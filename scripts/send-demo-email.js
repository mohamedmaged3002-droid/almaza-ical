// One-off demo/test of the Almaza price-watch email pipeline. Runs in CI (uses
// the SMTP_* repo secrets). Recipient comes from NOTIFY_EMAIL (set to Maged only
// for the test). Uses the exact same notify.js the daily watcher sends with.
require('dotenv').config();
const { sendEmail } = require('../src/notify');

// Non-sensitive diagnostic: domain + lengths only (no full address, no password)
// so we can see WHY auth fails without exposing the credentials.
const _u = process.env.SMTP_USER || '';
const _p = process.env.SMTP_PASS || '';
console.log('SMTP_USER domain:', _u.split('@')[1] || '(no @ / unset)');
console.log('SMTP_USER local-part length:', (_u.split('@')[0] || '').length);
console.log('SMTP_PASS length:', _p.length, '(a Gmail app password is 16 chars, or 19 if spaces kept)');

(async () => {
  const res = await sendEmail({
    subject: 'BlueKeys · Almaza price-watch — test email ✅',
    body:
      'This is a one-off TEST of the Almaza price-watch email pipeline.\n\n' +
      'If you received this, SMTP is configured correctly and price-change alerts\n' +
      'will be sent automatically whenever Almaza changes a nightly rate.\n\n' +
      'No action needed — you can ignore this message.\n\n' +
      '— BlueKeys automation',
  });
  console.log('sendEmail result:', JSON.stringify(res));
  if (!res.sent) {
    console.error('Email NOT sent (see result above).');
    process.exit(1);
  }
})();
