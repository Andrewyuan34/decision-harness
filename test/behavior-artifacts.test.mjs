import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { checkRecord } from '../skills/decision-harness/scripts/core.mjs';
const load = async name => JSON.parse(await fs.readFile(new URL(`../docs/agent-examples/${name}.json`, import.meta.url), 'utf8'));

test('DH-02 DH-03 DH-06 observed non-game Agent task preserves criteria-only scope and goal mapping', async () => {
  const r = await load('a-criteria');
  assert.equal(r.mode, 'criteria'); assert.equal(r.domain, 'general');
  assert.equal(r.alternatives.length, 0); assert.equal(r.recommendation, null); assert.equal(r.reviews.length, 0);
  assert.ok(r.criteria.length > 0 && r.criteria.every(c => c.objectiveIds.length && c.rationale));
  assert.ok(r.criteria.some(c => c.origin === 'library' && c.catalogVersion));
  assert.ok(r.criteria.some(c => c.origin === 'agent'));
  assert.equal(checkRecord(r).ok, true);
});

test('DH-02 DH-08 DH-10 observed source-based comparison keeps unknowns and conditional alternatives', async () => {
  const r = await load('b-initial');
  assert.equal(checkRecord(r).ok, true); assert.equal(r.alternatives.length, 2);
  assert.ok(r.evidence.filter(e => e.kind === 'web').length >= 2);
  assert.ok(r.assessments.some(a => a.status === 'unknown'));
  assert.ok(r.assessments.every(a => a.status === 'unknown' || a.evidenceIds.length));
  assert.ok(r.recommendation.conditions.length && r.recommendation.nextChecks.length);
  assert.equal(r.recommendation.alternativeIds.length, 2); assert.equal('score' in r.recommendation, false);
});

test('DH-02 DH-13 observed changed user requirement invalidates old recommendation, then preserves explicit uncertainty', async () => {
  const original = await load('b-initial'), intermediate = await load('c-changed'), revised = await load('c-revised');
  assert.equal(intermediate.revision, original.revision + 1); assert.equal(revised.revision, intermediate.revision + 1);
  assert.equal(intermediate.recommendation.basis, original.recommendation.basis);
  const check = checkRecord(intermediate); assert.equal(check.ok, false);
  for (const code of ['MISSING_ASSESSMENT', 'MISSING_CONSTRAINT_CHECK', 'STALE_RECOMMENDATION']) assert.ok(check.diagnostics.some(d => d.code === code));
  assert.equal(checkRecord(revised).ok, true);
  assert.notDeepEqual(revised.recommendation.alternativeIds, original.recommendation.alternativeIds);
  assert.equal(revised.alternatives.length, original.alternatives.length, 'A negative finding must not delete its candidate.');
  assert.ok(revised.constraintChecks.some(c => c.status === 'unknown' && revised.recommendation.alternativeIds.includes(c.alternativeId)));
  assert.ok(revised.recommendation.conditions.length && revised.recommendation.nextChecks.length);
  assert.equal(original.recommendation.alternativeIds.length, 2, 'Earlier exported state stays intact.');
});
