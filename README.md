# Decision Harness

给现有 Agent 使用的**判断标准库、研究规则和本地记录工具**。从用户的目标开始，帮助用户想出标准，再按需调查候选、保留依据和不确定性。你可以只完成“怎么判断”，也可以继续到“比较后建议先做什么”。

Agent 负责理解、调查和解释；本项目负责保存、检查遗漏、提醒旧判断需要重查。无需另接模型 API，不提供独立聊天客户端，不强制人工审核。v0.1 是可运行的早期版本，尚未证明能提高真实用户的决策质量。

## 第一版能做什么

- 12 条通用技术项目标准，另有 4 条可选游戏引擎标准；每条包括适用情况、问题示例和编写依据。可以修改、拒绝或自建个人库。
- 根据提示词做中文／英文字面检索，显示命中词；由 Agent 判断是否适合这次目标。检索匹配值不代表项目得分。
- 保存目标、限制、标准、候选、证据、逐项判断、建议和可选复核；未知单独记录，没有默认总分或自动淘汰。
- 检查漏评、漏掉的目标、无依据的确定判断、失效的旧判断，以及明确硬约束与推荐之间的冲突。
- 保存不可覆盖的历史版本；冲突时要求重新读取当前版本；资料变化后旧结论不会自动变成已验证。
- 导出 JSON、Markdown、可打印 HTML，或清除案例结论后的复用模板。**没有原生 PDF 生成器**；可自行用浏览器打印 HTML。

## 开始使用

需要 Node.js 22+。没有运行依赖或 API key。

```text
git clone https://github.com/Andrewyuan34/decision-harness.git
cd decision-harness
node skills/decision-harness/scripts/cli.mjs help
```

让能读文件、执行本地命令的 Agent 读取 [SKILL.md](skills/decision-harness/SKILL.md)。例如：

> 请使用 decision-harness。我想一个人做个减少整理资料时间的小工具，每周只有五小时。先帮我想清楚判断标准，不用现在替我选项目。研究记录放在当前工作区的 research-store。

分发有两种路径：支持可移植插件格式的宿主可读取根目录 `plugin.json`；也可以把 `skills/decision-harness` **整个目录**复制到宿主支持的 Skill 目录。兼容声明见 [验证记录](docs/verification.md)：命令执行与独立 Agent 使用已经分别验证的部分会在该文档列出；没有承诺所有宿主、插件商店安装界面都已测试。本项目不会自动修改全局配置。

按标准插件格式组织的依据见 [官方插件文档](https://developers.openai.com/plugins/build/plugins)；`.codex-plugin/plugin.json` 是兼容清单。这里没有 MCP 服务，也未发布到插件商店或 npm 注册表。

## 自己试一遍

```text
node skills/decision-harness/scripts/cli.mjs catalog --query "一个人做，结果可以验证" --domain general --limit 8
node skills/decision-harness/scripts/cli.mjs init --input examples/criteria-brief.json --id example --store ./research-store
node skills/decision-harness/scripts/cli.mjs check example --stage ready --store ./research-store
node skills/decision-harness/scripts/cli.mjs export example --format html --out example.html --store ./research-store
```

这是明确标为演示的“只整理标准”案例。检查通过表示记录齐全，不能证明这些标准对每个人都合适。`examples/brief.json` 是尚未补入标准的简报：它可保存，但 ready 检查会返回未完成。

修改现有记录时，先 `get` 看当前版本，再用 JSON 导出取得可编辑的裸记录。下面的命令适用于 PowerShell 与常见 Unix shell：

```text
node skills/decision-harness/scripts/cli.mjs get example --store ./research-store
node skills/decision-harness/scripts/cli.mjs export example --format json --out edited-record.json --store ./research-store
node skills/decision-harness/scripts/cli.mjs save example --file edited-record.json --expected-revision 1 --actor "user" --reason "说明这次实际修改的内容" --store ./research-store
node skills/decision-harness/scripts/cli.mjs history example --store ./research-store
node skills/decision-harness/scripts/cli.mjs diff example --from 1 --to 2 --store ./research-store
```

执行 `save` 前，用编辑器或 Agent 修改 `edited-record.json`，并填写真实修改原因。`get` 返回 `{record}`，`save` 接受裸 `record`，两者不能混用；JSON 导出已经去掉外层包装。`--expected-revision` 使用刚读取的版本号，工作文件保存为 UTF-8。

改变证据或限制后先保存，再检查哪些判断受影响。重新阅读并完成判断之后，可以在 `save` 加 `--recheck assessment-id,check-id`；重看建议后使用 `--recheck-recommendation`。这些选项记录“已复查”的声明，**不会替你核查事实**。新内容或实质修改的判断会记录新的依赖；仅改变空格不会算复查。

完整字段、个人标准库格式和命令在 [记录指南](skills/decision-harness/references/record-guide.md)。退出码：`0` 成功，`1` 输入／保存错误，`2` ready 检查未完成。已有导出文件默认不覆盖，确实要替换时加 `--force`。

## 保存方式与边界

研究数据在指定 `--store` 下，和插件安装分开。每条记录有 `revisions/000001.json` 等快照，以及保存期间使用的 `.lock`；快照包含操作者、原因和显式复查记录。不要手工编辑历史。出现锁提示时先确定是否仍有写入进程；程序不会擅自抢占锁。历史损坏会报告错误，不会覆盖修复。

这适合单机、本地文件系统上的小型研究，输入及快照上限 5 MiB。不是数据库服务、多人联网协作系统或恶意本地进程的安全隔离边界；原子改名和排他锁不等于所有网络盘、掉电场景都不会丢数据。自行备份研究目录。工具不自动打开记录里的路径或 URL，也不把来源文本当命令执行。

## 开发与验证

```text
npm test
npm run verify
node scripts/demo.mjs
npm pack
```

`npm test` 包含真正的命令行子进程、并发写入、错误输入、导出与本地打包安装。`npm run verify` 检查清单、引用和每项需求的追踪关系；它不能代替真实使用验证。`scripts/demo.mjs` 在临时目录重跑上面的主要命令。

从打包文件本地安装（无需从注册表安装本项目）：

```text
npm install --prefix ./local-install ./andrewyuan34-decision-harness-0.1.0.tgz --ignore-scripts --no-audit --no-fund
node local-install/node_modules/@andrewyuan34/decision-harness/skills/decision-harness/scripts/cli.mjs help
```

[Spec 与 20 项需求](docs/spec.md) · [实现／验收追踪](docs/traceability.json) · [验证记录与限制](docs/verification.md) · [方法说明](skills/decision-harness/references/method.md)

MIT License. The runtime is a dependency-free, local CLI and an Agent Skill. It does not make model calls, verify factual truth, or automatically rank alternatives.
