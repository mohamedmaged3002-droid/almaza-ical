// scripts/build-sheet-content.js — emit data/sheet-content.json: the compact,
// STATIC per-unit content the sheet needs (identity, beds/guests, amenities,
// geo, check-in/out, default rate). Regenerated LOCALLY when the content scrape
// re-runs; committed so CI (the price-watch) can rebuild the sheet without the
// full output/units/*.json (which stays local/gitignored).
//
// Deliberately STRIPPED: `description`/`the_property` (operator marketing text)
// and the raw `photos` URLs (operator CDN links) — the sheet needs neither, so
// they don't get committed to the public repo. Photo count is kept as an int.
const fs = require('fs');
const path = require('path');

const UNITS = path.join(__dirname, '..', 'output', 'units');
const OUT = path.join(__dirname, '..', 'data', 'sheet-content.json');

const units = fs.readdirSync(UNITS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(UNITS, f), 'utf8')))
  .sort((a, b) => a.wp - b.wp)
  .map((u) => ({
    wp: u.wp,
    sourceCode: u.sourceCode,
    operatorCode: u.operatorCode,
    subCommunity: u.subCommunity,
    title: u.title,
    slug: u.slug,
    guestsBluekeys: u.guestsBluekeys,
    guestsOperator: u.guestsOperator,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    rates: { defaultRate: u.rates ? u.rates.defaultRate : null, roomId: u.rates ? u.rates.roomId : null },
    checkinTime: u.checkinTime,
    checkoutTime: u.checkoutTime,
    amenities: u.amenities || [],
    photoCount: (u.photos || []).length,
    lat: u.lat,
    lng: u.lng,
    sourceUrl: u.sourceUrl,
  }));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(units, null, 0));
console.log(`wrote ${units.length} units -> data/sheet-content.json (descriptions + photo URLs stripped)`);
