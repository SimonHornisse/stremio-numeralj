/**
 * torrent-meta.js
 *
 * Fetches the file listing for a torrent given its infoHash, without
 * downloading any content. Uses a chain of public torrent-info services
 * and falls back to a lightweight WebTorrent DHT metadata fetch.
 *
 * Returns an array like:
 *   [{ name: 'foo.mkv', path: 'Show/foo.mkv', length: 12345678, idx: 0 }, ...]
 * sorted by file path so the index is stable.
 *
 * Results are cached in memory (and persisted to torrent-cache.json).
 */

const fs     = require('fs');
const path   = require('path');
const fetch  = require('node-fetch');

const CACHE_FILE = path.join(__dirname, '../torrent-cache.json');

// ─── Persistent cache ─────────────────────────────────────────────────────────
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}

function saveCache() {
    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); } catch {}
}

// ─── Source 1: itorrents.org .torrent file + parse-torrent ───────────────────
async function fromItorrents(infoHash) {
    const url = `https://itorrents.org/torrent/${infoHash.toUpperCase()}.torrent`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) throw new Error(`itorrents ${res.status}`);
    const buf = await res.buffer();
    const parseTorrent = require('parse-torrent');
    const info = await parseTorrent(buf);
    return (info.files || []).map((f, i) => ({
        name:   path.basename(f.path || f.name),
        path:   f.path || f.name,
        length: f.length,
        idx:    i
    }));
}

// ─── Source 2: torrage.info API ───────────────────────────────────────────────
async function fromTorrage(infoHash) {
    const url = `https://torrage.info/torrent.php?h=${infoHash.toLowerCase()}`;
    const res = await fetch(url, { timeout: 8000 });
    if (!res.ok) throw new Error(`torrage ${res.status}`);
    const buf = await res.buffer();
    const parseTorrent = require('parse-torrent');
    const info = await parseTorrent(buf);
    return (info.files || []).map((f, i) => ({
        name:   path.basename(f.path || f.name),
        path:   f.path || f.name,
        length: f.length,
        idx:    i
    }));
}

// ─── Source 3: WebTorrent DHT metadata fetch (fallback, ~5-15s) ───────────────
async function fromWebtorrent(infoHash) {
    return new Promise((resolve, reject) => {
        let done = false;
        const timeout = setTimeout(() => {
            if (!done) { done = true; client.destroy(); reject(new Error('webtorrent timeout')); }
        }, 20000);

        // Import dynamically to avoid loading the whole WebTorrent on startup
        const WebTorrent = require('webtorrent');
        const client = new WebTorrent({ dht: true, tracker: true, lsd: false, utp: false });
        const magnet = `magnet:?xt=urn:btih:${infoHash}`;

        const torrent = client.add(magnet, { store: require('memory-chunk-store') });

        torrent.on('metadata', () => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            const files = torrent.files.map((f, i) => ({
                name:   f.name,
                path:   f.path,
                length: f.length,
                idx:    i
            }));
            client.destroy();
            resolve(files);
        });

        torrent.on('error', (err) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            client.destroy();
            reject(err);
        });
    });
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function getTorrentFiles(infoHash) {
    const key = infoHash.toLowerCase();
    if (cache[key]) return cache[key];

    console.log(`[torrent-meta] fetching file list for ${key}...`);

    let files = null;

    // Try fast HTTP sources first
    for (const source of [fromItorrents, fromTorrage]) {
        try {
            files = await source(key);
            if (files && files.length > 0) {
                console.log(`[torrent-meta] got ${files.length} files from ${source.name}`);
                break;
            }
        } catch (e) {
            console.log(`[torrent-meta] ${source.name} failed: ${e.message}`);
        }
    }

    // Fall back to DHT
    if (!files || files.length === 0) {
        try {
            files = await fromWebtorrent(key);
            console.log(`[torrent-meta] got ${files.length} files via DHT`);
        } catch (e) {
            console.log(`[torrent-meta] DHT failed: ${e.message}`);
            return null;
        }
    }

    // Only video files
    const videoFiles = files.filter(f => /\.(mkv|mp4|avi|mov|m4v)$/i.test(f.name));
    // Sort by path so index order is stable and sensible
    videoFiles.sort((a, b) => a.path.localeCompare(b.path));

    cache[key] = videoFiles;
    saveCache();
    return videoFiles;
}

/**
 * Given a list of torrent video files and an episode title/number hint,
 * return the best matching fileIdx.
 *
 * Strategy (in order):
 *  1. Sort files alphabetically — episode N means the Nth file (0-based)
 *  2. If a title is given, fuzzy-match against filenames
 */
function pickFileIdx(files, episodeNumber, episodeTitle) {
    if (!files || files.length === 0) return 0;

    // Title-based fuzzy match (normalize both sides)
    if (episodeTitle) {
        const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const needle = norm(episodeTitle);
        let best = -1, bestScore = 0;
        for (const f of files) {
            const hay = norm(f.name);
            // Count matching 4-grams
            let score = 0;
            for (let i = 0; i <= needle.length - 4; i++) {
                if (hay.includes(needle.slice(i, i + 4))) score++;
            }
            // Bonus: episode number in filename (E01, E1, ep1, part1 etc.)
            if (episodeNumber !== null) {
                const epPad = String(episodeNumber).padStart(2, '0');
                if (new RegExp(`[Ee]0*${episodeNumber}\\b|[Pp]art0*${episodeNumber}\\b|[Ff]ilm0*${episodeNumber}\\b`).test(f.name)) {
                    score += 10;
                }
                if (f.name.includes(epPad)) score += 3;
            }
            if (score > bestScore) { bestScore = score; best = f.idx; }
        }
        if (bestScore > 0) return best;
    }

    // Fall back to sequential: episode 1 → file[0], episode 2 → file[1], etc.
    if (episodeNumber !== null && episodeNumber > 0) {
        const i = episodeNumber - 1;
        return files[Math.min(i, files.length - 1)].idx;
    }

    return files[0].idx;
}

module.exports = { getTorrentFiles, pickFileIdx };
