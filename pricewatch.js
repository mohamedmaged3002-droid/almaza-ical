#!/usr/bin/env node
// pricewatch.js — Almaza daily price watch.
//
// Re-fetches Almaza's live Lodgify rates for every unit in data/units.json, expands
// the season into per-night EGP prices, diffs them (+ the unit roster) against the
// committed baseline in state/prices.json + data/roster.json, and emails the team
// ONLY when a price or the roster changed. Read-only: it never writes to Almaza or
// any DB — the only writes are the local baseline files.
//
// Modelled on soul-price-watch/check.js (gated email, exit-1-on-undelivered-alert)
// and brassbell-ical change detection (src/changes.js). EGP throughout — no FX.
//
// Modes:
//   (default)     fetch -> diff -> email on change -> advance baseline
//   --dry-run     fetch -> diff -> log + print the email body; NO email, NO baseline write
//   --seed        (or: state/prices.json absent) establish the baseline from a fresh
//                 fetch WITHOUT emailing (first run is silent)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const cfg = require('./src/config');
const { openBrowser, fetchJsonInPage, sleep } = require('./src/browser');
const { discoverRoster } = require('./src/discover');
const { parseRates, dailyPricesForSeason } = require('./src/lodgify');
const { operatorCode } = require('./src/codes');
const { diffAll } = require('./src/changes');
const { smtpConfigured, sendEmail } = require('./src/notify');

// Same season window as build-prices-sql.js — the operator's active season.
const SEASON_START = '2026-06-01';
const SEASON_END = '2026-10-31';

const UNITS_PATH = path.join(__dirname, 'data', 'units.json');
const STATE_PATH = path.join(__dirname, 'state', 'prices.json');
const ROSTER_PATH = path.join(__dirname, 'data', 'roster.json');

const DRY = process.argv.includes('--dry-run');
const SEED = process.argv.includes('--seed');

// Politeness (D-003): Almaza has not authorised this scrape and the rates host
// throttles under load. Space units far apart, back off on throttle, and STOP
// entirely if we get walled off — never hammer.
const UNIT_SPACING_MS = 4000;
const RATE_BACKOFF_MS = [15000, 30000, 60000]; // copied from content.js fetchRatesPolitely
const MAX_CONSECUTIVE_FAILS = 6;

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// One line per unit -> a single-price change touches ONE line in the committed diff.
function serializePriceMap(map) {
  const wps = Object.keys(map).sort((a, b) => Number(a) - Number(b));
  return '{\n' + wps.map((wp) => `${JSON.stringify(String(wp))}:${JSON.stringify(map[wp])}`).join(',\n') + '\n}\n';
}

function writeBaseline(priceMap, roster) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, serializePriceMap(priceMap));
  fs.writeFileSync(
    ROSTER_PATH,
    JSON.stringify(roster.map((u) => ({ pageId: String(u.pageId), slug: u.slug })), null, 2) + '\n',
  );
  console.log(`Baseline written: ${Object.keys(priceMap).length} units priced, roster ${roster.length}.`);
}

// POLITE rate fetch: back off and retry on a throttle-triggered throw, then give up.
// (Same backoff schedule as content.js fetchRatesPolitely.)
async function fetchRatesWithBackoff(page, propId) {
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

const fmtRange = (r) =>
  `  ${r.from === r.to ? r.from : `${r.from}→${r.to}`}: ${r.oldEgp} → ${r.newEgp} EGP`;

// Build the plain-text alert. Subject reflects the dominant change kind.
function buildSummary(diff, units) {
  const byWp = new Map(units.map((u) => [String(u.wp), u]));
  const n = diff.priceChanges.length;
  const subject = n > 0
    ? `Almaza price changes — ${n} unit${n === 1 ? '' : 's'}`
    : `Almaza roster changed — ${diff.addedUnits.length} added, ${diff.removedUnits.length} removed`;

  const lines = [subject, ''];
  for (const pc of diff.priceChanges) {
    const u = byWp.get(String(pc.wp));
    const title = u ? u.title : `wp${pc.wp}`;
    const code = u ? operatorCode(u.title) : null;
    // Prepend the operator code, but not when the title already leads with it
    // (Almaza titles like "72D Bay homes…" would otherwise read "72D 72D …").
    const label = code && !new RegExp(`^${code}\\b`, 'i').test(title) ? `${code} ${title}` : title;
    lines.push(`[wp${pc.wp}] ${label}`);
    for (const r of pc.ranges) lines.push(fmtRange(r));
    lines.push('');
  }
  if (diff.addedUnits.length) {
    lines.push(`Added units (${diff.addedUnits.length}):`);
    for (const s of diff.addedUnits) lines.push(`  + ${s}`);
    lines.push('');
  }
  if (diff.removedUnits.length) {
    lines.push(`Removed units (${diff.removedUnits.length}):`);
    for (const s of diff.removedUnits) lines.push(`  - ${s}`);
    lines.push('');
  }
  return { subject, body: lines.join('\n').trimEnd() + '\n' };
}

async function main() {
  const units = loadJson(UNITS_PATH, null);
  if (!Array.isArray(units) || !units.length) throw new Error('data/units.json missing or empty');

  const baseline = loadJson(STATE_PATH, {});     // { wp: { date: egp } }, {} if absent
  const oldRoster = loadJson(ROSTER_PATH, []);   // [{ pageId, slug }]
  const firstRun = SEED || !fs.existsSync(STATE_PATH);

  const { browser, page } = await openBrowser();
  const newPrices = {};
  let newRoster = oldRoster;
  try {
    // Re-discover the roster for roster-change detection (reuses discover.js).
    const disc = await discoverRoster(page);
    newRoster = disc.units;
    console.log(`roster: ${newRoster.length} units (site advertises ${disc.expected})`);

    let consecutiveFails = 0;
    let i = 0;
    for (const u of units) {
      i += 1;
      try {
        const rates = parseRates(await fetchRatesWithBackoff(page, u.propertyId));
        newPrices[u.wp] = Object.fromEntries(
          dailyPricesForSeason(rates, SEASON_START, SEASON_END).map((r) => [r.date, r.price]),
        );
        consecutiveFails = 0;
        console.log(`[${i}/${units.length}] ${u.wp} ${u.title} — ${Object.keys(newPrices[u.wp]).length} priced dates`);
      } catch (e) {
        consecutiveFails += 1;
        console.error(`[${i}/${units.length}] FAILED ${u.wp} (prop ${u.propertyId}): ${e.message}`);
        // Circuit breaker: the rates host is walling us off. STOP and exit non-zero
        // rather than hammer an unauthorised operator for the rest of the roster.
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
          throw new Error(
            `circuit-breaker: ${consecutiveFails} consecutive rate fetches failed at unit ${i}/${units.length} — aborting to stay polite`,
          );
        }
      }
      await sleep(UNIT_SPACING_MS);
    }
  } finally {
    await browser.close();
  }

  const diff = diffAll(baseline, newPrices, oldRoster, newRoster);
  const changed =
    diff.priceChanges.length > 0 || diff.addedUnits.length > 0 || diff.removedUnits.length > 0;

  // Merge so a unit that transiently failed to fetch keeps its last-known baseline
  // (an absent unit produced no false price change above, and won't lose history).
  const nextBaseline = { ...baseline, ...newPrices };

  // ---- first run: establish the baseline SILENTLY (no email) ----
  if (firstRun) {
    console.log(`Seed run: establishing baseline for ${Object.keys(newPrices).length} units — no email sent.`);
    if (DRY) { console.log('[dry-run] seed: NOT writing baseline.'); return 0; }
    writeBaseline(nextBaseline, newRoster);
    return 0;
  }

  // ---- subsequent runs ----
  if (!changed) {
    console.log('No price or roster changes — no email sent.');
    return 0;
  }

  const { subject, body } = buildSummary(diff, units);
  console.log(`Changes: ${diff.priceChanges.length} priced units, +${diff.addedUnits.length} / -${diff.removedUnits.length} roster.`);
  console.log('---\n' + subject + '\n\n' + body + '---');

  if (DRY) {
    console.log('[dry-run] changes detected; NOT emailing and NOT writing baseline.');
    return 0;
  }
  if (!smtpConfigured()) {
    console.error('Changes detected but SMTP is not configured — failing loudly so the alert is not silently dropped.');
    return 1;
  }
  const { sent } = await sendEmail({ subject, body });
  if (!sent) { console.error('Alert email failed after retries; NOT writing baseline (will re-send next run).'); return 1; }
  writeBaseline(nextBaseline, newRoster);
  return 0;
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => { console.error('FATAL:', err && err.message ? err.message : err); process.exit(1); });
