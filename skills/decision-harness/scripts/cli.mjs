#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { loadCatalog, suggestCatalog } from './catalog.mjs';
import { checkRecord } from './core.mjs';
import { renderMarkdown, renderHtml, makeTemplate } from './render.mjs';
import { HarnessError, parseJson, MAX_BYTES } from './errors.mjs';

const commands = {
  help: 'help',
  catalog: 'catalog [--query TEXT] [--domain NAME] [--limit N] [--extra FILE]',
  init: 'init --input FILE|- [--id ID] [--store DIR]',
  get: 'get ID [--revision N] [--store DIR]',
  save: 'save ID --file FILE|- --expected-revision N --reason TEXT --actor TEXT [--recheck ID,ID] [--recheck-recommendation] [--store DIR]',
  check: 'check ID [--stage draft|ready] [--store DIR]',
  history: 'history ID [--store DIR]',
  diff: 'diff ID --from N --to N [--store DIR]',
  export: 'export ID --format json|markdown|html|template [--out FILE] [--force] [--store DIR]',
};
const options = {
  help: [], catalog: ['query', 'domain', 'limit', 'extra'], init: ['input', 'id', 'store'], get: ['revision', 'store'],
  save: ['file', 'expected-revision', 'reason', 'actor', 'recheck', 'recheck-recommendation', 'store'],
  check: ['stage', 'store'], history: ['store'], diff: ['from', 'to', 'store'], export: ['format', 'out', 'force', 'store'],
};
const usage = message => { throw new HarnessError('USAGE', message); };
const json = value => `${JSON.stringify(value, null, 2)}\n`;
function args(argv) {
  const [command = 'help', ...rest] = argv;
  if (!Object.hasOwn(commands, command)) usage(`Unknown command: ${command}. Run help.`);
  const values = {}, positional = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const name = token.slice(2);
    if (!options[command].includes(name) || Object.hasOwn(values, name)) usage(`Unknown or duplicate option: ${token}.`);
    if (['force', 'recheck-recommendation'].includes(name)) values[name] = true;
    else { const value = rest[++i]; if (value === undefined || value.startsWith('--')) usage(`Missing value for ${token}.`); values[name] = value; }
  }
  const expectsId = !['help', 'catalog', 'init'].includes(command);
  if (positional.length !== (expectsId ? 1 : 0)) usage(`Usage: ${commands[command]}`);
  return { command, values, id: positional[0] };
}
const integer = (value, name) => {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) usage(`${name} must be a positive integer.`);
  return Number(value);
};
const requireValue = (values, key) => { if (typeof values[key] !== 'string' || !values[key].trim()) usage(`--${key} is required.`); return values[key]; };

async function readInput(file) {
  let bytes;
  if (file === '-') {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) { size += chunk.length; if (size > MAX_BYTES) throw new HarnessError('INPUT_TOO_LARGE', 'Input exceeds 5 MiB.'); chunks.push(chunk); }
    bytes = Buffer.concat(chunks);
  } else {
    const stat = await fs.stat(file); if (!stat.isFile()) throw new HarnessError('INVALID_INPUT', 'Input must be a regular file.');
    if (stat.size > MAX_BYTES) throw new HarnessError('INPUT_TOO_LARGE', 'Input exceeds 5 MiB.');
    bytes = await fs.readFile(file);
  }
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new HarnessError('INVALID_UTF8', 'Input must be valid UTF-8.'); }
  return parseJson(decoded);
}
async function outputFile(file, contents, force) {
  const destination = path.resolve(file);
  try {
    const stat = await fs.lstat(destination);
    if (stat.isSymbolicLink()) throw new HarnessError('UNSAFE_PATH', 'Refusing to export through a symbolic link.');
    if (!force) throw new HarnessError('OUTPUT_EXISTS', 'Output exists; use --force to replace it.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(path.dirname(destination), `.dh-export-${randomUUID()}`);
  try {
    await fs.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
    if (force) await fs.rename(temporary, destination);
    else {
      try { await fs.link(temporary, destination); }
      catch (error) { if (error.code === 'EEXIST') throw new HarnessError('OUTPUT_EXISTS', 'Output was created by another writer.'); throw error; }
    }
  } finally { await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  return destination;
}

async function main() {
  const { command, values: v, id } = args(process.argv.slice(2));
  const store = new Store(v.store);
  let result;
  switch (command) {
    case 'help': result = { name: 'decision-harness', version: '0.1.0', commands, defaults: { store: '.decision-harness', stage: 'ready', catalogDomain: 'general', limit: 8 }, notes: ['init/get/save return {record}; save expects the bare record, not that wrapper.', 'Use UTF-8 JSON files or stdin. Checks do not establish factual truth. Review is optional.', 'Exit 0: success; 1: usage/data/storage error; 2: incomplete ready check.', 'HTML is printable; this tool does not render native PDF.'] }; break;
    case 'catalog': {
      const catalog = await loadCatalog(v.extra);
      result = { ...suggestCatalog(catalog, { query: v.query ?? '', domain: v.domain ?? 'general', limit: v.limit === undefined ? 8 : integer(v.limit, '--limit') }), limitation: 'Lexical candidate retrieval only; match scores are not project scores or semantic recommendations.' }; break;
    }
    case 'init': result = { record: await store.init(await readInput(requireValue(v, 'input')), v.id) }; break;
    case 'get': result = { record: await store.get(id, v.revision === undefined ? undefined : integer(v.revision, '--revision')) }; break;
    case 'save': result = { record: await store.save(id, await readInput(requireValue(v, 'file')), { expectedRevision: integer(v['expected-revision'], '--expected-revision'), actor: requireValue(v, 'actor'), reason: requireValue(v, 'reason'), recheck: v.recheck === undefined ? [] : v.recheck.split(','), recheckRecommendation: v['recheck-recommendation'] ?? false }) }; break;
    case 'check': result = checkRecord(await store.get(id), v.stage ?? 'ready'); if (!result.ok) process.exitCode = 2; break;
    case 'history': result = { history: await store.history(id) }; break;
    case 'diff': result = { changes: await store.diff(id, integer(v.from, '--from'), integer(v.to, '--to')) }; break;
    case 'export': {
      const format = requireValue(v, 'format'); if (!['json', 'markdown', 'html', 'template'].includes(format)) usage('Unsupported export format.');
      if (v.force && !v.out) usage('--force requires --out.');
      const record = await store.get(id), check = checkRecord(record);
      const contents = format === 'json' ? json(record) : format === 'template' ? json(makeTemplate(record)) : format === 'markdown' ? renderMarkdown(record, check) : renderHtml(record, check);
      if (!v.out) { process.stdout.write(contents); return; }
      result = { path: await outputFile(v.out, contents, v.force), format, revision: record.revision }; break;
    }
  }
  process.stdout.write(json(result));
}

try { await main(); }
catch (error) {
  process.stderr.write(json({ error: { code: error.code ?? 'INTERNAL_ERROR', message: error.message, ...(error.details === undefined ? {} : { details: error.details }) } }));
  process.exitCode = 1;
}
