// scripts/build-prices-sql.js
// Emit daily nightly rates for the 152 Almaza units into Supabase
// `unit_daily_prices`. Reads output/units/*.json, expands each unit's seasonal
// rate periods to per-date rows via ratePeriodsToDaily (COVERED DATES ONLY — no
// extrapolation), and writes output/almaza-prices.sql. NO network, NO DB.
//
// Schema note: currency + source are BOTH NOT NULL on unit_daily_prices — they
// are provided here (EGP / almaza), not omitted.
const fs = require('fs');
const path = require('path');
const { ratePeriodsToDaily } = require('../src/lodgify');

const UNITS_DIR = path.join(__dirname, '..', 'output', 'units');
const OUT = path.join(__dirname, '..', 'output', 'almaza-prices.sql');

function sqlText(v) {
  return `'${String(v).replace(/'/g, "''")}'`;
}

function loadUnits() {
  return fs
    .readdirSync(UNITS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(UNITS_DIR, f), 'utf8')))
    .sort((a, b) => a.wp - b.wp);
}

function main() {
  const units = loadUnits();
  const rows = [];
  let minDate = null;
  let maxDate = null;

  for (const u of units) {
    const daily = ratePeriodsToDaily(u.rates || {}); // [{date, price}] covered-only
    for (const { date, price } of daily) {
      if (minDate === null || date < minDate) minDate = date;
      if (maxDate === null || date > maxDate) maxDate = date;
      // (wp_post_id, date, price, currency, source) — one tuple per line.
      rows.push(`  (${u.wp}, ${sqlText(date)}, ${Number(price)}, 'EGP', 'almaza')`);
    }
  }

  const sql =
    `-- Almaza Bay — daily nightly rates for Supabase \`unit_daily_prices\`\n` +
    `-- Generated ${new Date().toISOString()} by scripts/build-prices-sql.js\n` +
    `-- Covered dates only (no extrapolation). Horizon: ${minDate} .. ${maxDate}\n` +
    `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source) VALUES\n` +
    rows.join(',\n') +
    `\nON CONFLICT (wp_post_id, date) DO UPDATE SET\n` +
    `  price = EXCLUDED.price,\n` +
    `  currency = EXCLUDED.currency,\n` +
    `  source = EXCLUDED.source;\n`;

  fs.writeFileSync(OUT, sql);
  console.log(`Wrote ${OUT}`);
  console.log(`Price rows: ${rows.length}`);
  console.log(`Horizon (min/max date): ${minDate} .. ${maxDate}`);
}

main();
