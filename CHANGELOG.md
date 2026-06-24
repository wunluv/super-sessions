# Changelog

All notable changes to super_sessions will be documented in this file.

## [0.1.0] — 2026-06-24

### Added
- **`/super_sessions` command** — mechanical extraction layer. Crawls all session JSONL files, generates clean `.md` (user+assistant text) and full `.md` (includes thinking blocks, tool calls, tool results), writes `index.md` manifest, and generates per-session HTML browser with content toggles.
- **`super_sessions_analyze` tool** — LLM-callable. Returns structured task for per-session topic extraction. Agent reads session files and writes analyses to `analyses/{topic}/{session}.md`. Idempotent (skips already-analyzed sessions).
- **`super_sessions_synthesize` tool** — LLM-callable. Returns structured task for cross-session synthesis. Agent reads all per-session analyses and produces a coherent blueprint to `wisdom/{topic}.md`.
- **Dual output format** — clean `.md` for project memory analysis, `_full.md` for future process-improvement loops and HTML browser data source.
- **HTML browser** — per-session viewer with tree sidebar, content toggles (Show thinking, Show tools), dark theme. Session selector index. Works from `file://`, no server required.
- **Zero external dependencies** — uses only `node:fs`, `node:path`, `node:os`, and `typebox` (pi's bundled peer dep). No build step.
- **Filesystem-based session reading** — avoids `SessionManager` static import issues with jiti. Reads JSONL directly, walks branch tree, produces identical output.
