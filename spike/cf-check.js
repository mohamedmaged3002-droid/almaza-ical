// spike/cf-check.js — can a GitHub Actions runner reach Lodgify's calendar API?
// Exit 0 = reachable, exit 1 = blocked. Prints the evidence either way.
const { chromium } = require('playwright');

const PROP = 298110;   // D08-G03 Beachtown — known-good probe unit
const ROOM = 362793;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // Land on the site first so Cloudflare can issue its clearance cookie.
  const resp = await page.goto('https://almazabay.lodgify.com/', { waitUntil: 'domcontentloaded' });
  console.log('homepage status:', resp.status());

  const url =
    `https://checkout.lodgify.com/api/v1/checkout/calendar` +
    `?propertyId=${PROP}&startDate=2026-08-01&roomId=${ROOM}`;

  const out = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'omit' });
    const t = await r.text();
    return { status: r.status, head: t.slice(0, 200) };
  }, url);

  console.log('calendar status:', out.status);
  console.log('calendar head:', out.head);

  await browser.close();

  const ok = out.status === 200 && out.head.includes('"calendar"');
  console.log(ok ? 'SPIKE PASS: calendar API reachable' : 'SPIKE FAIL: blocked or challenged');
  process.exit(ok ? 0 : 1);
})();
