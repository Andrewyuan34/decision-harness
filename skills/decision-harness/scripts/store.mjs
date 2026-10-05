import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRecord, prepareRevision, diffRecords } from './core.mjs';
import { assertRecord } from './schema.mjs';
import { HarnessError, validId, parseJson, MAX_BYTES } from './errors.mjs';

async function noLinks(target) {
  const resolved = path.resolve(target), root = path.parse(resolved).root;
  let current = root;
  for (const part of resolved.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new HarnessError('UNSAFE_PATH', `Symbolic links are not allowed in managed paths: ${current}`); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}
const positive = n => Number.isSafeInteger(n) && n > 0;
const fileName = n => `${String(n).padStart(6, '0')}.json`;

export class Store {
  constructor(root = '.decision-harness') { this.root = path.resolve(root); }
  location(id) {
    if (!validId(id)) throw new HarnessError('INVALID_ID', 'Invalid record ID.');
    return path.join(this.root, id);
  }
  async revisions(id) {
    const dir = path.join(this.location(id), 'revisions'); await noLinks(dir);
    let files;
    try { files = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') throw new HarnessError('NOT_FOUND', `Record ${id} does not exist.`); throw error; }
    const nums = [];
    for (const file of files) {
      if (file.name.startsWith('.tmp-') && file.isFile()) continue;
      if (!file.isFile() || !/^\d{6,}\.json$/.test(file.name)) throw new HarnessError('STORE_CORRUPT', `Unexpected item in revision directory: ${file.name}`);
      const n = Number(file.name.slice(0, -5));
      if (!positive(n) || file.name !== fileName(n)) throw new HarnessError('STORE_CORRUPT', 'Invalid revision filename.');
      nums.push(n);
    }
    nums.sort((a, b) => a - b);
    if (!nums.length || nums.some((n, i) => n !== i + 1)) throw new HarnessError('STORE_CORRUPT', 'Missing revision in immutable history.');
    return nums;
  }
  async snapshot(id, revision) {
    if (!positive(revision)) throw new HarnessError('INVALID_REVISION', 'Revision must be a positive integer.');
    const file = path.join(this.location(id), 'revisions', fileName(revision)); await noLinks(file);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Invalid snapshot file or excessive size.');
      const saved = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file)));
      const allowed = ['record', 'actor', 'reason', 'rechecked', 'recheckedRecommendation'];
      if (!saved || typeof saved !== 'object' || Object.keys(saved).some(k => !allowed.includes(k)) || typeof saved.actor !== 'string' || !saved.actor.trim() || typeof saved.reason !== 'string' || !saved.reason.trim() || !Array.isArray(saved.rechecked) || saved.rechecked.some(x => typeof x !== 'string') || typeof saved.recheckedRecommendation !== 'boolean') throw new Error('Invalid audit envelope.');
      assertRecord(saved.record);
      if (saved.record.id !== id || saved.record.revision !== revision) throw new Error('Snapshot identity mismatch.');
      return saved;
    } catch (error) {
      if (error.code === 'ENOENT') throw new HarnessError('NOT_FOUND', `Revision ${revision} was not found.`);
      if (error.code === 'UNSAFE_PATH') throw error;
      throw new HarnessError('STORE_CORRUPT', `Cannot read revision ${revision}: ${error.message}`);
    }
  }
  async get(id, revision) {
    if (revision !== undefined) return (await this.snapshot(id, revision)).record;
    const nums = await this.revisions(id);
    // Read every immutable envelope before accepting the current history.
    let saved;
    for (const n of nums) saved = await this.snapshot(id, n);
    return saved.record;
  }
  async locked(id, create, action) {
    const dir = this.location(id); await noLinks(dir);
    if (create) await fs.mkdir(dir, { recursive: true });
    const lockPath = path.join(dir, '.lock'); await noLinks(lockPath);
    let lock;
    try { lock = await fs.open(lockPath, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new HarnessError('STORE_LOCKED', `Record ${id} is locked. Check whether a writer is active before manually removing an abandoned .lock file; locks are never stolen.`);
      if (error.code === 'ENOENT') throw new HarnessError('NOT_FOUND', `Record ${id} does not exist.`);
      throw error;
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return await action();
    } finally { await lock.close(); await fs.unlink(lockPath); }
  }
  async publish(id, envelope) {
    const dir = path.join(this.location(id), 'revisions'); await noLinks(dir); await fs.mkdir(dir, { recursive: true });
    const destination = path.join(dir, fileName(envelope.record.revision)); await noLinks(destination);
    try { await fs.lstat(destination); throw new HarnessError('REVISION_EXISTS', 'An immutable revision already exists.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const serialized = `${JSON.stringify(envelope, null, 2)}\n`;
    if (Buffer.byteLength(serialized) > MAX_BYTES) throw new HarnessError('INPUT_TOO_LARGE', 'Serialized snapshot exceeds 5 MiB.');
    const temporary = path.join(dir, `.tmp-${randomUUID()}`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx'); await handle.writeFile(serialized, 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, destination);
    } finally { if (handle) await handle.close(); await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  async init(brief, id) {
    if (id !== undefined) this.location(id);
    const record = createRecord(brief, id);
    return this.locked(record.id, true, async () => {
      const revisions = path.join(this.location(record.id), 'revisions'); await noLinks(revisions);
      try { await fs.lstat(revisions); throw new HarnessError('ALREADY_EXISTS', 'This record already exists or has an unfinished initialization. Choose another ID or inspect the store.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await this.publish(record.id, { record, actor: 'init', reason: 'Initialize research from brief', rechecked: [], recheckedRecommendation: false });
      return record;
    });
  }
  async save(id, incoming, { expectedRevision, actor, reason, recheck = [], recheckRecommendation = false } = {}) {
    this.location(id);
    if (!positive(expectedRevision) || typeof actor !== 'string' || !actor.trim() || typeof reason !== 'string' || !reason.trim()) throw new HarnessError('INVALID_SAVE', 'Save requires positive expectedRevision, nonblank actor and reason.');
    assertRecord(incoming);
    if (incoming.id !== id) throw new HarnessError('ID_MISMATCH', 'Incoming record ID does not match the command.');
    return this.locked(id, false, async () => {
      const previous = await this.get(id);
      if (previous.revision !== expectedRevision) throw new HarnessError('REVISION_CONFLICT', `Expected revision ${expectedRevision}; current revision is ${previous.revision}. Reload and reconcile changes.`);
      const record = prepareRevision(previous, incoming, { recheck, recheckRecommendation });
      await this.publish(id, { record, actor, reason, rechecked: [...recheck], recheckedRecommendation: recheckRecommendation });
      return record;
    });
  }
  async history(id) {
    const nums = await this.revisions(id), results = [];
    for (const revision of nums) {
      const { record, ...audit } = await this.snapshot(id, revision);
      results.push({ revision, updatedAt: record.updatedAt, ...audit });
    }
    return results;
  }
  async diff(id, from, to) { return diffRecords(await this.get(id, from), await this.get(id, to)); }
}
