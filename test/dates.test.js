// test/dates.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { collapseBlocked, iso, addDays, parseIso } = require('../src/dates');

test('collapseBlocked merges consecutive dates into half-open ranges', () => {
  const r = collapseBlocked(['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-10']);
  assert.deepStrictEqual(r, [
    { start: '2026-08-02', endExclusive: '2026-08-05' },
    { start: '2026-08-10', endExclusive: '2026-08-11' },
  ]);
});

test('collapseBlocked dedupes and sorts unordered input', () => {
  const r = collapseBlocked(['2026-08-03', '2026-08-02', '2026-08-03']);
  assert.deepStrictEqual(r, [{ start: '2026-08-02', endExclusive: '2026-08-04' }]);
});

test('collapseBlocked returns [] for no blocked dates', () => {
  assert.deepStrictEqual(collapseBlocked([]), []);
});

test('addDays crosses a month boundary correctly', () => {
  assert.strictEqual(iso(addDays(parseIso('2026-08-31'), 1)), '2026-09-01');
});
