// Central tunables. Keep concurrency LOW — this is an unsanctioned scrape of a
// small operator site behind Cloudflare. Politeness is a hard requirement (D-003).
module.exports = {
  WEBSITE_ID: 233292,
  ORIGIN: 'https://almazabay.lodgify.com',
  ROSTER_PATH: '/en/5214762/all-properties/',
  RATES_URL: (propId) =>
    `https://websiteserver.lodgify.com/v3/websites/rates/website/233292/language/en/property/${propId}`,
  CALENDAR_URL: (propId, roomId, startDate) =>
    `https://checkout.lodgify.com/api/v1/checkout/calendar` +
    `?propertyId=${propId}&startDate=${startDate}` +
    (roomId ? `&roomId=${roomId}` : ''),
  HORIZON_MONTHS: 7,                                        // current month + 6 ahead
  UNIT_CONCURRENCY: Number(process.env.UNIT_CONCURRENCY) || 2,
  REQUEST_DELAY_MS: Number(process.env.REQUEST_DELAY_MS) || 750, // pause between units
  PAGES_BASE_URL: 'https://mohamedmaged3002-droid.github.io/almaza-ical',
  WP_BASE: 91001,                                           // wp_post_id block start
  USER_AGENT:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};
