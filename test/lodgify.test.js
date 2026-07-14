// test/lodgify.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseJsonLd, parseRates, parseCalendar, ratePeriodsToDaily } = require('../src/lodgify');

const LD = {
  '@type': 'VacationRental',
  identifier: 298110,
  name: 'D08-G03 Beachtown 2 Bedroom Apartment',
  url: 'https://almazabay.lodgify.com/en/d08-g03-beachtown-2-bedroom-apartment',
  description: '<p>Beach town is organically designed.</p>\n<p>Ground floor Chalet.</p>',
  geo: { latitude: 31.197092, longitude: 27.552341 },
  image: ['https://l.icdbcdn.com/oh/aaa.jpg', 'https://l.icdbcdn.com/oh/bbb.jpg'],
  amenityFeature: [
    { name: 'Air conditioning', value: true },
    { name: 'Washing machine', value: true },
    { name: 'Pets not allowed', value: true },
  ],
  checkinTime: '03:00 PM',
  checkoutTime: '12:00 PM (noon)',
  containsPlace: {
    occupancy: { value: 6, maxValue: 6 },
    numberOfBedrooms: 2,
    numberOfBathroomsTotal: 2,
  },
};

test('parseJsonLd extracts identity, geo, photos, amenities and strips description HTML', () => {
  const u = parseJsonLd(LD);
  assert.strictEqual(u.propertyId, 298110);
  assert.strictEqual(u.title, 'D08-G03 Beachtown 2 Bedroom Apartment');
  assert.strictEqual(u.bedrooms, 2);
  assert.strictEqual(u.bathrooms, 2);
  assert.strictEqual(u.guestsOperator, 6);       // operator's advertised number
  assert.deepStrictEqual(u.photos, ['https://l.icdbcdn.com/oh/aaa.jpg', 'https://l.icdbcdn.com/oh/bbb.jpg']);
  assert.deepStrictEqual(u.amenities, ['Air conditioning', 'Washing machine', 'Pets not allowed']);
  assert.strictEqual(u.lat, 31.197092);
  assert.ok(!u.description.includes('<p>'));
  assert.ok(u.description.includes('Beach town is organically designed.'));
});

test('parseRates returns the roomId, default rate and named seasonal periods (EGP)', () => {
  const r = parseRates({
    roomTypes: {
      362793: {
        id: 362793,
        defaultRate: { dailyPrice: 18000, name: 'Default Rate', currency: 'EGP' },
        rates: [
          { dailyPrice: 15000, name: 'July', currency: 'EGP',
            periods: [{ startDate: '2026-07-01T00:00:00', endDate: '2026-07-31T00:00:00' }] },
          { dailyPrice: 22000, name: 'August', currency: 'EGP',
            periods: [{ startDate: '2026-08-01T00:00:00', endDate: '2026-08-31T00:00:00' }] },
        ],
      },
    },
  });
  assert.strictEqual(r.roomId, 362793);
  assert.strictEqual(r.currency, 'EGP');
  assert.strictEqual(r.defaultRate, 18000);
  assert.strictEqual(r.periods.length, 2);
  assert.deepStrictEqual(r.periods[0], { name: 'July', price: 15000, start: '2026-07-01', end: '2026-07-31' });
});

test('ratePeriodsToDaily expands ONLY covered dates — never extrapolates the default rate', () => {
  const rows = ratePeriodsToDaily({
    defaultRate: 18000,
    periods: [{ name: 'July', price: 15000, start: '2026-07-01', end: '2026-07-03' }],
  });
  assert.deepStrictEqual(rows, [
    { date: '2026-07-01', price: 15000 },
    { date: '2026-07-02', price: 15000 },
    { date: '2026-07-03', price: 15000 },
  ]);
});

test('ratePeriodsToDaily returns [] when the operator defines no seasonal periods', () => {
  // A default rate alone is NOT a price for any specific date. Emitting rows here
  // would invent winter prices. No row => renders BLOCKED + WhatsApp CTA.
  assert.deepStrictEqual(ratePeriodsToDaily({ defaultRate: 18000, periods: [] }), []);
});

test('parseCalendar returns blocked dates, min-stay and a coverage count', () => {
  const c = parseCalendar({
    calendar: [
      { date: '2026-08-01', isAvailable: true, minimalStay: 4 },
      { date: '2026-08-02', isAvailable: false, minimalStay: 4 },
      { date: '2026-08-03', isAvailable: false, minimalStay: 4 },
    ],
  });
  assert.deepStrictEqual(c.blocked, ['2026-08-02', '2026-08-03']);
  assert.strictEqual(c.available, 1);
  assert.strictEqual(c.minStay, 4);
});
