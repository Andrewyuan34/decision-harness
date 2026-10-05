import { readFile, stat } from 'node:fs/promises';

const CATALOG_URL = new URL('../assets/catalog.json', import.meta.url);
const MAX_BYTES = 5 * 1024 * 1024;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ENTRY_KEYS = ['id', 'title', 'description', 'domains', 'objectiveTags', 'keywords', 'applicability', 'evidenceQuestions', 'example', 'provenance'];
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'we', 'with', '一个', '什么', '以及', '可以', '如何', '希望', '我们', '是否', '这个', '需要', '项目', '技术']);
const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' });

function invalid(path, message, cause) {
  const error = new Error(`${path}: ${message}`, cause ? { cause } : undefined);
  error.code = 'CATALOG_INVALID';
  return error;
}

function object(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid(path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (FORBIDDEN.has(key) || !keys.includes(key)) throw invalid(`${path}.${key}`, 'unknown or unsafe property');
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw invalid(`${path}.${key}`, 'required property is missing');
  }
}

function nonempty(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw invalid(path, 'expected a nonempty string');
}

function strings(value, path, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw invalid(path, 'expected a nonempty string array');
  value.forEach((item, index) => nonempty(item, `${path}[${index}]`));
  if (new Set(value).size !== value.length) throw invalid(path, 'duplicate values are not allowed');
}

function validateCatalog(catalog, path) {
  object(catalog, ['version', 'criteria'], path);
  nonempty(catalog.version, `${path}.version`);
  if (!Array.isArray(catalog.criteria)) throw invalid(`${path}.criteria`, 'expected an array');
  const ids = new Set();
  catalog.criteria.forEach((entry, index) => {
    const p = `${path}.criteria[${index}]`;
    object(entry, ENTRY_KEYS, p);
    for (const key of ['id', 'title', 'description', 'applicability', 'example']) nonempty(entry[key], `${p}.${key}`);
    if (!ID.test(entry.id)) throw invalid(`${p}.id`, 'expected a lowercase entity ID');
    if (ids.has(entry.id)) throw invalid(`${p}.id`, `duplicate criterion ID: ${entry.id}`);
    ids.add(entry.id);
    for (const key of ['domains', 'objectiveTags', 'keywords', 'evidenceQuestions']) strings(entry[key], `${p}.${key}`);
    object(entry.provenance, ['kind', 'note', 'references'], `${p}.provenance`);
    if (entry.provenance.kind !== 'editorial') throw invalid(`${p}.provenance.kind`, 'expected editorial');
    nonempty(entry.provenance.note, `${p}.provenance.note`);
    strings(entry.provenance.references, `${p}.provenance.references`, true);
  });
  return catalog;
}

async function readCatalog(path, label) {
  try {
    if ((await stat(path)).size > MAX_BYTES) throw invalid(label, 'catalog exceeds 5 MiB');
    const bytes = await readFile(path);
    if (bytes.length > MAX_BYTES) throw invalid(label, 'catalog exceeds 5 MiB');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return validateCatalog(JSON.parse(text), label);
  } catch (error) {
    if (error.code === 'CATALOG_INVALID') throw error;
    throw invalid(label, `cannot read valid UTF-8 catalog JSON (${error.code ?? error.name})`, error);
  }
}

/** Load the bundled catalog and optionally append a personal catalog without overrides. */
export async function loadCatalog(extraPath) {
  const bundled = await readCatalog(CATALOG_URL, 'catalog');
  if (extraPath === undefined) return bundled;
  if (typeof extraPath !== 'string' || !extraPath.trim()) throw invalid('extra', 'expected a catalog file path');
  const personal = await readCatalog(extraPath, 'extra');
  const ids = new Set(bundled.criteria.map((entry) => entry.id));
  for (const entry of personal.criteria) {
    if (ids.has(entry.id)) throw invalid('extra.criteria', `criterion ID collides with bundled catalog: ${entry.id}`);
  }
  return {
    version: `${bundled.version}+personal.${personal.version}`,
    criteria: [...bundled.criteria, ...personal.criteria],
  };
}

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US').trim();
}

function tokens(value) {
  return [...SEGMENTER.segment(normalize(value))]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment)
    .filter((term) => [...term].length > 1 && !STOP_WORDS.has(term));
}

function phraseInQuery(query, term) {
  if (!term || STOP_WORDS.has(term)) return false;
  // Latin fragments must not match inside unrelated words (for example, AI in "chair").
  if (/^[a-z0-9_-]+$/.test(term)) return query.split(/[^a-z0-9_-]+/).includes(term);
  return [...term].length > 1 && query.includes(term);
}

function retrieve(entry, query, queryTokens) {
  const matches = new Map();
  const fields = [
    [entry.title, 3],
    ...entry.keywords.map((word) => [word, 4]),
    ...entry.objectiveTags.map((word) => [word, 3]),
    [entry.description, 1],
    [entry.applicability, 1],
  ];
  for (const [text, weight] of fields) {
    const normalized = normalize(text);
    if (phraseInQuery(query, normalized)) matches.set(normalized, Math.max(matches.get(normalized) ?? 0, weight));
    for (const term of tokens(normalized)) {
      if (queryTokens.has(term)) matches.set(term, Math.max(matches.get(term) ?? 0, weight));
    }
  }
  return {
    score: [...matches.values()].reduce((sum, weight) => sum + weight, 0),
    matchedTerms: [...matches.keys()].sort(),
  };
}

/** Lexical retrieval only: scores describe text overlap, never suitability or project quality. */
export function suggestCatalog(catalog, { query = '', domain = 'general', limit = 8 } = {}) {
  validateCatalog(catalog, 'catalog');
  if (typeof query !== 'string') throw invalid('query', 'expected a string');
  if (typeof domain !== 'string' || !domain.trim()) throw invalid('domain', 'expected a nonempty string');
  if (!Number.isSafeInteger(limit) || limit < 1) throw invalid('limit', 'expected a positive integer');
  const normalizedQuery = normalize(query);
  const normalizedDomain = normalize(domain);
  const queryTokens = new Set(tokens(normalizedQuery));
  const criteria = catalog.criteria
    .filter((entry) => entry.domains.some((name) => ['general', normalizedDomain].includes(normalize(name))))
    .map((entry, index) => ({ entry, index, retrieval: retrieve(entry, normalizedQuery, queryTokens) }))
    .filter(({ retrieval }) => !normalizedQuery || retrieval.score > 0)
    .sort((a, b) => b.retrieval.score - a.retrieval.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry, retrieval }) => ({ ...structuredClone(entry), retrieval }));
  return { version: catalog.version, criteria };
}
