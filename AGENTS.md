# AGENTS.md — super-sessions

## Workflow

### Two tiers

**Tier 1: Conversational fix** — bugs, typos, small tweaks. The human mentions it in conversation, you fix it, commit, push. No issue needed. The commit message IS the record. Do not over-ceremony small things.

**Tier 2: Issue-driven work** — features, refactors, anything spanning multiple turns or needing design discussion. Create a GitHub issue first. Build from the issue. Close when done. If a Tier 1 fix escalates into a 200-line refactor, promote it: create the issue retroactively and explain why.

### Who does what

- **The human** says what they want or what's broken. Same as conversation. They do not open GitHub.
- **You (the agent)** create issues, fix bugs, commit, push, close. The human's job is to describe the desired outcome. Yours is everything else.

### Issue format

Minimal, structured:

```
Title: specific and searchable

What: one sentence
Why: one sentence (skip if obvious)
Context: link to conversation or session where this came from
Done when: 1-3 acceptance criteria
```

No templates with twelve sections. The issue exists so you can scan a list later and understand what happened — not to satisfy process fetish.

### Labels

| Label | Use |
|-------|-----|
| `bug` | Something's broken |
| `enhancement` | New feature or improvement |
| `docs` | Documentation, README, comments |
| `question` | Needs discussion before action |
| `wontfix` | Decided not to do — keep the record |

No priority labels, no sizing labels, no `good first issue`. Solo project. Everything is "when the human says so."

## Commit conventions

- **Present tense, imperative mood:** `fix: toggle buttons use pointer-events on iOS Safari` not `Fixed the toggle issue`
- **Prefix with type:** `fix:`, `feat:`, `docs:`, `refactor:`, `chore:`
- **Be specific:** The commit message should make sense six months from now
- **One thing per commit:** If you catch yourself writing "and" in the message, split it

## Branch conventions

- **Tier 1 fixes:** direct to `main`
- **Tier 2 features:** branch from `main`, name `iss-{number}-short-description`, open a PR if the human might want to review
- **No branch protection rules** — the human trusts you. Don't abuse it.

## Session hygiene

At the end of every session:

1. **Commit everything.** No uncommitted work. If it's in progress, commit with `wip:` prefix.
2. **Push.** The remote is the source of truth.
3. **Close any issues you completed.** Link the closing commit.
4. **Create issues for anything unresolved.** Decisions made, questions raised, partial work — capture it before context evaporates.
5. **Suggest `/remember`** for significant decisions or observations worth persisting beyond GitHub.

## Project context

- **Repo:** https://github.com/wunluv/super-sessions
- **Spec:** `spec.md` in repo root — the full technical design
- **Extension source:** `extensions/super-sessions/`
- **Pi auto-discovery:** `~/.pi/agent/extensions/super-sessions/` (copy from source for local dev, use `./dev.sh`)
- **Human:** San Naidoo, CEO Khanyi Corporation. Solo operator. Caps deep work at 30hrs/week. Designs/architects, agent executes.
