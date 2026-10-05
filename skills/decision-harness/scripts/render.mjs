import { assertRecord } from './schema.mjs';

const LIMITATION = '此检查只核对已记录的结构、覆盖和版本依赖，不证明事实正确、目标完整或研究质量。导出不会重新进行分析。';
const NONE = '（无条目）';
const CRITERIA_NOTE = '本次只整理标准，可以在明确目标和标准后结束。空章节不展开；已经记录的比较、依据和复核内容仍会保留。';

function html(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function markdown(value) {
  // Encode HTML metacharacters and escape Markdown syntax in every user-controlled scalar.
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&')
    .replace(/\r\n?/g, '\n').replace(/\n/g, '  \n');
}

function fields(values) {
  return Object.entries(values).filter(([, value]) => value !== undefined);
}

function item(title, values) {
  return { title, fields: fields(values) };
}

function section(title, items) {
  return { title, items };
}

function status(value) {
  const labels = { adopted: '采用', rejected: '未采用', supported: '有依据支持', mixed: '依据不一致', concern: '发现问题', unknown: '未知', met: '满足', violated: '不满足', open: '待处理', resolved: '已回应' };
  return `${labels[value] ?? value} (${value})`;
}

function sections(record, checkResult) {
  const check = checkResult ?? { ok: null, stage: 'not-run', diagnostics: [], limitation: '未提供检查结果。' };
  return [
    section('研究信息', [item('', {
      '研究 ID': record.id, '修订 revision': record.revision, '记录格式 schemaVersion': record.schemaVersion,
      '创建时间': record.createdAt, '更新时间': record.updatedAt, '模式': record.mode, '领域': record.domain,
      '原始请求': record.prompt, '本次问题': record.question,
    })]),
    section('检查结果与边界', [
      item('', { '状态': check.ok === true ? '记录检查通过' : check.ok === false ? '记录检查未通过' : '未运行检查', '检查阶段': check.stage, '固定边界': LIMITATION, '检查器说明': check.limitation }),
      ...check.diagnostics.map((diagnostic) => item(diagnostic.code, { '级别': diagnostic.severity, '位置': diagnostic.path, '说明': diagnostic.message })),
    ]),
    section('目标', record.objectives.map((objective) => item(objective.id, { '内容': objective.text, '来源': objective.origin }))),
    section('限制与偏好', record.constraints.map((constraint) => item(constraint.id, { '内容': constraint.text, '类别': constraint.kind, '来源': constraint.origin }))),
    section('尚需注意的假设', record.assumptions.map((assumption) => item(assumption.id, { '内容': assumption.text, '影响': assumption.impact }))),
    section('标准，包括未采用的条目', record.criteria.map((criterion) => item(`${criterion.title} [${criterion.id}]`, {
      '状态': status(criterion.status), '描述': criterion.description, '关联目标': criterion.objectiveIds,
      '调查问题': criterion.question, '采用或拒绝理由': criterion.rationale, '来源': criterion.origin,
      '库条目 ID': criterion.catalogId, '库版本': criterion.catalogVersion,
    }))),
    section('候选', record.alternatives.map((alternative) => item(`${alternative.title} [${alternative.id}]`, { '描述': alternative.description }))),
    section('依据与来源', record.evidence.map((evidence) => item(`${evidence.title} [${evidence.id}]`, {
      '来源位置': evidence.location, '来源类型': evidence.kind, '获取时间': evidence.retrievedAt, '记录的依据': evidence.summary,
    }))),
    section('逐项判断', record.assessments.map((assessment) => item(assessment.id, {
      '候选 ID': assessment.alternativeId, '标准 ID': assessment.criterionId, '状态': status(assessment.status),
      '主张类型': assessment.claimType, '理由': assessment.rationale, '引用依据 ID': assessment.evidenceIds, '不确定性': assessment.uncertainty,
    }))),
    section('限制核对', record.constraintChecks.map((check) => item(check.id, {
      '候选 ID': check.alternativeId, '限制 ID': check.constraintId, '状态': status(check.status), '理由': check.rationale, '引用依据 ID': check.evidenceIds,
    }))),
    section('条件式建议', record.recommendation ? [item('', {
      '候选清单 ID': record.recommendation.alternativeIds, '理由': record.recommendation.rationale,
      '取舍': record.recommendation.tradeoffs, '成立条件': record.recommendation.conditions, '下一步检查': record.recommendation.nextChecks,
    })] : []),
    section('可选复核与回应', record.reviews.map((review) => item(review.id, {
      '对象': review.target, '提出者': review.author, '意见': review.comment, '状态': status(review.status), '回应': review.response,
    }))),
  ].filter((group) => record.mode !== 'criteria' || group.items.length > 0);
}

function jsonFence(value) {
  const json = JSON.stringify(value, null, 2);
  let length = 3;
  for (const [run] of json.matchAll(/`+/g)) length = Math.max(length, run.length + 1);
  const fence = '`'.repeat(length);
  return `${fence}json\n${json}\n${fence}`;
}

/** Render the supplied saved record; never re-investigate or mutate its analysis. */
export function renderMarkdown(record, checkResult) {
  assertRecord(record);
  const lines = [`# ${markdown(record.title)}`, '', '本报告反映下面标出的研究修订；完整记录保留在末尾，历史版本请另用 history 或 diff 查看。', ''];
  if (record.mode === 'criteria') lines.push(CRITERIA_NOTE, '');
  for (const group of sections(record, checkResult)) {
    lines.push(`## ${group.title}`, '');
    if (!group.items.length) lines.push(NONE, '');
    for (const entry of group.items) {
      if (entry.title) lines.push(`### ${markdown(entry.title)}`, '');
      for (const [label, value] of entry.fields) {
        if (Array.isArray(value)) {
          lines.push(`**${label}**`, '');
          if (!value.length) lines.push(NONE, '');
          else lines.push(...value.map((line) => `- ${markdown(line)}`), '');
        } else lines.push(`**${label}：** ${value === '' ? '（空）' : markdown(value)}`, '');
      }
    }
  }
  lines.push('## 完整记录 JSON', '', '以下是同一版本的完整记录，包括工具维护的依赖信息。代码块中的内容仅作数据展示。', '', jsonFence(record), '');
  return lines.join('\n');
}

const CSS = `
:root { color-scheme: light; font-family: system-ui, "Microsoft YaHei", sans-serif; color: #202733; background: #f4f6f8; }
body { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem; line-height: 1.6; }
header, section { background: white; padding: 1.5rem; margin-bottom: 1rem; border: 1px solid #d9dee6; border-radius: .5rem; }
h1 { font-size: 1.8rem; margin-top: 0; } h2 { font-size: 1.3rem; margin-top: 0; } h3 { font-size: 1.05rem; }
p, h1, h2, h3, dd, li { overflow-wrap: anywhere; white-space: pre-wrap; }
dl { margin: .75rem 0 1.5rem; } dt { font-weight: 650; margin-top: .8rem; } dd { margin: .15rem 0 0; }
ul { padding-left: 1.4rem; } .note { color: #505b6b; } article + article { border-top: 1px solid #d9dee6; padding-top: .75rem; }
pre { background: #f4f6f8; padding: 1rem; font-size: .85rem; white-space: pre-wrap; overflow-wrap: anywhere; }
@media print { :root, body { background: white; color: black; } body { max-width: none; padding: 0; font-size: 10pt; }
header, section { border: 0; border-radius: 0; padding: 0; margin-bottom: 1.5rem; } h1, h2, h3, dt { break-after: avoid; }
article { break-inside: auto; } pre { background: white; border: 1px solid #ddd; } @page { margin: 18mm; } }
`;

function htmlField(label, value) {
  const content = Array.isArray(value)
    ? value.length ? `<ul>${value.map((entry) => `<li>${html(entry)}</li>`).join('')}</ul>` : `<p>${NONE}</p>`
    : value === '' ? '（空）' : html(value);
  return `<dt>${html(label)}</dt><dd>${content}</dd>`;
}

/** An offline, script-free printable report. Source locations are inert text, not remote assets. */
export function renderHtml(record, checkResult) {
  assertRecord(record);
  const body = sections(record, checkResult).map((group) => `<section><h2>${html(group.title)}</h2>${group.items.length
    ? group.items.map((entry) => `<article>${entry.title ? `<h3>${html(entry.title)}</h3>` : ''}<dl>${entry.fields.map(([label, value]) => htmlField(label, value)).join('')}</dl></article>`).join('')
    : `<p>${NONE}</p>`}</section>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${html(record.title)}</title><style>${CSS}</style></head><body>
<header><h1>${html(record.title)}</h1><p class="note">本报告反映下面标出的研究修订。可使用浏览器打印；此文件不是已生成的 PDF。完整历史请另用 history 或 diff 查看。</p>${record.mode === 'criteria' ? `<p>${CRITERIA_NOTE}</p>` : ''}</header>
${body}
<section><h2>完整记录 JSON</h2><p>同一版本的完整记录，包括工具维护的依赖信息。以下内容仅作数据展示。</p><pre id="record-json">${html(JSON.stringify(record, null, 2))}</pre></section>
</body></html>\n`;
}

/** Keep reusable framing only; every new case must supply fresh evidence and conclusions. */
export function makeTemplate(record) {
  assertRecord(record);
  return structuredClone({
    title: record.title, prompt: record.prompt, question: record.question, mode: record.mode, domain: record.domain,
    objectives: record.objectives, constraints: record.constraints,
    criteria: record.criteria.filter((criterion) => criterion.status === 'adopted'),
  });
}
