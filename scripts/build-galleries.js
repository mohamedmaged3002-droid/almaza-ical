// build-galleries.js — generate a per-unit photo gallery page + an index on the
// almaza-ical GitHub Pages site, so the OTA team can BROWSE each unit's photos
// (R2 serves individual files but has no folder listing). Output: docs/photos/.
//
// Image src = each unit's photos[] (currently the operator's Lodgify CDN URLs;
// swap to R2 URLs once photos are uploaded there — just re-run this). Pages are
// tiny HTML; generating/pushing them costs ~no bandwidth. The IMAGES load in the
// viewer's browser at open-time, straight from wherever the URLs point.
const fs = require('fs');
const path = require('path');

const OUTDIR = path.join(__dirname, '..', 'docs', 'photos');
const UNITS = path.join(__dirname, '..', 'output', 'units');
const R2MAP = path.join(__dirname, '..', 'output', 'r2-photos.json');

// Photos are served from OUR R2 (photos.bluekeys.co), never hot-linked from the
// operator's CDN. Require the R2 map — a unit with no R2 URLs yet is skipped with
// a warning rather than silently falling back to the Almaza CDN.
const r2 = fs.existsSync(R2MAP) ? JSON.parse(fs.readFileSync(R2MAP, 'utf8')) : {};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PAGE_CSS = `
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;line-height:1.4}
a{color:#2563eb}
h1{font-size:1.15rem;margin:0 0 2px}
.meta{color:#6b7280;font-size:.85rem;margin-bottom:16px}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
button{font:inherit;padding:6px 12px;border:1px solid #d1d5db;border-radius:8px;background:#f9fafb;cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.grid a{display:block;aspect-ratio:4/3;overflow:hidden;border-radius:10px;background:#eee}
.grid img{width:100%;height:100%;object-fit:cover;display:block}
.grid .n{position:absolute;margin:6px;padding:1px 7px;background:rgba(0,0,0,.6);color:#fff;border-radius:6px;font-size:.75rem}
.urls{width:100%;min-height:120px;margin-top:16px;font-family:ui-monospace,monospace;font-size:.75rem;padding:8px;border:1px solid #d1d5db;border-radius:8px}
`;

function unitPage(u, photos) {
  const tiles = photos.map((src, i) => `<a href="${esc(src)}" target="_blank" rel="noopener"><span class="n">${i + 1}</span><img loading="lazy" src="${esc(src)}" alt="${esc(u.title)} photo ${i + 1}"></a>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(u.operatorCode || u.wp)} · ${esc(u.title)} — photos</title><style>${PAGE_CSS}</style></head><body>
<p><a href="./index.html">← all units</a></p>
<h1>${esc(u.title)}</h1>
<div class="meta">${esc(u.operatorCode || '')} · ${esc(u.subCommunity || 'Almaza Bay')} · ${photos.length} photos</div>
<div class="bar">
  <button onclick="document.querySelectorAll('.grid img').forEach(i=>i.src=i.src)">Reload</button>
  <button onclick="const t=document.getElementById('urls');t.style.display=t.style.display==='none'?'block':'none'">Copy all URLs</button>
</div>
<div class="grid">
${tiles}
</div>
<textarea id="urls" class="urls" style="display:none" readonly onclick="this.select()">${photos.map(esc).join('\n')}</textarea>
</body></html>`;
}

function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const units = fs.readdirSync(UNITS)
    .map((f) => JSON.parse(fs.readFileSync(path.join(UNITS, f), 'utf8')))
    .sort((a, b) => a.wp - b.wp);

  let totalPhotos = 0;
  const skipped = [];
  const built = [];
  for (const u of units) {
    const photos = r2[u.wp] || [];
    if (!photos.length) { skipped.push(u.wp); continue; }     // not uploaded to R2 yet
    fs.writeFileSync(path.join(OUTDIR, `${u.wp}.html`), unitPage(u, photos));
    totalPhotos += photos.length;
    built.push(u);
  }
  if (skipped.length) console.warn(`WARNING: ${skipped.length} units have no R2 photos, skipped: ${skipped.join(',')}`);

  const rows = built.map((u) => `<tr><td>${u.wp}</td><td>${esc(u.operatorCode || '')}</td><td><a href="./${u.wp}.html">${esc(u.title)}</a></td><td>${esc(u.subCommunity || '')}</td><td style="text-align:right">${(r2[u.wp] || []).length}</td></tr>`).join('\n');
  const index = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Almaza Bay — unit photo galleries</title><style>${PAGE_CSS}
table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:left}</style></head><body>
<h1>Almaza Bay — unit photo galleries</h1>
<div class="meta">${built.length} units · ${totalPhotos} photos · served from photos.bluekeys.co · for the OTA team</div>
<table><thead><tr><th>wp</th><th>code</th><th>unit</th><th>community</th><th>photos</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
  fs.writeFileSync(path.join(OUTDIR, 'index.html'), index);

  console.log(`wrote ${units.length} gallery pages + index -> docs/photos/ (${totalPhotos} photos linked)`);
}

main();
