'use strict';
const catalog                         = require('../catalog.json');
const { getTorrentFiles, pickFileIdx } = require('../torrent-meta');
const { resolveAllDebrid }             = require('../debrid');
const { getMeta }                      = require('../metadata');
const { artworkUrls }                  = require('../artwork');

const STREAM_CACHE_TTL_MS = Number(process.env.STREAM_CACHE_TTL_MS || 10 * 60 * 1000);
const DEBRID_TIMEOUT_MS   = Number(process.env.DEBRID_TIMEOUT_MS   || 4500);

// ─── Lookup maps ──────────────────────────────────────────────────────────────
const byId   = {};
const byImdb = {};
for (const item of catalog) {
    byId[item.id] = item;
    if (item.imdbId)    byImdb[item.imdbId]    = item;
    if (item.imdbIdAlt) byImdb[item.imdbIdAlt] = item;
}

function parseId(rawId) {
    const parts   = rawId.split(':');
    const baseId  = parts[0];
    const season  = parts[1] ? parseInt(parts[1], 10) : null;
    const episode = parts[2] ? parseInt(parts[2], 10) : null;
    return { item: byId[baseId] || byImdb[baseId] || null, season, episode };
}

// ─── Config normaliser ────────────────────────────────────────────────────────
// Turns the raw URL-encoded config object into a resolved runtime object.
function resolveConfig(cfg) {
    const debridKeys = {
        torbox:     cfg.torbox     || '',
        realdebrid: cfg.realdebrid || '',
        alldebrid:  cfg.alldebrid  || '',
    };
    const hasDebridKey = Object.values(debridKeys).some(Boolean);
    return {
        debridKeys,
        hasDebridKey,
        // directDebrid is only active when there is at least one key
        directDebrid:    Boolean(cfg.directDebrid) && hasDebridKey,
        showGDrive:      cfg.showGDrive      !== false,
        showRawTorrents: cfg.showRawTorrents !== false,
    };
}

// ─── Manifest ─────────────────────────────────────────────────────────────────
function getManifest(cfg, baseUrl) {
    const imgs = artworkUrls(byId.numeralj_3, baseUrl);
    return {
        id: 'community.numeralj.starwars',
        version: '1.4.0',
        name: 'NumeralJ Star Wars Cuts',
        description:
            'NumeralJ / Mecha Salesman fan edits — Extended Editions, Siege of Mandalore Supercut, ' +
            'TV Film Cuts and more. Episode-level Google Drive links, fileIdx torrent streams, and optional debrid direct links.',
        logo:       imgs.logo,
        background: imgs.background,
        resources:  ['catalog', 'meta', 'stream'],
        types:      ['movie', 'series'],
        idPrefixes: ['numeralj_', 'tt'],
        catalogs: [
            { type: 'movie',  id: 'numeralj_movies', name: 'NumeralJ Movies',  extra: [{ name: 'search', isRequired: false }] },
            { type: 'series', id: 'numeralj_series', name: 'NumeralJ Series', extra: [{ name: 'search', isRequired: false }] },
        ],
    };
}

// ─── Catalog handler ──────────────────────────────────────────────────────────
function catalogHandler(cfg, type, _id, extra, baseUrl) {
    const search = ((extra && extra.search) || '').toLowerCase();
    return catalog
        .filter(item => item.type === type)
        .filter(item => !search || item.title.toLowerCase().includes(search))
        .map(item => {
            const imgs = artworkUrls(item, baseUrl);
            const meta = getMeta(item);
            return {
                id:          item.id,
                type:        item.type,
                name:        item.title,
                poster:      imgs.poster,
                background:  imgs.background,
                description: itemDescription(item),
                genres:      meta.genres,
                releaseInfo: meta.releaseInfo,
            };
        });
}

// ─── Meta handler ─────────────────────────────────────────────────────────────
function metaHandler(cfg, type, id, baseUrl) {
    const { item } = parseId(id);
    if (!item) return null;

    const custom = getMeta(item);
    const imgs   = artworkUrls(item, baseUrl);
    const meta   = {
        id:          item.id,
        type:        item.type,
        name:        item.title,
        poster:      imgs.poster,
        background:  imgs.background,
        logo:        imgs.logo,
        description: itemDescription(item),
        genres:      custom.genres,
        releaseInfo: custom.releaseInfo,
        runtime:     custom.runtime,
        country:     custom.country,
        language:    custom.language,
        director:    custom.director,
        cast:        custom.cast || ['NumeralJ / Mecha Salesman'],
        imdbRating:  custom.imdbRating || undefined,
    };

    if (item.type === 'series' && item.episodes)
        meta.videos = buildVideos(item, baseUrl);

    return meta;
}

// ─── Stream handler ───────────────────────────────────────────────────────────
const streamCache = new Map();

function getCachedStreams(key) {
    const cached = streamCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.time > STREAM_CACHE_TTL_MS) { streamCache.delete(key); return null; }
    return cached.streams;
}

function setCachedStreams(key, streams) {
    streamCache.set(key, { time: Date.now(), streams });
    return streams;
}

async function streamHandler(cfg, type, id) {
    const runtime    = resolveConfig(cfg);
    const serviceKey = Object.entries(runtime.debridKeys).filter(([, v]) => v).map(([k]) => k).join(',');
    const cacheKey   = `${type}:${id}:${runtime.directDebrid}:${runtime.showGDrive}:${runtime.showRawTorrents}:${serviceKey}`;

    const cached = getCachedStreams(cacheKey);
    if (cached) return cached;

    const { item, season, episode } = parseId(id);
    if (!item) return [];

    const streams = [];
    const binge   = `numeralj-${item.id}`;

    // ── Series episode ────────────────────────────────────────────────────────
    if (item.type === 'series' && item.episodes && season !== null && episode !== null) {
        const ep = item.episodes.find(e => e.season === season && e.episode === episode);
        if (!ep) return [];

        // 1. Google Drive
        if (runtime.showGDrive) {
            for (const [quality, url] of Object.entries(ep.gdrive || {})) {
                streams.push({
                    name:          `[NumeralJ]\n${quality} GDrive`,
                    title:         `${ep.title}\n${quality} · Google Drive`,
                    externalUrl:   url,
                    behaviorHints: { notWebReady: true, bingeGroup: binge },
                });
            }
        }

        const resolvedTorrentStreams = await Promise.all(
            item.streams.map(async s => ({ ...s, ...(await resolveFileIdx(s.infoHash, ep.episode, ep.title)) }))
        );

        // 2. infoHash + fileIdx
        if (runtime.showRawTorrents) {
            for (const s of resolvedTorrentStreams) {
                streams.push({
                    name:          `[NumeralJ]\n${s.quality}`,
                    title:         `${ep.title}\n${s.quality} · ${s.fileLabel || 'series torrent'}`,
                    infoHash:      s.infoHash,
                    fileIdx:       s.fileIdx,
                    behaviorHints: { bingeGroup: binge },
                });
            }
        }

        // 3. Debrid direct links
        const debridGroups = await Promise.all(resolvedTorrentStreams.map(async s => {
            const ds = await buildDebridStreams(s.infoHash, s.fileIdx, s.quality, binge, runtime, s.targetFile);
            return ds.map(d => ({ ...d, title: `${ep.title}\n${d.title}` }));
        }));
        streams.push(...debridGroups.flat());

        return setCachedStreams(cacheKey, streams);
    }

    // ── Movie ─────────────────────────────────────────────────────────────────

    // 1. Google Drive
    if (runtime.showGDrive) {
        for (const [quality, url] of Object.entries(item.gdrive || {})) {
            streams.push({
                name:          `[NumeralJ]\n${quality} GDrive`,
                title:         `${item.title}\n${quality} · Google Drive`,
                externalUrl:   url,
                behaviorHints: { notWebReady: true },
            });
        }
    }

    // 2. infoHash
    if (runtime.showRawTorrents) {
        for (const s of item.streams) {
            streams.push({
                name:          `[NumeralJ]\n${s.quality}`,
                title:         `${item.title}\n${s.quality} · torrent`,
                infoHash:      s.infoHash,
                fileIdx:       0,
                behaviorHints: { notWebReady: false },
            });
        }
    }

    // 3. Debrid direct links
    const debridGroups = await Promise.all(item.streams.map(async s => {
        const ds = await buildDebridStreams(s.infoHash, 0, s.quality, binge, runtime, null);
        return ds.map(d => ({ ...d, title: `${item.title}\n${d.title}` }));
    }));
    streams.push(...debridGroups.flat());

    return setCachedStreams(cacheKey, streams);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function itemDescription(item) {
    const meta         = getMeta(item);
    const episodeCount = item.episodes ? `\nEpisodes: ${item.episodes.length}` : '';
    const qualities    = item.streams.map(s => s.quality).join(' / ');
    return `${meta.description || meta.tagline || 'NumeralJ / Mecha Salesman fan edit.'}\n\nQualities: ${qualities}${episodeCount}`;
}

function buildVideos(item, baseUrl) {
    if (!item.episodes) return [];
    return item.episodes.map(ep => ({
        id:        `${item.id}:${ep.season}:${ep.episode}`,
        title:     ep.title,
        season:    ep.season,
        episode:   ep.episode,
        released:  new Date(2020, 0, 1 + ep.episode).toISOString(),
        thumbnail: artworkUrls(item, baseUrl).background,
        overview:  `NumeralJ chapter: ${ep.title}. Available streams: ${Object.keys(ep.gdrive || {}).join(' / ') || 'torrent'}.`,
    }));
}

const fileIdxCache = new Map();

async function resolveFileIdx(infoHash, epNumber, epTitle) {
    const cacheKey = `${infoHash}:${epNumber}:${epTitle || ''}`;
    if (fileIdxCache.has(cacheKey)) return fileIdxCache.get(cacheKey);

    try {
        const files = await getTorrentFiles(infoHash);
        if (files && files.length > 1) {
            const fileIdx   = pickFileIdx(files, epNumber, epTitle);
            const matched   = files.find(f => f.idx === fileIdx);
            const fileLabel = matched
                ? `file ${files.indexOf(matched) + 1}/${files.length}: ${matched.name.slice(0, 45)}`
                : `file ?/${files.length}`;
            const resolved  = { fileIdx, fileLabel, targetFile: matched || null };
            fileIdxCache.set(cacheKey, resolved);
            return resolved;
        }
    } catch {}

    const fallback = { fileIdx: 0, fileLabel: null, targetFile: null };
    fileIdxCache.set(cacheKey, fallback);
    return fallback;
}

async function buildDebridStreams(infoHash, fileIdx, quality, bingeGroup, runtime, targetFile) {
    if (!runtime.directDebrid || !runtime.hasDebridKey) return [];

    const timeout = new Promise(resolve => setTimeout(() => resolve([]), DEBRID_TIMEOUT_MS));
    const results = await Promise.race([
        resolveAllDebrid(infoHash, fileIdx, runtime.debridKeys, targetFile),
        timeout,
    ]);
    return results.map(({ service, url }) => ({
        name:          `[NumeralJ]\n${quality} ${service}`,
        title:         `${quality} · via ${service} (direct)`,
        url,
        behaviorHints: { notWebReady: false, bingeGroup },
    }));
}

module.exports = { getManifest, catalogHandler, metaHandler, streamHandler };
