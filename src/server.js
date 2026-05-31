'use strict';
const express     = require('express');
const path        = require('path');
const compression = require('compression');

const { getManifest, catalogHandler, metaHandler, streamHandler, prewarmTorrentCache } = require('./addon');
const { artworkSvg, ensureArtwork } = require('./artwork');
const catalog = require('../catalog.json');

const PORT = process.env.PORT || 7000;

// ─── Artwork lookup ───────────────────────────────────────────────────────────
const byId = {};
for (const item of catalog) byId[item.id] = item;
ensureArtwork(catalog);

// ─── App ──────────────────────────────────────────────────────────────────────
const app = express();

// Gzip all JSON/HTML/SVG responses
app.use(compression());

// CORS — required by Stremio for any remote addon
app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// Cache-Control
app.use((req, res, next) => {
    res.setHeader(
        'Cache-Control',
        req.path.startsWith('/art/') ? 'max-age=86400, public' : 'no-store'
    );
    next();
});

// ─── Configure page ───────────────────────────────────────────────────────────
app.get('/',          (_req, res) => res.sendFile(path.join(__dirname, 'configure.html')));
app.get('/configure', (_req, res) => res.sendFile(path.join(__dirname, 'configure.html')));

// ─── Artwork (no config needed) ───────────────────────────────────────────────
app.get('/art/:kind/:id.svg', (req, res) => {
    const item = byId[req.params.id];
    if (!item || !['poster', 'background', 'logo'].includes(req.params.kind))
        return res.status(404).end('not found');
    res.type('image/svg+xml').send(artworkSvg(req.params.kind, item));
});

// ─── Health check ─────────────────────────────────────────────────────────────
// Returns which debrid keys are configured (boolean only — never the key value).
// Used by the configure page to show a live status indicator.
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        keys: {
            torbox:     Boolean(process.env.TORBOX_API_KEY),
            realdebrid: Boolean(process.env.REALDEBRID_API_KEY),
            alldebrid:  Boolean(process.env.ALLDEBRID_API_KEY),
        },
    });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function decodeConfig(str) {
    try { return JSON.parse(Buffer.from(str, 'base64').toString()); }
    catch { return {}; }
}

function getBaseUrl(req) {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host  = req.headers['x-forwarded-host']  || req.get('host');
    return `${proto}://${host}`;
}

// ─── Stremio routes ───────────────────────────────────────────────────────────
app.get('/:config/manifest.json', (req, res) => {
    res.json(getManifest(decodeConfig(req.params.config), getBaseUrl(req)));
});

app.get('/:config/catalog/:type/:id.json', (req, res) => {
    res.json({ metas: catalogHandler(decodeConfig(req.params.config), req.params.type, req.params.id, req.query, getBaseUrl(req)) });
});

app.get('/:config/meta/:type/:id.json', (req, res) => {
    res.json({ meta: metaHandler(decodeConfig(req.params.config), req.params.type, req.params.id, getBaseUrl(req)) });
});

app.get('/:config/stream/:type/:id.json', async (req, res) => {
    try {
        const streams = await streamHandler(decodeConfig(req.params.config), req.params.type, req.params.id);
        res.json({ streams });
    } catch (err) {
        console.error('[stream error]', err.message);
        res.json({ streams: [] });
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`\n✅  NumeralJ addon v1.4.0 on port ${PORT}`);
    console.log(`   Configure: http://localhost:${PORT}/configure\n`);

    // Pre-warm torrent file cache in the background after startup
    prewarmTorrentCache().catch(() => {});
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE')
        console.error(`\n❌  Port ${PORT} is already in use. Stop the other process first, or set PORT=xxxx.\n`);
    else
        console.error('Server error:', err.message);
    process.exit(1);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Railway sends SIGTERM before stopping a container. We finish in-flight
// requests (up to 10 s) before exiting so no stream requests are dropped mid-deploy.
function shutdown(signal) {
    console.log(`\n${signal} received — shutting down gracefully…`);
    server.close(() => {
        console.log('Server closed. Exiting.');
        process.exit(0);
    });
    setTimeout(() => { console.error('Forced exit after timeout.'); process.exit(1); }, 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
