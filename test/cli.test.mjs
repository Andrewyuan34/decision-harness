import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { completeRecord } from './fixtures.mjs';
const cli = fileURLToPath(new URL('../skills/decision-harness/scripts/cli.mjs', import.meta.url));
export function run(args, input, { entry = cli, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
    child.stdout.on('data', c => stdout += c); child.stderr.on('data', c => stderr += c); child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', e => { if (e.code !== 'EPIPE') reject(e); }); child.stdin.end(input);
  });
}
async function setup(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dh CLI 中文 ')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return { dir, opts: ['--store', path.join(dir, 'store')] }; }
const brief = { title: '中文 Example', prompt: 'Help select a narrow tool', mode: 'criteria' };

test('DH-17 strict CLI usage, JSON errors and UTF-8 stdin', async t => {
  const { opts } = await setup(t);
  const help = await run(['help']); assert.equal(help.code, 0); assert.ok(JSON.parse(help.stdout).commands.save);
  for (const args of [['wat'], ['get', 'example', '--wat', 'x'], ['init'], ['help', 'extra'], ['catalog', '--limit', 'NaN'], ['catalog', '--query', 'a', '--query', 'b']]) {
    const result = await run(args); assert.equal(result.code, 1, result.stdout); assert.ok(JSON.parse(result.stderr).error.code); assert.equal(result.stdout, '');
  }
  const init = await run(['init', '--input', '-', '--id', 'example', ...opts], JSON.stringify(brief));
  assert.equal(init.code, 0, init.stderr); assert.equal(JSON.parse(init.stdout).record.title, brief.title);
  const check = await run(['check', 'example', ...opts]); assert.equal(check.code, 2); assert.equal(JSON.parse(check.stdout).ok, false);
  const draft = await run(['check', 'example', '--stage', 'draft', ...opts]); assert.equal(draft.code, 0);
  const bad = await run(['init', '--input', '-', '--id', 'bad', ...opts], Buffer.from([0xff])); assert.equal(bad.code, 1); assert.equal(JSON.parse(bad.stderr).error.code, 'INVALID_UTF8');
});

test('DH-11 DH-14 DH-15 DH-16 DH-17 all commands work through actual child processes', async t => {
  const { dir, opts } = await setup(t);
  const initial = await run(['init', '--input', '-', '--id', 'example', ...opts], JSON.stringify(brief)); assert.equal(initial.code, 0);
  const record = completeRecord(); record.revision = 1;
  const saved = await run(['save', 'example', '--file', '-', '--expected-revision', '1', '--actor', 'test agent', '--reason', 'Fill a demonstration comparison', ...opts], JSON.stringify(record)); assert.equal(saved.code, 0, saved.stderr);
  const current = JSON.parse(saved.stdout).record;
  const checked = await run(['check', 'example', ...opts]); assert.equal(checked.code, 0, checked.stdout);
  const get = await run(['get', 'example', ...opts]); assert.deepEqual(JSON.parse(get.stdout).record, current);
  const old = await run(['get', 'example', '--revision', '1', ...opts]); assert.equal(JSON.parse(old.stdout).record.revision, 1);
  const history = await run(['history', 'example', ...opts]); assert.equal(JSON.parse(history.stdout).history.length, 2);
  const diff = await run(['diff', 'example', '--from', '1', '--to', '2', ...opts]); assert.ok(JSON.parse(diff.stdout).changes.some(c => c.path === '/mode'));
  const catalog = await run(['catalog', '--query', 'test', '--domain', 'general']); assert.equal(catalog.code, 0); assert.ok(JSON.parse(catalog.stdout).version);
  for (const format of ['json', 'markdown', 'html', 'template']) {
    const output = path.join(dir, `导出 file.${format}`);
    const result = await run(['export', 'example', '--format', format, '--out', output, ...opts]); assert.equal(result.code, 0, result.stderr);
    const data = await fs.readFile(output, 'utf8'); assert.ok(data.includes(record.title));
    if (format === 'json') assert.deepEqual(JSON.parse(data), current);
    if (format === 'template') {
      const fresh = await run(['init', '--input', output, '--id', 'reused', ...opts]); assert.equal(fresh.code, 0, fresh.stderr); assert.equal(JSON.parse(fresh.stdout).record.assessments.length, 0);
    }
    const duplicate = await run(['export', 'example', '--format', format, '--out', output, ...opts]); assert.equal(duplicate.code, 1); assert.equal(JSON.parse(duplicate.stderr).error.code, 'OUTPUT_EXISTS');
    const force = await run(['export', 'example', '--format', format, '--out', output, '--force', ...opts]); assert.equal(force.code, 0);
  }
  const raw = await run(['export', 'example', '--format', 'json', ...opts]); assert.deepEqual(JSON.parse(raw.stdout), current);
  const unchanged = await run(['history', 'example', ...opts]); assert.deepEqual(JSON.parse(unchanged.stdout), JSON.parse(history.stdout));
});

test('DH-12 separate-process simultaneous writers keep one new revision', async t => {
  const { dir, opts } = await setup(t);
  const init = await run(['init', '--input', '-', '--id', 'example', ...opts], JSON.stringify(brief)); const r = JSON.parse(init.stdout).record;
  const inputFile = path.join(dir, 'incoming.json'); await fs.writeFile(inputFile, JSON.stringify({ ...r, question: 'Changed' }));
  const args = ['save', 'example', '--file', inputFile, '--expected-revision', '1', '--actor', 'tester', '--reason', 'race', ...opts];
  const results = await Promise.all([run(args), run(args)]); assert.equal(results.filter(r => r.code === 0).length, 1);
  assert.ok(['STORE_LOCKED', 'REVISION_CONFLICT'].includes(JSON.parse(results.find(r => r.code === 1).stderr).error.code));
});
