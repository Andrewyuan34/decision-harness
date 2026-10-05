import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const skillPath = path.join('skills', 'decision-harness');
const cliPath = path.join(skillPath, 'scripts', 'cli.mjs');

async function temporaryDirectory(t) {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'dh package 中文 '));
  t.after(async () => {
    // Only remove the exact child created for this test, including on Windows.
    assert.equal(path.dirname(path.resolve(directory)), parent);
    assert.ok(path.basename(directory).startsWith('dh package 中文 '));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function execute(executable, args, { cwd, input, env = {}, status = 0 } = {}) {
  const result = spawnSync(executable, args, {
    cwd, input, encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env, NODE_PATH: '', NODE_OPTIONS: '',
      PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}`,
      ...env,
    },
    windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, status,
    `${path.basename(executable)} ${args.join(' ')}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  return result;
}

function command(entry, args, cwd) {
  const result = execute(process.execPath, [entry, ...args], { cwd });
  assert.equal(result.stderr, '', 'Successful CLI commands must not emit errors.');
  return JSON.parse(result.stdout);
}

async function npmEntry() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    '/usr/share/nodejs/npm/bin/npm-cli.js',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  assert.fail('Cannot locate npm-cli.js; run this test with npm test or install npm alongside Node.');
}

async function smokeTest(entry, workingDirectory) {
  await fs.mkdir(workingDirectory, { recursive: true });
  const store = path.join(workingDirectory, '研究 store');
  const options = ['--store', store];
  const brief = {
    title: '可独立运行的研究 <示例>',
    prompt: 'Help me choose a small tool whose result I can verify.',
    question: 'Which criteria should guide the first experiment?',
    mode: 'criteria',
    objectives: [{ id: 'test-effect', text: 'Verify a useful observable effect.', origin: 'user' }],
    criteria: [{
      id: 'observable-effect', title: 'Observable effect',
      description: 'The tool has an observable result that can be checked.',
      objectiveIds: ['test-effect'], question: 'What observation would demonstrate the result?',
      rationale: 'The user wants to verify the effect of a small first tool.',
      status: 'adopted', origin: 'agent',
    }],
  };
  const input = path.join(workingDirectory, '研究 brief.json');
  await fs.writeFile(input, JSON.stringify(brief), 'utf8');

  const help = command(entry, ['help'], workingDirectory);
  assert.equal(help.name, 'decision-harness');
  for (const name of ['catalog', 'init', 'get', 'check', 'export']) assert.ok(help.commands[name]);
  const catalog = command(entry, ['catalog', '--domain', 'general', '--limit', '3'], workingDirectory);
  assert.ok(catalog.version);
  assert.ok(catalog.criteria.length > 0 && catalog.criteria.length <= 3,
    'Catalog must load from the distributed skill, not the source checkout.');

  const initialized = command(entry, ['init', '--input', input, '--id', 'portable-case', ...options], workingDirectory).record;
  assert.equal(initialized.title, brief.title);
  assert.equal(initialized.revision, 1);
  const fetched = command(entry, ['get', 'portable-case', ...options], workingDirectory).record;
  assert.deepEqual(fetched, initialized);
  const checked = command(entry, ['check', 'portable-case', '--stage', 'ready', ...options], workingDirectory);
  assert.equal(checked.ok, true);
  assert.equal(checked.stage, 'ready');

  const exported = command(entry, ['export', 'portable-case', '--format', 'json', ...options], workingDirectory);
  assert.deepEqual(exported, fetched);
  for (const format of ['markdown', 'html', 'template']) {
    const destination = path.join(workingDirectory, `导出 result.${format}`);
    const output = command(entry, ['export', 'portable-case', '--format', format, '--out', destination, ...options], workingDirectory);
    assert.equal(output.path, destination);
    assert.equal(output.revision, fetched.revision);
    const contents = await fs.readFile(destination, 'utf8');
    if (format === 'html') {
      assert.ok(contents.includes('&lt;示例&gt;'));
      assert.doesNotMatch(contents, /<script\b/i);
    } else if (format === 'markdown') assert.ok(contents.includes(brief.title));
    else {
      const template = JSON.parse(contents);
      assert.equal(template.title, brief.title);
      assert.equal(Object.hasOwn(template, 'revision'), false);
      const reused = command(entry, ['init', '--input', destination, '--id', 'reused-case', ...options], workingDirectory).record;
      assert.equal(reused.assessments.length, 0);
      assert.equal(reused.recommendation, null);
      assert.equal(command(entry, ['check', 'reused-case', ...options], workingDirectory).ok, true);
    }
  }
  assert.deepEqual(command(entry, ['get', 'portable-case', ...options], workingDirectory).record, fetched,
    'Read, check and export operations must not modify the saved record.');
}

test('DH-01 DH-20 npm tarball installs into a clean directory and its CLI and installed bin work', { timeout: 180_000 }, async t => {
  const directory = await temporaryDirectory(t);
  const npm = await npmEntry();
  const manifest = JSON.parse(await fs.readFile(path.join(repository, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'The release must need no runtime dependencies.');
  assert.deepEqual(manifest.optionalDependencies ?? {}, {}, 'The release must need no optional runtime dependencies.');
  const npmEnvironment = {
    npm_config_cache: path.join(directory, 'npm cache'),
    npm_config_update_notifier: 'false',
    npm_config_offline: 'true',
  };
  const packed = execute(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory], {
    cwd: repository, env: npmEnvironment,
  });
  const packages = JSON.parse(packed.stdout);
  assert.equal(packages.length, 1);
  const packageInfo = packages[0];
  assert.equal(packageInfo.name, manifest.name);
  const published = packageInfo.files.map(file => file.path.replaceAll('\\', '/'));
  for (const required of [
    'package.json', 'plugin.json', '.codex-plugin/plugin.json', 'README.md', 'LICENSE', 'docs/spec.md',
    'skills/decision-harness/SKILL.md', 'skills/decision-harness/assets/catalog.json',
    'skills/decision-harness/scripts/cli.mjs',
  ]) assert.ok(published.includes(required), `Missing published file: ${required}`);
  for (const filename of published) {
    const allowed = filename === 'package.json' || manifest.files.some(rule => {
      const prefix = rule.replaceAll('\\', '/').replace(/\/$/, '');
      return filename === prefix || filename.startsWith(`${prefix}/`);
    });
    assert.ok(allowed, `File outside the explicit publishing allowlist: ${filename}`);
    assert.doesNotMatch(filename,
      /(^|\/)(?:test|tests|node_modules|\.git|\.decision-harness|stores?|private|transcripts?|credentials?)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|key)$/i,
      `Private data, stores or development files leaked into the package: ${filename}`);
  }
  const tarball = path.join(directory, packageInfo.filename);
  assert.ok((await fs.stat(tarball)).size > 0, 'npm pack must create an actual archive.');
  const installation = path.join(directory, 'clean installation');
  await fs.mkdir(installation);
  assert.deepEqual(await fs.readdir(installation), []);
  // npm performs the real archive extraction and bin installation without fetching dependencies.
  execute(process.execPath, [npm, 'install', '--prefix', installation, '--ignore-scripts', '--no-audit', '--no-fund',
    '--offline', '--no-save', '--package-lock=false', tarball], { cwd: directory, env: npmEnvironment });
  const installedRoot = path.join(installation, 'node_modules', ...manifest.name.split('/'));
  const installedManifest = JSON.parse(await fs.readFile(path.join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(installedManifest.version, manifest.version);
  for (const filename of published) assert.ok((await fs.stat(path.join(installedRoot, filename))).isFile(), `Not extracted: ${filename}`);
  const portablePlugin = JSON.parse(await fs.readFile(path.join(installedRoot, 'plugin.json'), 'utf8'));
  assert.equal(portablePlugin.name, 'decision-harness');
  assert.equal(portablePlugin.version, installedManifest.version);
  // Portable plugins automatically discover the root skills/ directory.
  assert.ok((await fs.stat(path.join(installedRoot, 'skills', 'decision-harness', 'SKILL.md'))).isFile());
  const codexPlugin = JSON.parse(await fs.readFile(path.join(installedRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(codexPlugin.name, portablePlugin.name);
  assert.equal(codexPlugin.version, installedManifest.version);
  assert.equal(typeof codexPlugin.skills, 'string');
  assert.equal(path.resolve(installedRoot, codexPlugin.skills), path.join(installedRoot, 'skills'));
  assert.ok((await fs.stat(path.join(installedRoot, codexPlugin.skills, 'decision-harness', 'SKILL.md'))).isFile());
  assert.match(await fs.readFile(path.join(installedRoot, 'LICENSE'), 'utf8'), /MIT License/);
  await smokeTest(path.join(installedRoot, cliPath), path.join(directory, 'packed working directory'));

  assert.equal(installedManifest.bin['decision-harness'].replaceAll('\\', '/'), cliPath.replaceAll('\\', '/'));
  const binDirectory = path.join(installation, 'node_modules', '.bin');
  const binWorkingDirectory = path.join(directory, 'bin working directory');
  await fs.mkdir(binWorkingDirectory);
  // Keep a literal command on Windows; PATH selects the shim even with spaces in its directory.
  const binEnvironment = { PATH: `${binDirectory}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ''}` };
  const binHelp = process.platform === 'win32'
    ? execute(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'decision-harness.cmd help'], { cwd: binWorkingDirectory, env: binEnvironment })
    : execute(path.join(binDirectory, 'decision-harness'), ['help'], { cwd: binWorkingDirectory, env: binEnvironment });
  assert.equal(JSON.parse(binHelp.stdout).name, 'decision-harness');
});

test('DH-01 DH-20 copying only the Agent Skill retains runnable tools, catalog and exports', { timeout: 120_000 }, async t => {
  const directory = await temporaryDirectory(t);
  const copiedSkill = path.join(directory, 'standalone skill 中文');
  await fs.cp(path.join(repository, skillPath), copiedSkill, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(await fs.readdir(directory), [path.basename(copiedSkill)]);
  await fs.access(path.join(copiedSkill, 'SKILL.md'));
  await assert.rejects(fs.access(path.join(directory, 'package.json')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(directory, 'node_modules')), { code: 'ENOENT' });
  await smokeTest(path.join(copiedSkill, 'scripts', 'cli.mjs'), path.join(directory, 'standalone working directory'));
});
