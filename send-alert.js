// Email the CHANGED UNITS ONLY as an xlsx attachment — ONLY when pricewatch.js
// detected a real change (out/change-message.json exists). Mirrors
// brassbell-ical/send-alert.js, adapted to Almaza's src/notify.js sendEmail API.
// The full OTA sheet is NOT attached here (it still refreshes to Drive daily).
// Attachment-only email (Maged, 2026-07-16): when the xlsx is present we send an
// EMPTY text body — all the detail is in the sheet. Exception: a roster-only
// change has no xlsx and its added/removed list lives only in the body, so we
// keep the body in that case (else the email would arrive empty).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sendEmail } = require('./src/notify');

(async () => {
  const msgPath = path.join(__dirname, 'out', 'change-message.json');
  if (!fs.existsSync(msgPath)) { console.log('send-alert: no change-message.json — no changes, no email.'); return; }
  const msg = JSON.parse(fs.readFileSync(msgPath, 'utf8'));
  if (!msg || !msg.subject) { console.log('send-alert: change-message.json has no subject — no email.'); return; }

  const dateStr = new Date().toISOString().slice(0, 10);
  const changesXlsx = path.join(__dirname, 'out', 'almaza-changes.xlsx');
  const attachments = fs.existsSync(changesXlsx)
    ? [{ filename: `Almaza price changes ${dateStr}.xlsx`, path: changesXlsx }]
    : [];
  if (!attachments.length) console.log('send-alert: changes sheet not found — sending text-only (roster-only change or build skipped).');

  // Attachment-only: drop the text body when the xlsx is attached; keep it for
  // roster-only changes (no attachment) so their added/removed list still sends.
  const body = attachments.length ? '' : msg.body;
  const { sent } = await sendEmail({ subject: msg.subject, body, attachments });
  if (!sent) process.exitCode = 1;
})().catch((e) => { console.error(String(e)); process.exit(1); });
