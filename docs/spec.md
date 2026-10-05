# Decision Harness v0.1 Spec

Status: implementation baseline, written before implementation. 2026-10-04.

## Purpose and scope

Help a beginner turn a research goal into relevant criteria and, when requested, an evidence-backed comparison. Package a lightweight PrOACT workflow, an editable criteria library, and local persistence/checking tools for an existing Agent. The host Agent interprets goals, selects criteria, investigates sources and explains tradeoffs. The deterministic tools do not call a model, browse, decide factual truth or choose a winner.

The owner authorized completing the previously discussed plan. Implementation choices made under that authorization: Node.js 22+, no runtime dependencies; portable Agent Plugins manifest plus a standalone Agent Skill; JSON-oriented CLI; generic technical-project criteria and an optional game-engine pack; both criteria-only and full-screening modes; Markdown, JSON, reusable-template and printable HTML exports. MIT-licensed public repository. These are engineering choices, not claims that user research established the best interface.

No mandatory human approval or review stage. No default numeric score, automatic veto from a low score, or forced unique winner. Missing information is explicitly unknown. No independent client, model API integration, TUI, hosted service, MCP server, native PDF renderer, accounts or plugin-store publication in v0.1. Printable HTML is not native PDF generation. Other hosts may execute the same skill/CLI; compatibility is claimed only at the level actually tested.

## Functional requirements

Every requirement has an immutable ID. `docs/traceability.json` maps IDs to implementation and executable tests or observed Agent evidence. Planned items may not be labeled verified. Test titles include the corresponding IDs.

| ID | Required behavior | Observable acceptance |
| --- | --- | --- |
| DH-01 | Distributable plugin and self-contained Agent Skill | Root manifest discovers `skills/decision-harness`; copying that skill directory alone retains rules, library and runnable tools. No API key or global configuration edit required. |
| DH-02 | Goal-first PrOACT workflow | Skill preserves user wording, distinguishes explicit goals from assumptions, derives criteria before library supplementation, investigates alternatives and explains tradeoffs. Independent Agent case, not a heading check. |
| DH-03 | Two stopping points | `criteria` mode can be ready without alternatives/evidence/recommendation; `screen` mode checks a full comparison. Neither requires human review. |
| DH-04 | Versioned starter criteria library | General technical-project and optional game-engine entries include plain explanation, objective tags, applicability, evidence questions, example and editorial provenance. No claim of universal authority. Personal exclusions are not library defaults. |
| DH-05 | Explainable candidate retrieval | CLI lists/filters entries and suggests matches from query/domain with matched terms; this is lexical retrieval, not AI selection. No-match is allowed. Agent performs semantic selection and records why. |
| DH-06 | Customizable and reusable criteria | Agent/user may adopt, edit, reject, or add criteria and load a personal catalog. Adopted copies retain catalog ID/version when applicable, rationale, objective IDs and provenance. Catalog ID collisions fail explicitly. |
| DH-07 | Structured research record | Store original prompt, decision question, goals, constraints, assumptions, criteria, alternatives, evidence, assessments, constraint checks, recommendation and optional reviews. Stable IDs and schema version support references. Invalid enums/types/unknown fields fail with paths. |
| DH-08 | Evidence and uncertainty | Each assessment distinguishes fact/estimate/judgment and supported/mixed/concern/unknown. Non-unknown assessments reference evidence. Unknown requires a reason, never becomes zero/failure. Evidence includes location, type, summary and date. Reference presence does not prove source support. |
| DH-09 | Coverage checks | Detect missing adopted-criterion × alternative assessments; unaddressed goals; missing constraint checks; duplicate pair assessments, IDs and broken references; empty requirements; unsupported certainty. Draft can be saved while incomplete; ready checks return diagnostics. |
| DH-10 | Conditional recommendation | Save shortlist, rationale, tradeoffs, conditions and next checks. Empty shortlist is valid with an explanation. Selected alternatives must exist. A stated hard constraint known violated cannot silently coexist with a ready recommendation selecting it. A concern never deletes an option. |
| DH-11 | Durable local revisions | Initialize, get, save, list history and diff revisions. Every save requires expected revision, actor and reason. Immutable snapshots retain previous state. Malformed/conflicting writes leave prior data unchanged. Unicode and paths with spaces work. |
| DH-12 | Concurrent writes and corruption | Exclusive per-record lock prevents lost updates; expected revision rejects stale writers. Write via same-directory temporary file + rename. A stale lock is reported, never silently stolen. Invalid stored data is reported, not overwritten. |
| DH-13 | Changed evidence does not silently preserve old conclusions | Assessment dependency fingerprints cover its criterion, mapped objectives, alternative and cited evidence. Recommendation fingerprint covers decision context and analysis. Dependency changes mark retained conclusions stale. Explicit recheck acknowledges renewed assessment; old revision remains available. |
| DH-14 | Optional review and response | Reviews have target, author, comment, open/resolved status; resolved review requires response. Add or resolve through normal record editing/save. Review changes remain in history and exports. Open reviews warn but are not an approval gate. |
| DH-15 | Faithful exports | JSON is the exact saved record; Markdown and escaped HTML show same version, criteria, evidence, unknowns, diagnostic status, recommendation and reviews. Export does not rerun analysis. Output refuses overwrite unless explicitly forced. |
| DH-16 | Reusable template export | Keep question/goals/constraints/adopted criteria, clear case-specific alternatives/evidence/assessments/recommendation/reviews and revision metadata. Can initialize a new research record, never masquerades as verified conclusions. |
| DH-17 | Consistent Agent-facing CLI | Help documents commands/options; JSON responses and structured errors; UTF-8 file/stdin input avoids shell quoting. Exit 0 success, 1 usage/data/storage error, 2 incomplete ready check. Unknown commands/options fail. Reads do not mutate data. |
| DH-18 | Limited and visible checking | Check output explicitly says it validates recorded structure/coverage/staleness, not truth, completeness of human values or research quality. Catalog overlap is advisory. No automatic ranking or hidden model/network calls. |
| DH-19 | Safe local input handling | Record IDs cannot traverse paths; reject symlinked managed record paths; reject prototype keys and excessive input size; source text is inert. HTML escapes untrusted content, has no scripts/remote assets and uses print CSS. |
| DH-20 | Installable release and reproducible checks | npm pack from explicit allowlist, CLI runnable after clean extraction, Node 22/24 CI on Windows/Linux, npm test + traceability/package checks. README examples executed. No research stores, personal transcripts or credentials in package/repository. |

## Record contract

UTF-8 JSON. `schemaVersion: 1`. Unknown properties are errors, so misspelled fields are not silently ignored. Entity IDs match `[a-z][a-z0-9_-]{0,63}`. Arrays are editable; references must remain valid. Use strings in the user's language. Maximum input and serialized snapshot size 5 MiB. All timestamps include a valid calendar date, time and timezone, for example `2026-10-05T09:30:00Z`; date-only input is rejected. Text must be nonblank except assessment uncertainty and unresolved-review response. Validation allows an incomplete draft but not malformed types or broken references.

Top level:

```text
schemaVersion, id, revision, createdAt, updatedAt,
title, prompt, question, mode (criteria|screen), domain,
objectives[], constraints[], assumptions[], criteria[], alternatives[],
evidence[], assessments[], constraintChecks[], recommendation (object|null), reviews[]
```

Entity fields (all fields required unless noted; string lists may be empty):

- objective: `id, text, origin (user|agent)`.
- constraint: `id, text, kind (hard|preference), origin (user|agent)`.
- assumption: `id, text, impact`.
- criterion: `id, title, description, objectiveIds[], question, rationale, status (adopted|rejected), origin (library|user|agent), catalogId? (string), catalogVersion? (string)`. Library-origin entries require both catalog metadata fields.
- alternative: `id, title, description`.
- evidence: `id, title, location, kind (web|local|user|experiment), summary, retrievedAt`. Web locations must be HTTP(S); no tool automatically opens locations.
- assessment: `id, alternativeId, criterionId, status (supported|mixed|concern|unknown), claimType (fact|estimate|judgment), rationale, evidenceIds[], uncertainty, basis?`. `basis` is a tool-managed dependency hash.
- constraint check: `id, alternativeId, constraintId, status (met|violated|unknown), rationale, evidenceIds[], basis?`. Non-unknown requires evidence.
- recommendation: `alternativeIds[], rationale, tradeoffs[], conditions[], nextChecks[], basis?`. Conditions or tradeoffs may be empty but ready checks warn when alternatives have unresolved uncertainty.
- review: `id, target (record|criterion:<id>|assessment:<id>|alternative:<id>|recommendation), author, comment, status (open|resolved), response`.

Catalog document: `version, criteria[]`. Entries: `id, title, description, domains[], objectiveTags[], keywords[], applicability, evidenceQuestions[], example, provenance {kind: editorial, note, references[]}`. Personal catalogs use the same shape. Entries are authored examples informed by cited methods, not standards certified by the source authors.

Brief/template input for `init`: `title, prompt`, optional `question, mode, domain, objectives, constraints, assumptions, criteria`. Defaults: question=prompt, mode=screen, domain=general. No candidate claims are fabricated at initialization.

## CLI contract

Executable: `node <skill>/scripts/cli.mjs ...` or installed `decision-harness ...`. `--store` defaults to `.decision-harness` in the current working directory; documentation always shows an explicit location. IDs are positional where shown. Boolean flags take no values. `--input -` or `--file -` reads stdin.

```text
help
catalog [--query TEXT] [--domain NAME] [--limit N] [--extra FILE]
init --input FILE [--id ID] [--store DIR]
get ID [--revision N] [--store DIR]
save ID --file FILE --expected-revision N --reason TEXT --actor TEXT
     [--recheck ID,ID] [--recheck-recommendation] [--store DIR]
check ID [--stage draft|ready] [--store DIR]
history ID [--store DIR]
diff ID --from N --to N [--store DIR]
export ID --format json|markdown|html|template [--out FILE] [--force] [--store DIR]
```

`init/get/save` return `{record}`; `history` returns revision metadata; `diff` returns changed JSON paths with before/after values. `catalog` returns catalog version and entries with retrieval matches. `check` returns `{ok, stage, diagnostics, limitation}`. A diagnostic has `code, severity (error|warning), path, message`; `ok` means no error. Ready incompleteness is an error for check exit status, not a prohibition on saving drafts. Export writes raw format to stdout without `--out`, otherwise returns the saved path/format/revision as JSON.

Saving: validate incoming document and its ID, compare expected revision, preserve createdAt, increment revision and updatedAt. Actor/reason live in the immutable snapshot envelope with `record`. Do not trust incoming revision/timestamps/basis to overwrite managed history. New or substantively edited assessments get current dependency fingerprints; unchanged assessments preserve prior fingerprints even if context changed. `--recheck` explicitly refreshes listed assessment/constraint-check IDs; unknown IDs fail. Recommendation behaves similarly. Reviews do not change analytical dependency hashes.

Ready criteria mode: nonempty objectives and adopted criteria; every objective covered; no invalid references. Screening additionally needs alternatives, one assessment per adopted criterion per alternative, one constraint check per constraint per alternative, a non-null recommendation and current dependency fingerprints. Unknown is a valid assessment. A recommendation choosing an alternative with unknown evidence must state conditions or next checks. Unresolved reviews, assumptions, suspected overlapping criteria and non-selected hard-constraint violations are warnings. Rejected criteria are not required in comparison coverage. `draft` still reports omissions as warnings and malformed data as errors.

## Implementation organization

All runtime files inside the skill, so copying it is sufficient:

```text
plugin.json, .codex-plugin/plugin.json   distribution manifests
skills/decision-harness/SKILL.md         Agent workflow
skills/decision-harness/assets/catalog.json
skills/decision-harness/references/      record and method guide
skills/decision-harness/scripts/         schema/core/catalog/store/render/CLI
docs/spec.md, docs/traceability.json, docs/verification.md
test/                                  unit and subprocess integration tests
examples/                              explicitly labeled demonstration records
```

Data stays in the user's chosen store, not the plugin installation. Persistence uses per-ID revisions, a lock and atomic publication; no global daemon. Schemas and deterministic logic are separately testable. Changes to a requirement update this spec and traceability in the same commit.

Export refinement observed in first use: criteria-only reports omit empty sections while retaining nonempty content and the full record appendix. Screen reports keep empty sections visible. Templates also discard case-specific assumptions and rejected criteria; users must reconsider applicability in the new case.

## Verification and release gates

1. Write and commit this Spec before executable implementation. Build critical state/error tests before the corresponding code where useful.
2. Test record/reference validation, uncertainty, coverage, hard constraints, optional review, staleness and explicit recheck.
3. Test save/reopen/revise/history/diff, concurrent/stale saves, corrupted records, write failure, Unicode, spaces, path traversal and links.
4. Test every CLI command through child processes, stdout/stderr and exit codes; compare saved revisions to all exports; test hostile HTML data and template reuse.
5. Test packed installation from a clean temporary directory. Check manifests, all skill references and catalog entries. Run Windows/Linux CI at the pushed commit.
6. Independent Agent forward tests: a non-game criteria-only task from a natural-language prompt; a full comparison using actual source materials followed by a changed constraint or counterevidence. Agent gets only the delivered skill, normal user task and source material, not a developer-provided expected answer. Inspect artifacts and claims. Record what was/was not tested.
7. Traceability checker ensures every requirement maps to real files and an executable test or named behavioral evidence. This structural guard is not a substitute for reviewing whether the evidence proves the behavior.
8. A small forward test establishes a working integration, not statistical superiority or novice usability. The proposed multi-condition user study remains future research. No claim of proven decision quality or compatibility with untested hosts.

## Method and packaging sources

- [FWS PrOACT and SDM](https://www.fws.gov/training/category/decision-analysis).
- [FWS lightweight process overview](https://www.fws.gov/course/overview-structured-decision-making).
- [Bond et al. 2008, objective generation](https://www.scheller.gatech.edu/directory/research/marketing/bond/pdf/bond_carlson_keeney-man-sci-2008.pdf).
- [Bond et al. 2010, improving objective generation](https://www.scheller.gatech.edu/directory/research/marketing/bond/pdf/bond-carlson-keeney-da-2010.pdf).
- [UK MCA manual, chapters 5–6](https://assets.publishing.service.gov.uk/media/5a790545e5274a2acd18b975/1132618.pdf).
- [Official plugin packaging](https://developers.openai.com/plugins/build/plugins), checked 2026-10-04.
- [Official skill guidance](https://developers.openai.com/plugins/build/skills), checked 2026-10-04.
