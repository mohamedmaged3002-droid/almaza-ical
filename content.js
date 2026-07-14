// content.js — HEAVY, runs LOCALLY on Maged's Mac (not in CI).
// Walks the roster, pulls JSON-LD + rates for every unit, writes output/units/{propId}.json
// plus output/roster.json. Run it on demand, not on a cron.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cfg = require('./src/config');
const { openBrowser, fetchJsonInPage, sleep } = require('./src/browser');
const { discoverRoster } = require('./src/discover');
const { parseJsonLd, parseRates } = require('./src/lodgify');
const { operatorCode, subCommunity, inAlmazaBbox, guestsHouseRule, sourceCode } = require('./src/codes');

const OUT = path.join(__dirname, 'output', 'units');

// Read the VacationRental JSON-LD block out of a unit page.
async function readJsonLd(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return page.evaluate(() => {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const j = JSON.parse(s.textContent);
        if (j['@type'] === 'VacationRental') return j;
      } catch { /* not the block we want */ }
    }
    return null;
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await openBrowser();

  const { units: roster, expected } = await discoverRoster(page);
  fs.writeFileSync(path.join(__dirname, 'output', 'roster.json'), JSON.stringify(roster, null, 2));
  console.log(`roster: ${roster.length} units (site advertises ${expected})`);

  const problems = [];
  let n = 0;

  for (const r of roster) {
    n += 1;
    const wp = cfg.WP_BASE + n - 1;                       // 91001..91152, stable by roster order
    const url = `${cfg.ORIGIN}/en/${r.pageId}/${r.slug}`;
    try {
      const ld = await readJsonLd(page, url);
      if (!ld) throw new Error('no VacationRental JSON-LD on page');

      const u = parseJsonLd(ld);
      const rates = await fetchJsonInPage(page, cfg.RATES_URL(u.propertyId));
      const parsedRates = parseRates(rates);

      // Geo: pin ONLY genuine coords. Out-of-bbox pins are NULLed, never guessed
      // into a centroid (project_geocoding_quality).
      const geoOk = inAlmazaBbox(u.lat, u.lng);
      if (!geoOk && u.lat != null) problems.push({ wp, title: u.title, issue: 'geo-out-of-bbox', lat: u.lat, lng: u.lng });

      const sub = subCommunity(u.title);
      if (!sub) problems.push({ wp, title: u.title, issue: 'unknown-sub-community' });
      const code = operatorCode(u.title);
      if (!code) problems.push({ wp, title: u.title, issue: 'no-operator-code' });
      if (!parsedRates.periods.length) problems.push({ wp, title: u.title, issue: 'no-seasonal-rates' });
      if (parsedRates.currency && parsedRates.currency !== 'EGP') {
        problems.push({ wp, title: u.title, issue: `unexpected-currency-${parsedRates.currency}` });
      }

      const record = {
        ...u,
        wp,
        pageId: r.pageId,
        slug: r.slug,
        sourceCode: sourceCode(n),
        operatorCode: code,
        subCommunity: sub,
        guestsBluekeys: guestsHouseRule(u.bedrooms),      // house rule (D-022)
        // u.guestsOperator is kept as-is for the OTA sheet.
        lat: geoOk ? u.lat : null,
        lng: geoOk ? u.lng : null,
        rates: parsedRates,
        scrapedAt: new Date().toISOString(),
      };

      fs.writeFileSync(path.join(OUT, `${u.propertyId}.json`), JSON.stringify(record, null, 2));
      console.log(`[${n}/${roster.length}] ${wp} ${u.title} — ${u.photos.length} photos, ${parsedRates.periods.length} rate periods`);
    } catch (e) {
      console.error(`[${n}/${roster.length}] FAILED ${url}: ${e.message}`);
      problems.push({ wp, url, issue: `scrape-failed: ${e.message}` });
    }
    await sleep(cfg.REQUEST_DELAY_MS);
  }

  fs.writeFileSync(path.join(__dirname, 'output', 'problems.json'), JSON.stringify(problems, null, 2));
  console.log(`\nDone. ${problems.length} problems -> output/problems.json`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
