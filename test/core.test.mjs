import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, prepareRevision, checkRecord, diffRecords } from '../skills/decision-harness/scripts/core.mjs';
import { assertRecord } from '../skills/decision-harness/scripts/schema.mjs';
import { parseJson } from '../skills/decision-harness/scripts/errors.mjs';
import { completeRecord, NOW } from './fixtures.mjs';

test('DH-03 DH-07 criteria-only research can finish without alternatives or review', () => {
  const r = completeRecord('criteria');
  assert.equal(checkRecord(r, 'ready').ok, true);
  assert.equal(r.alternatives.length, 0);
  assert.equal(r.reviews.length, 0);
});

test('DH-07 DH-09 schema rejects unknown fields, bad enums, IDs and dangling references', () => {
  for (const change of [r => r.typo = true, r => r.mode = 'other', r => r.objectives[0].id = '../x', r => r.criteria[0].objectiveIds = ['absent']]) {
    const r = completeRecord('criteria'); change(r);
    assert.throws(() => assertRecord(r), e => e.code === 'INVALID_RECORD' && e.details.some(d => d.path));
  }
});

test('DH-08 DH-09 unknown is legitimate; unsupported certainty is not ready', () => {
  const r = completeRecord();
  r.assessments[0].status = 'unknown'; r.assessments[0].evidenceIds = []; r.assessments[0].uncertainty = 'No independent experiment.';
  const saved = prepareRevision(completeRecord(), r, { recheck: ['assessment-a'] });
  saved.recommendation.conditions = ['Only if the missing experiment passes.'];
  const ready = prepareRevision(saved, saved, { recheckRecommendation: true });
  assert.equal(checkRecord(ready, 'ready').ok, true);
  const bad = structuredClone(ready); bad.assessments[0].status = 'supported';
  assert.ok(checkRecord(bad, 'ready').diagnostics.some(d => d.code === 'MISSING_EVIDENCE'));
});

test('DH-09 missing pair and uncovered objective are reported, drafts remain savable', () => {
  const r = completeRecord(); r.assessments = [];
  r.objectives.push({ id: 'learning', text: 'Learn something useful', origin: 'user' });
  assert.doesNotThrow(() => assertRecord(r));
  assert.equal(checkRecord(r, 'draft').ok, true);
  const c = checkRecord(r, 'ready');
  assert.equal(c.ok, false);
  assert.ok(c.diagnostics.some(d => d.code === 'MISSING_ASSESSMENT'));
  assert.ok(c.diagnostics.some(d => d.code === 'UNCOVERED_OBJECTIVE'));
});

test('DH-07 DH-09 duplicate pairs/IDs and invalid review targets are rejected', () => {
  const r = completeRecord(); r.assessments.push({ ...r.assessments[0], id: 'other' });
  assert.throws(() => assertRecord(r), /Invalid research record/);
  const dup = completeRecord(); dup.objectives.push({ ...dup.objectives[0] });
  assert.throws(() => assertRecord(dup), /Invalid research record/);
  const review = completeRecord(); review.reviews.push({ id: 'review-a', target: 'assessment:missing', author: 'user', comment: 'why', status: 'open', response: '' });
  assert.throws(() => assertRecord(review), /Invalid research record/);
});

test('DH-10 concern does not delete a candidate, but explicit hard violation is visible', () => {
  const r = completeRecord(); r.assessments[0].status = 'concern';
  let saved = prepareRevision(completeRecord(), r, { recheckRecommendation: true });
  assert.equal(checkRecord(saved, 'ready').ok, true);
  assert.equal(saved.alternatives.length, 1);
  saved.constraints = [{ id: 'offline', text: 'Must work offline', kind: 'hard', origin: 'user' }];
  saved.constraintChecks = [{ id: 'offline-a', alternativeId: 'option-a', constraintId: 'offline', status: 'violated', rationale: 'Requires a server.', evidenceIds: ['source-a'] }];
  saved = prepareRevision(r, saved, { recheckRecommendation: true });
  assert.ok(checkRecord(saved, 'ready').diagnostics.some(d => d.code === 'HARD_CONSTRAINT_VIOLATION'));
  assert.equal(saved.alternatives.length, 1);
});

test('DH-10 empty shortlist is allowed with an explanation and no forced winner', () => {
  const r = completeRecord(); r.recommendation.alternativeIds = []; r.recommendation.rationale = 'Need an actual workload test before choosing.';
  const saved = prepareRevision(completeRecord(), r);
  assert.equal(checkRecord(saved, 'ready').ok, true);
});

test('DH-13 changed evidence invalidates unchanged judgment and recommendation', () => {
  const previous = completeRecord(); const edit = structuredClone(previous);
  edit.evidence[0].summary = 'A new experiment contradicts the earlier claim.';
  const saved = prepareRevision(previous, edit);
  assert.ok(checkRecord(saved, 'ready').diagnostics.some(d => d.code === 'STALE_ASSESSMENT'));
  assert.ok(checkRecord(saved, 'ready').diagnostics.some(d => d.code === 'STALE_RECOMMENDATION'));
  const updated = prepareRevision(saved, saved, { recheck: ['assessment-a'], recheckRecommendation: true });
  assert.equal(checkRecord(updated, 'ready').ok, true);
  assert.notEqual(updated.assessments[0].basis, previous.assessments[0].basis);
  assert.equal(previous.evidence[0].summary, 'Observed a passing documented check.');
});

test('DH-13 new criterion cannot inherit old recommendation and bogus recheck fails', () => {
  const r = completeRecord(); const edit = structuredClone(r);
  edit.criteria.push({ ...edit.criteria[0], id: 'maintenance', title: 'Maintenance' });
  const saved = prepareRevision(r, edit);
  assert.ok(checkRecord(saved, 'ready').diagnostics.some(d => d.code === 'MISSING_ASSESSMENT'));
  assert.throws(() => prepareRevision(r, r, { recheck: ['missing'] }), e => e.code === 'INVALID_RECHECK');
});

test('DH-14 review is optional; resolving requires response; reviews do not stale analysis', () => {
  const r = completeRecord(); const edit = structuredClone(r);
  edit.reviews.push({ id: 'review-a', target: 'assessment:assessment-a', author: 'user', comment: 'Please inspect this source', status: 'open', response: '' });
  const saved = prepareRevision(r, edit);
  assert.equal(checkRecord(saved, 'ready').ok, true);
  assert.ok(checkRecord(saved, 'ready').diagnostics.some(d => d.code === 'OPEN_REVIEW'));
  edit.reviews[0].status = 'resolved';
  assert.throws(() => assertRecord(edit), /Invalid research record/);
  edit.reviews[0].response = 'Read the actual document and retained uncertainty.';
  assert.doesNotThrow(() => assertRecord(edit));
});

test('DH-11 DH-17 initialization preserves Unicode; diff reports meaningful changed paths', () => {
  const r = createRecord({ title: '独立研究', prompt: '希望一个人能做完', mode: 'criteria' }, 'example', NOW);
  assert.equal(r.prompt, '希望一个人能做完'); assert.equal(r.question, r.prompt);
  const next = structuredClone(r); next.question = 'Which scope?';
  assert.deepEqual(diffRecords(r, next), [{ path: '/question', before: r.question, after: next.question }]);
});

test('DH-18 checks state their limited meaning and never invent scores', () => {
  const r = completeRecord(); const c = checkRecord(r, 'ready');
  assert.match(c.limitation, /truth/); assert.equal('score' in r.recommendation, false);
  assert.throws(() => checkRecord(r, 'mystery'), e => e.code === 'INVALID_STAGE');
});

test('DH-19 JSON source is inert and prototype keys/oversize are rejected', () => {
  assert.throws(() => parseJson('{"__proto__":{"polluted":1}}'), e => e.code === 'INVALID_JSON');
  assert.throws(() => parseJson(' '.repeat(5 * 1024 * 1024 + 1)), e => e.code === 'INPUT_TOO_LARGE');
  assert.equal(parseJson('{"text":"$(Write-Output danger)"}').text, '$(Write-Output danger)');
});

test('DH-07 malformed review target always produces a structured validation error', () => {
  for (const target of ['constructor:x', '__proto__:x', 'criterion:verifiable:']) {
    const r = completeRecord(); r.reviews.push({ id: 'r', target, author: 'tester', comment: 'check', status: 'open', response: '' });
    assert.throws(() => assertRecord(r), e => e.code === 'INVALID_RECORD');
  }
});

test('DH-13 cosmetic conclusion edits cannot conceal changed evidence', () => {
  const r = completeRecord(), edit = structuredClone(r);
  edit.evidence[0].summary = 'Contradictory result'; edit.assessments[0].rationale += ' '; edit.recommendation.rationale += '\n';
  const saved = prepareRevision(r, edit);
  const codes = checkRecord(saved).diagnostics.map(d => d.code);
  assert.ok(codes.includes('STALE_ASSESSMENT')); assert.ok(codes.includes('STALE_RECOMMENDATION'));
});

test('DH-10 unresolved mixed evidence is surfaced even when not unknown', () => {
  const r = completeRecord(), edit = structuredClone(r); edit.assessments[0].status = 'mixed';
  const saved = prepareRevision(r, edit, { recheckRecommendation: true });
  assert.ok(checkRecord(saved).diagnostics.some(d => d.code === 'UNRESOLVED_UNCERTAINTY' && d.severity === 'warning'));
});

test('DH-07 evidence dates cannot name nonexistent calendar days', () => {
  const r = completeRecord(); r.evidence[0].retrievedAt = '2026-02-30T12:00:00.000Z';
  assert.throws(() => assertRecord(r), e => e.code === 'INVALID_RECORD');
  r.evidence[0].retrievedAt = '2024-02-29T12:00:00.000Z'; assert.doesNotThrow(() => assertRecord(r));
});
