// A public index availability check must never erase a recent content review.
export function reconcileSourceCheck(prior, indexCheck, now = Date.now()) {
  const reviewedAt = Date.parse(prior?.checkedAt || '');
  const substantive = /(?:written-analysis|public-excerpt|transcript)-reviewed/i.test(prior?.status || '')
    && !/fail|missing|stale/i.test(prior?.status || '')
    && Number.isFinite(reviewedAt) && reviewedAt <= now + 300000
    && now - reviewedAt < 48 * 3600000;
  if (!substantive) return indexCheck;
  return {...prior, indexAvailability: {
    checkedAt: indexCheck.checkedAt, sourceUrl: indexCheck.sourceUrl,
    httpStatus: indexCheck.httpStatus, latestFinding: indexCheck.latestFinding
  }};
}
