// spike/rate-probe.js — POLITE characterization of Lodgify's rate limits.
// D-003: this is being a good citizen (understanding the limit so we can back
// off correctly), NOT evasion. Honest UA, single browser, wide spacing.
// Tests two hosts: the rates host (blocked after ~4 in the real scrape) and the
// calendar host (the one the 6h sync depends on).
const { chromium } = require('playwright');

const RATES = (p) => `https://websiteserver.lodgify.com/v3/websites/rates/website/233292/language/en/property/${p}`;
const CAL = (p, r, d) => `https://checkout.lodgify.com/api/v1/checkout/calendar?propertyId=${p}&startDate=${d}&roomId=${r}`;

// A handful of real (propId, roomId) pairs from the 4 units that DID scrape.
const UNITS = [
  { p: 673204, r: null },
  { p: 334781, r: null },
  { p: 294593, r: null },
  { p: 298084, r: null },
  { p: 673204, r: null },
  { p: 334781, r: null },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hit(page, url) {
  try {
    const out = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'omit' });
      const t = await r.text();
      return { status: r.status, ok: t.trim().startsWith('{'), head: t.slice(0, 60) };
    }, url);
    return out;
  } catch (e) {
    return { status: 'ERR', ok: false, head: String(e.message).slice(0, 60) };
  }
}

async function burst(page, label, urlFn, spacingMs) {
  console.log(`\n=== ${label} (spacing ${spacingMs}ms) ===`);
  let ok = 0;
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i];
    const res = await hit(page, urlFn(u));
    if (res.ok) ok += 1;
    console.log(`  ${i + 1}. prop ${u.p} -> ${res.status} ${res.ok ? 'OK' : 'BLOCKED'} ${res.ok ? '' : res.head}`);
    if (i < UNITS.length - 1) await sleep(spacingMs);
  }
  console.log(`  => ${ok}/${UNITS.length} ok`);
  return ok;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  await page.goto('https://almazabay.lodgify.com/', { waitUntil: 'domcontentloaded' });

  // 1) Rates host at MODERATE spacing (3s) — does 3s sustain 6 calls?
  await burst(page, 'RATES @3s', (u) => RATES(u.p), 3000);

  // 2) Cool-down, then rates host at WIDE spacing (8s) — does 8s sustain?
  console.log('\n--- cooling down 45s ---');
  await sleep(45000);
  await burst(page, 'RATES @8s', (u) => RATES(u.p), 8000);

  // 3) Calendar host at WIDE spacing (8s) — does the SYNC host throttle too?
  console.log('\n--- cooling down 45s ---');
  await sleep(45000);
  await burst(page, 'CALENDAR @8s', (u) => CAL(u.p, u.r, '2026-08-01'), 8000);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
