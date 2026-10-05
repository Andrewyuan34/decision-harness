import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const repo = fileURLToPath(new URL('../', import.meta.url));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dh-readme-'));
const cli = path.join(repo, 'skills/decision-harness/scripts/cli.mjs');
function run(args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
try {
  const s = ['--store', path.join(dir, 'research-store')];
  run(['help']); assert.ok(Array.isArray(run(['catalog', '--query', '一个人做，结果可以验证', '--domain', 'general', '--limit', '8']).criteria));
  run(['init', '--input', path.join(repo, 'examples/criteria-brief.json'), '--id', 'example', ...s]);
  assert.equal(run(['check', 'example', '--stage', 'ready', ...s]).ok, true);
  run(['export', 'example', '--format', 'html', '--out', path.join(dir, 'example.html'), ...s]);
  const record = run(['get', 'example', ...s]).record;
  record.question = '演示：进一步明确判断方法';
  const edit = path.join(dir, 'edited-record.json'); await fs.writeFile(edit, JSON.stringify(record));
  run(['save', 'example', '--file', edit, '--expected-revision', '1', '--actor', 'demo', '--reason', 'Clarify demonstration question', ...s]);
  assert.equal(run(['history', 'example', ...s]).history.length, 2);
  assert.ok(run(['diff', 'example', '--from', '1', '--to', '2', ...s]).changes.some(x => x.path === '/question'));
  run(['init', '--input', path.join(repo, 'examples/brief.json'), '--id', 'draft', ...s]); run(['check', 'draft', ...s], 2);
  console.log('README example flow passed in an isolated temporary directory.');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
