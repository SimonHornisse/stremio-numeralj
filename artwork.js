const { getMeta } = require('./metadata');

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function wrapWords(text, maxChars, maxLines) {
    const words = String(text).replace(/\s+/g, ' ').split(' ');
    const lines = [];
    let line = '';

    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > maxChars && line) {
            lines.push(line);
            line = word;
            if (lines.length === maxLines - 1) break;
        } else {
            line = next;
        }
    }
    if (line && lines.length < maxLines) lines.push(line);
    return lines;
}

function textLines(lines, x, y, size, fill, weight = 700, gap = 1.16) {
    return lines.map((line, i) =>
        `<text x="${x}" y="${y + i * size * gap}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`
    ).join('\n');
}

function posterSvg(item) {
    const meta = getMeta(item);
    const theme = meta.theme || {};
    const primary = theme.primary || '#1a1a2e';
    const secondary = theme.secondary || '#e94560';
    const accent = theme.accent || '#f2cc8f';
    const titleLines = wrapWords(item.title.replace(/^Star Wars:? /i, ''), 18, 6);
    const eyebrow = item.type === 'series' ? 'SERIES CUTS' : 'FEATURE CUT';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${primary}"/>
      <stop offset="0.58" stop-color="#111827"/>
      <stop offset="1" stop-color="${secondary}"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.42"/>
      <stop offset="0.55" stop-color="${accent}" stop-opacity="0.08"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="600" height="900" fill="url(#bg)"/>
  <rect width="600" height="900" fill="url(#glow)"/>
  <path d="M65 112 C155 58 288 48 379 88 C462 125 514 206 523 309 C425 246 335 229 253 259 C170 290 112 364 70 480 C38 329 9 210 65 112Z" fill="${accent}" opacity="0.14"/>
  <path d="M89 715 C192 640 340 633 508 692" fill="none" stroke="${accent}" stroke-width="4" opacity="0.5"/>
  <path d="M88 738 C212 668 360 666 514 733" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.16"/>
  <text x="54" y="86" font-size="24" font-weight="800" fill="${accent}" letter-spacing="4">NUMERALJ</text>
  <text x="54" y="124" font-size="16" font-weight="700" fill="#ffffff" opacity="0.72" letter-spacing="3">${eyebrow}</text>
  ${textLines(titleLines, 54, 300, titleLines.length > 4 ? 50 : 58, '#ffffff', 900, 1.08)}
  <text x="54" y="785" font-size="20" font-weight="700" fill="${accent}">${escapeXml(meta.releaseInfo || 'Fan Edit')}</text>
  <text x="54" y="824" font-size="18" font-weight="600" fill="#ffffff" opacity="0.78">${escapeXml(meta.runtime || item.streams.map(s => s.quality).join(' / '))}</text>
</svg>`;
}

function backdropSvg(item) {
    const meta = getMeta(item);
    const theme = meta.theme || {};
    const primary = theme.primary || '#101624';
    const secondary = theme.secondary || '#c2410c';
    const accent = theme.accent || '#fbbf24';
    const titleLines = wrapWords(item.title, 38, 3);
    const taglineLines = wrapWords(meta.tagline || 'NumeralJ Star Wars fan edit', 58, 2);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${primary}"/>
      <stop offset="0.62" stop-color="#121826"/>
      <stop offset="1" stop-color="${secondary}"/>
    </linearGradient>
    <radialGradient id="star" cx="72%" cy="26%" r="50%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.34"/>
      <stop offset="0.5" stop-color="${accent}" stop-opacity="0.08"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect width="1280" height="720" fill="url(#star)"/>
  <path d="M820 132 C999 175 1127 292 1193 497 C1014 380 834 347 654 398 C472 450 315 573 180 704 C238 453 354 276 526 174 C614 122 711 106 820 132Z" fill="${accent}" opacity="0.13"/>
  <path d="M0 620 C230 500 458 474 687 544 C882 604 1064 596 1280 514" fill="none" stroke="${accent}" stroke-width="5" opacity="0.36"/>
  <text x="76" y="112" font-size="26" font-weight="800" fill="${accent}" letter-spacing="5">NUMERALJ / MECHA SALESMAN</text>
  ${textLines(titleLines, 76, 278, titleLines.length > 2 ? 58 : 70, '#ffffff', 900, 1.08)}
  ${textLines(taglineLines, 80, 514, 28, '#ffffff', 650, 1.2)}
  <text x="80" y="638" font-size="22" font-weight="700" fill="${accent}">${escapeXml((meta.genres || []).join('  /  '))}</text>
</svg>`;
}

function logoSvg(item) {
    const meta = getMeta(item);
    const theme = meta.theme || {};
    const accent = theme.accent || '#fbbf24';
    const titleLines = wrapWords(item.title.replace(/^Star Wars:? /i, ''), 28, 2);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="360" viewBox="0 0 900 360">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <rect width="900" height="360" fill="none"/>
  <g filter="url(#shadow)">
    <text x="450" y="76" text-anchor="middle" font-size="31" font-weight="900" fill="${accent}" letter-spacing="9">NUMERALJ</text>
    ${titleLines.map((line, i) =>
        `<text x="450" y="${168 + i * 76}" text-anchor="middle" font-size="${titleLines.length > 1 ? 58 : 70}" font-weight="900" fill="#ffffff">${escapeXml(line)}</text>`
    ).join('\n')}
  </g>
</svg>`;
}

function ensureArtwork(catalog) {
    // Kept as a startup hook. Artwork is generated on demand so no files or
    // directories are required.
    return catalog.length;
}

function artworkUrls(item, baseUrl) {
    return {
        poster: `${baseUrl}/art/poster/${item.id}.svg`,
        background: `${baseUrl}/art/background/${item.id}.svg`,
        logo: `${baseUrl}/art/logo/${item.id}.svg`,
    };
}

function artworkSvg(kind, item) {
    if (kind === 'background') return backdropSvg(item);
    if (kind === 'logo') return logoSvg(item);
    return posterSvg(item);
}

module.exports = { ensureArtwork, artworkUrls, artworkSvg };
