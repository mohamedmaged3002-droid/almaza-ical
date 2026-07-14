// src/codes.js

// Almaza titles lead with the operator's own unit code:
//   "D08-G03 Beachtown 2 Bedroom Apartment" -> D08-G03
//   "72D Bay homes 1 Bedroom Chalet"        -> 72D
//   "F01-S1 Residences 1 Bedroom Chalet"    -> F01-S1
// Require a digit so plain words ("Beautiful…") don't match.
function operatorCode(title) {
  const m = String(title || '').trim().match(/^([A-Z]?\d+[A-Z]?(?:-[A-Z]?\d+[A-Z]?)?)\b/i);
  return m ? m[1].toUpperCase() : null;
}

// Discovered live across the 152-unit roster (2026-07-14). "Bayhomes" (one word)
// and "Residence" (singular) both occur; "Selection" is the villa community.
const SUB_COMMUNITIES = [
  [/\bbeach\s*town\b/i, 'Beachtown'],
  [/\bbay\s*homes\b/i, 'Bay Homes'],
  [/\bresidences?\b/i, 'Residences'],   // matches "Residence" and "Residences"
  [/\bselection\b/i, 'Selection'],      // villa community
];

// Returns null for anything unrecognised — content.js FLAGS those rather than
// guessing, so a new sub-community shows up in the report instead of silently
// landing under the wrong compound.
function subCommunity(title) {
  for (const [re, name] of SUB_COMMUNITIES) if (re.test(String(title || ''))) return name;
  return null;
}

// Almaza Bay sits on the Marsa Matrouh coast. Operator pins are unreliable — the
// Beachtown and Bay Homes pins we sampled are ~35km apart — so anything outside
// this generous box is treated as a bad pin and NULLed rather than guessed.
// Policy: pin only genuine coords, never a centroid (project_geocoding_quality).
const BBOX = { minLat: 31.0, maxLat: 31.6, minLng: 27.0, maxLng: 27.8 };

function inAlmazaBbox(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  return lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng;
}

// House rule: capacity = bedrooms x 2, studio -> 2 (D-022). The operator's own
// advertised occupancy is carried separately into the OTA sheet, NOT into this.
function guestsHouseRule(bedrooms) {
  const b = Number(bedrooms) || 0;
  return b <= 1 ? 2 : b * 2;
}

const sourceCode = (n) => `AB${String(n).padStart(3, '0')}`;

module.exports = { operatorCode, subCommunity, inAlmazaBbox, guestsHouseRule, sourceCode, BBOX };
