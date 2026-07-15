const { test } = require('node:test');
const assert = require('node:assert');
const { diffUnitDates, diffAll, addDay } = require('../src/changes');

test('addDay steps one calendar day (UTC, DST-safe)', () => {
  assert.strictEqual(addDay('2026-06-01'), '2026-06-02');
  assert.strictEqual(addDay('2026-06-30'), '2026-07-01'); // month boundary
  assert.strictEqual(addDay('2026-10-31'), '2026-11-01');
});

test('diffUnitDates: a single-date price change is reported as one range', () => {
  const oldD = { '2026-07-10': 12000 };
  const newD = { '2026-07-10': 13000 };
  assert.deepStrictEqual(diffUnitDates(oldD, newD), [
    { from: '2026-07-10', to: '2026-07-10', oldEgp: 12000, newEgp: 13000 },
  ]);
});

test('diffUnitDates: a multi-date same-delta run collapses into ONE range', () => {
  const oldD = { '2026-07-01': 12000, '2026-07-02': 12000, '2026-07-03': 12000 };
  const newD = { '2026-07-01': 15000, '2026-07-02': 15000, '2026-07-03': 15000 };
  assert.deepStrictEqual(diffUnitDates(oldD, newD), [
    { from: '2026-07-01', to: '2026-07-03', oldEgp: 12000, newEgp: 15000 },
  ]);
});

test('diffUnitDates: different (old,new) pairs do NOT merge, and a gap breaks a run', () => {
  const oldD = { '2026-07-01': 12000, '2026-07-02': 12000, '2026-07-04': 12000 };
  const newD = { '2026-07-01': 15000, '2026-07-02': 16000, '2026-07-04': 15000 };
  assert.deepStrictEqual(diffUnitDates(oldD, newD), [
    { from: '2026-07-01', to: '2026-07-01', oldEgp: 12000, newEgp: 15000 },
    { from: '2026-07-02', to: '2026-07-02', oldEgp: 12000, newEgp: 16000 },
    { from: '2026-07-04', to: '2026-07-04', oldEgp: 12000, newEgp: 15000 }, // 07-03 missing => run breaks
  ]);
});

test('diffUnitDates: a date present on only ONE side is availability, NOT a price change', () => {
  const oldD = { '2026-07-10': 12000, '2026-07-11': 12000 };
  const newD = { '2026-07-10': 12000 }; // 07-11 became blocked/unavailable
  assert.deepStrictEqual(diffUnitDates(oldD, newD), []);
  // and the reverse (a newly-available date) is likewise not a price change
  assert.deepStrictEqual(diffUnitDates({ '2026-07-10': 12000 }, { '2026-07-10': 12000, '2026-07-12': 9000 }), []);
});

test('diffUnitDates: identical maps => no changes', () => {
  const d = { '2026-07-10': 12000, '2026-07-11': 12000 };
  assert.deepStrictEqual(diffUnitDates(d, { ...d }), []);
});

test('diffAll: reports per-unit price ranges keyed by wp, sorted numerically', () => {
  const oldP = {
    91001: { '2026-07-01': 12000, '2026-07-02': 12000 },
    91002: { '2026-07-01': 8000 },
  };
  const newP = {
    91001: { '2026-07-01': 14000, '2026-07-02': 14000 },
    91002: { '2026-07-01': 8000 }, // unchanged
  };
  const d = diffAll(oldP, newP, [], []);
  assert.deepStrictEqual(d.priceChanges, [
    { wp: '91001', ranges: [{ from: '2026-07-01', to: '2026-07-02', oldEgp: 12000, newEgp: 14000 }] },
  ]);
  assert.deepStrictEqual(d.addedUnits, []);
  assert.deepStrictEqual(d.removedUnits, []);
});

test('diffAll: no price or roster changes => all empty', () => {
  const p = { 91001: { '2026-07-01': 12000 } };
  const roster = [{ pageId: '5339689', slug: 'a' }];
  const d = diffAll(p, JSON.parse(JSON.stringify(p)), roster, [...roster]);
  assert.deepStrictEqual(d.priceChanges, []);
  assert.deepStrictEqual(d.addedUnits, []);
  assert.deepStrictEqual(d.removedUnits, []);
});

test('diffAll: a roster add and a remove are detected by pageId, reported by slug', () => {
  const oldRoster = [
    { pageId: '111', slug: 'stays-here' },
    { pageId: '222', slug: 'goes-away' },
  ];
  const newRoster = [
    { pageId: '111', slug: 'stays-here' },
    { pageId: '333', slug: 'brand-new' },
  ];
  const d = diffAll({}, {}, oldRoster, newRoster);
  assert.deepStrictEqual(d.priceChanges, []);
  assert.deepStrictEqual(d.addedUnits, ['brand-new']);
  assert.deepStrictEqual(d.removedUnits, ['goes-away']);
});
