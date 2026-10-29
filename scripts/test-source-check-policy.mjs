import assert from 'node:assert/strict';
import { reconcileSourceCheck } from './source-check-policy.mjs';
const now = Date.parse('2026-10-29T22:00:00Z');
const index = {status:'active-current-source-limited',checkedAt:'2026-10-29T22:00:00Z',httpStatus:404,sourceUrl:'https://example.org/index'};
for (const kind of ['written-analysis','public-excerpt','transcript']) {
  const prior={status:`active-current-${kind}-reviewed`,checkedAt:'2026-10-29T20:00:00Z',sourceUrl:'https://example.org/article',latestFinding:'Reviewed attributable content'};
  const result=reconcileSourceCheck(prior,index,now);
  assert.equal(result.status,prior.status);
  assert.equal(result.sourceUrl,prior.sourceUrl);
  assert.equal(result.checkedAt,prior.checkedAt);
  assert.equal(result.indexAvailability.httpStatus,404);
  assert.equal(reconcileSourceCheck({...prior,checkedAt:'2026-10-26T20:00:00Z'},index,now),index);
  assert.equal(reconcileSourceCheck({...prior,checkedAt:'2026-11-01T20:00:00Z'},index,now),index);
}
assert.equal(reconcileSourceCheck(null,index,now),index);
assert.equal(reconcileSourceCheck({status:'active-current-source-limited',checkedAt:index.checkedAt},index,now),index);
console.log('Source review preservation PASS: index checks retain recent substantive evidence without inventing reviews.');
