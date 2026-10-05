import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, suggestCatalog } from '../skills/decision-harness/scripts/catalog.mjs';

async function personal(t, contents) {
  const directory = await mkdtemp(join(tmpdir(), 'decision catalog 中文 '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, '个人 标准.json');
  await writeFile(path, typeof contents === 'string' || Buffer.isBuffer(contents) ? contents : JSON.stringify(contents), 'utf8');
  return path;
}

test('DH-04 starter catalog has 12 general and 4 optional engine entries with editorial provenance', async () => {
  const catalog = await loadCatalog();
  assert.equal(typeof catalog.version, 'string');
  assert.ok(catalog.criteria.filter((entry) => entry.domains.includes('general')).length >= 12);
  assert.ok(catalog.criteria.filter((entry) => entry.domains.includes('game-engine')).length >= 4);
  for (const entry of catalog.criteria) {
    assert.equal(entry.provenance.kind, 'editorial');
    assert.ok(entry.evidenceQuestions.length > 0);
    assert.ok(entry.provenance.note.length > 0);
  }
});

test('DH-05 default retrieval excludes optional domains and requested engine domain adds them', async () => {
  const catalog = await loadCatalog();
  const general = suggestCatalog(catalog, { limit: 100 });
  assert.ok(general.criteria.every((entry) => entry.domains.includes('general')));
  assert.ok(general.criteria.length >= 12);
  const engine = suggestCatalog(catalog, { domain: 'game-engine', limit: 100 });
  assert.ok(engine.criteria.some((entry) => entry.domains.includes('game-engine')));
  assert.ok(engine.criteria.some((entry) => entry.domains.includes('general')));
  assert.equal(suggestCatalog(catalog, { domain: 'unknown-domain', limit: 100 }).criteria.length, general.criteria.length);
});

test('DH-05 Chinese query retrieves meaningful matches with terms, and no match stays empty', async () => {
  const catalog = await loadCatalog();
  const matches = suggestCatalog(catalog, { query: '我想一个人两周做完，结果能自动测试验证', limit: 4 });
  assert.ok(matches.criteria.some((entry) => entry.id === 'general-solo-scope'));
  assert.ok(matches.criteria.some((entry) => entry.id === 'general-verification'));
  assert.ok(matches.criteria.every((entry) => entry.retrieval.score > 0 && entry.retrieval.matchedTerms.length > 0));
  assert.deepEqual(suggestCatalog(catalog, { query: '量子巧克力海豚' }).criteria, []);
});

test('DH-05 English normalization, stable limits and term boundaries remain lexical', async () => {
  const catalog = await loadCatalog();
  assert.ok(suggestCatalog(catalog, { query: 'BUDGET' }).criteria.some((entry) => entry.id === 'general-budget'));
  const before = structuredClone(catalog);
  const first = suggestCatalog(catalog, { limit: 2 });
  assert.equal(first.criteria.length, 2);
  assert.deepEqual(first, suggestCatalog(catalog, { limit: 2 }));
  first.criteria[0].keywords.push('mutation');
  assert.deepEqual(catalog, before);
  const isolated = { version: 'test', criteria: [{ ...catalog.criteria[0], title: 'AI', keywords: ['AI'], description: 'AI', applicability: 'AI', objectiveTags: ['AI'] }] };
  assert.deepEqual(suggestCatalog(isolated, { query: 'chair' }).criteria, []);
  assert.equal(suggestCatalog(isolated, { query: 'AI' }).criteria.length, 1);
});

test('DH-06 personal catalog appends versioned entries and supports Chinese paths', async (t) => {
  const base = await loadCatalog();
  const entry = { ...base.criteria[0], id: 'personal-offline', title: '断网可用', keywords: ['离线', 'offline'] };
  const path = await personal(t, { version: '2', criteria: [entry] });
  const catalog = await loadCatalog(path);
  assert.equal(catalog.criteria.length, base.criteria.length + 1);
  assert.equal(catalog.version, `${base.version}+personal.2`);
  assert.ok(suggestCatalog(catalog, { query: '离线' }).criteria.some((match) => match.id === entry.id));
});

test('DH-06 duplicate IDs within a personal catalog and overrides fail explicitly', async (t) => {
  const base = await loadCatalog();
  const clone = { ...base.criteria[0], id: 'personal-copy' };
  for (const entries of [[clone, clone], [base.criteria[0]]]) {
    const path = await personal(t, { version: '1', criteria: entries });
    await assert.rejects(loadCatalog(path), { code: 'CATALOG_INVALID' });
  }
});

test('DH-04 DH-19 malformed catalog fields, unsafe keys and invalid UTF-8 fail with paths', async (t) => {
  const base = await loadCatalog();
  const malformed = [
    ['not JSON', 'extra'],
    [{ version: '1', criteria: 'wrong' }, 'extra.criteria'],
    [{ version: '1', criteria: [{ ...base.criteria[0], keywords: [] }] }, 'keywords'],
    [{ version: '1', criteria: [{ ...base.criteria[0], id: '../escape' }] }, 'id'],
    [{ version: '1', criteria: [{ ...base.criteria[0], provenance: { kind: 'certified', note: 'bad', references: [] } }] }, 'provenance.kind'],
    ['{"version":"1","criteria":[],"__proto__":{}}', '__proto__'],
    [{ version: '1', criteria: [], typo: true }, 'typo'],
    [Buffer.from([0xff, 0xfe]), 'extra'],
  ];
  for (const [contents, expectedPath] of malformed) {
    const path = await personal(t, contents);
    await assert.rejects(loadCatalog(path), (error) => error.code === 'CATALOG_INVALID' && error.message.includes(expectedPath));
  }
});

test('DH-19 oversized personal catalogs fail before loading into retrieval', async (t) => {
  const path = await personal(t, ' '.repeat(5 * 1024 * 1024 + 1));
  await assert.rejects(loadCatalog(path), (error) => error.code === 'CATALOG_INVALID' && error.message.includes('5 MiB'));
});

test('DH-05 invalid retrieval parameters are explicit errors', async () => {
  const catalog = await loadCatalog();
  for (const options of [{ limit: 0 }, { limit: 1.5 }, { query: 3 }, { domain: '' }]) {
    assert.throws(() => suggestCatalog(catalog, options), { code: 'CATALOG_INVALID' });
  }
});
