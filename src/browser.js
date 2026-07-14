// src/browser.js
// All Lodgify endpoints sit behind Cloudflare, which challenges non-browser
// clients (plain curl gets "Just a moment..."). We therefore drive a REAL
// Chromium with an HONEST user-agent and fetch from inside the page context,
// so the CF clearance cookie applies.
//
// D-003: do NOT add stealth/anti-detection plugins. Almaza has not authorised
// this scrape. If honest access stops working, STOP and escalate to Maged.
const { chromium } = require('playwright');
const cfg = require('./config');

async function openBrowser() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: cfg.USER_AGENT });
  const page = await ctx.newPage();
  // Land on the origin once so Cloudflare issues its clearance cookie for the
  // whole session; every later in-page fetch then rides on it.
  await page.goto(cfg.ORIGIN, { waitUntil: 'domcontentloaded' });
  return { browser, page };
}

// Fetch JSON from inside the page (rides the CF cookie). Throws on non-200.
async function fetchJsonInPage(page, url) {
  const out = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'omit' });
    const text = await r.text();
    return { status: r.status, text };
  }, url);
  if (out.status !== 200) {
    throw new Error(`GET ${url} -> ${out.status}: ${out.text.slice(0, 120)}`);
  }
  try {
    return JSON.parse(out.text);
  } catch {
    // A Cloudflare challenge returns HTML, not JSON — surface that clearly.
    throw new Error(`GET ${url} -> non-JSON (Cloudflare challenge?): ${out.text.slice(0, 120)}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { openBrowser, fetchJsonInPage, sleep };
