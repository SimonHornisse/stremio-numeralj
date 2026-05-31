/**
 * debrid.js — RealDebrid, AllDebrid, and TorBox resolvers
 *
 * Each resolver takes an infoHash + optional fileIdx and returns a direct
 * streamable HTTP URL, or null if unavailable/not cached.
 *
 * Env vars (set whichever services you use):
 *   TORBOX_API_KEY      — TorBox API key
 *   REALDEBRID_API_KEY  — RealDebrid API key (from https://real-debrid.com/apitoken)
 *   ALLDEBRID_API_KEY   — AllDebrid API key  (from https://alldebrid.com/apikeys)
 */

const fetch = require('node-fetch');

// ─── Shared helpers ───────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isVideo(name) { return /\.(mkv|mp4|avi|mov|m4v|wmv)$/i.test(name); }

function norm(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fileNameOf(file) {
    return file.name || file.filename || file.path || '';
}

function scoreFile(candidate, targetFile) {
    if (!targetFile) return 0;
    const targetName = norm(targetFile.name || targetFile.path);
    const candidateName = norm(fileNameOf(candidate));
    if (!targetName || !candidateName) return 0;

    let score = 0;
    const targetTokens = targetName.split(' ').filter(t => t.length >= 2 && !['star', 'wars', 'the', 'clone', 'clones', '1080p', '2160p', 'hdr', 'x265', 'mkv', 'mp4'].includes(t));
    for (const token of targetTokens) {
        if (candidateName.includes(token)) score += token.length >= 4 ? 4 : 2;
    }

    if (targetFile.length && candidate.size) {
        const diff = Math.abs(Number(candidate.size) - Number(targetFile.length));
        if (diff / Number(targetFile.length) < 0.03) score += 12;
    }
    if (targetFile.length && candidate.length) {
        const diff = Math.abs(Number(candidate.length) - Number(targetFile.length));
        if (diff / Number(targetFile.length) < 0.03) score += 12;
    }
    if (targetFile.idx !== undefined && Number(candidate.id) === Number(targetFile.idx)) score += 5;
    if (targetFile.idx !== undefined && Number(candidate.id) === Number(targetFile.idx) + 1) score += 5;
    return score;
}

function pickDebridFile(files, fileIdx, targetFile) {
    if (!files.length) return null;

    if (targetFile) {
        const scored = files
            .map(file => ({ file, score: scoreFile(file, targetFile) }))
            .sort((a, b) => b.score - a.score);
        if (scored[0] && scored[0].score > 0) return scored[0].file;
    }

    const exact = files.find(f => Number(f.id) === Number(fileIdx));
    const oneBased = files.find(f => Number(f.id) === Number(fileIdx) + 1);
    if (exact || oneBased) return exact || oneBased;

    const sorted = [...files].sort((a, b) => fileNameOf(a).localeCompare(fileNameOf(b)));
    return sorted[Math.min(fileIdx ?? 0, sorted.length - 1)] || files[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TorBox
// ═══════════════════════════════════════════════════════════════════════════════
const TB_API = 'https://api.torbox.app/v1/api';

async function torboxResolve(infoHash, fileIdx, apiKey, targetFile) {
    if (!apiKey) return null;
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;

    try {
        // Add/find torrent
        const form = new URLSearchParams({ magnet, seed: '1', allow_zip: 'false' });
        const addRes = await fetch(`${TB_API}/torrents/createtorrent`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString()
        }).then(r => r.json());

        const torrentId = addRes?.data?.torrent_id || addRes?.detail?.torrent_id || addRes?.data?.id;
        if (!torrentId) return null;

        // Poll for cached/complete
        for (let i = 0; i < 6; i++) {
            const info = await fetch(`${TB_API}/torrents/mylist?id=${torrentId}&bypass_cache=true`, {
                headers: { Authorization: `Bearer ${apiKey}` }
            }).then(r => r.json());

            const t = Array.isArray(info?.data) ? info.data[0] : info?.data;
            if (!t) break;

            const ready = t.download_state === 'cached' || t.download_state === 'complete' || t.download_finished;
            if (ready) {
                const files = (t.files || []).filter(f => isVideo(f.name));
                if (!files.length) break;

                const pick = pickDebridFile(files, fileIdx, targetFile);
                if (!pick) break;

                const linkRes = await fetch(
                    `${TB_API}/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${pick.id}&zip_link=false`
                ).then(r => r.json());

                const url = linkRes?.data;
                if (url && typeof url === 'string') return url;
            }
            await sleep(1000);
        }
    } catch (e) {
        console.error('[TorBox]', e.message);
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RealDebrid
// ═══════════════════════════════════════════════════════════════════════════════
const RD_API = 'https://api.real-debrid.com/rest/1.0';

async function rdFetch(path, apiKey, opts = {}) {
    const res = await fetch(`${RD_API}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${apiKey}`, ...(opts.headers || {}) }
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`RD ${res.status}: ${txt.slice(0, 100)}`);
    }
    return res.json().catch(() => null);
}

async function realDebridResolve(infoHash, fileIdx, apiKey, targetFile) {
    if (!apiKey) return null;
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;

    try {
        // 1. Add magnet
        const body = new URLSearchParams({ magnet });
        const added = await fetch(`${RD_API}/torrents/addMagnet`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        }).then(r => r.json());

        const torrentId = added?.id;
        if (!torrentId) return null;

        // 2. Get torrent info to see the file list
        let info = await rdFetch(`/torrents/info/${torrentId}`, apiKey);

        // If it's already "downloaded" / "cached" the files are already selected
        if (info?.status === 'magnet_error') return null;

        const rdFiles = (info?.files || []).filter(f => isVideo(f.path || ''));
        if (!rdFiles.length) return null;

        const pick = pickDebridFile(rdFiles, fileIdx, targetFile);

        await fetch(`${RD_API}/torrents/selectFiles/${torrentId}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ files: String(pick.id) }).toString()
        });

        // 4. Poll for download link (instant if cached, else skip)
        for (let i = 0; i < 6; i++) {
            info = await rdFetch(`/torrents/info/${torrentId}`, apiKey);
            const links = info?.links || [];
            if (links.length > 0) {
                // 5. Unrestrict the link to get a direct CDN URL
                const unres = await fetch(`${RD_API}/unrestrict/link`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ link: links[0] }).toString()
                }).then(r => r.json());

                const url = unres?.download;
                if (url) return url;
            }
            if (info?.status === 'downloaded') break;
            await sleep(1000);
        }
    } catch (e) {
        console.error('[RealDebrid]', e.message);
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AllDebrid
// ═══════════════════════════════════════════════════════════════════════════════
const AD_API = 'https://api.alldebrid.com/v4';
const AD_AGENT = 'NumeralJStremioAddon';

async function allDebridResolve(infoHash, fileIdx, apiKey, targetFile) {
    if (!apiKey) return null;
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;

    try {
        // 1. Upload magnet
        const upload = await fetch(
            `${AD_API}/magnet/upload?agent=${AD_AGENT}&apikey=${apiKey}&magnets[]=${encodeURIComponent(magnet)}`
        ).then(r => r.json());

        const magnetId = upload?.data?.magnets?.[0]?.id;
        if (!magnetId) return null;

        // 2. Poll for status
        for (let i = 0; i < 8; i++) {
            const status = await fetch(
                `${AD_API}/magnet/status?agent=${AD_AGENT}&apikey=${apiKey}&id=${magnetId}`
            ).then(r => r.json());

            const magData = status?.data?.magnets;
            if (!magData) break;

            const st = magData.status;
            if (st === 'Ready') {
                const links = (magData.links || []).filter(l => isVideo(l.filename || ''));
                if (!links.length) break;

                const pick = pickDebridFile(links, fileIdx, targetFile);
                if (!pick) break;

                // 3. Unlock/unrestrict the link
                const unlock = await fetch(
                    `${AD_API}/link/unlock?agent=${AD_AGENT}&apikey=${apiKey}&link=${encodeURIComponent(pick.link)}`
                ).then(r => r.json());

                const url = unlock?.data?.link;
                if (url) return url;
            }
            if (st === 'Error') break;
            await sleep(1000);
        }
    } catch (e) {
        console.error('[AllDebrid]', e.message);
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unified resolver — runs all configured services in parallel
// ═══════════════════════════════════════════════════════════════════════════════
async function resolveAllDebrid(infoHash, fileIdx, keys, targetFile) {
    const tasks = [];

    if (keys.torbox)     tasks.push(torboxResolve(infoHash, fileIdx, keys.torbox, targetFile)    .then(u => u ? { service: 'TorBox',     url: u } : null).catch(() => null));
    if (keys.realdebrid) tasks.push(realDebridResolve(infoHash, fileIdx, keys.realdebrid, targetFile).then(u => u ? { service: 'RealDebrid', url: u } : null).catch(() => null));
    if (keys.alldebrid)  tasks.push(allDebridResolve(infoHash, fileIdx, keys.alldebrid, targetFile) .then(u => u ? { service: 'AllDebrid',  url: u } : null).catch(() => null));

    const results = await Promise.all(tasks);
    return results.filter(Boolean); // [{ service, url }, ...]
}

module.exports = { torboxResolve, realDebridResolve, allDebridResolve, resolveAllDebrid };
