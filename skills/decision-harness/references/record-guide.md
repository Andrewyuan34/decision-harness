# 记录与命令指南

内容可以使用用户的语言；字段名和枚举值固定。所有输入是 UTF-8 JSON，最大 5 MiB。工具会拒绝未知字段、错误类型和无效引用；缺少研究内容可以先保存草稿，再通过检查列出需要补充的部分。

## 建立一条研究

`init` 输入是简报或模板，不是完整记录。必填 `title`、`prompt`，其他允许字段为 `question`、`mode`、`domain`、`objectives`、`constraints`、`assumptions`、`criteria`。默认问题等于原始提示词，模式为 `screen`，领域为 `general`。初始化不会伪造候选或证据。

```json
{
  "title": "选择一个自己能开始的小工具方向",
  "prompt": "我想独立做个减少整理资料时间的工具，先帮我想清楚判断标准。",
  "question": "哪些标准能帮助我选择适合独立开始的资料整理工具方向？",
  "mode": "criteria",
  "domain": "general",
  "objectives": [
    {"id": "save-time", "text": "减少整理资料的时间", "origin": "user"},
    {"id": "solo", "text": "能够独立开始", "origin": "user"}
  ]
}
```

```text
node "<skill>/scripts/cli.mjs" init --input "brief.json" --id research-one --store "./research-store"
node "<skill>/scripts/cli.mjs" get research-one --store "./research-store"
```

`init`、`get` 和 `save` 返回 `{record}`。取出 `.record` 保存到工作文件后再编辑；不要把包装层交给 `save --file`。可以在当前工作区保存编辑文件，研究历史交给工具维护。

## 查询和采用标准

```text
node "<skill>/scripts/cli.mjs" catalog --domain general --query "独立开始，时间有限" --limit 8
node "<skill>/scripts/cli.mjs" catalog --domain game-engine --limit 20
node "<skill>/scripts/cli.mjs" catalog --extra "personal-catalog.json" --query "离线" --limit 8
```

默认领域为 `general`。指定其他领域时，结果包含通用条目及该领域条目；未知领域仍可使用通用条目。空查询按库顺序列出；非空查询只返回字面命中，无命中返回空数组。`retrieval.score` 衡量词项重合，`matchedTerms` 解释命中内容；二者都不是标准的重要性或候选项目得分。限制数量 `limit` 必须是正整数。

个人库使用下列形状：

```text
{ version: string, criteria: [
  { id, title, description, domains[], objectiveTags[], keywords[],
    applicability, evidenceQuestions[], example,
    provenance: { kind: "editorial", note, references[] } }
] }
```

所有列出的字段必需；字符串非空，四个描述性列表也非空，`references` 可以为空。库版本是非空字符串。个人库只追加，不覆盖；库内重复 ID 或与默认库冲突均返回 `CATALOG_INVALID`。合并后的版本写为 `默认版本+personal.个人版本`，采用时保留 CLI 返回的版本。不要让没有可验证来源的条目假称权威标准；`note` 应说明编写者如何形成这个建议。

**库条目不能直接复制成研究 criterion。** 将它转换为下面的允许字段，填上本次目标、理由和调查问题；保留 `catalogId` 与返回的 `catalogVersion`。库的检索分数和额外字段不属于研究记录。

```json
{
  "id": "manageable-scope",
  "title": "现有时间能完成有用的小版本",
  "description": "比较首个可用版本的必要工作和学习负担。",
  "objectiveIds": ["solo"],
  "question": "必须做哪些工作，现有能力与时间能否覆盖？",
  "rationale": "用户希望独立开始，因此先判断首版范围是否可控。这是编辑建议，需要本次调查。",
  "status": "adopted",
  "origin": "library",
  "catalogId": "general-solo-scope",
  "catalogVersion": "0.1.0"
}
```

这个版本号仅用于演示，应以实际载入的库为准。完全自定义的标准使用 `origin: user` 或 `agent`，不填不存在的库 ID。拒绝的标准可以保留 `status: rejected` 和理由，不计入候选覆盖要求。

## 完整记录字段

顶层字段全部为：

```text
schemaVersion, id, revision, createdAt, updatedAt, title, prompt, question,
mode, domain, objectives, constraints, assumptions, criteria, alternatives,
evidence, assessments, constraintChecks, recommendation, reviews
```

`schemaVersion` 为 `1`；`mode` 为 `criteria` 或 `screen`。实体 ID 匹配 `[a-z][a-z0-9_-]{0,63}`。时间采用 ISO 8601 字符串。除注明可选字段，以下字段都要提供；允许为空的内容也应使用相应的字符串、数组或 `null`，不能省略。

| 实体 | 字段 |
| --- | --- |
| 目标 objective | `id, text, origin`；origin 为 `user` 或 `agent` |
| 限制 constraint | `id, text, kind, origin`；kind 为 `hard` 或 `preference` |
| 假设 assumption | `id, text, impact` |
| 标准 criterion | `id, title, description, objectiveIds[], question, rationale, status, origin`；status 为 `adopted` 或 `rejected`；origin 为 `library`、`user` 或 `agent`；`catalogId`、`catalogVersion` 可选 |
| 候选 alternative | `id, title, description` |
| 证据 evidence | `id, title, location, kind, summary, retrievedAt`；kind 为 `web`、`local`、`user` 或 `experiment` |
| 判断 assessment | `id, alternativeId, criterionId, status, claimType, rationale, evidenceIds[], uncertainty`；工具管理的 `basis` 可选 |
| 限制核对 constraint check | `id, alternativeId, constraintId, status, rationale, evidenceIds[]`；工具管理的 `basis` 可选 |
| 建议 recommendation | `alternativeIds[], rationale, tradeoffs[], conditions[], nextChecks[]`；工具管理的 `basis` 可选；未形成建议时整个字段为 `null` |
| 复核 review | `id, target, author, comment, status, response` |

判断的 `status` 为 `supported`、`mixed`、`concern` 或 `unknown`，`claimType` 为 `fact`、`estimate` 或 `judgment`。非 unknown 判断必须引用证据；unknown 必须解释未知原因，`evidenceIds` 可以为空。`uncertainty` 说明局限；没有可说明的额外局限时可以为空字符串，但不得因此宣称绝对确定。

限制核对的 `status` 为 `met`、`violated` 或 `unknown`，非 unknown 同样需要证据。Web 来源的 `location` 必须为 HTTP(S) URL；程序不会自动打开它。其他来源记录能定位到原材料的位置或标识。`retrievedAt` 是实际获取时间，必须含时间和时区，例如 `2026-10-05T09:30:00Z`；仅写 `2026-10-05` 不符合格式。使用实际时间，不能伪造未来查证。

复核 target 为 `record`、`criterion:<id>`、`assessment:<id>`、`alternative:<id>` 或 `recommendation`。status 为 `open` 或 `resolved`；resolved 必须有回应。复核记录描述用户或实际评阅者的意见，不要虚构已有人审核。

## 保存、检查与复查

下面 `<revision>` 要替换为最近 `get` 返回的当前数字；其他占位内容同样按当前研究填写。每次保存都包括操作者和实际改动原因。

```text
node "<skill>/scripts/cli.mjs" save research-one --file "edited-record.json" --expected-revision <revision> --actor "agent" --reason "补充标准采用理由" --store "./research-store"
node "<skill>/scripts/cli.mjs" check research-one --stage draft --store "./research-store"
node "<skill>/scripts/cli.mjs" check research-one --stage ready --store "./research-store"
node "<skill>/scripts/cli.mjs" history research-one --store "./research-store"
node "<skill>/scripts/cli.mjs" diff research-one --from <earlier-revision> --to <later-revision> --store "./research-store"
```

保存输入使用完整裸 record。不要自行更新 revision、时间戳或 basis；它们由工具管理。发生版本冲突时，先读取新的当前记录，再考虑保留双方变更。工具不会静默抢占旧锁；锁或数据损坏需要检查原因，不能通过覆盖历史来绕过。

`criteria` 模式 ready 需要非空目标和采用标准，且每个目标被覆盖。`screen` 还需要候选、每个候选与采用标准的判断、每条限制与候选的核对、建议和有效的依赖记录。未知可以作为有效判断保留；若推荐仍有未知依据的候选，要说明成立条件或下一步检查。已知违反硬约束的候选不能在 ready 推荐中入选：需要重新考虑选择，或由用户明确改变该限制；仅补一段解释不会消除冲突，草稿仍可保存。

修改依据后，未改动的旧判断可能被标为 stale。读过新依据并重新完成受影响分析后，才在正常 `save` 中加 `--recheck assessment-id,check-id`；重新检查整条建议后才加 `--recheck-recommendation`。这两个选项声明你已经完成复查，不会替你执行复查。旧版本仍留在历史中。

检查返回 `{ok, stage, diagnostics, limitation}`。draft 的未完成项可以是 warning；ready 未满足内容要求时退出码为 `2`。其他用法、数据或存储错误退出码为 `1`；成功为 `0`。`ok` 不是事实核查或所有人类目标都完整的证明。开放复核、假设或疑似标准重叠会提醒，但不构成强制审批。

## 导出和复用

```text
node "<skill>/scripts/cli.mjs" export research-one --format markdown --out "research.md" --store "./research-store"
node "<skill>/scripts/cli.mjs" export research-one --format html --out "research.html" --store "./research-store"
node "<skill>/scripts/cli.mjs" export research-one --format json --out "research.json" --store "./research-store"
node "<skill>/scripts/cli.mjs" export research-one --format template --out "next-brief.json" --store "./research-store"
```

导出反映已保存的同一版本，未保存的工作文件不会进入导出。JSON 是裸记录；模板保留问题、目标、限制和采用标准，清空本次候选、证据、判断、推荐、复核及修订元数据，可以作为新 `init --input` 的输入。检查新情境下这些标准是否仍适合，不继承旧研究的可信程度。

没有 `--out` 时原始导出内容写到 stdout；指定时返回路径、格式和修订号。已有输出不会覆盖，明确需要时才使用 `--force`。HTML 不含脚本或远程资源，可由用户的浏览器打印；工具没有原生 PDF 渲染功能。
