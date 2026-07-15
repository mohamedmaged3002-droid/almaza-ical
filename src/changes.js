// src/changes.js — PURE diff over per-unit daily EGP price maps. No I/O, no network,
// which is what makes it unit-testable without scraping.
//
// Almaza's Lodgify rates are already EGP (parseRates/dailyPricesForSeason keep them
// EGP), so — unlike brassbell-ical/src/changes.js — there is NO fx/usd() conversion.
// The range-collapsing shape below mirrors brassbell's diffUnit, in EGP.

// iso 'YYYY-MM-DD' -> next calendar day. UTC arithmetic is DST-safe (copied verbatim
// from brassbell-ical/src/changes.js addDay).
const addDay = (iso) => {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
};

// oldDates / newDates: { 'YYYY-MM-DD': egpInt }. Returns PRICE-CHANGE ranges only:
// [{ from, to, oldEgp, newEgp }]. A date counts as changed ONLY if it has a real
// price on BOTH sides and the value differs. A date missing on either side is an
// availability flip (priced <-> blocked), NOT a price change, and is ignored — that
// belongs to the iCal availability sync, not this price watcher. Consecutive dates
// sharing the SAME (oldEgp, newEgp) pair collapse into one from..to range.
function diffUnitDates(oldDates = {}, newDates = {}) {
  const dates = [...new Set([...Object.keys(oldDates), ...Object.keys(newDates)])].sort();
  const changed = [];
  for (const d of dates) {
    const o = oldDates[d];
    const n = newDates[d];
    if (o != null && n != null && o !== n) changed.push({ date: d, o, n });
  }
  const ranges = [];
  for (const c of changed) {
    const last = ranges[ranges.length - 1];
    if (last && last.oldEgp === c.o && last.newEgp === c.n && c.date === addDay(last.to)) {
      last.to = c.date; // extend the current run
    } else {
      ranges.push({ from: c.date, to: c.date, oldEgp: c.o, newEgp: c.n });
    }
  }
  return ranges;
}

// oldPrices / newPrices: { wp: { date: egp } }. oldRoster / newRoster: [{ pageId, slug }].
// Returns:
//   { priceChanges: [{ wp, ranges }],   // one entry per unit with >=1 changed range
//     addedUnits:   [slug, ...],        // pageIds present in new roster but not old
//     removedUnits: [slug, ...] }       // pageIds present in old roster but not new
function diffAll(oldPrices = {}, newPrices = {}, oldRoster = [], newRoster = []) {
  const priceChanges = [];
  const wps = [...new Set([...Object.keys(oldPrices), ...Object.keys(newPrices)])]
    .sort((a, b) => Number(a) - Number(b));
  for (const wp of wps) {
    const ranges = diffUnitDates(oldPrices[wp] || {}, newPrices[wp] || {});
    if (ranges.length) priceChanges.push({ wp, ranges });
  }

  const oldById = new Map((oldRoster || []).map((u) => [String(u.pageId), u]));
  const newById = new Map((newRoster || []).map((u) => [String(u.pageId), u]));
  const addedUnits = [];
  for (const [id, u] of newById) if (!oldById.has(id)) addedUnits.push(u.slug);
  const removedUnits = [];
  for (const [id, u] of oldById) if (!newById.has(id)) removedUnits.push(u.slug);

  return { priceChanges, addedUnits, removedUnits };
}

module.exports = { diffUnitDates, diffAll, addDay };
