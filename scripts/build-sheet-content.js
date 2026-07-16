// scripts/build-sheet-content.js — emit data/sheet-content.json: the compact,
// STATIC per-unit content the sheet needs (identity, beds/guests, amenities,
// geo, check-in/out, default rate, Lodgify ids, operator description).
// Regenerated LOCALLY when the content scrape re-runs; committed so CI (the
// price-watch) can rebuild the FULL rich master sheet without the full
// output/units/*.json (which stays local/gitignored).
//
// `description` (operator marketing text) + `propertyId`/`roomId` (Lodgify ids)
// ARE included — the OTA team's Drive master tab needs them (Maged, 2026-07-16:
// keep the rich master on the Drive). Only the raw `photos` CDN URLs stay
// stripped (never hot-link the operator CDN — galleries live on R2); the sheet
// keeps photo_count as an int + the R2 gallery link.
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
    propertyId: u.propertyId,
    subCommunity: u.subCommunity,
    title: u.title,
    slug: u.slug,
    guestsBluekeys: u.guestsBluekeys,
    guestsOperator: u.guestsOperator,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    description: (u.description || '').trim(),
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
console.log(`wrote ${units.length} units -> data/sheet-content.json (rich: descriptions + Lodgify ids kept; photo URLs stripped)`);
