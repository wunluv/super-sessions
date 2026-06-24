# super_sessions

> Project memory foundation for pi — treats session data as a cultivated asset, not a disposable log.

Session data is high-grade human+machine energy. Every session costs focused attention, compute tokens, model inference, and electricity. After the session ends, that energy is typically archived as opaque JSONL with no tooling for reuse.

**super_sessions** converts your pi session history into readable markdown, per-session topic analyses, and cross-session synthesis blueprints — all with a tiered model cost strategy that respects your token budget.

## Philosophy

Three concerns, cleanly separated:

| Layer | What it does | Model cost |
|-------|-------------|------------|
| **Mechanical** | Session JSONL → `.md` + HTML | **Zero** |
| **Analysis** | Per-session topic extraction | Cheap model |
| **Synthesis** | Cross-session blueprint | SOTA model |

The raw `.md` files are the source of truth. Everything else derives from them. They are version-controllable, grep-able, agent-ingestible, and survive format migrations.

## Installation

```bash
# Install globally
pi install npm:@khanyi/super-sessions

# Or install for a specific project
pi install -l npm:@khanyi/super-sessions

# Or install from git
pi install git:github.com/wunluv/super-sessions
```

After installation, the `/super_sessions` command and analysis tools are available in every pi session.

**Requirements:** pi v2.0+. No external dependencies beyond pi's bundled packages.

## Quick Start

### 1. Export your sessions

From any pi session in your project directory:

```
/super_sessions
```

This generates:

```
project_insights/
├── README.md              # Generated once — explains the layout
├── index.md               # Session manifest (dates, counts, names)
├── sessions/              # Canonical source of truth
│   ├── 2026-05-02_id.md        # Clean (user + assistant text)
│   ├── 2026-05-02_id_full.md   # Full (includes thinking, tool calls)
│   └── ...
├── html/                  # Visual browser
│   ├── index.html              # Session selector
│   └── 2026-05-02_id.html      # Per-session viewer
├── analyses/              # Per-session LLM extractions (by topic)
└── wisdom/                # Cross-session synthesis blueprints
```

### 2. Browse sessions

Open `project_insights/html/index.html` in any browser. No server required — works from `file://`.

- **Tree sidebar** — full conversation structure, always visible
- **Content toggles** — ☐ Show thinking ☐ Show tools (both off by default)
- **Dark theme** — readable typography, proper spacing
- **Click to navigate** — tree entries scroll to messages

### 3. Analyze by topic

Ask your pi agent to analyze sessions for a specific topic:

```
Analyze all sessions for engineering decisions using a cheap model.
Call super_sessions_analyze with topic="engineering".
```

The agent will:
1. Read each clean `.md` session
2. Extract observations (context, insight, evidence, significance)
3. Write structured analyses to `analyses/engineering/`

Already-analyzed sessions are skipped (idempotent). Use `sessionGlob` to filter: `"2026-06-*"` or `"all"`.

### 4. Synthesize wisdom

Once analyses exist, ask your agent to synthesize:

```
Synthesize all engineering analyses into a blueprint.
Call super_sessions_synthesize with topic="engineering".
```

The agent will:
1. Read all `analyses/engineering/*.md`
2. Synthesize patterns, contradictions, evolution, and key decisions
3. Write a coherent blueprint to `wisdom/engineering.md`

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
                    ├── sessions/*_full.md ← full (thinking, tools)
                    ├── html/           ← visual browser with toggles
                    └── index.md        ← session manifest
                           │
                           ▼
              ┌─────────────────────────┐
              │  PER-SESSION ANALYSIS   │  Cheap model (e.g. deepseek-chat)
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
              │  super_sessions_synthesize│ Tool, LLM-callable
              └────────────┬────────────┘
                           │
                    project_insights/
                    └── wisdom/
                        ├── engineering_blueprint.md
                        ├── negotiation_summary.md
                        ├── architectural_decisions.md
                        └── ...
```

## Commands & Tools

| Command/Tool | What it does | Cost |
|-------------|-------------|------|
| `/super_sessions` | Regenerate all session exports (.md, HTML, index) | Free |
| `super_sessions_analyze` | Per-session topic extraction | Cheap model |
| `super_sessions_synthesize` | Cross-session synthesis blueprint | SOTA model |

### `/super_sessions`

Regenerates `sessions/`, `html/`, and `index.md` from all session JSONL files.

- Idempotent — safe to run repeatedly
- Never touches `analyses/` or `wisdom/`
- Overwrites existing session exports
- Creates `README.md` on first run

### `super_sessions_analyze`

LLM-callable. Returns structured instructions for per-session topic analysis.

**Parameters:**
- `topic` (required) — e.g. `"engineering_decisions"`, `"negotiation"`, `"architecture"`
- `sessionGlob` (optional) — filter sessions, e.g. `"2026-06-*"`. Defaults to `"all"`
- `focusPrompt` (optional) — additional extraction guidance

**Behavior:**
- Skips sessions already analyzed for this topic (idempotent)
- The agent reads session files and writes analyses
- Each analysis includes: context, observation, evidence, significance

### `super_sessions_synthesize`

LLM-callable. Returns structured instructions for cross-session synthesis.

**Parameters:**
- `topic` (required) — same topic used in analyze
- `outputFormat` (optional) — `"blueprint"` (default), `"summary"`, or `"timeline"`

**Behavior:**
- Reads all `analyses/{topic}/*.md`
- Includes session timeline from `index.md`
- The agent writes synthesis to `wisdom/{topic}.md`

## Output formats

### Clean `.md` (`sessions/{date}_{id}.md`)

User and assistant text only. No thinking blocks, no tool calls, no tool results. Designed for project memory analysis — signal-rich for "what did we build, decide, learn."

```markdown
# Session name

**Session:** 2026-05-02_abc123
**Date:** 2026-05-02

---

## User (2026-05-02T14:00:00.000Z)

Hey, let's design the data model...

## Assistant (2026-05-02T14:00:15.000Z)

Here's what I'm thinking...
```

### Full `.md` (`sessions/{date}_{id}_full.md`)

Includes thinking blocks, tool calls, and tool results. Dormant asset for future process-improvement analysis ("how do we work, where do we waste tokens"). Also serves as the data source for the HTML browser's toggles.

```markdown
<details>
<summary>💭 Thinking (2026-05-02T14:00:15.000Z)</summary>

Let me think about the data model...

</details>

### 🔧 Tool Call: `read` (2026-05-02T14:00:15.000Z)
  path: /project/schema.ts
```

## HTML Browser

The generated HTML viewer includes:

- **Tree sidebar** — full conversation structure. User messages, assistant messages, thinking blocks, tool calls, tool results. Color-coded by role.
- **Content toggles** — independent checkboxes for thinking blocks and tool calls. Both off by default for clean reading. Instant CSS toggle — no rebuild.
- **Dark theme** — Tokyo Night-inspired palette. JetBrains Mono for code, system font stack for body text.
- **Responsive** — resizable sidebar, scrollable content. Works at any viewport size.
- **Offline** — self-contained HTML, no server, no CDN, no network requests. Works from `file://`.

## Model Tiering Strategy

| Tier | Model | Use | Token cost | Invocation |
|------|-------|-----|------------|------------|
| Mechanical | None | Session → .md | Free | `/super_sessions` |
| Analysis | Cheap (deepseek-chat, etc.) | Per-session topic extraction | Low | `super_sessions_analyze` |
| Synthesis | SOTA (your active model) | Cross-session blueprint | Moderate | `super_sessions_synthesize` |

The analysis tool returns instructions, not model calls. Your agent chooses the model and orchestrates the extraction. This gives you maximum control over model selection and cost.

## Development

### Project structure

```
super-sessions/
├── package.json          # Pi package manifest
├── extensions/           # Extension source (loaded by pi)
│   ├── index.ts          # Entry point — registers command + tools
│   ├── extraction.ts     # Mechanical extraction engine
│   └── html-generator.ts # HTML browser generation
├── spec.md               # Full technical specification
├── README.md             # This file
├── LICENSE               # MIT
└── CHANGELOG.md          # Version history
```

### Local development

```bash
# Clone the repo
git clone https://github.com/wunluv/super-sessions.git
cd super-sessions

# Copy extension to auto-discovery path
cp -r extensions/ ~/.pi/agent/extensions/super-sessions/

# Start pi — the extension auto-loads
pi

# After making changes, copy again
cp extensions/*.ts ~/.pi/agent/extensions/super-sessions/
# Then /reload in pi
```

Or load directly:

```bash
pi -e ./extensions
```

### Testing

The mechanical extraction can be tested standalone:

```bash
npx tsx -e "
import { listSessions, extractSessionFile, buildIndex } from './extensions/extraction.ts';
const sessions = listSessions(process.cwd());
console.log('Found', sessions.length, 'sessions');
"
```

Extraction output goes to `project_insights/` in the current working directory.

### Engineering decisions

**Filesystem-based session reading.** `SessionManager` static imports from `@earendil-works/pi-coding-agent` cause jiti module resolution hangs. We read JSONL directly from the pi sessions directory and walk the branch tree manually. Same output, zero dependency issues.

**Analysis tools as instruction generators.** Instead of calling model APIs from within extension code, the tools return structured tasks. Your agent reads the session files, calls the model, and writes the output. This avoids API key wrangling, gives you model selection control, and keeps the extension logic simple.

**Self-contained HTML.** No `marked.js`, no `highlight.js`, no CDN. The HTML templates bundle all CSS and JS inline. This eliminates vendor management and ensures the browser works offline perpetually.

**Zero npm dependencies.** Only peer deps on pi's bundled packages (`@earendil-works/pi-coding-agent`, `typebox`). No install step needed beyond what pi provides.

## Roadmap

### v0.2 (next)

- `/super_sessions --since <date>` — incremental regeneration
- `/super_sessions --session <id>` — single-session regeneration
- Configuration file for topic-specific extraction prompts
- Date-range filtering for synthesis

### v0.3

- Direct model calling from within analysis tool (cheap model auto-selection)
- Cross-session search across all analyses and wisdom files
- Integration with pi's compaction system

### v1.0

- Dashboard with project-level metrics (session frequency, topic distribution)
- Process-improvement analysis mode (uses `_full.md` with thinking blocks)
- Configurable model tiering per-project

## Contributing

Contributions welcome. Open an issue to discuss before submitting a PR.

This project follows pi's extension conventions. Extensions should:

- Require no build step (jiti loads TypeScript directly)
- Avoid native addons, `eval()`, and dynamic `require()`
- List core pi libraries in `peerDependencies` with `"*"` range
- Keep dependencies minimal (zero runtime deps preferred)

## License

MIT © 2026 San Naidoo (Khanyi Corporation)
