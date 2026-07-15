// One-off demo/test of the Almaza price-watch email pipeline. Runs in CI (uses
// the SMTP_* repo secrets). Recipient comes from NOTIFY_EMAIL (set to Maged only
// for the test). Uses the exact same notify.js the daily watcher sends with.
require('dotenv').config();
const { sendEmail } = require('../src/notify');

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
