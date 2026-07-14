// src/discover.js
const cfg = require('./config');
const { sleep } = require('./browser');

// CMS pages share the /en/{id}/{slug} shape with units. Exclude the known ones.
const CMS_PAGE_IDS = new Set(['1474893', '3877954', '5214762']);

function extractPropertyLinks(hrefs, knownCmsIds = CMS_PAGE_IDS) {
  const seen = new Set();
  const out = [];
  for (const href of hrefs) {
    const m = String(href).match(/^\/en\/(\d+)\/([a-z0-9-]+)/i);
    if (!m) continue;
    const [, pageId, slug] = m;
    if (knownCmsIds.has(pageId) || seen.has(pageId)) continue;
    seen.add(pageId);
    out.push({ pageId, slug });
  }
  return out;
}

function totalFromResultsText(text) {
  const m = String(text).match(/(\d+)\s+Results|of\s+(\d+)\s+places/i);
  if (!m) return null;
  return Number(m[1] || m[2]);
}

// Read the roster grid currently rendered in the page.
async function readRosterDom(page) {
  return page.evaluate(() => ({
    hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
    body: document.body.innerText.slice(0, 400),
  }));
}

// Walk every roster page and return the full unit list.
//
// DEVIATION FROM PLAN: the plan walked `?page=N` in the URL, but the Lodgify
// roster is a client-rendered SPA and IGNORES the `page` query param — every
// `?page=N` URL re-renders page 1, so the original walk found only the first 12
// units and then dedupe-stopped. Pagination is driven by clicking the numbered
// pager BUTTONS (which carry no href). Two live-verified changes vs the plan:
//   1. Wait for network-idle after each render so the cards + "N Results" hydrate
//      (at domcontentloaded the grid is empty).
//   2. Advance by clicking the (p+1) pager button and waiting for the grid to
//      swap, instead of navigating a URL.
// The pure link/count parsers below are unchanged from the plan.
async function discoverRoster(page) {
  const all = [];
  const url = `${cfg.ORIGIN}${cfg.ROSTER_PATH}?adults=1&children=0&infants=0&pets=0`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  let { hrefs, body } = await readRosterDom(page);
  const expected = totalFromResultsText(body);
  const cmsIds = [...CMS_PAGE_IDS];

  for (let p = 1; p <= 20; p++) {                       // 13 pages today; 20 is a safe cap
    const found = extractPropertyLinks(hrefs);
    const fresh = found.filter((f) => !all.some((a) => a.pageId === f.pageId));
    all.push(...fresh);
    console.log(`roster page ${p}: +${fresh.length} (total ${all.length})`);
    if (expected && all.length >= expected) break;      // got them all
    if (p > 1 && !fresh.length) break;                  // grid stopped advancing

    const prevFirst = found.length ? found[0].pageId : null;
    // Click the next-page pager button (no href, so it must be clicked).
    const advanced = await page.evaluate((next) => {
      const btns = [...document.querySelectorAll('button, a')].filter(
        (b) => (b.textContent || '').trim() === String(next),
      );
      if (!btns.length) return false;
      btns[btns.length - 1].click();
      return true;
    }, p + 1);
    if (!advanced) break;                               // no further pages

    // The click re-renders the grid client-side (often without a network hit),
    // so wait for the first property id to actually change before re-reading.
    await page
      .waitForFunction(
        ({ prev, cms }) => {
          const first = [...document.querySelectorAll('a[href]')]
            .map((a) => a.getAttribute('href'))
            .map((h) => (h && h.match(/^\/en\/(\d+)\//i)) || null)
            .filter((m) => m && !cms.includes(m[1]))
            .map((m) => m[1])[0];
          return first && first !== prev;
        },
        { prev: prevFirst, cms: cmsIds },
        { timeout: 20000 },
      )
      .catch(() => {});
    await sleep(cfg.REQUEST_DELAY_MS);
    ({ hrefs, body } = await readRosterDom(page));
  }
  // Reconcile against the site's own advertised count — a silent shortfall here
  // would mean we quietly onboard fewer units than exist.
  if (expected && all.length !== expected) {
    console.warn(`WARNING: roster found ${all.length} units but the site advertises ${expected}`);
  }
  return { units: all, expected };
}

module.exports = { extractPropertyLinks, totalFromResultsText, discoverRoster, CMS_PAGE_IDS };
