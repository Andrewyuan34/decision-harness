import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadCatalog } from '../skills/decision-harness/scripts/catalog.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = relative => fs.readFile(path.join(root, relative), 'utf8');
const json = async relative => JSON.parse(await read(relative));
async function exists(relative) {
  assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..'), `Nonportable reference: ${relative}`);
  assert.ok((await fs.stat(path.join(root, relative))).isFile(), `Missing file: ${relative}`);
}
const spec = await read('docs/spec.md');
const ids = [...spec.matchAll(/^\| (DH-\d{2}) \|/gm)].map(x => x[1]);
assert.equal(ids.length, 20); assert.equal(new Set(ids).size, ids.length);
const trace = await json('docs/traceability.json');
assert.deepEqual(trace.requirements.map(r => r.id).sort(), [...ids].sort(), 'Traceability must cover every requirement exactly once.');
for (const requirement of trace.requirements) {
  assert.ok(requirement.implementation.length && (requirement.tests.length || requirement.behavior.length));
  for (const file of requirement.implementation) await exists(file);
  for (const test of requirement.tests) {
    await exists(test.file);
    const titles = [...(await read(test.file)).matchAll(/test\('([^']+)'/g)].map(x => x[1]);
    assert.ok(titles.some(title => title.includes(test.titleIncludes)), `${requirement.id}: missing executable test title in ${test.file}`);
  }
  for (const evidence of requirement.behavior) {
    const report = await json(evidence.file), observed = report.cases.find(c => c.id === evidence.caseId);
    assert.equal(observed?.status, 'passed', `${requirement.id}: behavioral case ${evidence.caseId} is not verified.`);
    assert.ok(observed.observations?.length && observed.artifacts?.length, 'Behavioral assertions need observations and inspectable artifacts.');
    for (const file of observed.artifacts) await exists(file);
  }
}
const pkg = await json('package.json'), plugin = await json('plugin.json'), overlay = await json('.codex-plugin/plugin.json');
assert.equal(plugin.name, 'decision-harness'); assert.equal(overlay.name, plugin.name);
assert.equal(pkg.version, plugin.version); assert.equal(overlay.version, plugin.version);
assert.equal(overlay.skills, './skills/'); assert.ok(plugin.$schema.startsWith('https://agent-plugins.org/'));
assert.equal(pkg.bin['decision-harness'], 'skills/decision-harness/scripts/cli.mjs');
assert.deepEqual(pkg.dependencies ?? {}, {});
await exists(pkg.bin['decision-harness']); assert.match(await read('LICENSE'), /MIT License/);
const skillFile = 'skills/decision-harness/SKILL.md', skill = await read(skillFile);
assert.match(skill, /^---\r?\nname: decision-harness\r?\ndescription: .+/);
for (const file of [skillFile, 'README.md', 'skills/decision-harness/references/method.md', 'skills/decision-harness/references/record-guide.md']) {
  for (const match of (await read(file)).matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(match[1])) continue;
    await exists(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1].split('#')[0])));
  }
}
const catalog = await loadCatalog(); assert.ok(catalog.criteria.length >= 16);
console.log(`Verified ${ids.length} requirement mappings, observed Agent evidence, manifests, catalog and local documentation links. This is a structural check, not proof of research quality.`);
