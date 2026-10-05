import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../skills/decision-harness/scripts/store.mjs';
import { completeRecord } from './fixtures.mjs';
const brief = { title: '研究 α', prompt: 'Keep the original request.', mode: 'criteria' };
async function setup(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dh 测试 ')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return { dir, store: new Store(path.join(dir, 'store')) }; }

test('DH-11 durable revisions reopen, diff, and audit explicit rechecks', async t => {
  const { store } = await setup(t); const first = await store.init(brief, 'example');
  const edit = structuredClone(first); edit.question = 'A revised question'; edit.createdAt = '2020-01-01T00:00:00Z'; edit.revision = 99;
  const second = await store.save('example', edit, { expectedRevision: 1, actor: 'tester', reason: 'Clarify question' });
  assert.equal(second.revision, 2); assert.equal(second.createdAt, first.createdAt);
  assert.deepEqual(await new Store(store.root).get('example', 1), first);
  assert.equal((await store.history('example'))[1].reason, 'Clarify question');
  assert.ok((await store.diff('example', 1, 2)).some(d => d.path === '/question'));
});

test('DH-11 DH-12 stale, malformed and locked writes preserve the last snapshot', async t => {
  const { store } = await setup(t); const r = await store.init(brief, 'example');
  await assert.rejects(store.save('example', r, { expectedRevision: 2, actor: 'tester', reason: 'stale' }), e => e.code === 'REVISION_CONFLICT');
  await assert.rejects(store.save('example', { ...r, typo: true }, { expectedRevision: 1, actor: 'tester', reason: 'bad' }), e => e.code === 'INVALID_RECORD');
  await fs.writeFile(path.join(store.root, 'example', '.lock'), 'abandoned lock');
  await assert.rejects(store.save('example', r, { expectedRevision: 1, actor: 'tester', reason: 'locked' }), e => e.code === 'STORE_LOCKED');
  assert.deepEqual(await store.get('example'), r);
});

test('DH-12 concurrent saves cannot overwrite each other', async t => {
  const { store } = await setup(t); const r = await store.init(brief, 'example');
  const result = await Promise.allSettled(['first', 'second'].map(reason => store.save('example', { ...r, question: reason }, { expectedRevision: 1, actor: 'tester', reason })));
  assert.equal(result.filter(x => x.status === 'fulfilled').length, 1);
  assert.ok(['STORE_LOCKED', 'REVISION_CONFLICT'].includes(result.find(x => x.status === 'rejected').reason.code));
  assert.equal((await store.history('example')).length, 2);
});

test('DH-12 corrupted snapshots and gaps are reported without overwrite', async t => {
  const { store } = await setup(t); const r = await store.init(brief, 'example');
  const snapshot = path.join(store.root, 'example', 'revisions', '000001.json');
  await fs.writeFile(snapshot, '{broken');
  await assert.rejects(store.get('example'), e => e.code === 'STORE_CORRUPT');
  await assert.rejects(store.save('example', r, { expectedRevision: 1, actor: 'tester', reason: 'try' }), e => e.code === 'STORE_CORRUPT');
  assert.equal(await fs.readFile(snapshot, 'utf8'), '{broken');
});

test('DH-12 failure to publish leaves prior revision readable', async t => {
  const { store } = await setup(t); const r = await store.init(brief, 'example');
  const rename = fs.rename;
  fs.rename = async () => { const error = new Error('Injected publication failure'); error.code = 'EIO'; throw error; };
  try { await assert.rejects(store.save('example', r, { expectedRevision: 1, actor: 'tester', reason: 'try' }), { code: 'EIO' }); }
  finally { fs.rename = rename; }
  assert.deepEqual(await store.get('example', 1), r);
  assert.deepEqual(await fs.readdir(path.join(store.root, 'example', 'revisions')), ['000001.json']);
  assert.equal((await fs.readdir(path.join(store.root, 'example'))).includes('.lock'), false);
});

test('DH-11 DH-13 explicit recheck actions are retained in the audit history', async t => {
  const { store } = await setup(t); await store.init(brief, 'example');
  const r = await store.save('example', completeRecord(), { expectedRevision: 1, actor: 'tester', reason: 'Add comparison' });
  await store.save('example', r, { expectedRevision: 2, actor: 'reviewer', reason: 'Re-read source', recheck: ['assessment-a'], recheckRecommendation: true });
  const latest = (await store.history('example')).at(-1);
  assert.deepEqual(latest.rechecked, ['assessment-a']); assert.equal(latest.recheckedRecommendation, true); assert.equal(latest.actor, 'reviewer');
});

test('DH-12 gaps in stored history are reported before accepting a latest revision', async t => {
  const { store } = await setup(t); const r = await store.init(brief, 'example');
  await store.save('example', r, { expectedRevision: 1, actor: 'tester', reason: 'next' });
  await fs.rename(path.join(store.root, 'example', 'revisions', '000002.json'), path.join(store.root, 'example', 'revisions', '000003.json'));
  await assert.rejects(store.get('example'), e => e.code === 'STORE_CORRUPT');
});

test('DH-12 corrupted UTF-8 is not silently replaced inside otherwise valid JSON', async t => {
  const { store } = await setup(t); await store.init(brief, 'example');
  const file = path.join(store.root, 'example', 'revisions', '000001.json');
  const bytes = await fs.readFile(file); const offset = bytes.indexOf(Buffer.from('Keep the original request.'));
  assert.ok(offset > 0); bytes[offset] = 0xff; await fs.writeFile(file, bytes);
  await assert.rejects(store.get('example'), e => e.code === 'STORE_CORRUPT');
});

test('DH-19 traversal and linked managed paths are refused', async t => {
  const { store, dir } = await setup(t);
  await assert.rejects(store.init(brief, '../escape'), e => e.code === 'INVALID_ID');
  await fs.mkdir(store.root, { recursive: true }); const outside = path.join(dir, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(store.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.init(brief, 'linked'), e => e.code === 'UNSAFE_PATH');
  assert.deepEqual(await fs.readdir(outside), []);
});
