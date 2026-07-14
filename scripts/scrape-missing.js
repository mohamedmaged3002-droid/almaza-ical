// Targeted re-scrape of specific units that failed on a transient network error.
// Reuses the library; writes the same record shape as content.js. Polite (2 units).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const { openBrowser, fetchJsonInPage, sleep } = require('../src/browser');
const { parseJsonLd, parseRates } = require('../src/lodgify');
const { operatorCode, subCommunity, inAlmazaBbox, guestsHouseRule, sourceCode } = require('../src/codes');

const OUT = path.join(__dirname, '..', 'output', 'units');

// wp -> { pageId, slug } for the units to (re)scrape.
const TARGETS = [
  { wp: 91115, pageId: '5214893', slug: 'e02-g08-beachtown-2-bedroom-maids-room-apartment' },
  { wp: 91116, pageId: '5337381', slug: 'e06-g02-beachtown-2-bedroom-maids-room-apartment' },
];

async function readJsonLd(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page.evaluate(() => {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const j = JSON.parse(s.textContent); if (j['@type'] === 'VacationRental') return j; } catch {}
    }
    return null;
  });
}

(async () => {
  const { browser, page } = await openBrowser();
  for (const t of TARGETS) {
    const n = t.wp - 91000;                                  // roster position (wp = 91000 + n)
    const url = `${cfg.ORIGIN}/en/${t.pageId}/${t.slug}`;
    try {
      const ld = await readJsonLd(page, url);
      if (!ld) throw new Error('no VacationRental JSON-LD');
      const u = parseJsonLd(ld);
      const rates = await fetchJsonInPage(page, cfg.RATES_URL(u.propertyId));
      const parsedRates = parseRates(rates);
      const geoOk = inAlmazaBbox(u.lat, u.lng);
      const record = {
        ...u, wp: t.wp, pageId: t.pageId, slug: t.slug,
        sourceCode: sourceCode(n),
        operatorCode: operatorCode(u.title),
        subCommunity: subCommunity(u.title),
        guestsBluekeys: guestsHouseRule(u.bedrooms),
        lat: geoOk ? u.lat : null, lng: geoOk ? u.lng : null,
        rates: parsedRates, scrapedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(OUT, `${u.propertyId}.json`), JSON.stringify(record, null, 2));
      console.log(`OK ${t.wp} ${u.title} — ${u.photos.length} photos, ${parsedRates.periods.length} rate periods, sub=${record.subCommunity}`);
    } catch (e) {
      console.error(`FAILED ${t.wp} ${url}: ${e.message}`);
    }
    await sleep(3000);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
