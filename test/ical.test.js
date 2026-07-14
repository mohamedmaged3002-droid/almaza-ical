// test/ical.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildIcal } = require('../src/ical');

test('buildIcal emits a valid VCALENDAR envelope with CRLF line endings', () => {
  const s = buildIcal({ wp: 91001, title: 'D08-G03 Beachtown', ranges: [] });
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(s.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(s.includes('X-WR-CALNAME:D08-G03 Beachtown'));
});

test('buildIcal folds range start+end into the UID so changed blocks re-sync', () => {
  const s = buildIcal({
    wp: 91001,
    title: 'X',
    ranges: [{ start: '2026-08-02', endExclusive: '2026-08-05' }],
  });
  assert.ok(s.includes('UID:almaza-91001-20260802-20260805@bluekeys.co'));
  assert.ok(s.includes('DTSTART;VALUE=DATE:20260802'));
  assert.ok(s.includes('DTEND;VALUE=DATE:20260805')); // DTEND is exclusive
  assert.ok(/DTSTAMP:\d{8}T\d{6}Z/.test(s));
  assert.ok(/LAST-MODIFIED:\d{8}T\d{6}Z/.test(s));
  assert.ok(s.includes('SUMMARY:BLOCKED'));
});

test('buildIcal gives a DIFFERENT UID when the range changes', () => {
  const a = buildIcal({ wp: 91001, title: 'X', ranges: [{ start: '2026-08-02', endExclusive: '2026-08-05' }] });
  const b = buildIcal({ wp: 91001, title: 'X', ranges: [{ start: '2026-08-02', endExclusive: '2026-08-06' }] });
  const uid = (s) => s.match(/UID:[^\r]+/)[0];
  assert.notStrictEqual(uid(a), uid(b));
});

test('buildIcal escapes commas and semicolons in the title', () => {
  const s = buildIcal({ wp: 91001, title: 'A, B; C', ranges: [] });
  assert.ok(s.includes('X-WR-CALNAME:A\\, B\\; C'));
});
