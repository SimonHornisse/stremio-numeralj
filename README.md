# NumeralJ Star Wars Cuts — Stremio Addon

Stremio addon for all **NumeralJ / Mecha Salesman** Star Wars fan edits extracted from the PDF.
17 titles, 33 torrent streams, episode-level Google Drive links, fileIdx torrent playback, and generated posters/backgrounds.

## Install & Run

```bash
cd stremio-numeralj
npm install
node index.js
```

Then in Stremio: **Settings → Addons → Install from URL**:
```
http://127.0.0.1:7000/manifest.json
```

Or click the install link printed in the console.

## Fast Mode vs Direct Debrid

Fast mode is the default:

```bash
node index.js
```

In fast mode the addon immediately returns:

- Google Drive episode/movie links
- `infoHash + fileIdx` torrent streams
- custom metadata, posters, backgrounds, and episode lists

This is the best mode when using Stremio's own debrid support or addons such as AIOStreams, Comet, Torrentio, and Jackettio.

Addon-level direct debrid links are optional because resolving TorBox/RealDebrid/AllDebrid links can slow down the stream response:

```bash
$env:DIRECT_DEBRID="1"
$env:TORBOX_API_KEY="your_key"
$env:REALDEBRID_API_KEY="your_key"
node index.js
```

You can also configure keys in the browser:

```text
http://127.0.0.1:7000/configure
```

Paste your TorBox, RealDebrid, or AllDebrid key, keep **Show direct debrid streams** enabled, save, then restart `node index.js`.

Important: other Stremio addons do not automatically transform streams returned by this addon when this addon is installed directly. To see `[NumeralJ] 1080p RealDebrid` or `[NumeralJ] 4K HDR TorBox`, this addon itself needs a debrid API key through `/configure`, `config.json`, or environment variables.

## Artwork and Metadata

The addon generates separate local SVG posters, backgrounds, and logos at runtime. No external poster host is required.

Examples:

```text
http://127.0.0.1:7000/art/poster/numeralj_5.svg
http://127.0.0.1:7000/art/background/numeralj_5.svg
http://127.0.0.1:7000/art/logo/numeralj_5.svg
```

Metadata lives in `metadata.js` and includes descriptions, taglines, genres, runtimes, release info, language, country, and director fields.

## Avoiding Reinstalls

The addon URL is stable:

```text
http://127.0.0.1:7000/manifest.json
```

For normal changes, do not reinstall the addon. Restart `node index.js`, then reopen the item in Stremio. The addon returns `Cache-Control: no-store` for manifest, meta, catalog, and stream responses so Stremio has less reason to keep stale addon data.

If you are using Stremio on a phone, TV, or another device, do not install the `127.0.0.1` URL. Set `BASE_URL` to your PC's LAN address before starting the addon:

```powershell
$env:BASE_URL="http://192.168.x.x:7000"
node index.js
```

Then install:

```text
http://192.168.x.x:7000/manifest.json
```

Only reinstall if you change the installed base URL or the manifest structure itself. Config changes from `/configure` are read live by the addon.

## TorBox Integration

Set your TorBox API key and enable direct mode to get direct HTTP streams:

```bash
$env:DIRECT_DEBRID="1"
$env:TORBOX_API_KEY="your_key_here"
node index.js
```

The addon will attempt to resolve each magnet via TorBox and return a direct playback URL alongside the raw torrent stream.

## Other Debrid Services (RealDebrid, AllDebrid, etc.)

The addon exposes raw `infoHash + fileIdx` streams. Any Stremio debrid addon or native Stremio debrid support can resolve them through your configured debrid service.

## Catalog

| # | Title | Type | Qualities |
|---|-------|------|-----------|
| 1 | Episode I – Phantom Menace Extended Edition | Movie | 1080p, 4K HDR |
| 2 | Episode II – Attack of the Clones Extended Edition | Movie | 1080p, 4K HDR |
| 3 | Episode III – Siege of Mandalore Supercut | Movie | 1080p, 4K HDR |
| 4 | Clone Wars (2003) Re-Edited | Movie | 1080p, 4K HDR |
| 5 | The Clone Wars – TV Film Cuts (Complete) | Series | 1080p, 4K HDR |
| 6 | The Bad Batch – TV Film Cuts (Complete) | Series | 1080p, 4K HDR |
| 7 | Maul – Shadow Lord The Feature Cut | Series | 1080p, 4K HDR |
| 8 | Solo Extended Edition | Movie | 1080p, 4K HDR |
| 9 | Obi-Wan Kenobi – The Feature Cut | Movie | 1080p, 4K HDR |
| 10 | Andor – TV Film Cuts (Complete) | Series | 1080p, 4K HDR |
| 11 | Rebels – TV Film Cuts (Complete) | Series | 1080p, 4K HDR |
| 12 | Episode IV – A New Hope: The Rogue Cut | Movie | 1080p, 4K HDR |
| 13 | The Star Wars Holiday Special | Movie | 4K HDR |
| 14 | Mandalorian & Book of Boba Fett – TV Film Cuts | Series | 1080p, 4K HDR |
| 15 | Ahsoka – The Feature Cut | Movie | 1080p, 4K HDR |
| 16 | The Acolyte – Feature Cut | Movie | 1080p, 4K HDR |
| 17 | Tales – TV Film Cuts (Seasons 1-3) | Series | 1080p, 4K HDR |

## Port

Default: **7000**. Override with `PORT=xxxx node index.js`.
