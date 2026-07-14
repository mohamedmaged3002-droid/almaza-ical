// src/guard.js
// Decide whether a fresh scrape result may overwrite the last-good .ics.
// prev:    { availableCount } from the previous index.json entry, or null.
// current: { ok, blocked, available, errors } counts from this scrape.
function shouldWrite(prev, current, nights) {
  const { ok, blocked, available, errors } = current;
  if (!ok) return { write: false, reason: 'scrape-not-ok' };

  const classified = blocked + available;
  // An empty feed means "nothing blocked" — i.e. fully open. Publishing that off
  // a failed scrape would re-open real bookings. Fail closed.
  if (classified === 0) return { write: false, reason: 'zero-classified' };
  if (classified < nights * 0.95) return { write: false, reason: 'low-coverage' };
  if (errors > nights * 0.05) return { write: false, reason: 'too-many-errors' };

  // A sudden mass-unblocking is far more likely to be a scrape bug than 150
  // real cancellations. Refuse and keep the last-good feed.
  if (prev && typeof prev.availableCount === 'number' && prev.availableCount > 0) {
    if (available < prev.availableCount * 0.5) {
      return { write: false, reason: 'availability-collapse' };
    }
  }
  return { write: true, reason: 'ok' };
}

module.exports = { shouldWrite };
