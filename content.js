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

// The rates host (websiteserver.lodgify.com) rate-limits under sustained load —
// a cross-origin block surfaces as "Failed to fetch". D-003 handling: back off
// POLITELY and retry (no evasion, no UA/IP tricks). Give the quota window time
// to breathe rather than hammering.
const RATE_BACKOFF_MS = [15000, 30000, 60000];
async function fetchRatesPolitely(page, propId) {
  let lastErr;
  for (let attempt = 0; attempt <= RATE_BACKOFF_MS.length; attempt++) {
    try {
      return await fetchJsonInPage(page, cfg.RATES_URL(propId));
    } catch (e) {
      lastErr = e;
      const wait = RATE_BACKOFF_MS[attempt];
      if (wait == null) break; // out of retries
      console.warn(`    rates ${propId} failed (${e.message}); backing off ${wait / 1000}s then retry`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { browser, page } = await openBrowser();

  const { units: roster, expected } = await discoverRoster(page);
  fs.writeFileSync(path.join(__dirname, 'output', 'roster.json'), JSON.stringify(roster, null, 2));
  console.log(`roster: ${roster.length} units (site advertises ${expected})`);

  const problems = [];
  let n = 0;
  let consecutiveFails = 0;
  // Circuit breaker: if the rates host walls us off for this many units in a row
  // even after backoff, the quota is spent — STOP rather than hammer an
  // unauthorised operator's servers for 100 more units (D-003 politeness).
  const MAX_CONSECUTIVE_FAILS = 6;

  for (const r of roster) {
    n += 1;
    const wp = cfg.WP_BASE + n - 1;                       // 91001..91152, stable by roster order
    const url = `${cfg.ORIGIN}/en/${r.pageId}/${r.slug}`;
    try {
      const ld = await readJsonLd(page, url);
      if (!ld) throw new Error('no VacationRental JSON-LD on page');

      const u = parseJsonLd(ld);

      // Resume support: if this unit was already scraped in a prior (aborted)
      // run, skip WITHOUT re-hitting the throttled rates host. The unit page
      // itself (same-origin) doesn't rate-limit, so reaching this check is cheap.
      const outFile = path.join(OUT, `${u.propertyId}.json`);
      if (fs.existsSync(outFile)) {
        console.log(`[${n}/${roster.length}] ${wp} ${u.title} — already scraped, skip`);
        consecutiveFails = 0;
        continue;
      }

      const rates = await fetchRatesPolitely(page, u.propertyId);
      const parsedRates = parseRates(rates);
      consecutiveFails = 0;

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
      consecutiveFails += 1;
      if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
        console.error(`\nABORTING: ${consecutiveFails} consecutive failures — the rates host is walling us off. ` +
          `Stopping at unit ${n}/${roster.length} to stay polite. Re-run later (quota resets fast) to resume the rest.`);
        problems.push({ issue: 'aborted-circuit-breaker', atUnit: n, of: roster.length });
        break;
      }
    }
    await sleep(cfg.REQUEST_DELAY_MS);
  }

  const done = fs.readdirSync(OUT).length;
  fs.writeFileSync(path.join(__dirname, 'output', 'problems.json'), JSON.stringify(problems, null, 2));
  console.log(`\nDone. ${done}/${roster.length} units scraped, ${problems.length} problems -> output/problems.json`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
