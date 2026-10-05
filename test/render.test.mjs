import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderHtml, makeTemplate } from '../skills/decision-harness/scripts/render.mjs';
import { createRecord, checkRecord } from '../skills/decision-harness/scripts/core.mjs';
import { completeRecord, NOW } from './fixtures.mjs';

function decodeHtml(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function markdownPayload(text) {
  const match = text.match(/^(`{3,})json\n([\s\S]*)\n\1\n$/m);
  assert.ok(match, 'the exported record has a complete fenced JSON block');
  return { data: JSON.parse(match[2]), outside: text.slice(0, match.index), fence: match[1], raw: match[2] };
}

function reportRecord() {
  const record = completeRecord();
  record.revision = 7;
  record.criteria[0].origin = 'library';
  record.criteria[0].catalogId = 'general-verification';
  record.criteria[0].catalogVersion = '0.1.0';
  record.criteria.push({ ...record.criteria[0], id: 'rejected-criterion', title: 'Rejected marker', status: 'rejected', rationale: 'Not useful for this case.' });
  record.constraints = [{ id: 'offline', text: 'Offline use marker', kind: 'hard', origin: 'user' }];
  record.assumptions = [{ id: 'assumption-a', text: 'Assumption marker', impact: 'Needs revalidation.' }];
  record.assessments[0].status = 'unknown';
  record.assessments[0].rationale = 'Unknown marker: no real workload tried.';
  record.assessments[0].uncertainty = 'Uncertainty marker';
  record.constraintChecks = [{ id: 'check-a', alternativeId: 'option-a', constraintId: 'offline', status: 'unknown', rationale: 'Offline not tested marker', evidenceIds: [] }];
  record.evidence[0].location = 'https://example.com/source?query=hello&lang=zh';
  record.evidence[0].kind = 'web';
  record.reviews = [{ id: 'review-a', target: 'assessment:assessment-a', author: 'Reviewer marker', comment: 'Review marker', status: 'resolved', response: 'Response marker' }];
  return record;
}

test('DH-15 both report formats preserve every saved field and revision without changing the record', () => {
  const record = reportRecord();
  const original = structuredClone(record);
  const check = checkRecord(record);
  const beforeCheck = structuredClone(check);
  const md = renderMarkdown(record, check);
  const page = renderHtml(record, check);
  assert.deepEqual(markdownPayload(md).data, record);
  const payload = page.match(/<pre id="record-json">([\s\S]*?)<\/pre>/);
  assert.ok(payload);
  assert.deepEqual(JSON.parse(decodeHtml(payload[1])), record);
  assert.deepEqual(record, original);
  assert.deepEqual(check, beforeCheck);
});

test('DH-08 DH-14 DH-15 rejected criteria, unknowns, sources, reviews and diagnostics appear before the JSON appendix', () => {
  const record = reportRecord();
  const check = checkRecord(record);
  const md = markdownPayload(renderMarkdown(record, check)).outside;
  const page = decodeHtml(renderHtml(record, check).split('<pre id="record-json">')[0]);
  for (const word of ['Rejected marker', 'unknown', 'Uncertainty marker', 'Review marker', 'Response marker', 'Assumption marker', 'STALE_ASSESSMENT']) {
    // Markdown escapes underscores, which must stay literal when displayed.
    assert.ok(md.includes(word.replace(/_/g, '\\_')), `Markdown shows ${word}`);
    assert.ok(page.includes(word), `HTML shows ${word}`);
  }
  assert.ok(page.includes(record.evidence[0].location));
  assert.ok(md.includes('revision'));
  assert.ok(page.includes('revision'));
  assert.ok(page.includes(check.limitation));
});

test('DH-19 hostile record and diagnostic text cannot add active HTML or remote assets', () => {
  const record = reportRecord();
  const attack = '</title></pre><script>alert("x")</script><img src="https://evil.example/pixel" onerror="alert(1)">&lt;';
  record.title = attack;
  record.prompt = attack;
  record.evidence[0].summary = attack;
  record.evidence[0].location = `https://example.com/?q=${attack}`;
  record.reviews[0].comment = attack;
  const check = { ok: false, stage: attack, limitation: attack, diagnostics: [{ code: attack, severity: attack, path: attack, message: attack }] };
  const page = renderHtml(record, check);
  assert.doesNotMatch(page, /<script\b|<img\b|<iframe\b|<object\b|<link\b|<base\b|<form\b/i);
  const tags = page.match(/<[^>]+>/g).join('\n');
  assert.doesNotMatch(tags, /\s(?:src|href|onerror|onclick)=/i);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /@media print/);
  assert.match(page, /default-src 'none'/);
  assert.deepEqual(JSON.parse(decodeHtml(page.match(/<pre id="record-json">([\s\S]*?)<\/pre>/)[1])), record);
});

test('DH-19 Markdown fences and escaped user text resist raw HTML, image and link injection', () => {
  const record = completeRecord();
  const attack = `</pre><script>alert(1)</script>\n# forged heading\n![tracking](https://evil.example/pixel)\n[run](javascript:alert(1))\n${'`'.repeat(20)}\n<img src=x>\n${'`'.repeat(20)}`;
  record.title = attack;
  record.prompt = attack;
  record.recommendation.rationale = attack;
  const result = markdownPayload(renderMarkdown(record, checkRecord(record)));
  assert.deepEqual(result.data, record);
  assert.ok(result.fence.length > 20, 'source cannot close the JSON code fence');
  assert.doesNotMatch(result.outside, /<\/?[a-z]/i);
  assert.doesNotMatch(result.outside, /!\[tracking\]\(|\[run\]\(/);
  assert.ok(result.outside.includes('\\# forged heading'));
});

test('DH-16 template initializes a new case while clearing evidence, conclusions, guesses and history', () => {
  const source = reportRecord();
  const template = makeTemplate(source);
  assert.deepEqual(Object.keys(template).sort(), ['title', 'prompt', 'question', 'mode', 'domain', 'objectives', 'constraints', 'criteria'].sort());
  assert.deepEqual(template.criteria, source.criteria.filter((criterion) => criterion.status === 'adopted'));
  assert.deepEqual(template.objectives, source.objectives);
  assert.deepEqual(template.constraints, source.constraints);
  const next = createRecord(template, 'new-case', '2026-10-05T12:00:00.000Z');
  assert.equal(next.revision, 1);
  assert.equal(next.id, 'new-case');
  assert.equal(next.createdAt, '2026-10-05T12:00:00.000Z');
  for (const key of ['assumptions', 'alternatives', 'evidence', 'assessments', 'constraintChecks', 'reviews']) assert.deepEqual(next[key], []);
  assert.equal(next.recommendation, null);
  assert.equal(checkRecord(next).ok, false, 'a new screening case is not presented as completed research');
  template.objectives[0].text = 'Different objective';
  template.criteria[0].objectiveIds.length = 0;
  assert.notEqual(source.objectives[0].text, 'Different objective');
  assert.ok(source.criteria[0].objectiveIds.length > 0);
});

test('DH-19 many Markdown delimiters in valid input do not overflow fence generation', () => {
  const record = completeRecord('criteria');
  record.prompt = '`a'.repeat(100000);
  assert.deepEqual(markdownPayload(renderMarkdown(record, checkRecord(record))).data, record);
});

test('DH-03 DH-15 DH-16 criteria-only output and reusable template need no candidates or human approval', () => {
  const source = completeRecord('criteria');
  assert.doesNotThrow(() => renderMarkdown(source, checkRecord(source)));
  assert.doesNotThrow(() => renderHtml(source, checkRecord(source)));
  const next = createRecord(makeTemplate(source), 'criteria-copy', NOW);
  assert.equal(checkRecord(next).ok, true);
  assert.equal(next.reviews.length, 0);
  assert.equal(next.alternatives.length, 0);
});

test('DH-15 missing check result stays explicit instead of inventing a successful check', () => {
  const record = completeRecord('criteria');
  assert.ok(renderMarkdown(record).includes('未运行检查'));
  assert.ok(renderHtml(record).includes('未运行检查'));
});

test('DH-03 DH-15 criteria reports omit empty sections while screen reports reveal unfinished work', () => {
  const record = completeRecord('criteria');
  const optionalTitles = ['限制与偏好', '尚需注意的假设', '候选', '依据与来源', '逐项判断', '限制核对', '条件式建议', '可选复核与回应'];
  const md = renderMarkdown(record, checkRecord(record));
  const page = renderHtml(record, checkRecord(record));
  for (const title of optionalTitles) {
    assert.ok(!md.includes(`## ${title}\n`), `criteria Markdown omits empty ${title}`);
    assert.ok(!page.includes(`<h2>${title}</h2>`), `criteria HTML omits empty ${title}`);
  }
  assert.ok(md.includes('可以在明确目标和标准后结束'));
  assert.ok(page.includes('可以在明确目标和标准后结束'));
  assert.deepEqual(markdownPayload(md).data, record);
  assert.deepEqual(JSON.parse(decodeHtml(page.match(/<pre id="record-json">([\s\S]*?)<\/pre>/)[1])), record);
  record.mode = 'screen';
  const screenMd = renderMarkdown(record, checkRecord(record));
  const screenHtml = renderHtml(record, checkRecord(record));
  for (const title of optionalTitles) {
    assert.ok(screenMd.includes(`## ${title}\n`), `screen Markdown retains empty ${title}`);
    assert.ok(screenHtml.includes(`<h2>${title}</h2>`), `screen HTML retains empty ${title}`);
  }
});

test('DH-03 DH-15 criteria mode retains existing comparison material and complete record fidelity', () => {
  const record = reportRecord();
  record.mode = 'criteria';
  const md = renderMarkdown(record, checkRecord(record));
  const page = renderHtml(record, checkRecord(record));
  const mdBody = markdownPayload(md).outside;
  const htmlBody = page.split('<pre id="record-json">')[0];
  for (const title of ['限制与偏好', '尚需注意的假设', '候选', '依据与来源', '逐项判断', '限制核对', '条件式建议', '可选复核与回应']) {
    assert.ok(mdBody.includes(`## ${title}\n`));
    assert.ok(htmlBody.includes(`<h2>${title}</h2>`));
  }
  for (const value of ['Small check', 'Synthetic test fixture', 'Unknown marker', 'Review marker', 'Response marker']) {
    assert.ok(mdBody.includes(value));
    assert.ok(htmlBody.includes(value));
  }
  assert.deepEqual(markdownPayload(md).data, record);
  assert.deepEqual(JSON.parse(decodeHtml(page.match(/<pre id="record-json">([\s\S]*?)<\/pre>/)[1])), record);
});

test('DH-15 DH-19 malformed source records cannot masquerade as valid reports or templates', () => {
  const record = completeRecord();
  record.accidentalField = 'Not part of the schema';
  for (const render of [renderMarkdown, renderHtml, makeTemplate]) assert.throws(() => render(record), { code: 'INVALID_RECORD' });
});
