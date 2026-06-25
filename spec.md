# super_sessions — Project Memory Foundation for pi

## Philosophy

Session data is high-grade human+machine energy. Every session costs focused attention, compute tokens, model inference, and electricity. After the session ends, that energy is typically archived as opaque JSONL with no tooling for reuse.

super_sessions treats session data as a **cultivated asset**, not a disposable log. It separates four concerns:

1. **Mechanical extraction** — reproducible, deterministic, zero-LLM-cost. Produces canonical raw conversation files.
2. **Classification / tagging** — cheap LLM pass to add YAML frontmatter (relevance, topics, summary) and optionally strip noise from body text. One-time per session.
3. **Per-session analysis** — topic-focused extraction using a cheap, fast model. Granular observations from each session, filtered by frontmatter.
4. **Cross-session synthesis** — blueprint construction using a SOTA model, consuming per-session analyses as input, filtered by frontmatter.

The raw `.md` files are the source of truth. Everything else derives from them. They are version-controllable, grep-able, agent-ingestible, and survive format migrations.

## Architecture

```
                    Session JSONL files
                    (~/.pi/agent/sessions/)
                           │
                           ▼
              ┌─────────────────────────┐
              │  MECHANICAL EXTRACTION  │  Zero LLM cost. Deterministic.
              │  /super_sessions        │
              └────────────┬────────────┘
                           │
                    project_insights/
                    ├── sessions/       ← raw .md (user+assistant only)
                    ├── html/           ← visual browser with toggles
                    └── index.md        ← session manifest
                           │
                           ▼
              ┌─────────────────────────┐
              │  CLASSIFICATION / TAGGING│  Cheap model
              │  /super_sessions tag    │  One-time per session
              └────────────┬────────────┘
                           │
                    project_insights/
                    └── sessions/       ← .md now with YAML frontmatter
                           │             (project_relevant, topics, summary)
                           ▼             (+ optionally noise-stripped body)
              ┌─────────────────────────┐
              │  PER-SESSION ANALYSIS   │  Cheap model (e.g., deepseek-v4-flash)
              │  super_sessions_analyze │  Tool, LLM-callable
              └────────────┬────────────┘
                           │
                    project_insights/
                    └── analyses/
                        └── {topic}/
                            ├── session_001.md
                            ├── session_002.md
                            └── ...
                           │
                           ▼
              ┌─────────────────────────┐
              │  CROSS-SESSION SYNTHESIS│  SOTA model (user's default)
              │  super_sessions_synthesize│  Tool, LLM-callable
              └────────────┬────────────┘
                           │
                    project_insights/
                    └── wisdom/
                        ├── engineering_blueprint.md
                        ├── negotiation_summary.md
                        ├── architectural_decisions.md
                        └── ...
```

## Feature Scope

### v1 (this build)

**Mechanical layer** — `/super_sessions`
- Crawl all session JSONL files for current working directory
- Extract user + assistant text (strip thinking blocks, tool calls, tool results)
- Write per-session `.md` files to `project_insights/sessions/`
- Also generate `sessions/{id}_full.md` with thinking blocks and tool calls included (dormant asset for future process-improvement analysis loop)
- Write `project_insights/index.md` (manifest with dates, message counts, session names)
- Generate per-session HTML browser with working content toggles (uses `_full.md` as data source for thinking/tool-call visibility)
- Generate `project_insights/html/index.html` session selector
- Regeneration is safe (overwrites existing, never touches `analyses/` or `wisdom/`)

**Classification / tagging layer** — `/super_sessions tag`
- Reads untagged clean `.md` files (no YAML frontmatter)
- Reads project `AGENTS.md` for context on what constitutes project relevance
- Calls cheap LLM to generate YAML frontmatter: `project_relevant`, `topics`, `summary`, `noise_stripped`
- Prepends frontmatter to session `.md` files (one-time, idempotent)
- With `--strip-noise` flag: LLM also removes non-project tangents from body text, sets `noise_stripped: true`
- With `--force` flag: overwrites existing frontmatter (normally skips already-tagged files)
- `retag` subcommand: alias for `tag` (only processes untagged sessions)
- Never touches `_full.md`, `analyses/`, or `wisdom/` files
- Frontmatter becomes machine-readable filter for analysis and synthesis tools

**Per-session analysis tool** — `super_sessions_analyze`
- Takes parameters: `topic` (string, required), `sessions` (glob or "all", optional), `model` (optional override)
- Filters sessions by frontmatter: skips `project_relevant: false`, optionally matches `topics`
- For each matched session: reads `sessions/{id}.md`, calls cheap model with topic-specific extraction prompt, writes `analyses/{topic}/{id}.md`
- Each analysis file: structured observations tagged with topic, session date, and line references
- Skips sessions that already have an analysis for this topic (idempotent)
- Respects abort signal

**Cross-session synthesis tool** — `super_sessions_synthesize`
- Takes parameters: `topic` (string, required), `model` (optional override)
- Reads all files in `analyses/{topic}/` plus `index.md`
- Calls SOTA model with synthesis prompt to produce a coherent blueprint/document
- Writes `wisdom/{topic}.md`
- Synthesis prompt includes: all per-session analyses, session dates/timeline, instructions to identify patterns, contradictions, decisions, evolution over time

**HTML browser layer** — generated by `/super_sessions`
- Per-session viewer with tree sidebar (full conversation structure, always visible)
- Content toggle checkboxes: ☐ Show thinking ☐ Show tool calls (both off by default)
- Toggles affect content pane via CSS classes — no tree rebuild, instant
- Thinking blocks rendered subordinate (lighter bg, italic, collapsible)
- Tool calls rendered with expandable output
- `index.html`: searchable session list, click to open per-session viewer
- Typography: readable font sizes, proper spacing, dark theme
- Works from `file://`, no server required

### v2 (future)

- `/super_sessions --since <date>` — incremental regeneration
- `/super_sessions --session <id>` — single-session regeneration
- Cross-session search across all analyses and wisdom files
- Configuration file for topic-specific extraction prompts
- Integration with pi's compaction system for context-ware session analysis
- Dashboard with project-level metrics (session frequency, topic distribution, evolution velocity)

## Directory Conventions

```
project_insights/                   ← root, in project working directory
│
├── README.md                       ← generated once, explains layout
│
├── index.md                        ← session manifest (dates, count, names)
│
├── sessions/                       ← canonical source of truth
│   ├── 2026-05-02_{session-id}.md       ← clean (user+assistant text, no thinking/tools)
│   │                                      After tagging: YAML frontmatter added
│   │                                      (project_relevant, topics, summary, noise_stripped)
│   ├── 2026-05-02_{session-id}_full.md  ← full (includes thinking blocks, tool calls)
│   └── ...
│
├── html/                           ← visual browser
│   ├── index.html                  ← session selector
│   └── 2026-05-02_{session-id}.html
│
├── analyses/                       ← per-session LLM extractions
│   ├── engineering/
│   │   ├── 2026-05-02_{session-id}.md
│   │   └── ...
│   ├── negotiation/
│   │   └── ...
│   └── architecture/
│       └── ...
│
└── wisdom/                         ← cross-session synthesis
    ├── engineering_blueprint.md
    ├── negotiation_summary.md
    └── architectural_decisions.md
```

## Commands and Tools

### Command: `/super_sessions`

Regenerates `sessions/`, `html/`, and `index.md` from all session files in the current project directory.

- Uses `SessionManager.list(cwd)` to discover sessions
- Opens each session via `SessionManager.open(path)`
- Gets the active conversation path via `getBranch()`
- Filters entries to `user` and `assistant` roles
- For assistant messages: extracts only `text` content blocks (skips `thinking` and `toolCall`)
- Writes formatted `.md` with role labels and timestamps
- Generates HTML files with embedded session data and client-side toggles
- Always regenerates fully (stateless, idempotent)
- Reports: "Generated N session exports to project_insights/"

### Command: `/super_sessions tag`

Adds YAML frontmatter to untagged session `.md` files via cheap LLM. One-time per session. Separated from mechanical extraction to keep the export step zero-cost.

**Frontmatter schema:**

```yaml
---
date: 2026-06-24
session_id: 019ef8f1
project_relevant: true       # boolean — skip entirely if false
topics:                       # what was discussed (for targeted analysis)
  - architecture
  - authentication
summary: "Redesigned JWT refresh flow. Fixed session race condition."
noise_stripped: false         # whether body has been cleaned of tangents
---
```

**Subcommands / flags:**

| Command | Behavior |
|---------|----------|
| `/super_sessions tag` | Tags all untagged sessions (adds frontmatter only, body unchanged) |
| `/super_sessions tag --strip-noise` | Tags + asks LLM to remove non-project tangents from body text |
| `/super_sessions retag` | Alias: tags only sessions missing frontmatter (same as `tag`) |
| `/super_sessions tag --force` | Overwrites frontmatter on already-tagged sessions |

**Idempotency:** Skips any file whose first line is `---` (already has YAML frontmatter). `--force` overrides. Never modifies `_full.md` or `analyses/` / `wisdom/` files.

**Project context:** The tagging prompt includes the project's `AGENTS.md` content for relevance detection. Falls back to a generic prompt if no `AGENTS.md` exists.

**Noise stripping behavior:** When `--strip-noise` is used, the LLM receives the full conversation body plus project context. It removes sections unrelated to the project (research tangents, unrelated debugging, tool exploration on other codebases) while preserving all project-relevant discussion with no loss of fidelity. The cleaned body replaces the original in the `.md` file. `noise_stripped` is set to `true` in frontmatter.

**Model:** Uses the cheap model (same tier as per-session analysis).

**Tagging prompt structure:**
```
You are tagging a developer session transcript.

Project context:
{AGENTS.md content or "No project context available."}

Session transcript:
---
{session_body}
---

Analyze the session and return:
1. YAML frontmatter with:
   - project_relevant: true if this session is about the project, false if entirely unrelated
   - topics: array of 2-5 topics discussed (e.g., architecture, debugging, refactoring, documentation)
   - summary: one-sentence description of what happened
   - noise_stripped: false (set true only if noise stripping is requested separately)

{if --strip-noise}2. The cleaned transcript with all non-project tangents removed. Preserve all project-relevant discussion exactly.
{/if}
```

**Processing flow:**
1. Discover untagged sessions in `project_insights/sessions/` (no `---` first line)
2. Read `AGENTS.md` from project root for context
3. For each session: call cheap LLM with tagging prompt (+ noise stripping if flagged)
4. Prepend YAML frontmatter to the `.md` file (with cleaned body if applicable)
5. Report: "Tagged N sessions. M already tagged (skipped)."

### Tool: `super_sessions_analyze`

**LLM-callable.** Extracts topic-specific observations from one or more session `.md` files. Respects frontmatter for filtering.

```typescript
parameters: {
  topic: string;           // e.g., "engineering_decisions", "negotiation"
  sessionGlob?: string;    // defaults to "all", supports "2026-06-*" or specific files
  model?: string;          // override cheap model, defaults to extension config
  focusPrompt?: string;    // additional extraction guidance beyond defaults
}
```

**Processing:**
1. Match sessions against glob in `project_insights/sessions/`
2. Filter by frontmatter: skip sessions where `project_relevant: false`. Optionally filter by `topics` array.
3. Skip any that already have `analyses/{topic}/{session-name}.md` (idempotent)
4. For each matched session:
   a. Read `sessions/{session-name}.md` (body may be noise-stripped if tagged with `--strip-noise`)
   b. Call cheap model with topic-specific extraction prompt
   c. Write structured extraction to `analyses/{topic}/{session-name}.md`
5. Return summary: "Analyzed N sessions for topic '{topic}'. M skipped (already analyzed). X skipped (not project relevant)."

**Extraction prompt structure:**
```
You are extracting {topic} insights from a human+AI coding session.

Session: {date}, {session_name}

Conversation:
---
{raw_md_content}
---

Extract observations about {topic}. For each observation:
- Context: what was being discussed
- Observation: the specific insight, decision, or pattern
- Evidence: relevant quote or paraphrase from the conversation
- Significance: why this matters to the project

Format output as structured markdown.
```

**Model selection:**
- Default: extension config setting `cheapModel` (e.g., `deepseek/deepseek-chat` or `deepseek/deepseek-v4-flash`)
- Override: `model` parameter accepts any valid pi model pattern

### Tool: `super_sessions_synthesize`

**LLM-callable.** Produces a coherent blueprint/document from per-session analyses.

```typescript
parameters: {
  topic: string;           // e.g., "engineering_decisions", "negotiation"
  model?: string;          // override SOTA model, defaults to current session model
  outputFormat?: "blueprint" | "summary" | "timeline";  // defaults to "blueprint"
}
```

**Processing:**
1. Read all files in `analyses/{topic}/`
2. Optionally filter to only analyses from sessions with specific frontmatter `topics` or `project_relevant: true`
3. If none exist, return error: "No analyses found for topic '{topic}'. Run super_sessions_analyze first."
4. Read `index.md` for session timeline context
5. Call SOTA model with synthesis prompt, passing all analysis content
6. Write synthesized document to `wisdom/{topic}.md`

**Synthesis prompt structure:**
```
You are synthesizing a {outputFormat} about {topic} from multiple analysis sessions.

Sessions analyzed ({count} sessions spanning {date_range}):

{session_timeline_context}

Per-session analyses:
---
{all_analysis_content}
---

Synthesize into a coherent {outputFormat} that:
1. Identifies patterns and recurring themes across sessions
2. Tracks evolution of decisions over time
3. Notes contradictions or unresolved tensions
4. Highlights key decisions with session context
5. Provides actionable next steps

The output should be a standalone document suitable for human review and agent context injection.
```

**Model selection:**
- Default: the model active in the current pi session (user's chosen model)
- Override: `model` parameter for deliberate control

## Model Tiering Strategy

| Tier | Model | Use | Token Cost | Invocation |
|------|-------|-----|------------|------------|
| Mechanical | None | Session → .md extraction | Free | `/super_sessions` |
| Tagging | Cheap (deepseek-v4-flash or similar) | Relevance + topics + noise stripping | Low per session | `/super_sessions tag` |
| Analysis | Cheap (deepseek-v4-flash or similar) | Per-session topic extraction | Low per session | `super_sessions_analyze` tool |
| Synthesis | SOTA (user's active model) | Cross-session blueprint | Moderate | `super_sessions_synthesize` tool |

**Configuration:**
- The analysis model is configurable via `.pi/super_sessions.json` in the project root
- Default cheap model: `deepseek/deepseek-chat` (or `deepseek/deepseek-v4-flash` if available)
- The synthesis model defaults to the current session model (respects user's preference)
- Users can override on any invocation via the `model` parameter

## Processing Pipeline: Typical Agent Workflow

```
User: /super_sessions
  → generates sessions/*.md, html/*, index.md

User: /super_sessions tag --strip-noise
  → cheap LLM adds frontmatter to all sessions
  → skips project-irrelevant sessions, strips tangents from relevant ones
  → reports: "Tagged 14 sessions. 2 already tagged (skipped). 3 marked not relevant."

User: Analyze all engineering decisions across sessions using cheap model
Agent: calls super_sessions_analyze(topic="engineering", sessionGlob="all")
  → filters to project_relevant=true sessions
  → processes each session.md through cheap model
  → writes analyses/engineering/{session}.md
  → reports: "Analyzed 11 sessions for topic 'engineering'. 0 skipped."

User: Synthesize into engineering blueprint
Agent: calls super_sessions_synthesize(topic="engineering")
  → reads all analyses/engineering/*.md
  → calls SOTA model to synthesize
  → writes wisdom/engineering_blueprint.md
  → reports: "Blueprint written to project_insights/wisdom/engineering_blueprint.md"

User: (reviews blueprint, iterates)
User: Regenerate with additional focus on architecture decisions
Agent: calls super_sessions_analyze(topic="architecture", sessionGlob="all")
```

The agent (me) handles the orchestration — choosing when to analyze vs. synthesize, inspecting intermediate output, iterating on prompts. The extension provides the tools. The wisdom emerges from the conversation, not a one-shot flag.

## Extension Structure

```
~/.pi/agent/extensions/super-sessions/
│
├── index.ts                      ← entry point, registers tools + commands
├── config.ts                     ← reads/merges .pi/super_sessions.json
├── extraction.ts                 ← mechanical extraction (SessionManager → .md)
├── tagging.ts                    ← frontmatter + noise stripping (cheap LLM pass)
├── html-generator.ts             ← HTML browser generation (template filling)
├── templates/
│   ├── session.html              ← per-session viewer template
│   ├── session.js                ← client-side JS (tree, toggles, search)
│   ├── session.css               ← styles (typography, dark theme, toggles)
│   └── index.html                ← session selector template
├── analysis.ts                   ← calls cheap model for per-session analysis
├── synthesis.ts                  ← calls SOTA model for cross-session synthesis
├── prompts/
│   ├── tag-session.md            ← classification + noise stripping prompt
│   ├── analyze-engineering.md    ← default extraction prompt for engineering
│   ├── analyze-negotiation.md    ← default extraction prompt for negotiation
│   ├── synthesize-blueprint.md   ← default synthesis prompt for blueprints
│   └── synthesize-summary.md     ← default synthesis prompt for summaries
└── vendor/                       ← symlinks to pi's marked.js, highlight.js
```

## Dependencies

```json
{
  "dependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-ai": "*"
  }
}
```

- `SessionManager` for session discovery and entry parsing (from pi-coding-agent)
- Model calling APIs for analysis and synthesis (from pi-ai and pi-coding-agent)
- No external Node dependencies beyond pi's bundled packages
- HTML uses vendored `marked.js` and `highlight.js` from pi's export directory (read at generation time, not bundled)

## Integration with pi Ecosystem

**Does not replace:**
- `/export` — still useful for quick single-session HTML export
- `pi-insights` (ygncode) — analytics dashboard complements our approach
- `pi-session-analyzer` (catlain) — different use case (query/audit vs. foundation building)

**Does extend:**
- Adds project memory layer that doesn't exist in pi today
- Provides canonical `.md` format that agents can consume directly
- Tiered model approach that respects cost while enabling deep analysis

**Output conventions:**
- All output goes under `project_insights/` in the project root
- This directory can be `.gitignore`d (it's derived) or committed (it's valuable)
- Decision left to project maintainer

## Design Decisions

**Dual-output format (2026-06-24):** The mechanical layer generates two `.md` files per session:
- `sessions/{id}.md` — clean user+assistant text. Used for project memory analysis (engineering decisions, negotiation patterns, architecture choices). Signal-rich for "what did we build/decide/learn."
- `sessions/{id}_full.md` — includes thinking blocks, tool calls, and tool results. Dormant asset for future process-improvement analysis loop ("how do we work, where do we waste tokens, where do we derail"). Also serves as data source for the HTML browser's thinking/tool-call toggles.

Separation keeps two clean surfaces instead of one muddy one. Analysis tools default to clean `.md`; process-improvement topics can be added later targeting `_full.md`.

**YAML frontmatter as classification layer (2026-06-25):** Tagging adds structured metadata to clean `.md` files via cheap LLM, separate from mechanical extraction. This keeps the export step free and the tagging step one-time. Frontmatter fields:
- `project_relevant` (boolean): kill switch for irrelevant sessions. Analysis tools skip when false.
- `topics` (array): machine-readable topic tags for targeted synthesis ("only sessions tagged architecture").
- `summary` (string): one-sentence human overview for index browsing.
- `noise_stripped` (boolean): whether body has been cleaned of tangents.

Tagging is idempotent: files with existing frontmatter are skipped unless `--force`. Hand-edits to frontmatter are preserved — regeneration never overwrites. This makes frontmatter a user-editable curation layer, not just LLM output.

**Noise stripping in-place (2026-06-25):** When `--strip-noise` is used, the LLM removes non-project tangents from the clean `.md` body in-place. The `_full.md` file preserves the original. This treats the clean `.md` as the analysis-ready artifact rather than an immutable source — transformation is one-time, idempotent, and always recoverable via `/super_sessions` regeneration.

## Open Questions

1. **Analysis prompt customization:** Should per-topic extraction prompts be built-in, user-editable, or both? Built-in defaults with a `prompts/` directory users can override feels right for v1.

2. **Model configuration granularity:** Should the cheap model be configurable per-topic? Per-project? Per-user? Starting simple: per-project config file, with sane defaults.

3. **Analysis idempotency:** Should `super_sessions_analyze` always regenerate (like `/super_sessions`) or skip existing analyses? Skipping is safer (avoids re-burning tokens) but means stale analyses persist. Compromise: skip by default, `--force` flag to regenerate.

4. **Session selection for synthesis:** Should synthesis consider all analyses or allow date-range filtering? For v1: all analyses for a topic. Date-range filtering is v2.

5. **HTML browser JavaScript size:** The export template's tree logic is non-trivial (~1000 lines of JS). Fork and modify, or start fresh? Fork with modifications is pragmatic for v1. Extract into shared utilities for v2.

6. **Handle very large sessions:** Sessions with thousands of entries produce large `.md` files and large HTML embeds. Should the HTML browser support lazy loading or pagination? For v1: single embed, truncate very long tool outputs. Pagination is v2.

7. **Naming conflict:** `ygncode/pi-insights` and `BlazeUp-AI/pi-insights` both use the command `/insights`. Should we use a prefixed command like `/super_sessions` to avoid conflict? Yes — `/super_sessions` is the command, tools use `super_sessions_*` prefix.

## Implementation Plan

**Phase 1: Mechanical extraction** (core value, zero LLM cost)
- Session discovery via SessionManager.list(cwd)
- Entry filtering (user + assistant text only)
- .md file generation with timestamps
- index.md generation with session manifest
- Test with BTTN sessions (16 files)

**Phase 2: HTML browser**
- Fork pi's export template (tree logic, message rendering)
- Add independent toggle checkboxes (thinking, tool calls)
- Fix content toggles to actually affect content pane
- Session selector for multi-session navigation
- Readable typography and dark theme

**Phase 2b: Classification / tagging**
- `/super_sessions tag` command with cheap LLM integration
- YAML frontmatter generation (project_relevant, topics, summary, noise_stripped)
- `--strip-noise` flag for body cleaning
- `--force` flag for overwriting existing frontmatter
- `retag` subcommand for untagged-only processing
- Frontmatter parsing helpers for analysis/synthesis filtering
- AGENTS.md reading for project context injection

**Phase 3: Analysis and synthesis**
- super_sessions_analyze tool with cheap model integration
- super_sessions_synthesize tool with SOTA model integration
- Topic-specific extraction prompts
- Configuration file support

**Phase 4: Polish and release**
- Error handling (missing sessions, corrupt files, API errors)
- Progress reporting (long-running analyze operations)
- Documentation (README in project_insights/, usage guide)
- Package for pi ecosystem
