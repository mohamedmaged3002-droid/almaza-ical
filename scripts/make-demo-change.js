// scripts/make-demo-change.js — write a SAMPLE out/changed-units.json +
// out/change-message.json so build-changes.py + send-alert.js produce a faithful
// DEMO of the daily Almaza price-change email. Manual/demo use only — the daily
// cron never runs this (it diffs real prices). The change body is built with the
// exact same helpers as pricewatch.js (operatorCode + the fmtRange/buildSummary
// shape), so what lands in the inbox matches production byte-for-byte in format.
// Numbers are illustrative. Artifacts carry RAW EGP; build-changes.py applies the
// same +10% markup as the OTA sheet for the attached xlsx — just like production.
const fs = require('fs');
const path = require('path');
const { operatorCode } = require('../src/codes');

const OUT_DIR = path.join(__dirname, '..', 'out');
const dateStr = process.env.DEMO_DATE || new Date().toISOString().slice(0, 10);

// Three real units with illustrative RAW-EGP moves: a peak-season bump and a
// shoulder-season cut (mirrors the kinds of change the watcher actually catches).
const units = [
  { wp: 91007, title: 'D01-G02 Beachtown 2 Bedroom Apartment',
    ranges: [{ from: '2026-07-24', to: '2026-08-14', oldEgp: 18000, newEgp: 21000 }] },
  { wp: 91042, title: 'D07-S06 Beachtown 2 Bedroom Apartment',
    ranges: [{ from: '2026-08-01', to: '2026-08-31', oldEgp: 18000, newEgp: 19500 },
             { from: '2026-09-16', to: '2026-09-30', oldEgp: 16000, newEgp: 14000 }] },
  { wp: 91081, title: 'D01-F Residences 3 Bedroom Chalet',
    ranges: [{ from: '2026-07-24', to: '2026-08-14', oldEgp: 35000, newEgp: 39000 }] },
];

// identical to pricewatch.js fmtRange + buildSummary body
const fmtRange = (r) => `  ${r.from === r.to ? r.from : `${r.from}→${r.to}`}: ${r.oldEgp} → ${r.newEgp} EGP`;
const n = units.length;
const subject = `Almaza price changes — ${n} unit${n === 1 ? '' : 's'}`;
const lines = [subject, ''];
const changedUnits = units.map((u) => {
  const code = operatorCode(u.title);
  const label = code && !new RegExp(`^${code}\\b`, 'i').test(u.title) ? `${code} ${u.title}` : u.title;
  lines.push(`[wp${u.wp}] ${label}`);
  for (const r of u.ranges) lines.push(fmtRange(r));
  lines.push('');
  return { wp: u.wp, code, title: u.title, ranges: u.ranges };
});
const body = lines.join('\n').trimEnd() + '\n';

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'changed-units.json'), JSON.stringify({ dateStr, units: changedUnits }));
fs.writeFileSync(path.join(OUT_DIR, 'change-message.json'), JSON.stringify({ subject, body }));
console.log('make-demo-change: wrote out/changed-units.json + out/change-message.json');
console.log('----- EMAIL PREVIEW -----\nSubject: ' + subject + '\n\n' + body + '-------------------------');
