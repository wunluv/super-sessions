---
description: Apply an approved friction audit — install staged drafts under a per-finding contract, test each locally, record what changed, and stop. Installs nothing San has not approved.
argument-hint: "[project-path]"
---

# Friction resolve — the project in the current working directory

## Arguments

**If `$@` contains `--dry-run`, do Step 0b and nothing else** (rehearsal, install nothing).
Otherwise `$@` names the findings San approved, e.g. `1, 2, 3, 9, 10` or `all`.
If `$@` is empty, print the decision list from the report and stop.

Turn an approved audit into installed fixes, one finding at a time, each with a test that proves it works. Then stop. Measurement belongs to `/session-friction-check`, about ten sessions later.

## Step 0 — approved scope

Read the newest `<project>/.memory/project_insights/audit-<date>/report.md` and every file in `drafts/`. If San's message does not say which findings are approved, print the decision list and stop. Do not infer approval from a general "looks good".

Write down the approved set first:

| finding | home | draft file | test I will run | server touch? |
|---|---|---|---|---|

Open each draft before installing it. If one looks wrong now, say so and propose a rewrite instead of installing it. A staged draft is a proposal, not a verdict.

Follow the project's own change gate. If the project requires an issue before a change, or dev-before-prod, that overrides anything here. Never touch production as part of an audit fix.

## Step 0b — dry run (`--dry-run`)

A rehearsal, not a partial install. Produce everything resolve would produce, install nothing, and write nothing outside the audit directory (only `audit-<date>/dry-run.md`).

Run only non-mutating local checks: `bash -n` on shell scripts, `shellcheck` if present, `python3 -m py_compile` on Python, reading the drafts against the current files, checking that a skill or prompt name is not already taken, checking frontmatter validity and trigger phrasing, and counting the AGENTS.md line delta.

**No server commands at all.** If a finding's only test touches a host, mark it `would run: <command>` with what it would leave behind, and stop there.

Output `dry-run.md` with:

1. The contract table for the approved set.
2. Local check results, per draft, with the command and its output.
3. The exact install path every draft would take.
4. The tests that would run at resolve time, with the evidence each should produce.
5. Anything that looks wrong on inspection, with a proposed rewrite.
6. The decision list, so San can approve or reject each item before a real resolve.

## Step 1 — apply in order

Cheapest and most reversible first, so a bad assumption costs least:

1. scripts
2. skills (`.pi/skills/<name>/SKILL.md` + assets)
3. prompt templates (`.pi/prompts/<name>.md`)
4. memory notes (Zone B)
5. always-loaded rules (AGENTS.md)

The always-loaded surface pays for its lines in every future session. Apply those last, and only what the audit justified.

## Step 2 — the contract, per finding

```
Finding:       id, class, one line
Change:        the exact diff or file, as installed
Test:          the falsification test from the draft, run now
Result:        pass | fail | not testable yet
Evidence:      command output, quote, or the turn that shows it working
Blast radius:  surfaces touched, what could regress
Keep/kill:     the re-check trigger, and what result retires it
```

Test rules:

- **Local first.** A test that touches a server, production data, or a live service needs San's explicit approval before it runs. Say what it will do and what it will leave behind.
- **No test artifacts outside the project.** If a test must touch a host, clean up in the same run and show the cleanup. If it cannot be cleaned up, list every file left behind, with the exact command to remove it, and hand the list to San.
- **A failed test is a finding.** Revert, record it, and report. Do not install something that does not work because the draft sounded right.
- **A test that cannot run yet** is `not testable yet`, with the date or condition when it can be.

San's own lesson: a false success is worse than a failure. If a command reports success while producing nothing, say so loudly, as the d5 backup script did when a failed dump reported success.

## Step 3 — install cleanly

- Skills: valid `name` and `description` frontmatter. The description must contain the phrasing San actually types, or the skill will never load. Verify the skill appears after `/reload` and that the project is trusted.
- Prompt templates: frontmatter `description`, optional `argument-hint`. Confirm the name is not already taken.
- AGENTS.md: apply as a patch, net additions within the audit's budget (+15 lines). Deleting stale lines counts against the budget in your favour. If the patch needs more, split the procedure into a skill and keep the rule short.
- Memory: write to Zone B with a description that reads as a subject, and cite the audit date. Facts that drift get a "last verified" date and the command that re-checks them.
- Harness items: append to `~/.pi/org/insights/`, never to a project rule.

## Step 4 — record and report

Append to the audit's memory file (`reference/session-audit/<date>.md`) a `## Applied <YYYY-MM-DD>` section: the contract table from Step 2, what was installed and where, what was skipped and why, and what remains not testable. Update `BASELINE.tsv` if the audit's measurement definitions changed.

Report in plain language, state of play first:

```
## Installed
- <finding> — <file> — <test result>

## Not installed
- <finding> — <reason>

## What I need from you
1. <decision, e.g. a server-touching test, a deletion> — <consequence>
```

Then name the check trigger: roughly ten sessions, or a date.

## Rules

- One finding at a time. Do not batch unrelated installs into one change.
- `--dry-run` is a full rehearsal: no writes outside the audit directory, no installs, and no server commands.
- Nothing outside the approved set. No opportunistic edits while you are in the file.
- Never delete a rule, skill or memory note without listing it for San first.
- Do not re-run the audit. If the findings look wrong, say so and send it back.
- If the audit is stale (more than ~30 sessions old), say so and recommend re-running it before installing anything.
