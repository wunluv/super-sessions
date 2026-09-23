# SPEC — friction audit

Status: built and tested to the resolve boundary · 2026-09-21/22 · owner: San, built by Alph

## Map (start here)

```
              ~/.pi/agent/sessions/--<project>--/*.jsonl      raw history, authoritative
                              │
        ┌─────────────────────┴──────────────────────┐
        │ conversation layer                          │ machine layer
        │ /super_sessions            (free)           │ extract-friction.py   (free)
        ▼                                             ▼
  sessions/*.md  index.md  html/                audit/*.tsv   (5 tables)
        │                                             │
        │ /super-sessions-friction = export → numbers → tag untagged → analyse   (cheap model)
        ▼
  analyses/friction/*.md ──super_sessions_synthesize──▶ wisdom/friction.md   (SOTA model)
        │                                                        │
        └────────────────────────┬───────────────────────────────┘
                                 ▼
                    /session-friction-audit          judgement, main session
                                 │  findings · ranking · routing · budget
                                 ▼
              audit-<date>/{report.md, BASELINE.tsv, drafts/, dry-run.md}
                                 │
                    San approves │ finding set
                                 ▼
                    /session-friction-resolve          apply · test · record
                        (--dry-run = rehearsal, installs nothing)
                                 │
                  ~10 sessions   ▼
                    /session-friction-check            re-measure · keep/kill/demote
                                 │
                                 ▼
        project instruction surface: AGENTS.md · .pi/skills/ · .pi/prompts/ · .memory/
```

**Components and who owns them**

| layer | artifact | owned by | role |
|---|---|---|---|
| mechanics | `scripts/extract-friction.py`, `analysis.ts`, `index.ts`, `paths.ts` | extension (TypeScript) | deterministic work: parse, count, call a model, write files |
| judgement | `pi-prompts/session-friction-{audit,resolve,check}.md` | prompt templates | reasoning, routing, approval flow, budgets |
| extraction template | `prompts/analyze-friction.md` | extension | the F1-F8 taxonomy the cheap model reads |
| access | `~/.pi/agent/extensions/server-guard.ts` | sibling extension | blocks delegated sessions from hosts |
| facts | `<project>/.memory/` | Zone B memory | what the project learned |

**Gates, and who passes them**

| gate | who decides | what it blocks |
|---|---|---|
| finding set | San | anything being installed at all |
| per-test approval | San | any test that touches a host or prod data |
| project trust (`/trust`) | San | project-local `.pi/skills/` and `.pi/prompts/` loading |
| project change gate | the project's own rules | repo/prod edits (d5: issue first) |
| deletion of a rule, skill or note | San | pruning |
| `--dry-run` | anyone | nothing; it is the rehearsal |

**Two layers, one reason.** No single detector sees all friction. `super_sessions_analyze` reads the clean `.md`, which by construction excludes `*_full.md` and therefore every tool call. F1 path-hunting and F2 rebuilt procedures are invisible there; the numeric pass is blind to what was said. Where the two disagree, the numbers win.

## Purpose

Give each project an instruction surface (AGENTS.md, skills, prompt templates, memory) that is derived from measured friction in its own session history and pruned when it stops earning its place, so recurring work starts informed instead of rediscovered.

## Problem

1. Instructions and skills are written on guesswork, then frozen. Nobody knows which lines ever mattered.
2. Recurring work (translation-gap queries, prod DB reads, deploy verification) is rediscovered session by session, paying the same discovery cost repeatedly.
3. Agent self-improvement is unmeasured: rules get added, never removed. Always-loaded context inflates, real rules lose attention.

## Two layers, two detectors

Friction shows up in the conversation and in the machine. Neither detector sees both.

| layer | source | detector | sees | blind to |
|---|---|---|---|---|
| conversation | `sessions/*.md` (clean, no tool calls) | `super_sessions_analyze`, cheap model | facts re-asked, rules restated, corrections, wrong questions, abandoned threads | every tool call |
| machine | raw session JSONL | `scripts/extract-friction.py`, free | path-hunting, rebuilt procedures, error counts, cost per occurrence | what was meant |

## Scope

**In:** super_sessions gains a friction topic (prompt template + routing), a mechanical extractor, and one command. Three prompt templates drive audit, resolve, check. Findings land in `<project>/.memory/project_insights/`.

**Out:** no auto-edit of AGENTS.md, skills or memory. No new memory write paths. No harness hooks. No cross-project dashboard. No changes to existing engineering/meaning/ideas behaviour.

## Deliverables

| file | what | where | cost |
|---|---|---|---|
| `prompts/analyze-friction.md` | extraction template: F-classes, evidence rules, silence rule | extension | per session, cheap model |
| `analysis.ts` | routing line: `friction` → that template | extension | none |
| `scripts/extract-friction.py` | numeric signals → 5 tables | extension | free |
| `index.ts` | `/super-sessions-friction` command: export → script → analyze | extension | free + cheap model |
| `SPEC-friction.md`, `GUIDE-friction.md` | this spec, operator manual | extension | none |
| `pi-prompts/session-friction-audit.md` | findings, ranking, routing, staged drafts, report | extension, loaded via settings `prompts` | main session |
| `pi-prompts/session-friction-resolve.md` | per-finding contract, apply, approval gate, `--dry-run` rehearsal | extension | main session |
| `pi-prompts/session-friction-check.md` | re-measure, keep/kill/demote | extension | cheap |
| `server-guard.ts` (sibling extension) | blocks ssh/scp/rsync for delegated sessions | `~/.pi/agent/extensions/` | free |

The extension is unversioned today. Build step 0: `git init` and a first commit, so this work is diffable.

## Friction classes

| id | class | detector | failure layer | usual home |
|---|---|---|---|---|
| F1 | handed-path hunting | numeric: search before read of a supplied path | agent behaviour + instruction salience | AGENTS.md line, or a harness hook |
| F2 | procedure rediscovery | numeric: same command signature in ≥3 sessions | missing capability | skill + script asset |
| F3 | fact re-derived | conversation + numeric: same question or SQL ≥2 sessions | memory gap | Zone B `reference/` |
| F4 | rule violated | conversation: rule exists, agent broke it | placement in a long document | top of AGENTS.md |
| F5 | output-shape drift | conversation: format or tone restated | missing template | prompt template |
| F6 | friction by question | conversation: agent asked what it could read | missing standing authorisation | AGENTS.md + memory |
| F7 | tool misfit | both: manual dance with no tool behind it | harness | ledger, not prose |
| F8 | human-side friction | conversation: San repeats, corrects twice, does it manually, abandons | any | highest-signal; the correction names the missing context |

Coverage rule: F1–F2 require the numeric pass, F3–F6 and F8 require the conversation pass, F7 requires both. An audit that ran only one detector must say so.

## Pipeline

| step | command | produces | cost | cadence |
|---|---|---|---|---|
| 1 | `/super_sessions` | `sessions/*.md`, `index.md` | free | when sessions are new |
| 2 | `/super-sessions-friction` | numeric tables + `analyses/friction/*.md` (tags untagged sessions first) | free + cheap model, idempotent | monthly, or after ~20 sessions |
| 3 | `super_sessions_synthesize(topic:"friction")` | `wisdom/friction.md` | SOTA model, one call | same run |
| 4 | `/session-friction-audit` | findings, pattern catalog, staged drafts, report | main session | same run |
| 5 | `/session-friction-resolve` | installed fixes + baseline recorded | main session, approval-gated | after San approves |
| 6 | `/session-friction-check` | delta vs baseline, keep/kill per finding | cheap | ~10 sessions later, then each cycle |

Steps 1–3 are extension-owned. Steps 4–6 are judgment and stay in prompt templates.

## Decisions log

| date | decision | why |
|---|---|---|
| 2026-09-21 | reasoning models get a 16k output budget (ceiling 32k), and empty content throws with `finish_reason` and prompt size | `deepseek-v4-flash` spent a 4096-token budget on thinking and returned empty content; the old code silently reported "Empty response from LLM" with no note file |
| 2026-09-21 | the friction command tags untagged sessions before analyzing | analysis filters on `project_relevant`, so a freshly exported project silently analyzes nothing |
| 2026-09-21 | selection + loop logic moved to `analyzeTopic()` in `analysis.ts`; path helpers moved to `paths.ts` | the command and the tool need identical behaviour; two copies would drift |
| 2026-09-21 | numeric pass stays a Python script called by the command | the detectors are regex and counters; Python iterates faster than TypeScript here and the script is separately testable |
| 2026-09-21 | `tagging.ts` keeps its local path copies | untouched by this work; consolidating it is a separate cleanup |
| 2026-09-21 | `REPEAT-SIGNATURES.sessions` counts distinct sessions, not calls | the first version incremented per call, so both columns were identical. Caught by the first d5 audit as its finding #10 |
| 2026-09-21 | the audit extends to `synthesis.ts`: 32k output budget | same reasoning-model failure as analysis; `deepseek-v4-pro` returned empty content on an 8192 budget |
| 2026-09-21 | falsification tests stay local; server-touching tests need explicit approval | the first d5 audit, run unsupervised, tested a prod backup script and left 5 files in `/var/www/private/backups/` |
| 2026-09-21 | resolve and check prompts written | `session-friction-resolve.md`, `session-friction-check.md` |
| 2026-09-21 | the three prompt templates live in the extension repo, loaded through settings `prompts` | they change with the code they depend on, and `~/.pi/agent/prompts/` was unversioned |
| 2026-09-21 | hard rule: delegated agents get no server access, enforced by `server-guard.ts` | an unsupervised audit tested a prod backup script; pi has no sandbox, so prose is not enforcement. The subagent extension now sets `PI_DELEGATED=1` for every child |
| 2026-09-21 | the handed-path detector works per turn and matches by filename tokens | the first version only read the first user turn (blind on 41 of 50 sessions) and missed a glob search for the handed file |
| 2026-09-21 | `--dry-run` in resolve produces the contract table and local lint only | San asked to see what resolve would do before it installs anything |

## Data contracts

**`BASELINE.tsv`** (written by the audit, read by check): `metric<TAB>value<TAB>session_count<TAB>date`
Metrics: `sessions`, `tool_calls`, `errors`, `handed_path_sessions`, `search_before_read_sessions`, per-F-class recurrence counts.

**`analyses/friction/<session>.md`**: one file per session, cheap model, same shape as other topics. Observations carry Context / Observation / Evidence / Significance. Must be allowed to return "no friction observed".

**`audit-<YYYY-MM-DD>/`**: `report.md`, `BASELINE.tsv`, `drafts/` (`AGENTS.md.patch`, `skills/<name>/SKILL.md`, `prompts/<name>.md`, `memory/reference/<slug>.md`).

**Per-finding contract** (in the report and in resolve):

```
Finding:        id, class, one line
Evidence:       session id + tool-call index, or quoted turn
Cost:           turns/tool calls per occurrence x occurrences
Home:           AGENTS.md | skill | prompt template | memory | script | harness ledger
Exact change:   the diff
Falsification:  the cheapest test that proves it works, named before applying
Blast radius:   surfaces touched, what could regress
Keep/kill:      re-check trigger, and what result retires it
```

## Promotion rules

Routing: behaviour that must hold every session, ≤5 lines → AGENTS.md. Multi-step procedure → `.pi/skills/<name>/SKILL.md`. Recurring intent with a fixed output shape → `.pi/prompts/<name>.md`. Fact, query, gotcha → Zone B memory. Deterministic step → script. Harness limitation → `~/.pi/org/insights/` ledger, never a project rule.

Promotion test: frequency x cost saved exceeds the maintenance cost. Two bans: nothing for a one-off; nothing that duplicates an existing skill or prompt (sharpen it instead).

Budget per cycle: **+15 lines of always-loaded context maximum, and at most one new skill.** Additions must recur in the next audit or be reverted. Edits that remove text are preferred over edits that add it.

## Evidence rules

- Every finding cites a session and a turn or tool-call index.
- Corrections and repeats outrank everything. They name the missing context verbatim.
- A pattern needs ≥2 sessions. One hard-rule violation is enough.
- Silence is not cleanliness: an empty occurrence table means the detector was blind, not that the session was frictionless.
- The numeric pass is immune to agreeableness. Where the two layers disagree, the numbers win.

## Success criteria

Measured on the same project, 10+ sessions after resolve, against `BASELINE.tsv`:

1. `search_before_read_sessions` falls. Target: zero where a path was supplied.
2. `errors` per session falls or holds, with no rise in user turns.
3. Tool calls per session fall on the recurring patterns that received a skill.
4. Every installed fix either fires or is retired at the check step. No unmeasured survivors.
5. Net always-loaded context does not grow across two consecutive cycles.

## Non-goals

Proving the agent's judgment improved. Fixing the harness from inside a project audit. Ranking projects against each other. Replacing `/super_sessions` for knowledge extraction.

## Open questions

1. **Does pi's editor `@file` reference attach content, or only leave the token?** The d5 record shows a bare token and no attachment block. If it attaches, F1 is an AGENTS.md line. If not, F1 is a harness item and possibly a `tool_call` hook. Test: reference a file in a fresh session and ask what is in it. Blocks the F1 decision, not the build.
2. Cheap-model reliability on "absence of friction" judgments. Mitigation: the numeric layer, plus a template instruction to return nothing rather than invent.
3. Whether `/super-sessions-friction` should also run tag first when frontmatter is missing. Default: yes, skip tagged sessions.

## Build order

| step | build | test |
|---|---|---|
| 0 | `git init` + commit the extension as-is | `git log` |
| 1 | `scripts/extract-friction.py` | run on d5: 49 sessions, 9 handed-path flags, San's Norwegian session flagged |
| 2 | `prompts/analyze-friction.md` + routing line | one session through the analyze path |
| 3 | `/super-sessions-friction` command | full run on d5, `analyses/friction/*.md` written |
| 4 | rewrite `session-friction-audit.md` to delegate | dry-read for coherence |
| 5 | `session-friction-resolve.md`, `session-friction-check.md` | written against real d5 findings |
| 6 | first full cycle on d5 | report + staged drafts for San |
