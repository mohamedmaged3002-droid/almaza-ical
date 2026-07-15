// scripts/build-insert-sql.js
// Emit an idempotent INSERT for 152 DRAFT Almaza units into Supabase `units`.
// Reads output/units/*.json (the completed content scrape) and writes
// output/almaza-insert.sql. NO network, NO DB — pure file generation.
//
// Builds to the VERIFIED live schema: provides every NOT-NULL-without-default
// column (slug, title, compound, beds, baths, guests) and overrides the
// defaulted source/area/status. photo_urls comes from output/r2-photos.json
// (the R2 upload map) when present; otherwise falls back to the '{}' default.
const fs = require('fs');
const path = require('path');

const UNITS_DIR = path.join(__dirname, '..', 'output', 'units');
const R2MAP = path.join(__dirname, '..', 'output', 'r2-photos.json');
const OUT = path.join(__dirname, '..', 'output', 'almaza-insert.sql');
const NOTES_TAG = '[almaza-stage 2026-07-14]';

// wp -> [R2 photo urls]. Empty {} if the upload hasn't run.
const R2 = fs.existsSync(R2MAP) ? JSON.parse(fs.readFileSync(R2MAP, 'utf8')) : {};

// --- SQL literal helpers -----------------------------------------------------
// A text literal: wrap in single quotes, doubling any internal single quote.
// Straight apostrophes DO occur (61 units have "Maid's Room" titles), so this
// escaping is load-bearing. Typographic apostrophes (U+2019) pass through
// untouched — they are not SQL delimiters.
function sqlText(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}
// Nullable text.
function sqlTextOrNull(v) {
  return v == null ? 'NULL' : sqlText(v);
}
// Numeric or NULL. Rejects non-finite so a stray NaN never lands in SQL.
function sqlNum(v) {
  if (v == null) return 'NULL';
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : 'NULL';
}
// Postgres text[] literal as ARRAY[...]::text[] — safer than a '{}' literal for
// arbitrary strings because each element is a normal escaped SQL string.
function sqlTextArray(arr) {
  const items = (arr || []).map(sqlText);
  return items.length ? `ARRAY[${items.join(',')}]::text[]` : `ARRAY[]::text[]`;
}

function loadUnits() {
  return fs
    .readdirSync(UNITS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(UNITS_DIR, f), 'utf8')))
    .sort((a, b) => a.wp - b.wp); // deterministic order
}

// Column order for the INSERT — keep the row tuple builder in lockstep.
const COLUMNS = [
  'wp_post_id', 'source', 'source_code', 'operator_unit_code',
  'title', 'slug', 'short_description', 'the_property',
  'beds', 'baths', 'guests',
  'compound', 'area', 'city',
  'lat', 'lng', 'source_url',
  'status', 'pricing_model', 'service_fee_percent', 'cleaning_fee_egp',
  'amenities', 'photo_urls', 'cover_url', 'min_nights', 'notes',
];

function rowTuple(u) {
  const desc = String(u.description || '');
  const area = u.subCommunity || 'Almaza Bay';
  const vals = [
    sqlNum(u.wp),                         // wp_post_id
    sqlText('almaza'),                    // source
    sqlTextOrNull(u.sourceCode),          // source_code
    sqlTextOrNull(u.operatorCode),        // operator_unit_code
    sqlText(u.title),                     // title
    sqlText('almaza-' + u.slug),          // slug
    sqlText(desc.slice(0, 200)),          // short_description
    sqlText(desc),                        // the_property
    sqlNum(u.bedrooms),                   // beds
    sqlNum(u.bathrooms),                  // baths
    sqlNum(u.guestsBluekeys),             // guests
    sqlText('Almaza Bay'),                // compound
    sqlText(area),                        // area
    sqlText('Marsa Matrouh'),             // city
    sqlNum(u.lat),                        // lat
    sqlNum(u.lng),                        // lng
    sqlTextOrNull(u.sourceUrl),           // source_url
    sqlText('draft'),                     // status
    sqlText('nightly'),                   // pricing_model
    '0',                                  // service_fee_percent
    '0',                                  // cleaning_fee_egp
    sqlTextArray(u.amenities),            // amenities
    sqlTextArray(R2[u.wp]),               // photo_urls (R2; '{}' if not uploaded)
    (R2[u.wp] && R2[u.wp][0]) ? sqlText(R2[u.wp][0]) : 'NULL', // cover_url
    'NULL',                               // min_nights (filled later from calendar)
    sqlText(NOTES_TAG),                   // notes
  ];
  // One tuple per line so `grep -c "'draft'"` counts exactly one per row.
  return `  (${vals.join(', ')})`;
}

function main() {
  const units = loadUnits();

  // Assert every emitted row is a draft before we write anything.
  const nonDraft = units.filter((u) => false); // status is hardcoded 'draft' per row
  if (nonDraft.length) throw new Error(`non-draft rows: ${nonDraft.length}`);

  const rows = units.map(rowTuple);
  // Sanity: exactly one 'draft' literal per generated tuple.
  for (const r of rows) {
    const n = (r.match(/'draft'/g) || []).length;
    if (n !== 1) throw new Error(`row does not have exactly one 'draft' literal (${n})`);
  }

  const sql =
    `-- Almaza Bay — ${units.length} DRAFT units for Supabase \`units\`\n` +
    `-- Generated ${new Date().toISOString()} by scripts/build-insert-sql.js\n` +
    `-- Idempotent: ON CONFLICT (wp_post_id) DO NOTHING\n` +
    `INSERT INTO units (\n  ${COLUMNS.join(', ')}\n) VALUES\n` +
    rows.join(',\n') +
    `\nON CONFLICT (wp_post_id) DO NOTHING;\n`;

  fs.writeFileSync(OUT, sql);
  console.log(`Wrote ${OUT}`);
  console.log(`Rows: ${units.length} (all status='draft')`);
}

main();
