import { createHash, randomUUID } from 'node:crypto';
import { assertBrief, assertRecord } from './schema.mjs';
import { HarnessError } from './errors.mjs';

export function createRecord(brief, id = `r-${randomUUID()}`, now = new Date().toISOString()) {
  assertBrief(brief);
  return assertRecord({ schemaVersion: 1, id, revision: 1, createdAt: now, updatedAt: now,
    title: brief.title, prompt: brief.prompt, question: brief.question ?? brief.prompt,
    mode: brief.mode ?? 'screen', domain: brief.domain ?? 'general',
    objectives: [], constraints: [], assumptions: [], criteria: [], alternatives: [], evidence: [], assessments: [], constraintChecks: [], recommendation: null, reviews: [], ...structuredClone(brief) });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const withoutBasis = value => { if (!value) return value; const { basis, ...rest } = value; return rest; };
const equal = (a, b) => canonical(a) === canonical(b);
// Cosmetic whitespace changes do not acknowledge newly changed evidence.
function substantive(value) {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ');
  if (Array.isArray(value)) return value.map(substantive);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substantive(v)]));
  return value;
}
const sameConclusion = (a, b) => equal(substantive(withoutBasis(a)), substantive(withoutBasis(b)));

export function assessmentBasis(record, a, constraint = false) {
  const criterion = constraint ? record.constraints.find(c => c.id === a.constraintId) : record.criteria.find(c => c.id === a.criterionId);
  return hash({ criterion, objectives: constraint ? [] : record.objectives.filter(o => criterion.objectiveIds.includes(o.id)), alternative: record.alternatives.find(x => x.id === a.alternativeId), evidence: record.evidence.filter(e => a.evidenceIds.includes(e.id)) });
}
export function recommendationBasis(record) {
  const { question, mode, domain, objectives, constraints, assumptions, criteria, alternatives, evidence, assessments, constraintChecks } = record;
  return hash({ question, mode, domain, objectives, constraints, assumptions, criteria: criteria.filter(c => c.status === 'adopted'), alternatives, evidence, assessments, constraintChecks });
}

export function prepareRevision(previous, incoming, { recheck = [], recheckRecommendation = false, now = new Date().toISOString() } = {}) {
  assertRecord(previous); assertRecord(incoming);
  if (incoming.id !== previous.id) throw new HarnessError('ID_MISMATCH', 'Cannot change the record ID.');
  const next = structuredClone(incoming);
  next.createdAt = previous.createdAt; next.updatedAt = now; next.revision = previous.revision + 1;
  const validRechecks = new Set([...next.assessments, ...next.constraintChecks].map(a => a.id));
  if (!Array.isArray(recheck) || recheck.some(id => !validRechecks.has(id))) throw new HarnessError('INVALID_RECHECK', 'Recheck IDs must identify existing assessments or constraint checks.');
  for (const group of ['assessments', 'constraintChecks']) for (const a of next[group]) {
    const old = previous[group].find(x => x.id === a.id);
    if (!old || !sameConclusion(old, a) || recheck.includes(a.id)) a.basis = assessmentBasis(next, a, group === 'constraintChecks');
    else if (old.basis) a.basis = old.basis;
    else delete a.basis;
  }
  if (next.recommendation) {
    if (recheckRecommendation || !sameConclusion(previous.recommendation, next.recommendation)) next.recommendation.basis = recommendationBasis(next);
    else if (previous.recommendation?.basis) next.recommendation.basis = previous.recommendation.basis;
    else delete next.recommendation.basis;
  } else if (recheckRecommendation) throw new HarnessError('INVALID_RECHECK', 'There is no recommendation to recheck.');
  return assertRecord(next);
}

export function checkRecord(record, stage = 'ready') {
  if (!['draft', 'ready'].includes(stage)) throw new HarnessError('INVALID_STAGE', 'Stage must be draft or ready.');
  const diagnostics = [];
  const add = (code, path, message, warning = false) => diagnostics.push({ code, severity: warning || stage === 'draft' ? 'warning' : 'error', path, message });
  const limitation = 'Checks recorded structure, coverage and staleness only; does not verify factual truth, completeness of human values, or research quality. A recheck is an explicit acknowledgement, not an independent experiment.';
  try { assertRecord(record); } catch (error) {
    if (error.code !== 'INVALID_RECORD') throw error;
    return { ok: false, stage, diagnostics: error.details.map(d => ({ code: 'INVALID_RECORD', severity: 'error', ...d })), limitation };
  }
  const adopted = record.criteria.filter(c => c.status === 'adopted');
  if (!record.objectives.length) add('MISSING_OBJECTIVES', '/objectives', 'Record the goals that matter to the user.');
  if (!adopted.length) add('MISSING_CRITERIA', '/criteria', 'Adopt at least one criterion.');
  for (const o of record.objectives) if (!adopted.some(c => c.objectiveIds.includes(o.id))) add('UNCOVERED_OBJECTIVE', '/objectives', `No adopted criterion addresses ${o.id}.`);
  for (const c of adopted) if (!c.objectiveIds.length) add('UNMAPPED_CRITERION', '/criteria', `${c.id} needs a rationale linked to at least one goal.`);
  const titles = new Set();
  for (const c of adopted) { const t = c.title.trim().toLocaleLowerCase(); if (titles.has(t)) add('POSSIBLE_OVERLAP', '/criteria', `Repeated criterion title: ${c.title}. Review whether it duplicates a goal.`, true); titles.add(t); }
  for (const a of record.assumptions) add('ASSUMPTION', '/assumptions', `${a.text} Impact: ${a.impact}`, true);
  for (const r of record.reviews.filter(r => r.status === 'open')) add('OPEN_REVIEW', '/reviews', `Open review ${r.id}: ${r.comment}`, true);
  if (record.mode === 'screen') {
    if (!record.alternatives.length) add('MISSING_ALTERNATIVES', '/alternatives', 'Add alternatives for a comparison, or use criteria mode.');
    for (const a of record.alternatives) {
      for (const c of adopted) if (!record.assessments.some(x => x.alternativeId === a.id && x.criterionId === c.id)) add('MISSING_ASSESSMENT', '/assessments', `Missing ${a.id} × ${c.id}; unknown with a reason is valid.`);
      for (const c of record.constraints) if (!record.constraintChecks.some(x => x.alternativeId === a.id && x.constraintId === c.id)) add('MISSING_CONSTRAINT_CHECK', '/constraintChecks', `Missing ${a.id} × ${c.id}.`);
    }
    for (const group of ['assessments', 'constraintChecks']) record[group].forEach((a, i) => {
      if (a.status !== 'unknown' && !a.evidenceIds.length) add('MISSING_EVIDENCE', `/${group}/${i}/evidenceIds`, `${a.id}: non-unknown statements need evidence; references alone do not prove support.`);
      if (a.basis !== assessmentBasis(record, a, group === 'constraintChecks')) add(group === 'assessments' ? 'STALE_ASSESSMENT' : 'STALE_CONSTRAINT_CHECK', `/${group}/${i}`, `${a.id} depends on changed or unacknowledged material. Review it and explicitly recheck.`);
    });
    if (!record.recommendation) add('MISSING_RECOMMENDATION', '/recommendation', 'Explain a conditional shortlist, including an empty shortlist if appropriate.');
    else {
      if (record.recommendation.basis !== recommendationBasis(record)) add('STALE_RECOMMENDATION', '/recommendation', 'Decision context or analysis changed; revisit the recommendation.');
      const selected = new Set(record.recommendation.alternativeIds);
      if (record.assessments.some(a => selected.has(a.alternativeId) && (a.status === 'mixed' || a.status === 'unknown' || a.uncertainty.trim()))) add('UNRESOLVED_UNCERTAINTY', '/recommendation', 'Selected alternatives have recorded uncertainty. Explain the tradeoff and what remains to verify.', true);
      if ([...record.assessments, ...record.constraintChecks].some(a => selected.has(a.alternativeId) && a.status === 'unknown') && !record.recommendation.conditions.length && !record.recommendation.nextChecks.length) add('UNCONDITIONAL_UNKNOWN', '/recommendation', 'Selected options have unknowns; record conditions or next checks.');
      for (const a of record.constraintChecks) if (a.status === 'violated' && record.constraints.find(c => c.id === a.constraintId).kind === 'hard') add('HARD_CONSTRAINT_VIOLATION', '/constraintChecks', `${a.alternativeId} violates hard constraint ${a.constraintId}. Revisit the constraint or selection; the tool never deletes the option.`, !selected.has(a.alternativeId));
    }
  }
  return { ok: !diagnostics.some(d => d.severity === 'error'), stage, diagnostics, limitation };
}

export function diffRecords(before, after, path = '') {
  if (equal(before, after)) return [];
  if (before && after && typeof before === 'object' && typeof after === 'object' && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => diffRecords(before[key], after[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`));
  }
  return [{ path: path || '/', before: before === undefined ? null : before, after: after === undefined ? null : after }];
}
