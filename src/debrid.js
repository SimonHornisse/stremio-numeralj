'use strict';
/**
 * debrid.js — TorBox, RealDebrid, AllDebrid resolvers
 *
 * Each resolver:
 *   1. Calls the service's instant-availability endpoint first.
 *      If the torrent is NOT already cached → returns null immediately (~300 ms).
 *      This avoids the old 4-6 second polling loop for every non-cached torrent.
 *   2. If cached → add torrent + poll (max 3 × 1 s) → return direct CDN URL.
 *
 * All HTTPS calls share a keep-alive agent so TCP connections are reused
 * across the multiple API calls per resolver, saving ~150 ms each.
 */

const https = require('https');
const fetch = require('node-fetch');

// ─── Keep-alive HTTPS agent ───────────────────────────────────────────────────
const agent = new https.Agent({ keepAlive: true, maxSockets: 20 });

// Shorthand: merge agent + any extra opts
const f = (url, opts = {}) => fetch(url, { agent, ...opts });
const fj = (url, opts = {}) => f(url, opts).then(r => r.json()).catch(() => null);

// ─── Shared helpers ───────────────────────────────────────────────────────────
const sleep    = ms => new Promise(r => setTimeout(r, ms));
const isVideo  = name => /\.(mkv|mp4|avi|mov|m4v|wmv)$/i.test(name);
const norm     = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameOf   = f => f.name || f.filename || f.path || '';

function scoreFile(candidate, targetFile) {
    if (!targetFile) return 0;
    const tName = norm(targetFile.name || targetFile.path);
    const cName = norm(nameOf(candidate));
    if (!tName || !cName) return 0;

    let score = 0;
    const skip = new Set(['star','wars','the','clone','clones','1080p','2160p','hdr','x265','mkv','mp4']);
    for (const token of tName.split(' ').filter(t => t.length >= 2 && !skip.has(t))) {
        if (cName.includes(token)) score += token.length >= 4 ? 4 : 2;
    }
    if (targetFile.length && candidate.size) {
        if (Math.abs(Number(candidate.size) - Number(targetFile.length)) / Number(targetFile.length) < 0.03) score += 12;
    }
    if (targetFile.length && candidate.length) {
        if (Math.abs(Number(candidate.length) - Number(targetFile.length)) / Number(targetFile.length) < 0.03) score += 12;
    }
    if (targetFile.idx !== undefined && Number(candidate.id) === Number(targetFile.idx))     score += 5;
    if (targetFile.idx !== undefined && Number(candidate.id) === Number(targetFile.idx) + 1) score += 5;
    return score;
}

function pickDebridFile(files, fileIdx, targetFile) {
    if (!files.length) return null;
    if (targetFile) {
        const best = files.map(file => ({ file, score: scoreFile(file, targetFile) })).sort((a, b) => b.score - a.score)[0];
        if (best?.score > 0) return best.file;
    }
    const exact    = files.find(f => Number(f.id) === Number(fileIdx));
    const oneBased = files.find(f => Number(f.id) === Number(fileIdx) + 1);
    if (exact || oneBased) return exact || oneBased;
    const sorted = [...files].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return sorted[Math.min(fileIdx ?? 0, sorted.length - 1)] || files[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TorBox
// ═══════════════════════════════════════════════════════════════════════════════
const TB_API = 'https://api.torbox.app/v1/api';

async function torboxResolve(infoHash, fileIdx, apiKey, targetFile) {
    if (!apiKey) return null;
    const hash = infoHash.toLowerCase();
    const auth = { Authorization: `Bearer ${apiKey}` };

    try {
        // 1. Instant-availability check — bail immediately if not cached
        const check = await fj(
            `${TB_API}/torrents/checkcached?hash=${hash}&format=list&list_files=true`,
            { headers: auth }
        );
        const cached = check?.data?.[hash];
        if (!Array.isArray(cached) || cached.length === 0) return null;

        // 2. Add torrent
        const addRes = await fj(`${TB_API}/torrents/createtorrent`, {
            method:  'POST',
            headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${hash}`, seed: '1', allow_zip: 'false' }).toString(),
        });
        const torrentId = addRes?.data?.torrent_id || addRes?.detail?.torrent_id || addRes?.data?.id;
        if (!torrentId) return null;

        // 3. Poll (max 3 × 1 s — instant since we confirmed it's cached)
        for (let i = 0; i < 3; i++) {
            const info = await fj(`${TB_API}/torrents/mylist?id=${torrentId}&bypass_cache=true`, { headers: auth });
            const t    = Array.isArray(info?.data) ? info.data[0] : info?.data;
            if (!t) break;

            if (t.download_state === 'cached' || t.download_state === 'complete' || t.download_finished) {
                const files = (t.files || []).filter(f => isVideo(f.name));
                if (!files.length) break;
                const pick = pickDebridFile(files, fileIdx, targetFile);
                if (!pick) break;
                const linkRes = await fj(
                    `${TB_API}/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&file_id=${pick.id}&zip_link=false`
                );
                if (typeof linkRes?.data === 'string') return linkRes.data;
            }
            await sleep(1000);
        }
    } catch (e) { console.error('[TorBox]', e.message); }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RealDebrid
// ═══════════════════════════════════════════════════════════════════════════════
const RD_API = 'https://api.real-debrid.com/rest/1.0';

async function rdFetch(path, apiKey, opts = {}) {
    const res = await f(`${RD_API}${path}`, {
        ...opts,
        headers: { Authorization: `Bearer ${apiKey}`, ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`RD ${res.status}: ${(await res.text().catch(() => '')).slice(0, 80)}`);
    return res.json().catch(() => null);
}

async function realDebridResolve(infoHash, fileIdx, apiKey, targetFile) {
    if (!apiKey) return null;
    const hash = infoHash.toLowerCase();

    try {
        // 1. Instant-availability check — RD returns { [hash]: { rd: [...] } }
        const avail  = await rdFetch(`/torrents/instantAvailability/${hash}`, apiKey).catch(() => null);
        const rdList = avail?.[hash]?.rd ?? avail?.[hash.toUpperCase()]?.rd ?? [];
        if (!rdList.length) return null;

        // 2. Add magnet
        const added = await f(`${RD_API}/torrents/addMagnet`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({ magnet: `magnet:?xt=urn:btih:${hash}` }).toString(),
        }).then(r => r.json());
        const torrentId = added?.id;
        if (!torrentId) return null;

        // 3. Get file list, select best file
        let info = await rdFetch(`/torrents/info/${torrentId}`, apiKey);
        if (info?.status === 'magnet_error') return null;

        const rdFiles = (info?.files || []).filter(f => isVideo(f.path || ''));
        if (!rdFiles.length) return null;

        const pick = pickDebridFile(rdFiles, fileIdx, targetFile);
        await f(`${RD_API}/torrents/selectFiles/${torrentId}`, {
            method:  'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({ files: String(pick.id) }).toString(),
        });

        // 4. Poll for link (max 3 × 1 s — instant since cached)
        for (let i = 0; i < 3; i++) {
            info = await rdFetch(`/torrents/info/${torrentId}`, apiKey);
            if ((info?.links || []).length > 0) {
                const unres = await f(`${RD_API}/unrestrict/link`, {
                    method:  'POST',
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    body:    new URLSearchParams({ link: info.links[0] }).toString(),
                }).then(r => r.json());
                if (unres?.download) return unres.download;
            }
            if (info?.status === 'downloaded') break;
            await sleep(1000);
        }
    } catch (e) { console.error('[RealDebrid]', e.message); }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AllDebrid
// ═══════════════════════════════════════════════════════════════════════════════
const AD_API   = 'https://api.alldebrid.com/v4';
const AD_AGENT = 'NumeralJStremioAddon';

async function allDebridResolve(infoHash, fileIdx, apiKey, targetFile) {
    if (!apiKey) return null;
    const magnet = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;

    try {
        // 1. Instant-availability check
        const instant = await fj(
            `${AD_API}/magnet/instant?agent=${AD_AGENT}&apikey=${apiKey}&magnets[]=${encodeURIComponent(magnet)}`
        );
        if (!instant?.data?.magnets?.[0]?.instant) return null;

        // 2. Upload magnet
        const upload = await fj(
            `${AD_API}/magnet/upload?agent=${AD_AGENT}&apikey=${apiKey}&magnets[]=${encodeURIComponent(magnet)}`
        );
        const magnetId = upload?.data?.magnets?.[0]?.id;
        if (!magnetId) return null;

        // 3. Poll (max 4 × 1 s — should be Ready immediately since cached)
        for (let i = 0; i < 4; i++) {
            const status = await fj(
                `${AD_API}/magnet/status?agent=${AD_AGENT}&apikey=${apiKey}&id=${magnetId}`
            );
            const mag = status?.data?.magnets;
            if (!mag) break;

            if (mag.status === 'Ready') {
                const links = (mag.links || []).filter(l => isVideo(l.filename || ''));
                if (!links.length) break;
                const pick = pickDebridFile(links, fileIdx, targetFile);
                if (!pick) break;
                const unlock = await fj(
                    `${AD_API}/link/unlock?agent=${AD_AGENT}&apikey=${apiKey}&link=${encodeURIComponent(pick.link)}`
                );
                if (unlock?.data?.link) return unlock.data.link;
            }
            if (mag.status === 'Error') break;
            await sleep(1000);
        }
    } catch (e) { console.error('[AllDebrid]', e.message); }
    return null;
}

// ─── Unified resolver ─────────────────────────────────────────────────────────
async function resolveAllDebrid(infoHash, fileIdx, keys, targetFile) {
    const tasks = [
        keys.torbox     && torboxResolve(infoHash, fileIdx, keys.torbox, targetFile)    .then(u => u ? { service: 'TorBox',     url: u } : null).catch(() => null),
        keys.realdebrid && realDebridResolve(infoHash, fileIdx, keys.realdebrid, targetFile).then(u => u ? { service: 'RealDebrid', url: u } : null).catch(() => null),
        keys.alldebrid  && allDebridResolve(infoHash, fileIdx, keys.alldebrid, targetFile) .then(u => u ? { service: 'AllDebrid',  url: u } : null).catch(() => null),
    ].filter(Boolean);

    return (await Promise.all(tasks)).filter(Boolean);
}

module.exports = { torboxResolve, realDebridResolve, allDebridResolve, resolveAllDebrid };
