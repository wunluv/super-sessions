# Changelog

All notable changes to super_sessions will be documented in this file.

## [Unreleased] — 2026-09-22

### Added
- **Friction audit layer** (#12) — a `friction` analysis topic, a free numeric pass over tool calls
  (`scripts/extract-friction.py`), and `/super-sessions-friction` to run export → numbers → tag →
  analyses in one command. Design: `SPEC-friction.md`; operator manual: `GUIDE-friction.md`.
- **`pi-prompts/`** — three workflow prompts: `session-friction-audit`, `session-friction-resolve`
  (with `--dry-run`), `session-friction-check`. Loaded through the `prompts` setting, so they version
  with the extension.
- **`paths.ts`** — one definition of the insights tree, replacing three copies.
- **`analyzeTopic()`** — the analyze loop shared by the tool and the new command.

### Fixed
- **Reasoning models returned empty content** — `analysis.ts` and `synthesis.ts` asked for 4096 and
  8192 output tokens, which the model spent on thinking, so long sessions silently produced
  "Empty response from LLM" with no note file. Budgets are now 16k/32k and an empty response throws
  with `finish_reason` and prompt size. This was breaking `super_sessions_analyze` in the field.
- **Untagged sessions were filtered out of analysis with no error** — the friction command tags
  untagged sessions before analysing.
- **`REPEAT-SIGNATURES.tsv` counted calls in its `sessions` column** — both columns were identical,
  so the "≥2 sessions" test was really "≥2 calls".
- **The handed-path detector read only the first user turn** — blind on 41 of 50 sessions, and it
  missed a glob search for the handed file. It now works per turn with filename-token matching.

### Changed
- **`dev.sh` maintains a symlink instead of copying.** The copy-based layout diverged from the source
  twice; the script only copied `*.ts` and `prompts/*.md`, so running it would have overwritten edited
  sources with older ones and dropped `paths.ts`, `scripts/`, `pi-prompts/` and the docs.

## [0.1.0] — 2026-06-24

### Added
- **`/super_sessions` command** — mechanical extraction layer. Crawls all session JSONL files, generates clean `.md` (user+assistant text) and full `.md` (includes thinking blocks, tool calls, tool results), writes `index.md` manifest, and generates per-session HTML browser with content toggles.
- **`super_sessions_analyze` tool** — LLM-callable. Returns structured task for per-session topic extraction. Agent reads session files and writes analyses to `analyses/{topic}/{session}.md`. Idempotent (skips already-analyzed sessions).
- **`super_sessions_synthesize` tool** — LLM-callable. Returns structured task for cross-session synthesis. Agent reads all per-session analyses and produces a coherent blueprint to `wisdom/{topic}.md`.
- **Dual output format** — clean `.md` for project memory analysis, `_full.md` for future process-improvement loops and HTML browser data source.
- **HTML browser** — per-session viewer with tree sidebar, content toggles (Show thinking, Show tools), dark theme. Session selector index. Works from `file://`, no server required.
- **Zero external dependencies** — uses only `node:fs`, `node:path`, `node:os`, and `typebox` (pi's bundled peer dep). No build step.
- **Filesystem-based session reading** — avoids `SessionManager` static import issues with jiti. Reads JSONL directly, walks branch tree, produces identical output.
