import { HarnessError, validId, MAX_BYTES } from './errors.mjs';

const text = { type: 'string', nonempty: true };
const string = { type: 'string' };
const id = { ...text, id: true };
const date = { ...text, date: true };
const enumeration = (...values) => ({ type: 'string', values });
const array = items => ({ type: 'array', items });
const object = (properties, optional = []) => ({ type: 'object', properties, optional });
const ids = array(id), texts = array(text);
const basis = { ...text, pattern: /^[a-f0-9]{64}$/ };
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] && Number(value.slice(11, 13)) < 24;
}
export const objectiveSchema = object({ id, text, origin: enumeration('user', 'agent') });
export const constraintSchema = object({ id, text, kind: enumeration('hard', 'preference'), origin: enumeration('user', 'agent') });
export const assumptionSchema = object({ id, text, impact: text });
export const criterionSchema = object({ id, title: text, description: text, objectiveIds: ids, question: text, rationale: text, status: enumeration('adopted', 'rejected'), origin: enumeration('library', 'user', 'agent'), catalogId: text, catalogVersion: text }, ['catalogId', 'catalogVersion']);
const alternativeSchema = object({ id, title: text, description: text });
const evidenceSchema = object({ id, title: text, location: text, kind: enumeration('web', 'local', 'user', 'experiment'), summary: text, retrievedAt: date });
const assessmentSchema = object({ id, alternativeId: id, criterionId: id, status: enumeration('supported', 'mixed', 'concern', 'unknown'), claimType: enumeration('fact', 'estimate', 'judgment'), rationale: text, evidenceIds: ids, uncertainty: string, basis }, ['basis']);
const constraintCheckSchema = object({ id, alternativeId: id, constraintId: id, status: enumeration('met', 'violated', 'unknown'), rationale: text, evidenceIds: ids, basis }, ['basis']);
const recommendationSchema = object({ alternativeIds: ids, rationale: text, tradeoffs: texts, conditions: texts, nextChecks: texts, basis }, ['basis']);
const reviewSchema = object({ id, target: text, author: text, comment: text, status: enumeration('open', 'resolved'), response: string });
const briefProperties = { title: text, prompt: text, question: text, mode: enumeration('criteria', 'screen'), domain: text, objectives: array(objectiveSchema), constraints: array(constraintSchema), assumptions: array(assumptionSchema), criteria: array(criterionSchema) };
const briefSchema = object(briefProperties, Object.keys(briefProperties).filter(k => !['title', 'prompt'].includes(k)));
export const recordSchema = object({ schemaVersion: { type: 'number', constant: 1 }, id, revision: { type: 'number', positiveInteger: true }, createdAt: date, updatedAt: date, ...briefProperties, alternatives: array(alternativeSchema), evidence: array(evidenceSchema), assessments: array(assessmentSchema), constraintChecks: array(constraintCheckSchema), recommendation: { ...recommendationSchema, nullable: true }, reviews: array(reviewSchema) });

function validate(value, schema, path, errors) {
  const fail = message => errors.push({ path: path || '/', message });
  if (value === null && schema.nullable) return;
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return fail('Expected an array.');
    value.forEach((item, index) => validate(item, schema.items, `${path}/${index}`, errors));
    if (schema.items.type === 'string' && new Set(value).size !== value.length) fail('Duplicate list values.');
    return;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('Expected a plain object.');
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) errors.push({ path: `${path}/${key}`, message: 'Unknown field.' });
    for (const [key, rule] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(value, key)) {
        if (!schema.optional.includes(key)) errors.push({ path: `${path}/${key}`, message: 'Required field.' });
      } else validate(value[key], rule, `${path}/${key}`, errors);
    }
    return;
  }
  if (typeof value !== schema.type) return fail(`Expected ${schema.type}.`);
  if (schema.nonempty && !value.trim()) fail('Must not be blank.');
  if (schema.id && !validId(value)) fail('Invalid ID; use lowercase letters, digits, hyphen or underscore, starting with a letter, up to 64 characters.');
  if (schema.date && !validDate(value)) fail('Expected a real ISO 8601 timestamp.');
  if (schema.values && !schema.values.includes(value)) fail(`Expected one of: ${schema.values.join(', ')}.`);
  if (schema.constant !== undefined && value !== schema.constant) fail(`Expected ${schema.constant}.`);
  if (schema.positiveInteger && (!Number.isSafeInteger(value) || value < 1)) fail('Expected a positive safe integer.');
  if (schema.pattern && !schema.pattern.test(value)) fail('Invalid dependency fingerprint.');
}

export function assertBrief(brief) {
  const errors = []; validate(brief, briefSchema, '', errors);
  if (errors.length) throw new HarnessError('INVALID_BRIEF', 'Invalid initialization brief.', errors);
  return brief;
}

export function assertRecord(record) {
  const errors = []; validate(record, recordSchema, '', errors);
  if (!errors.length) {
    const groups = ['objectives', 'constraints', 'assumptions', 'criteria', 'alternatives', 'evidence', 'assessments', 'constraintChecks', 'reviews'];
    const sets = Object.fromEntries(groups.map(group => [group, new Set(record[group].map(x => x.id))]));
    for (const group of groups) if (sets[group].size !== record[group].length) errors.push({ path: `/${group}`, message: 'Duplicate entity IDs.' });
    // Assessment and constraint-check IDs share the --recheck namespace.
    for (const value of sets.assessments) if (sets.constraintChecks.has(value)) errors.push({ path: '/constraintChecks', message: 'ID collides with an assessment ID.' });
    const ref = (value, group, path) => { if (!sets[group].has(value)) errors.push({ path, message: `Unknown ${group} ID: ${value}.` }); };
    record.criteria.forEach((c, i) => {
      c.objectiveIds.forEach((v, j) => ref(v, 'objectives', `/criteria/${i}/objectiveIds/${j}`));
      if (c.origin === 'library' && (!c.catalogId || !c.catalogVersion)) errors.push({ path: `/criteria/${i}`, message: 'Library criteria need catalogId and catalogVersion.' });
    });
    for (const [group, field, target] of [['assessments', 'criterionId', 'criteria'], ['constraintChecks', 'constraintId', 'constraints']]) {
      const pairs = new Set();
      record[group].forEach((a, i) => {
        ref(a.alternativeId, 'alternatives', `/${group}/${i}/alternativeId`);
        ref(a[field], target, `/${group}/${i}/${field}`);
        a.evidenceIds.forEach((v, j) => ref(v, 'evidence', `/${group}/${i}/evidenceIds/${j}`));
        const pair = `${a.alternativeId}:${a[field]}`;
        if (pairs.has(pair)) errors.push({ path: `/${group}/${i}`, message: 'Duplicate alternative/criterion or constraint pair.' });
        pairs.add(pair);
      });
    }
    record.evidence.forEach((e, i) => {
      if (e.kind === 'web') {
        try { if (!['http:', 'https:'].includes(new URL(e.location).protocol)) throw new Error(); }
        catch { errors.push({ path: `/evidence/${i}/location`, message: 'Web evidence requires an absolute HTTP(S) URL.' }); }
      }
    });
    record.recommendation?.alternativeIds.forEach((v, i) => ref(v, 'alternatives', `/recommendation/alternativeIds/${i}`));
    record.reviews.forEach((r, i) => {
      const segments = r.target.split(':'), [kind, target] = segments;
      const groups = { criterion: 'criteria', assessment: 'assessments', alternative: 'alternatives' };
      if ((Object.hasOwn(groups, kind) ? segments.length !== 2 || !target || !sets[groups[kind]].has(target) : !['record', 'recommendation'].includes(r.target)) || (r.target === 'recommendation' && !record.recommendation)) errors.push({ path: `/reviews/${i}/target`, message: 'Invalid review target.' });
      if (r.status === 'resolved' && !r.response.trim()) errors.push({ path: `/reviews/${i}/response`, message: 'Resolved review requires a response.' });
    });
    if (Buffer.byteLength(JSON.stringify(record)) > MAX_BYTES) errors.push({ path: '/', message: 'Record exceeds 5 MiB.' });
  }
  if (errors.length) throw new HarnessError('INVALID_RECORD', 'Invalid research record.', errors);
  return record;
}
