---
description: Measure a project's friction audit against its baseline, decide keep/rewrite/delete per finding, and prune instruction surfaces that stopped earning their place. Run ~10 sessions after /session-friction-resolve.
argument-hint: "[project-path]"
---

# Friction check — the project in the current working directory

## Arguments

`$@` — optional scope, e.g. a session glob to measure part of the window. Empty is fine.

Close the loop on the last audit: did the fixes change anything, and does the instruction surface still deserve its size?

The fixer must not be the judge. If you wrote the fixes in this session, say so and stop. This runs in a fresh session, ideally a subagent.

## Step 1 — find the baseline

```bash
ls -1 <project>/.memory/project_insights/ | grep '^audit-'
```

Take the newest `audit-<date>/`. Read `report.md` and `BASELINE.tsv`. Note the audit date: sessions after it are the only ones that count.

If there is no baseline file, say so and stop. A check without a baseline is an opinion.

## Step 2 — re-measure, mechanically

Run the numeric pass into a throwaway directory so the standing tables stay intact:

```bash
python3 ~/.pi/agent/extensions/super-sessions/scripts/extract-friction.py \
  ~/.pi/agent/sessions/--<cwd with / → ->-- \
  <project>/.memory/project_insights/audit-check
```

Compute the same metrics the baseline recorded, restricted to sessions dated after the audit. Then, per finding, count recurrences of its specific signature (the `REPEAT-SIGNATURES.tsv` row, the `search_before_read` flag, the artifact).

| metric | baseline | now | delta | verdict |
|---|---|---|---|---|

| finding | baseline recurrences | now | fix evidence | verdict |
|---|---|---|---|---|

Verdicts, no other options:

| observation | verdict |
|---|---|
| fired, cost fell | keep |
| fired, cost flat | keep, rewrite the falsification test |
| never fired, pattern still occurs | rewrite: wrong home or wrong trigger phrasing |
| never fired, pattern gone | delete |
| cannot be measured from the record | mark unknown; do not guess |

## Step 3 — did each artifact fire?

For every artifact installed by the resolve step, look for evidence it was used since the audit:

| artifact | how to see it fire |
|---|---|
| AGENTS.md line | the flagged behaviour is absent in sessions dated after the audit |
| skill | the skill file was read, or the procedure ran without rediscovery |
| prompt template | it was invoked (`/name` in a session) |
| memory note | sessions after the audit stopped re-deriving the fact |
| script | it was executed |

A skill that was never read and never invoked is dead weight, regardless of how good it looks. Pi shows the agent only the name and description, so an unread skill usually means the description does not carry the trigger phrasing San actually uses. That is a rewrite, not a delete.

## Step 4 — prune

Read `AGENTS.md`, `.pi/skills/*/SKILL.md`, `.pi/prompts/*.md`, and the rules added by the last two audits:

- Rules that never came up in the measured window: propose deletion.
- Overlapping skills or prompts: propose a merge, and say which description survives.
- Descriptions that do not contain the trigger phrasing: rewrite the description.
- Net always-loaded growth across two consecutive cycles: prune before adding anything.

Prefer deletions. Report every proposed deletion with the line and the reason, and let San approve it.

## Step 5 — report

Short, plain language, state of play first.

```
## What changed
- <finding> — <metric> <baseline> → <now> — <verdict>

## What died
- <artifact> — never fired in N sessions — delete?

## What I need from you
1. <decision> — <consequence> (recommendation: …)
```

Then append the result to the audit's memory file (`memory_write("reference/session-audit/<date>.md", …)` with a `## Check <YYYY-MM-DD>` section: metrics, verdicts, deletions proposed). Delete the throwaway `audit-check/` directory.

## Rules

- Unmeasurable is a valid, honest result. Say unknown.
- The numbers decide, not the story attached to the fix.
- One check per resolve cycle. Do not stack checks.
- If nothing fires and nothing dies, say that plainly. A null result means the audit over-reached, and that is worth knowing.
