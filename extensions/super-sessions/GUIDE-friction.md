# GUIDE — friction audit

Operator manual. Everything needed to run a full audit on any project, start to finish.
Spec: `SPEC-friction.md` — start with its **Map** section for the whole system on one page. Prompt templates live in `pi-prompts/`.

## What it is

Two detectors over a project's session history. The numeric pass measures what the agent *did* (tool calls, errors, rediscovery). The conversation pass reads what was *said* (corrections, restated rules, re-asked facts). The audit turns both into findings, ranks them, and stages fixes for approval. Nothing is installed without San's sign-off.

## Prerequisites

- Project directory with a `.memory/` root (Zone B). Sessions bind to the project by cwd.
- One prior `/super_sessions` run, or accept that step 2 runs it.
- Project trusted by pi (project-local skills, prompts and agents load only then).

## Command reference

| command | does | cost | safe to re-run |
|---|---|---|---|
| `/super_sessions` | exports every session to `sessions/*.md` + `html/` + `index.md` | free | yes, rewrites |
| `/super-sessions-tag` | adds frontmatter (`project_relevant`, `topics`, `summary`) | cheap model per untagged session | yes, skips tagged; `--force` retags |
| `/super-sessions-friction` | export → numeric tables → friction analyses, then reports counts | free + cheap model | yes, idempotent (skips analyzed sessions) |
| `super_sessions_analyze` | same analysis step, agent-callable, any topic, `focusPrompt` supported | cheap model per session | yes |
| `super_sessions_synthesize` | reads `analyses/<topic>/*.md`, writes `wisdom/<topic>.md` | SOTA model, one call | yes, overwrites |
| `/session-friction-audit` | findings, pattern catalog, staged drafts, plain-language report | main session, expensive | yes, rewrites the day's audit dir |
| `/session-friction-resolve` | applies approved findings under a per-finding contract, records baseline; `--dry-run` rehearses and writes `dry-run.md` only | main session, approval-gated | yes, idempotent per finding id |
| `/session-friction-check` | re-measures, compares to baseline, keep/kill/demote | cheap | yes |
| `/super-sessions-friction` | export → numeric tables → tag untagged → friction analyses, then reports counts | free + cheap model | yes, idempotent (skips analyzed sessions) |
| `extract-friction.py` | the numeric pass alone (`extract-friction.py <session_dir> [out_dir]`) | free | yes |
| `/server-access` | prints this session's server-access mode (operator, locked, delegated) | free | yes |

## Full audit, step by step

```bash
# 0. bind the project
cd ~/DEV/<project> && /startwork <project>          # memory root = <project>/.memory/

# 1. export + numeric + conversation pass in one command
/super-sessions-friction
#    --numeric-only  skip the LLM pass and the tagging
#    --sessions <glob>  limit the analysis, e.g. 2026-09-*
#    --no-tag  skip tagging (untagged sessions are then filtered out)

# 2. read the numbers before any transcript
cat .memory/project_insights/audit/INDEX.tsv
cat .memory/project_insights/audit/REPEAT-SIGNATURES.tsv
cat .memory/project_insights/audit/RECURRING-ARTIFACTS.tsv
cat .memory/project_insights/audit/HANDED-PATH-WASTE.tsv

# 3. findings, routing, staged drafts
/session-friction-audit

# 4. approve, then apply
/session-friction-resolve

# 5. ten or more sessions later
/session-friction-check
```

Numeric output lands in `.memory/project_insights/audit/`. Analyses in `.memory/project_insights/analyses/friction/`. Synthesis in `.memory/project_insights/wisdom/friction.md`. Audit report and drafts in `.memory/project_insights/audit-<YYYY-MM-DD>/`.

## Reading the numeric tables

| file | columns | how to act |
|---|---|---|
| `INDEX.tsv` | session, user_turns, tool_calls, errors, handed_paths, handed_searched, handed_unused, model | high `errors`, or a non-zero `handed_searched`, marks the sessions worth a second look |
| `REPEAT-SIGNATURES.tsv` | signature, sessions, calls | ≥3 sessions = skill candidate; the signature names the procedure |
| `RECURRING-ARTIFACTS.tsv` | artifact, calls | the project's real vocabulary; files here belong in a skill's context or AGENTS.md routing |
| `HANDED-PATH-WASTE.tsv` | session, turn, handed, basename | a search for a supplied path before any read; dismiss false positives by eye |
| `<session>.tsv` | i, tool, detail | the per-session tool-call list, for confirming one flag |
| `<session>.users.md` | San's turns only | the cheapest read of intent, especially before corrections |

## Cadence

- After ~20 new sessions, or monthly, whichever comes first.
- One resolve cycle per audit. Do not stack audits; an unverified audit is a list of opinions.
- Check at ~10 sessions after resolve, then fold the check into the next audit.

## Budget

Per cycle: **+15 lines of always-loaded context maximum, one new skill maximum.** Prefer edits that delete text. Anything added must recur in the next audit or be reverted. Always-loaded context must not grow across two consecutive cycles.

## Keep / kill

| observation at check time | action |
|---|---|
| fix fired, cost fell | keep |
| fix fired, cost flat | keep, rewrite the falsification test |
| fix never fired, pattern still occurs | rewrite: wrong home or wrong trigger phrasing |
| fix never fired, pattern gone | delete |
| always-loaded context grew two cycles running | prune before adding |

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `No sessions directory found` | export never ran | `/super_sessions` first |
| analyses all skipped | fresh project, or topic mismatch filter | check `analyses/friction/` for files; drop the `topics` filter |
| analyses skipped as not relevant | the sessions were never tagged, and tagging was skipped | rerun without `--no-tag`; the command tags untagged sessions itself |
| analysis fails with empty content | a reasoning model spent its output budget on thinking | fixed 2026-09-21: the request now asks for 16k output tokens and reports `finish_reason` on failure |
| numeric tables empty | wrong session dir; the project cwd changed since those sessions | the prompt's fallback matches the `cwd` field in the JSONL header; verify `SDIR` |
| one session missing from analyses | session skipped as not `project_relevant`, or an empty body | inspect its frontmatter, retag with `--force` |
| analysis truncates long sessions | `_full.md` and body truncation limits | numeric tables still cover it; for detail read the raw JSONL |
| the cheap model reports no friction anywhere | expected in short or clean sessions | trust the numeric layer; where layers disagree, numbers win |
| handed-path table noisy | regex plus filename-token heuristic | treat as candidates; confirm in `<session>.tsv` |
| a delegated agent is blocked from a host | intended | `server-guard.ts`: subagents carry `PI_DELEGATED=1`. Have the agent hand the command back to the operator |
| tokens burning in the audit | reading transcripts instead of tables | re-read the audit prompt: tables first, flagged turns only, subagents for breadth |

## Files

```
~/.pi/agent/extensions/super-sessions/
  SPEC-friction.md             this design
  GUIDE-friction.md            this manual
  prompts/analyze-friction.md  extraction template
  scripts/extract-friction.py  numeric pass
~/.pi/agent/prompts/
  session-friction-audit.md    findings + staging
  session-friction-resolve.md  apply + baseline
  session-friction-check.md    measure + prune
<project>/.memory/project_insights/
  sessions/  html/  index.md            (super_sessions)
  analyses/friction/*.md                (cheap model)
  wisdom/friction.md                    (SOTA synthesis)
  audit/ INDEX.tsv REPEAT-SIGNATURES.tsv RECURRING-ARTIFACTS.tsv HANDED-PATH-WASTE.tsv <session>.tsv
  audit-<date>/ report.md BASELINE.tsv drafts/
```
