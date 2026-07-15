# Almaza daily price watch — design (2026-07-15)

## Purpose
Almaza (7th operator, Marsa Matrouh, ~152 units on `almazabay.lodgify.com`) is an
unsanctioned Lodgify scrape. We already publish per-unit iCal availability feeds
(`sync.js` → `docs/*.ics`). This adds a **price** watcher: each day it re-fetches the
live Lodgify rates, compares them to a committed baseline, and **emails the team only
when a nightly price (or the unit roster) actually changes**. It is a change *alarm*,
not a data pipeline — the team updates OTAs/BlueKeys by hand off the alert.

## Read-only
The watcher NEVER writes to Almaza or to any BlueKeys DB. Its only writes are the two
local baseline files it commits back to this repo (`state/prices.json`,
`data/roster.json`). No Supabase, no R2, no OTA.

## Daily EGP diff
- For each unit in `data/units.json`, fetch `RATES_URL(propertyId)` and expand the
  active season **2026-06-01 … 2026-10-31** into per-night prices via
  `dailyPricesForSeason(parseRates(rates), …)` — the period-covering rate, else the
  operator's explicit Default Rate. Same season constants as `build-prices-sql.js`.
- Almaza's Lodgify rates are **already EGP**, so the diff is pure EGP — **no FX / no
  USD conversion** (this is the one substantive difference from `brassbell-ical`'s
  watcher, which converts EGP→USD for OTA entry).
- `src/changes.js` (pure, unit-tested) diffs `{wp:{date:egp}}` maps. A date counts as
  a price change **only if it has a real price on BOTH sides and the value differs**.
  A date missing on one side is an *availability* flip (priced ↔ blocked) and is
  ignored — that belongs to the iCal availability sync, not here. Consecutive dates
  with the same `(oldEgp,newEgp)` pair collapse into one `from..to` range (mirrors
  brassbell's range-collapsing).
- Roster change: re-run `discoverRoster()` and diff by `pageId` → added/removed slugs.

## Gated email
- No price change **and** no roster change → log "no changes", **send nothing**, exit 0.
- Change detected → build a plain-text summary (`{operator code} {title}` then each
  `from→to: oldEgp → newEgp EGP`, plus added/removed units), `sendEmail(...)`, then
  advance the baseline (`state/prices.json` + `data/roster.json`) and commit it.
- First run / `--seed` (or `state/prices.json` absent): establish the baseline
  **silently**, no email — so the first run doesn't fire 152 phantom "changes".
- `--dry-run`: compute + print the email body, but do NOT email and do NOT write
  baselines.
- If a change is detected but SMTP is unconfigured, or the send fails after retries,
  the run exits **non-zero and does NOT advance the baseline** — the alert re-sends
  next run rather than being silently dropped (soul-price-watch semantics).

## Politeness (D-003)
The rates host throttles under load. Units are spaced ~4 s apart, each fetch backs off
`[15s, 30s, 60s]` on a throttle-triggered throw (copied from `content.js`), and a
**circuit breaker** aborts the whole run (non-zero exit) after 6 consecutive failures
rather than hammering an unauthorised operator for the rest of the roster. A unit that
transiently fails is simply absent from this run's map (no false price change) and
keeps its previous baseline via a merge.

## Reuse
Built entirely on the existing, tested `almaza-ical` library: `src/browser.js`
(CF-cleared page + `fetchJsonInPage`), `src/lodgify.js` (`parseRates`,
`dailyPricesForSeason`), `src/config.js` (`RATES_URL`), `src/discover.js`
(`discoverRoster`), `src/codes.js` (`operatorCode`), plus `data/units.json` (the
152-unit fetch list). Only genuinely new pieces: `src/changes.js` (pure diff),
`src/notify.js` (copied verbatim from `soul-price-watch`), and `pricewatch.js`.

## Recipients & schedule
GitHub Actions cron `0 4 * * *` (06:00 Africa/Cairo), plus manual `workflow_dispatch`
(with a `dry_run` toggle). Alerts go to: `samanoudi@bluekeys.co`, `maged@bluekeys.co`,
`reservations@bluekeys.co`, `mfikry772007@gmail.com`. Requires repo secrets
`SMTP_USER` / `SMTP_PASS` (Gmail app password) for delivery.
