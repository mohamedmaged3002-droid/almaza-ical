// test/codes.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { operatorCode, subCommunity, inAlmazaBbox, guestsHouseRule, sourceCode } = require('../src/codes');

test('operatorCode pulls the operator unit code off the front of the title', () => {
  assert.strictEqual(operatorCode('D08-G03 Beachtown 2 Bedroom Apartment'), 'D08-G03');
  assert.strictEqual(operatorCode('F01-S1 Residences 1 Bedroom Chalet'), 'F01-S1');
  assert.strictEqual(operatorCode('72D Bay homes 1 Bedroom Chalet with Large Roof'), '72D');
});

test('operatorCode returns null when the title has no leading code', () => {
  assert.strictEqual(operatorCode('Beautiful Chalet by the Sea'), null);
});

test('subCommunity recognises the three known sub-communities, case-insensitively', () => {
  assert.strictEqual(subCommunity('D08-G03 Beachtown 2 Bedroom Apartment'), 'Beachtown');
  assert.strictEqual(subCommunity('72D Bay homes 1 Bedroom Chalet'), 'Bay Homes');
  assert.strictEqual(subCommunity('F01-S1 Residences 1 Bedroom Chalet'), 'Residences');
});

test('subCommunity returns null for an unknown sub-community (so the run can flag it)', () => {
  assert.strictEqual(subCommunity('Z99 Lagoon Villa'), null);
});

test('inAlmazaBbox accepts a real Almaza pin and rejects a far-off one', () => {
  assert.strictEqual(inAlmazaBbox(31.3543445, 27.2373159), true);   // Bay Homes
  assert.strictEqual(inAlmazaBbox(30.0444, 31.2357), false);        // Cairo
  assert.strictEqual(inAlmazaBbox(null, null), false);
});

test('guestsHouseRule is bedrooms x 2, with a studio floor of 2', () => {
  assert.strictEqual(guestsHouseRule(0), 2);   // studio
  assert.strictEqual(guestsHouseRule(1), 2);
  assert.strictEqual(guestsHouseRule(2), 4);
  assert.strictEqual(guestsHouseRule(3), 6);
});

test('sourceCode zero-pads to three digits', () => {
  assert.strictEqual(sourceCode(1), 'AB001');
  assert.strictEqual(sourceCode(152), 'AB152');
});
