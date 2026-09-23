---
description: Audit this project's past sessions for friction — where the agent wasted turns rediscovering what it already had, and which recurring tasks deserve a skill, prompt template, memory note or AGENTS.md line. Produces a ranked report plus staged drafts; installs nothing without approval.
argument-hint: "[project-path]"
---

# Session friction audit — the project in the current working directory

## Arguments

`$@` — optional scope for this audit (e.g. `--sessions 2026-09-*`). Empty is fine.

Audit the session record and answer two questions with evidence:

1. **Where did effort burn because context was thin?** tools, instructions (AGENTS.md), skills, prompt templates or memory that lacked clarity, placement, or existence.
2. **Which task intents recur often enough to promote** into a skill, prompt template, memory note, script or rule, so the next occurrence starts informed.

Work as an auditor. Report, rank, stage drafts. Install nothing until San approves.

## Evidence rules

- Every finding cites a session id and a tool-call index or quoted turn.
- Corrections and repeats outrank everything. They name the missing context verbatim.
- A pattern needs ≥2 sessions. One hard-rule violation is enough.
- Silence is not cleanliness: an empty table means the detector was blind, not that the session was frictionless.
- Where the numeric layer and the conversation layer disagree, the numbers win.

## Step 0 — inputs

Prerequisites, all under `<project>/.memory/project_insights/`:

| input | from | if missing |
|---|---|---|
| `sessions/*.md` + `index.md` | `/super_sessions` | run it |
| `audit/*.tsv` (numeric tables) | `/super-sessions-friction` | run it |
| `analyses/friction/*.md` | same command, cheap model | run it |
| `wisdom/friction.md` | `super_sessions_synthesize(topic:"friction")` | optional; run if you want the cross-session view in one file |

If the command is unavailable, the numeric pass is `python3 ~/.pi/agent/extensions/super-sessions/scripts/extract-friction.py <session_jsonl_dir> <project>/.memory/project_insights/audit`. Session JSONL lives at `~/.pi/agent/sessions/--<cwd with / → ->--` (leading `/` dropped: `/home/x/y` → `--home-x-y--`). Fallback: match `"cwd"` in the first line of each `*.jsonl`.

Then read what already exists before proposing anything: `AGENTS.md`, `.memory/reference/index.md`, `.pi/skills/`, `.pi/prompts/`, `.pi/agents/`, plus the global `~/.pi/agent/skills/` and `~/.pi/agent/prompts/`. Most proposals already exist in weaker form, and the honest fix is then a sharper description or a pointer.

Use only these two sources. Do not read transcripts except to confirm one specific finding.

| source | what it covers | cost |
|---|---|---|
| `audit/*.tsv` | what the agent did: tool calls, errors, path-hunting, rebuilt procedures, cost per occurrence | free, already computed |
| `analyses/friction/*.md`, `wisdom/friction.md` | what was said: facts re-asked, rules skipped, format corrections, wrong questions, abandoned threads | paid, already computed |

## Step 1 — read the numbers

| file | columns | read it for |
|---|---|---|
| `INDEX.tsv` | session, user_turns, tool_calls, errors, handed_paths, search_before_read, model | sessions worth a second look |
| `REPEAT-SIGNATURES.tsv` | signature, sessions, calls | procedures rebuilt in ≥3 sessions (skill candidates) |
| `RECURRING-ARTIFACTS.tsv` | artifact, calls | the project's working vocabulary |
| `HANDED-PATH-WASTE.tsv` | session, handed, first_tool, call | F1 candidates (heuristic; dismiss the false positives) |
| `<session>.tsv`, `<session>.users.md` | tool calls, San's turns | confirming one flag, cheaply |

Record the headline numbers. They become the baseline the check step compares against.

## Step 2 — cluster into findings

Confirm each candidate against the actual turn before it becomes a finding. Classes:

| id | class | evidence test | usual home |
|---|---|---|---|
| F1 | handed-path hunting | a supplied path, followed by search before read | AGENTS.md line, or a harness fix |
| F2 | procedure rediscovery | same signature ≥3 sessions, rebuilt each time | skill + script asset |
| F3 | fact re-derived | same question, query or SQL in ≥2 sessions | Zone B `reference/` |
| F4 | rule not honoured | rule exists, agent broke it or asked anyway | top of AGENTS.md |
| F5 | output-shape drift | format, tone or length restated | prompt template |
| F6 | friction by question | agent asked what it could have read, or asked twice | standing authorisation + memory note |
| F7 | tool misfit | repeated manual workaround, no tool behind it | harness ledger |
| F8 | human-side friction | San repeated, corrected twice, did it himself, dropped a thread | highest signal; the correction names the gap |

Then one row per recurring intent:

| pattern | trigger phrasing San uses | sessions | cost/occurrence | exists today as | proposed home |
|---|---|---|---|---|---|

Trigger phrasing matters: it becomes the skill or prompt `description`, which is the only thing pi shows the agent before it decides to load the thing.

## Step 3 — route and budget

| shape of the fix | home | reaches the agent as |
|---|---|---|
| behaviour that must hold every session, ≤5 lines | `<project>/AGENTS.md` | always in context |
| multi-step procedure with fixed commands | `.pi/skills/<name>/SKILL.md` (+ `scripts/`) | name + description in context, body on load |
| recurring intent with a fixed output shape | `.pi/prompts/<name>.md` | `/name` |
| fact, query, gotcha, decision | Zone B memory `reference/...` | `memory_tree` / `memory_read` |
| deterministic step | script in `tools/` or a skill asset | executed, not reasoned about |
| harness limitation | `~/.pi/org/insights/` ledger | read when planning |

Promotion test: frequency × cost saved exceeds maintenance. Two bans: nothing for a one-off; nothing that duplicates an existing skill or prompt.

Budget for this cycle: **at most +15 lines of always-loaded context and at most one new skill.** Anything longer is a skill wearing a rule's clothing. Edits that delete text are preferred over edits that add it.

## Step 4 — stage the drafts

Write to `<project>/.memory/project_insights/audit-<YYYY-MM-DD>/`: `report.md`, `BASELINE.tsv`, and `drafts/` with the same names the files will have in place (`AGENTS.md.patch`, `skills/<name>/SKILL.md`, `prompts/<name>.md`, `memory/reference/<slug>.md`).

`BASELINE.tsv`: one `metric<TAB>value<TAB>session_count<TAB>date` row per number from Step 1, plus a recurrence count per finding. The check step reads this file.

Every draft carries, in this shape:

```
Finding:        id, class, one line
Evidence:       session id + tool-call index, or quoted turn
Cost:           turns or tool calls per occurrence x occurrences
Home:           AGENTS.md | skill | prompt template | memory | script | harness ledger
Exact change:   the diff
Falsification:  the cheapest test that proves it works, named before applying
Blast radius:   surfaces touched, what could regress
Keep/kill:      the re-check trigger, and what result retires it
```

Counterfactual check before staging anything: **would this have changed the flagged turn?** If not, the draft is wrong or unnecessary. Verify it will load: project skills at `.pi/skills/<name>/SKILL.md` with valid `name`/`description`; prompt templates at `.pi/prompts/<name>.md`; subagents at `.pi/agents/<name>.md`.

## Step 5 — report, then ask

Plain language. State of play first, what something IS before how it works, no jargon. Ten findings maximum, ranked by frequency × cost, one short paragraph each: what happened, where, what it cost, what would prevent it. Include what is **not** a problem, so a clean month does not read as alarm.

```
## What I need from you
1. <decision> — <consequence> (recommendation: …)
```

Write the audit to memory: `memory_write("reference/session-audit/<YYYY-MM-DD>.md", …)` with the findings, the baseline, and what was staged versus installed. Then hand off to `/session-friction-resolve`. Measurement belongs to `/session-friction-check`, about ten sessions later.

## Guardrails

- **Frugal.** Tables and analyses first. Transcripts only to confirm a flag. Subagents for breadth, never twenty sessions pasted into context.
- **Falsification tests stay local.** Anything that touches a server, production data, or a live service needs San's explicit approval first. No test artifacts inside the project or on any host; if a test must touch a host, clean up in the same run and show the cleanup.
- **No writes outside Zone B** and the drafts directory. Never edit `AGENTS.md`, skills, prompts or prod on your own initiative.
- **No invented behaviour.** If you cannot quote it, do not claim it.
- **Harness issues** get one line in the `~/.pi/org/insights/` ledger and move on. Do not spend the audit fixing the harness, and do not route a harness limitation into a project rule.
- If the record is thin (under ~5 sessions), say so and stop. A pattern cannot be established yet.
