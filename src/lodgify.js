// src/lodgify.js
// Pure parsers over already-fetched Lodgify payloads. No network in here — that
// is what makes them testable.
const { iso, parseIso, addDays } = require('./dates');

const stripHtml = (s) =>
  String(s || '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

// JSON-LD "VacationRental" -> our unit record.
function parseJsonLd(ld) {
  const cp = ld.containsPlace || {};
  return {
    propertyId: ld.identifier,
    title: ld.name,
    sourceUrl: ld.url,
    description: stripHtml(ld.description),
    lat: ld.geo ? Number(ld.geo.latitude) : null,
    lng: ld.geo ? Number(ld.geo.longitude) : null,
    photos: Array.isArray(ld.image) ? ld.image.slice() : [],
    // The REAL amenity list. Ground the copy model in this — do NOT let it invent
    // amenities (project_birdnest_resort_copy_hallucination).
    amenities: (ld.amenityFeature || []).map((a) => a.name),
    checkinTime: ld.checkinTime || null,
    checkoutTime: ld.checkoutTime || null,
    bedrooms: cp.numberOfBedrooms ?? null,
    bathrooms: cp.numberOfBathroomsTotal ?? null,
    // The operator's ADVERTISED occupancy. Goes to the OTA sheet verbatim; the
    // BlueKeys units.guests value uses the bedrooms x 2 house rule instead.
    guestsOperator: cp.occupancy ? (cp.occupancy.maxValue ?? cp.occupancy.value) : null,
  };
}

// v3 rates payload -> { roomId, currency, defaultRate, periods[] }.
// NOTE: rates come from the API ONLY. The rendered page is CDN-cached and has
// been observed serving a stale July price (20,000 vs the live 15,000).
function parseRates(json) {
  const roomTypes = json.roomTypes || {};
  const key = Object.keys(roomTypes)[0];
  if (!key) return { roomId: null, currency: null, defaultRate: null, periods: [] };
  const rt = roomTypes[key];
  const periods = [];
  for (const rate of rt.rates || []) {
    for (const p of rate.periods || []) {
      periods.push({
        name: rate.name,
        price: rate.dailyPrice,
        start: String(p.startDate).slice(0, 10),
        end: String(p.endDate).slice(0, 10),
      });
    }
  }
  return {
    roomId: rt.id ?? Number(key),
    currency: (rt.defaultRate && rt.defaultRate.currency) || null,
    defaultRate: rt.defaultRate ? rt.defaultRate.dailyPrice : null,
    periods,
  };
}

// Expand seasonal periods into per-date rows — COVERED DATES ONLY.
// The default rate is deliberately NOT extrapolated across the year: a date with
// no operator-defined rate has no price, and renders BLOCKED + WhatsApp CTA.
// Inventing a winter price from a default rate would either lose money or lose
// the guest. (Mirrors the no-monthly-fallback rule in new-site/src/lib/pricing.ts.)
function ratePeriodsToDaily({ periods }) {
  const byDate = new Map();
  for (const p of periods || []) {
    let d = parseIso(p.start);
    const end = parseIso(p.end);
    while (d <= end) {
      byDate.set(iso(d), p.price); // later periods win on overlap
      d = addDays(d, 1);
    }
  }
  return [...byDate.entries()].sort().map(([date, price]) => ({ date, price }));
}

// checkout/calendar payload -> blocked dates + min-stay + coverage counts.
function parseCalendar(json) {
  const days = json.calendar || [];
  const blocked = [];
  let available = 0;
  let minStay = null;
  for (const d of days) {
    if (d.isAvailable) available += 1;
    else blocked.push(d.date);
    if (minStay == null && typeof d.minimalStay === 'number') minStay = d.minimalStay;
  }
  return { blocked, available, minStay, covered: days.length };
}

module.exports = { parseJsonLd, parseRates, parseCalendar, ratePeriodsToDaily, stripHtml };
