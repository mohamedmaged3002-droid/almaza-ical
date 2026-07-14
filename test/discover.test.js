// test/discover.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { extractPropertyLinks, totalFromResultsText } = require('../src/discover');

test('extractPropertyLinks pulls pageId + slug and ignores CMS pages', () => {
  const hrefs = [
    '/en/1474893/home-owners',
    '/en/3877954/contact-us',
    '/en/5214861/d08-g03-beachtown-2-bedroom-apartment?adults=1',
    '/en/5339689/72d-bay-homes-1-bedroom-chalet-with-large-roof?adults=1',
  ];
  const known = new Set(['1474893', '3877954']);
  assert.deepStrictEqual(extractPropertyLinks(hrefs, known), [
    { pageId: '5214861', slug: 'd08-g03-beachtown-2-bedroom-apartment' },
    { pageId: '5339689', slug: '72d-bay-homes-1-bedroom-chalet-with-large-roof' },
  ]);
});

test('extractPropertyLinks dedupes repeats across pages', () => {
  const hrefs = ['/en/5214861/a-unit', '/en/5214861/a-unit?adults=1'];
  assert.strictEqual(extractPropertyLinks(hrefs, new Set()).length, 1);
});

test('totalFromResultsText reads the advertised result count', () => {
  assert.strictEqual(totalFromResultsText('152 Results'), 152);
  assert.strictEqual(totalFromResultsText('Showing 1 - 12 of 152 places.'), 152);
  assert.strictEqual(totalFromResultsText('no numbers here'), null);
});
