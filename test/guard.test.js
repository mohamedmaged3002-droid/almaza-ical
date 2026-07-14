// test/guard.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldWrite } = require('../src/guard');

const NIGHTS = 200;

test('writes when the scrape is healthy', () => {
  const r = shouldWrite(null, { ok: true, blocked: 40, available: 160, errors: 0 }, NIGHTS);
  assert.deepStrictEqual(r, { write: true, reason: 'ok' });
});

test('refuses when the scrape did not complete', () => {
  const r = shouldWrite(null, { ok: false, blocked: 0, available: 0, errors: 0 }, NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'scrape-not-ok');
});

test('refuses when nothing was classified (would publish an empty = fully-open feed)', () => {
  const r = shouldWrite(null, { ok: true, blocked: 0, available: 0, errors: 0 }, NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'zero-classified');
});

test('refuses on low coverage', () => {
  const r = shouldWrite(null, { ok: true, blocked: 10, available: 20, errors: 0 }, NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'low-coverage');
});

test('refuses when availability collapses vs the last good run', () => {
  const prev = { availableCount: 160 };
  const r = shouldWrite(prev, { ok: true, blocked: 190, available: 10, errors: 0 }, NIGHTS);
  assert.strictEqual(r.write, false);
  assert.strictEqual(r.reason, 'availability-collapse');
});
