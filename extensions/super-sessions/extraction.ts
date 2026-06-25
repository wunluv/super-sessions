/**
 * Mechanical extraction: Session JSONL → clean .md + full .md
 * Zero LLM cost. Deterministic.
 *
 * Reads session files directly from the filesystem to avoid
 * SessionManager static import issues with jiti module resolution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Types ────────────────────────────────────────────────────────────────────────

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  arguments?: Record<string, unknown>;
}

interface SessionEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    timestamp?: number;
    usage?: unknown;
  };
}

export interface SessionMeta {
  /** Session file path */
  file: string;
  /** Session ID */
  id: string;
  /** ISO timestamp from header */
  timestamp: string;
  /** Working directory */
  cwd: string;
  /** Date string (YYYY-MM-DD) */
  date: string;
  /** Display name (from session_info or first message) */
  name?: string;
  /** Number of user+assistant messages */
  messageCount: number;
}

/** Raw session info from filesystem discovery */
interface RawSessionInfo {
  path: string;
  id: string;
  cwd: string;
  timestamp: string;
}

// ─── Session Discovery (filesystem-based, no SessionManager dependency) ────────────

const SESSIONS_BASE = path.join(os.homedir(), ".pi", "agent", "sessions");

/** Convert a cwd to the sanitized directory name used by pi */
function cwdToDirName(cwd: string): string {
  // Matches pi's getDefaultSessionDirPath encoding:
  // `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

/**
 * List all session files for the given working directory.
 * Replicates SessionManager.list() behavior.
 */
export function listSessions(cwd: string): RawSessionInfo[] {
  const dirName = cwdToDirName(cwd);
  const projDir = path.join(SESSIONS_BASE, dirName);

  if (!fs.existsSync(projDir)) return [];

  const results: RawSessionInfo[] = [];
  try {
    for (const file of fs.readdirSync(projDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(projDir, file);

      // Parse header to get session ID and timestamp
      const header = parseSessionHeader(filePath);
      if (header) {
        results.push({
          path: filePath,
          id: header.id,
          cwd: header.cwd || cwd,
          timestamp: header.timestamp,
        });
      }
    }
  } catch {
    // unreadable
  }

  // Sort by timestamp descending (newest first)
  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return results;
}

// ─── Session Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse session header from JSONL file.
 * The first line of a JSONL session file is the header.
 */
function parseSessionHeader(filePath: string): { id: string; timestamp: string; cwd: string } | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const firstLine = content.split("\n")[0];
    if (!firstLine) return null;

    const header = JSON.parse(firstLine);
    if (header.type === "session") {
      return {
        id: header.id || "unknown",
        timestamp: header.timestamp || new Date().toISOString(),
        cwd: header.cwd || "",
      };
    }
  } catch {
    // unparseable
  }
  return null;
}

/**
 * Parse all entries from a session JSONL file.
 * Returns entries in order (skips the header line).
 *
 * Edge cases:
 * - Corrupt JSONL lines: logged with console.warn, skipped, processing continues
 * - Unreadable file: logged with console.error, returns empty array
 * - Empty file (header only): returns empty array
 */
function parseSessionEntries(filePath: string): SessionEntry[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);

    const entries: SessionEntry[] = [];
    let corruptCount = 0;
    for (let i = 1; i < lines.length; i++) {
      // skip header (line 0)
      try {
        const entry = JSON.parse(lines[i]);
        entries.push(entry);
      } catch {
        corruptCount++;
      }
    }

    if (corruptCount > 0) {
      console.warn(`[super_sessions] ${corruptCount} corrupt JSONL line(s) in ${path.basename(filePath)} — skipped`);
    }

    return entries;
  } catch (err) {
    console.error(`[super_sessions] Could not read session file ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Walk from the leaf entry to the root, following parentId links.
 * Returns entries in chronological order (root first, leaf last).
 */
function getActiveBranch(entries: SessionEntry[]): SessionEntry[] {
  if (entries.length === 0) return [];

  // Build id -> entry map
  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
  }

  // Find leaf: last entry, or entry with no children
  let leaf: SessionEntry | undefined;

  // Find which entries have children pointing to them
  const hasChildren = new Set<string>();
  for (const entry of entries) {
    if (entry.parentId) hasChildren.add(entry.parentId);
  }

  // Leaf is the last entry that has no children pointing to it
  // (or just the last entry if tree is linear)
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].id && !hasChildren.has(entries[i].id!)) {
      leaf = entries[i];
      break;
    }
  }

  if (!leaf) leaf = entries[entries.length - 1];

  // Walk from leaf to root
  const branch: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    branch.unshift(current);
    if (current.parentId) {
      current = byId.get(current.parentId);
    } else {
      break;
    }
  }

  return branch;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function formatTimestamp(ts: number | string | undefined): string {
  if (!ts) return "?";
  if (typeof ts === "string") {
    // Check for malformed date string
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "?";
    return ts;
  }
  if (typeof ts === "number") {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "?";
    return d.toISOString();
  }
  return "?";
}

/** Extract human-readable summary from first user message */
function getSessionName(entries: SessionEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg || msg.role !== "user") continue;

    const text = extractText(msg.content);
    if (!text) continue;

    const cleaned = text
      .replace(/@[\w./-]+/g, "")
      .trim()
      .replace(/\s+/g, " ");

    if (cleaned.length > 0) {
      return cleaned.length > 80 ? cleaned.slice(0, 80) + "..." : cleaned;
    }
  }
  return "Untitled session";
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return (content as ContentBlock[])
    .filter(
      (c): c is ContentBlock & { type: "text"; text: string } =>
        typeof c === "object" && c !== null && c.type === "text" && typeof c.text === "string",
    )
    .map((c) => c.text!)
    .join("\n");
}

/** Build clean .md: user + assistant text only */
function buildCleanMd(entries: SessionEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg) continue;

    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;

    const ts = formatTimestamp(msg.timestamp);
    const text = extractText(msg.content);

    if (!text) continue;

    if (role === "user") {
      lines.push(`\n## User (${ts})\n\n${text}\n`);
    } else {
      lines.push(`\n## Assistant (${ts})\n\n${text}\n`);
    }
  }

  return lines.join("\n").trim();
}

/** Build full .md: includes thinking blocks, tool calls, tool results */
function buildFullMd(entries: SessionEntry[]): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (!msg) continue;

    const role = msg.role;
    const ts = formatTimestamp(msg.timestamp);

    if (role === "user") {
      const text = extractText(msg.content);
      if (text) {
        lines.push(`\n## User (${ts})\n\n${text}\n`);
      }
    } else if (role === "assistant") {
      const content = Array.isArray(msg.content) ? (msg.content as ContentBlock[]) : [];

      for (const block of content) {
        if (block.type === "thinking" && block.thinking) {
          lines.push(
            `\n<details>\n<summary>💭 Thinking (${ts})</summary>\n\n${block.thinking}\n\n</details>\n`,
          );
        } else if (block.type === "text" && block.text) {
          lines.push(`\n## Assistant (${ts})\n\n${block.text}\n`);
        } else if (block.type === "toolCall") {
          const args = block.arguments
            ? Object.entries(block.arguments)
                .filter(([, v]) => typeof v !== "object" || v === null)
                .map(
                  ([k, v]) =>
                    `  ${k}: ${typeof v === "string" ? v.slice(0, 80) : String(v)}`,
                )
                .join("\n")
            : "";
          lines.push(
            `\n### 🔧 Tool Call: \`${block.name}\` (${ts})\n\n\`\`\`\n${args || "  (no simple args)"}\n\`\`\`\n`,
          );
        }
      }
    } else if (role === "toolResult") {
      const resultText = extractText(msg.content);
      const errorMarker = msg.isError ? " ❌ ERROR" : "";
      const display =
        resultText.length > 2000
          ? resultText.slice(0, 2000) + "\n\n... (truncated)"
          : resultText;

      lines.push(
        `\n### 📋 Tool Result: \`${msg.toolName || "unknown"}\`${errorMarker} (${ts})\n\n\`\`\`\n${display}\n\`\`\`\n`,
      );
    }
  }

  return lines.join("\n").trim();
}

// ─── Main Extraction ─────────────────────────────────────────────────────────────

/**
 * Extract a single session to clean and full .md files.
 * Reads JSONL directly from filesystem.
 */
export function extractSessionFile(
  sessionPath: string,
  outputDir: string,
  rawInfo: RawSessionInfo,
): SessionMeta | null {
  // Parse entries
  const allEntries = parseSessionEntries(sessionPath);
  if (allEntries.length === 0) {
    console.warn(`[super_sessions] Empty session file: ${path.basename(sessionPath)} — skipping`);
    return null;
  }

  // Get active branch (walk from leaf to root)
  const branch = getActiveBranch(allEntries);
  if (branch.length === 0) {
    console.warn(`[super_sessions] No active branch in ${path.basename(sessionPath)} — skipping`);
    return null;
  }

  const dateStr = rawInfo.timestamp.split("T")[0];
  const shortId = rawInfo.id.length > 8 ? rawInfo.id.slice(0, 8) : rawInfo.id;
  const baseName = `${dateStr}_${shortId}`;

  // Count messages
  let userMsgs = 0;
  let assistantMsgs = 0;
  for (const entry of branch) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg?.role === "user") userMsgs++;
    if (msg?.role === "assistant") assistantMsgs++;
  }

  // Skip sessions with no user or assistant messages (e.g. tool-only sessions)
  if (userMsgs === 0 && assistantMsgs === 0) {
    console.warn(`[super_sessions] Session ${baseName} has no user or assistant messages — skipping`);
    return null;
  }

  const sessionName = getSessionName(branch);

  // Generate clean .md
  const cleanMd = buildCleanMd(branch);
  const cleanPath = path.join(outputDir, `${baseName}.md`);
  const cleanHeader = `# ${sessionName}\n\n**Session:** ${baseName}\n**Date:** ${dateStr}\n**Project:** ${rawInfo.cwd}\n**Messages:** ${userMsgs} user, ${assistantMsgs} assistant\n\n---\n`;
  fs.mkdirSync(path.dirname(cleanPath), { recursive: true });
  fs.writeFileSync(cleanPath, cleanHeader + cleanMd, "utf-8");

  // Generate full .md with truncation check for very large sessions
  const fullMd = buildFullMd(branch);
  const MARKDOWN_SIZE_LIMIT = 500000; // 500KB max per file
  const fullBody = fullMd.length > MARKDOWN_SIZE_LIMIT
    ? fullMd.slice(0, MARKDOWN_SIZE_LIMIT) +
      `\n\n[... _full.md truncated at ${MARKDOWN_SIZE_LIMIT} characters — ${fullMd.length} total in source ...]`
    : fullMd;
  if (fullMd.length > MARKDOWN_SIZE_LIMIT) {
    console.warn(`[super_sessions] ${baseName}_full.md truncated (${fullMd.length} chars > ${MARKDOWN_SIZE_LIMIT} limit)`);
  }
  const fullPath = path.join(outputDir, `${baseName}_full.md`);
  const fullHeader = `# ${sessionName} (Full)\n\n**Session:** ${baseName}\n**Date:** ${dateStr}\n**Project:** ${rawInfo.cwd}\n**Messages:** ${userMsgs} user, ${assistantMsgs} assistant\n\n> Includes thinking blocks, tool calls, and tool results.\n\n---\n`;
  fs.writeFileSync(fullPath, fullHeader + fullBody, "utf-8");

  return {
    file: sessionPath,
    id: rawInfo.id,
    timestamp: rawInfo.timestamp,
    cwd: rawInfo.cwd,
    date: dateStr,
    name: sessionName,
    messageCount: userMsgs + assistantMsgs,
  };
}

// ─── Frontmatter Parsing ──────────────────────────────────────────────────────

export interface SessionFrontmatter {
  /** Whether this session is relevant to the project */
  project_relevant: boolean;
  /** Topics discussed in this session */
  topics: string[];
  /** One-sentence summary of the session */
  summary: string;
  /** Whether noise has been stripped from the body */
  noise_stripped: boolean;
}

/**
 * Parse YAML frontmatter from a session .md file.
 * Returns default values if no frontmatter exists.
 *
 * Files without frontmatter are treated as project_relevant: true
 * by default, since untagged sessions haven't been classified yet.
 *
 * Edge cases:
 * - Invalid YAML: warns and treats as untagged (returns defaults)
 * - Missing closing ---: warns and treats as untagged
 * - Empty file: returns defaults without warning
 * - Malformed list items in topics: gracefully skips them
 *
 * Performs simple line-by-line parsing (no YAML library dependency).
 */
export function parseSessionFrontmatter(filePath: string): SessionFrontmatter {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    // Check for opening ---
    if (lines.length < 2 || lines[0].trim() !== "---") {
      return { project_relevant: true, topics: [], summary: "", noise_stripped: false };
    }

    // Find closing ---
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        closingIndex = i;
        break;
      }
    }

    if (closingIndex < 0) {
      console.warn(`[super_sessions] Unclosed YAML frontmatter in ${path.basename(filePath)} — treating as untagged`);
      return { project_relevant: true, topics: [], summary: "", noise_stripped: false };
    }

    // Parse frontmatter lines (between opening and closing ---)
    const fmLines = lines.slice(1, closingIndex);

    if (fmLines.length === 0) {
      console.warn(`[super_sessions] Empty YAML frontmatter block in ${path.basename(filePath)} — treating as untagged`);
      return { project_relevant: true, topics: [], summary: "", noise_stripped: false };
    }

    // Parse project_relevant: true/false
    const projectRelevant = (() => {
      const line = fmLines.find((l) => /^project_relevant:\s*(true|false)/.test(l));
      if (line) {
        const match = line.match(/^project_relevant:\s*(true|false)/);
        if (!match) {
          console.warn(`[super_sessions] Could not parse project_relevant value in ${path.basename(filePath)}: ${line.trim()}`);
          return true;
        }
        return match[1] === "true";
      }
      return true;
    })();

    // Parse topics array
    const topics = (() => {
      const result: string[] = [];
      let inTopics = false;
      for (const line of fmLines) {
        if (/^topics:/.test(line)) {
          inTopics = true;
          continue;
        }
        if (inTopics) {
          if (/^\s+-\s/.test(line)) {
            const topic = line.replace(/^\s+-\s+/, "").trim().replace(/^"|"$/g, "");
            if (topic) result.push(topic);
          } else if (/^\S/.test(line)) {
            inTopics = false;
          }
        }
      }
      return result;
    })();

    // Parse summary
    const summary = (() => {
      const line = fmLines.find((l) => /^summary:/.test(l));
      if (line) {
        const val = line
          .replace(/^summary:\s*/, "")
          .replace(/^"|"$/g, "")
          .replace(/^'|'$/g, "")
          .trim();
        // Reject if the value is clearly malformed (e.g. another key)
        if (/^\w+:/.test(val)) {
          console.warn(`[super_sessions] Malformed summary value in ${path.basename(filePath)}: ${line.trim()}`);
          return "";
        }
        return val;
      }
      return "";
    })();

    // Parse noise_stripped: true/false
    const noiseStripped = (() => {
      const line = fmLines.find((l) => /^noise_stripped:\s*(true|false)/.test(l));
      if (line) {
        const match = line.match(/^noise_stripped:\s*(true|false)/);
        return match ? match[1] === "true" : false;
      }
      return false;
    })();

    return {
      project_relevant: projectRelevant,
      topics,
      summary,
      noise_stripped: noiseStripped,
    };
  } catch (err) {
    console.warn(`[super_sessions] Could not read ${path.basename(filePath)} for frontmatter parsing: ${err instanceof Error ? err.message : String(err)}`);
    return { project_relevant: true, topics: [], summary: "", noise_stripped: false };
  }
}

/**
 * Build index.md manifest from session metadata array.
 */
export function buildIndex(sessions: SessionMeta[], outputDir: string): string {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const lines = [
    "# Session Archive",
    "",
    `**Project:** ${process.cwd()}`,
    `**Generated:** ${new Date().toISOString()}`,
    `**Sessions:** ${sorted.length}`,
    "",
    "---",
    "",
    "| # | Date | Session | Messages | Name |",
    "|---|------|---------|----------|------|",
  ];

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const dateStr = s.date;
    const shortId = s.id.length > 8 ? s.id.slice(0, 8) : s.id;
    const name = (s.name || "Untitled").replace(/\|/g, "\\|");
    const baseName = `${dateStr}_${shortId}`;
    const cleanFile = `sessions/${baseName}.md`;
    const fullFile = `sessions/${baseName}_full.md`;
    lines.push(
      `| ${i + 1} | ${dateStr} | [clean](${cleanFile}) · [full](${fullFile}) | ${s.messageCount} | ${name} |`,
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Formats");
  lines.push("");
  lines.push(
    "- **Clean** (`sessions/{date}_{id}.md`) — User + assistant text. No thinking blocks, no tool calls. Use for project memory analysis.",
  );
  lines.push(
    "- **Full** (`sessions/{date}_{id}_full.md`) — Includes thinking blocks, tool calls, and tool results. Use the HTML browser for interactive exploration.",
  );
  lines.push("");
  lines.push("## Layers");
  lines.push("");
  lines.push("| Layer | Command/Tool | Description |");
  lines.push("|-------|-------------|-------------|");
  lines.push("| Mechanical | `/super_sessions` | Extracts sessions to .md (zero LLM cost) |");
  lines.push("| Analysis | `super_sessions_analyze` | Per-session topic analysis (cheap model) |");
  lines.push("| Synthesis | `super_sessions_synthesize` | Cross-session blueprint (SOTA model) |");

  const indexPath = path.join(outputDir, "index.md");
  fs.writeFileSync(indexPath, lines.join("\n"), "utf-8");

  return lines.join("\n");
}
