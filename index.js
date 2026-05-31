const express = require('express');
const fs = require('fs');
const path = require('path');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const catalog = require('./catalog.json');
const { getTorrentFiles, pickFileIdx } = require('./torrent-meta');
const { resolveAllDebrid } = require('./debrid');
const { getMeta } = require('./metadata');
const { ensureArtwork, artworkUrls, artworkSvg } = require('./artwork');

// ─── Config — set via env vars or edit the defaults here ──────────────────────
const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const STREAM_CACHE_TTL_MS = Number(process.env.STREAM_CACHE_TTL_MS || 10 * 60 * 1000);
const DEBRID_TIMEOUT_MS = Number(process.env.DEBRID_TIMEOUT_MS || 4500);
const CONFIG_FILE = path.join(__dirname, 'config.json');

function readLocalConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function truthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

let configCache = { mtimeMs: 0, value: readLocalConfig() };

function getRuntimeConfig() {
    try {
        const stat = fs.statSync(CONFIG_FILE);
        if (stat.mtimeMs !== configCache.mtimeMs) {
            configCache = { mtimeMs: stat.mtimeMs, value: readLocalConfig() };
            if (typeof streamCache !== 'undefined') streamCache.clear();
        }
    } catch {
        configCache = { mtimeMs: 0, value: {} };
    }

    const cfg = configCache.value || {};
    const debrid = cfg.debrid || {};
    const debridKeys = {
        torbox:     process.env.TORBOX_API_KEY     || debrid.torbox     || '',
        realdebrid: process.env.REALDEBRID_API_KEY || debrid.realdebrid || '',
        alldebrid:  process.env.ALLDEBRID_API_KEY  || debrid.alldebrid  || '',
    };
    const hasDebridKey = Object.values(debridKeys).some(Boolean);
    const directDebrid = process.env.DIRECT_DEBRID !== undefined
        ? truthy(process.env.DIRECT_DEBRID)
        : cfg.directDebrid !== undefined
            ? cfg.directDebrid !== false
            : hasDebridKey;

    return {
        debridKeys,
        hasDebridKey,
        directDebrid,
        showGDrive: cfg.showGDrive !== false,
        showRawTorrents: cfg.showRawTorrents !== false,
    };
}

ensureArtwork(catalog);

// ─── Lookup maps ──────────────────────────────────────────────────────────────
const byId   = {};  // numeralj_* → item
const byImdb = {};  // tt*        → item

for (const item of catalog) {
    byId[item.id] = item;
    if (item.imdbId)    byImdb[item.imdbId]    = item;
    if (item.imdbIdAlt) byImdb[item.imdbIdAlt] = item;
}

// Parse Stremio id which may be "numeralj_5:1:3" or "tt0458290:1:3" or bare id
function parseId(rawId) {
    const parts = rawId.split(':');
    const baseId   = parts[0];
    const season   = parts[1] ? parseInt(parts[1], 10) : null;
    const episode  = parts[2] ? parseInt(parts[2], 10) : null;
    const item     = byId[baseId] || byImdb[baseId] || null;
    return { item, season, episode };
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
const manifest = {
    id: 'community.numeralj.starwars',
    version: '1.4.0',
    name: 'NumeralJ Star Wars Cuts',
    description:
        'NumeralJ / Mecha Salesman fan edits — Extended Editions, Siege of Mandalore Supercut, ' +
        'TV Film Cuts and more. Episode-level Google Drive links, fileIdx torrent streams, and optional debrid direct links.',
    logo: artworkUrls(byId.numeralj_3, BASE_URL).logo,
    background: artworkUrls(byId.numeralj_3, BASE_URL).background,
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    idPrefixes: ['numeralj_', 'tt'],
    catalogs: [
        {
            type: 'movie',
            id: 'numeralj_movies',
            name: 'NumeralJ Movies',
            extra: [{ name: 'search', isRequired: false }]
        },
        {
            type: 'series',
            id: 'numeralj_series',
            name: 'NumeralJ Series',
            extra: [{ name: 'search', isRequired: false }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function itemImages(item) {
    return artworkUrls(item, BASE_URL);
}

function itemDescription(item) {
    const meta = getMeta(item);
    const episodeCount = item.episodes ? `\nEpisodes: ${item.episodes.length}` : '';
    const qualities = item.streams.map(s => s.quality).join(' / ');
    return `${meta.description || meta.tagline || 'NumeralJ / Mecha Salesman fan edit.'}\n\nQualities: ${qualities}${episodeCount}`;
}

// Build meta.videos array for series
function buildVideos(item) {
    if (!item.episodes) return [];
    return item.episodes.map(ep => ({
        id:       `${item.id}:${ep.season}:${ep.episode}`,
        title:    ep.title,
        season:   ep.season,
        episode:  ep.episode,
        released: new Date(2020, 0, 1 + ep.episode).toISOString(),
        thumbnail: itemImages(item).background,
        overview: `NumeralJ chapter: ${ep.title}. Available streams: ${Object.keys(ep.gdrive || {}).join(' / ') || 'torrent'}.`
    }));
}

// ─── Catalog ──────────────────────────────────────────────────────────────────
builder.defineCatalogHandler(({ type, id, extra }) => {
    const search = ((extra && extra.search) || '').toLowerCase();
    const metas = catalog
        .filter(item => item.type === type)
        .filter(item => !search || item.title.toLowerCase().includes(search))
        .map(item => ({
            id:          item.id,
            type:        item.type,
            name:        item.title,
            poster:      itemImages(item).poster,
            background:  itemImages(item).background,
            description: itemDescription(item),
            genres:      getMeta(item).genres,
            releaseInfo: getMeta(item).releaseInfo
        }));
    return Promise.resolve({ metas });
});

// ─── Meta ─────────────────────────────────────────────────────────────────────
builder.defineMetaHandler(({ type, id }) => {
    const { item } = parseId(id);
    if (!item) return Promise.resolve({ meta: null });

    const custom = getMeta(item);
    const images = itemImages(item);
    const meta = {
        id:          item.id,
        type:        item.type,
        name:        item.title,
        poster:      images.poster,
        background:  images.background,
        logo:        images.logo,
        description: itemDescription(item),
        genres:      custom.genres,
        releaseInfo: custom.releaseInfo,
        runtime:     custom.runtime,
        country:     custom.country,
        language:    custom.language,
        director:    custom.director,
        cast:        custom.cast || ['NumeralJ / Mecha Salesman'],
        imdbRating:  custom.imdbRating || undefined
    };

    if (item.type === 'series' && item.episodes) {
        meta.videos = buildVideos(item);
    }

    return Promise.resolve({ meta });
});

// ─── Stream builder helpers ───────────────────────────────────────────────────

// Resolve fileIdx from torrent metadata, returns { fileIdx, fileLabel }
const fileIdxCache = new Map();
async function resolveFileIdx(infoHash, epNumber, epTitle) {
    const cacheKey = `${infoHash}:${epNumber}:${epTitle || ''}`;
    if (fileIdxCache.has(cacheKey)) return fileIdxCache.get(cacheKey);

    try {
        const files = await getTorrentFiles(infoHash);
        if (files && files.length > 1) {
            const fileIdx = pickFileIdx(files, epNumber, epTitle);
            const matched = files.find(f => f.idx === fileIdx);
            const fileLabel = matched
                ? `file ${files.indexOf(matched) + 1}/${files.length}: ${matched.name.slice(0, 45)}`
                : `file ?/${files.length}`;
            const resolved = { fileIdx, fileLabel, targetFile: matched || null };
            fileIdxCache.set(cacheKey, resolved);
            return resolved;
        }
    } catch {}
    const fallback = { fileIdx: 0, fileLabel: null };
    fileIdxCache.set(cacheKey, fallback);
    return fallback;
}

// Build debrid direct-URL streams for a given infoHash + fileIdx
async function buildDebridStreams(infoHash, fileIdx, quality, bingeGroup, runtime, targetFile) {
    if (!runtime.directDebrid || !runtime.hasDebridKey) return [];

    const timeout = new Promise(resolve => setTimeout(() => resolve([]), DEBRID_TIMEOUT_MS));
    const results = await Promise.race([
        resolveAllDebrid(infoHash, fileIdx, runtime.debridKeys, targetFile),
        timeout
    ]);
    return results.map(({ service, url }) => ({
        name:  `[NumeralJ]\n${quality} ${service}`,
        title: `${quality} · via ${service} (direct)`,
        url,
        behaviorHints: { notWebReady: false, bingeGroup }
    }));
}

const streamCache = new Map();

function getCachedStreams(key) {
    const cached = streamCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.time > STREAM_CACHE_TTL_MS) {
        streamCache.delete(key);
        return null;
    }
    return cached.value;
}

function setCachedStreams(key, value) {
    streamCache.set(key, { time: Date.now(), value });
    return value;
}

// ─── Stream handler ───────────────────────────────────────────────────────────
builder.defineStreamHandler(async ({ type, id }) => {
    const runtime = getRuntimeConfig();
    const serviceKey = Object.entries(runtime.debridKeys).filter(([, value]) => value).map(([key]) => key).join(',');
    const cacheKey = `${type}:${id}:${runtime.directDebrid ? 'direct' : 'fast'}:${runtime.showGDrive}:${runtime.showRawTorrents}:${serviceKey}`;
    const cached = getCachedStreams(cacheKey);
    if (cached) return cached;

    const { item, season, episode } = parseId(id);
    if (!item) return { streams: [] };

    const streams = [];
    const binge = `numeralj-${item.id}`;

    // ── Series episode ────────────────────────────────────────────────────────
    if (item.type === 'series' && item.episodes && season !== null && episode !== null) {
        const ep = item.episodes.find(e => e.season === season && e.episode === episode);
        if (!ep) return { streams: [] };

        // 1. Google Drive (per-episode direct file)
        if (runtime.showGDrive) {
            for (const [quality, url] of Object.entries(ep.gdrive || {})) {
                streams.push({
                    name:  `[NumeralJ]\n${quality} GDrive`,
                    title: `${ep.title}\n${quality} · Google Drive`,
                    externalUrl: url,
                    behaviorHints: { notWebReady: true, bingeGroup: binge }
                });
            }
        }

        const resolvedTorrentStreams = await Promise.all(item.streams.map(async s => ({
            ...s,
            ...(await resolveFileIdx(s.infoHash, ep.episode, ep.title))
        })));

        // 2. infoHash + fileIdx (Stremio native torrent / aggregator debrid)
        if (runtime.showRawTorrents) {
            for (const s of resolvedTorrentStreams) {
                const label = s.fileLabel || 'series torrent';
                streams.push({
                    name:  `[NumeralJ]\n${s.quality}`,
                    title: `${ep.title}\n${s.quality} · ${label}`,
                    infoHash: s.infoHash,
                    fileIdx: s.fileIdx,
                    behaviorHints: { bingeGroup: binge }
                });
            }
        }

        // 3. Debrid direct links (TorBox / RealDebrid / AllDebrid)
        const debridGroups = await Promise.all(resolvedTorrentStreams.map(async s => {
            const debridStreams = await buildDebridStreams(s.infoHash, s.fileIdx, s.quality, binge, runtime, s.targetFile);
            return debridStreams.map(ds => ({ ...ds, title: `${ep.title}\n${ds.title}` }));
        }));
        streams.push(...debridGroups.flat());

        return setCachedStreams(cacheKey, { streams });
    }

    // ── Movie (or bare series id with no episode) ─────────────────────────────

    // 1. Google Drive
    if (runtime.showGDrive) {
        for (const [quality, url] of Object.entries(item.gdrive || {})) {
            streams.push({
                name:  `[NumeralJ]\n${quality} GDrive`,
                title: `${item.title}\n${quality} · Google Drive`,
                externalUrl: url,
                behaviorHints: { notWebReady: true }
            });
        }
    }

    // 2. infoHash (Stremio native / Stremio built-in debrid)
    if (runtime.showRawTorrents) {
        for (const s of item.streams) {
            streams.push({
                name:  `[NumeralJ]\n${s.quality}`,
                title: `${item.title}\n${s.quality} · torrent`,
                infoHash: s.infoHash,
                fileIdx:  0,
                behaviorHints: { notWebReady: false }
            });
        }
    }

    // 3. Debrid direct links
    const debridGroups = await Promise.all(item.streams.map(async s => {
        const debridStreams = await buildDebridStreams(s.infoHash, 0, s.quality, binge, runtime, null);
        return debridStreams.map(ds => ({ ...ds, title: `${item.title}\n${ds.title}` }));
    }));
    streams.push(...debridGroups.flat());

    return setCachedStreams(cacheKey, { streams });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const addonInterface = builder.getInterface();
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
    if (req.path.startsWith('/art/')) {
        res.setHeader('Cache-Control', 'max-age=86400, public');
    } else {
        res.setHeader('Cache-Control', 'no-store');
    }
    next();
});
app.get('/', (_, res) => {
    const runtime = getRuntimeConfig();
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>NumeralJ Stremio Addon</title>
<style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;background:#111827;color:#e5e7eb}
a{color:#93c5fd} code{background:#1f2937;padding:2px 6px;border-radius:5px}
.box{border:1px solid #374151;border-radius:8px;padding:20px;background:#151f2e}
</style></head><body>
<h1>NumeralJ Star Wars Cuts</h1>
<div class="box">
<p>Install URL: <code>${BASE_URL}/manifest.json</code></p>
<p>Configure debrid keys: <a href="/configure">/configure</a></p>
<p>Current direct debrid mode: <strong>${runtime.directDebrid ? 'enabled' : 'disabled'}</strong></p>
<p>Loaded debrid services: <strong>${Object.entries(runtime.debridKeys).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}</strong></p>
</div>
</body></html>`);
});
app.get('/configure', (_, res) => {
    const cfg = readLocalConfig();
    const debrid = cfg.debrid || {};
    const checked = value => value === false ? '' : 'checked';
    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Configure NumeralJ</title>
<style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;background:#111827;color:#e5e7eb}
label{display:block;margin:16px 0 6px;font-weight:700} input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:10px;border-radius:6px;border:1px solid #4b5563;background:#0b1220;color:#e5e7eb}
.row{margin:14px 0}.box{border:1px solid #374151;border-radius:8px;padding:20px;background:#151f2e}button{padding:10px 14px;border:0;border-radius:6px;background:#2563eb;color:white;font-weight:800}
small{color:#a7b0c0} a{color:#93c5fd}
</style></head><body>
<h1>Configure Debrid</h1>
<form class="box" method="post" action="/configure">
<label>TorBox API key</label>
<input type="password" name="torbox" value="${debrid.torbox || ''}">
<label>RealDebrid API key</label>
<input type="password" name="realdebrid" value="${debrid.realdebrid || ''}">
<label>AllDebrid API key</label>
<input type="password" name="alldebrid" value="${debrid.alldebrid || ''}">
<div class="row"><label><input type="checkbox" name="directDebrid" ${checked(cfg.directDebrid)}> Show direct debrid streams from this addon</label><small>Requires at least one key above. If off, you only get GDrive + raw torrent/fileIdx streams.</small></div>
<div class="row"><label><input type="checkbox" name="showGDrive" ${checked(cfg.showGDrive)}> Show Google Drive streams</label></div>
<div class="row"><label><input type="checkbox" name="showRawTorrents" ${checked(cfg.showRawTorrents)}> Show raw torrent / fileIdx streams</label></div>
<button type="submit">Save config</button>
</form>
<p>After saving, restart <code>node index.js</code>, then reinstall or reload <code>${BASE_URL}/manifest.json</code> in Stremio.</p>
<p><a href="/">Back</a></p>
</body></html>`);
});
app.post('/configure', (req, res) => {
    const body = req.body || {};
    const clean = value => String(value || '').trim();
    const nextConfig = {
        directDebrid: body.directDebrid === 'on',
        showGDrive: body.showGDrive === 'on',
        showRawTorrents: body.showRawTorrents === 'on',
        debrid: {
            torbox: clean(body.torbox),
            realdebrid: clean(body.realdebrid),
            alldebrid: clean(body.alldebrid),
        }
    };
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(nextConfig, null, 2));
    } catch (error) {
        res.status(500).type('html').send(`<!doctype html><html><body style="font-family:system-ui;background:#111827;color:#e5e7eb;max-width:680px;margin:48px auto">
<h1>Could not save config</h1>
<p>Node could not write to <code>${CONFIG_FILE}</code>.</p>
<pre style="white-space:pre-wrap;background:#0b1220;padding:12px;border-radius:8px">${String(error.message)}</pre>
<p>Edit <code>config.json</code> manually, or run the addon from a terminal with write access.</p>
<p><a style="color:#93c5fd" href="/configure">Back to configure</a></p>
</body></html>`);
        return;
    }
    res.type('html').send(`<!doctype html><html><body style="font-family:system-ui;background:#111827;color:#e5e7eb;max-width:680px;margin:48px auto">
<h1>Saved</h1>
<p>Config was written to <code>${CONFIG_FILE}</code>.</p>
<p>Restart the addon for the new keys to load.</p>
<p><a style="color:#93c5fd" href="/configure">Back to configure</a></p>
</body></html>`);
});
app.get('/art/:kind/:id.svg', (req, res) => {
    const item = byId[req.params.id];
    if (!item || !['poster', 'background', 'logo'].includes(req.params.kind)) {
        res.status(404).end('not found');
        return;
    }
    res.type('image/svg+xml').send(artworkSvg(req.params.kind, item));
});
app.use(getRouter(addonInterface));

const server = app.listen(PORT, () => {
    console.log('HTTP addon accessible at:', `${BASE_URL}/manifest.json`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌  Port ${PORT} is already in use. Stop the other process first, or set PORT=xxxx.\n`);
    } else {
        console.error('Server error:', err.message);
    }
    process.exit(1);
});

const startupRuntime = getRuntimeConfig();
const activeServices = Object.entries(startupRuntime.debridKeys).filter(([, v]) => v).map(([k]) => k);
console.log(`\n✅  NumeralJ addon v1.4.0 on port ${PORT}`);
console.log(`   Install:   stremio://127.0.0.1:${PORT}/manifest.json`);
console.log(`   Manifest:  ${BASE_URL}/manifest.json`);
console.log(`   Artwork:   ${BASE_URL}/art/poster/numeralj_3.svg`);
console.log(`   Logo:      ${BASE_URL}/art/logo/numeralj_3.svg`);
console.log(`   Debrid:    ${startupRuntime.directDebrid ? (activeServices.length ? activeServices.join(', ') : 'direct enabled - no keys') : 'direct debrid disabled'}`);
console.log(`\n   Fastest path: use Stremio/AIOStreams/Comet debrid with the infoHash + fileIdx streams.`);
console.log(`   To enable addon direct debrid URLs: set DIRECT_DEBRID=1 plus TORBOX_API_KEY / REALDEBRID_API_KEY / ALLDEBRID_API_KEY.`);
console.log(`\n   To add RealDebrid:  set REALDEBRID_API_KEY=your_key`);
console.log(`   To add AllDebrid:   set ALLDEBRID_API_KEY=your_key\n`);
