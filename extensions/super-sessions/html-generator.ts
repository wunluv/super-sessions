/**
 * HTML browser generation for session exports.
 * Generates per-session viewer and index.html selector.
 * Reads session JSONL directly from filesystem — no SessionManager dependency.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionMeta } from "./extraction";

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
  };
}

// ─── Session JSON Parsing ─────────────────────────────────────────────────────────

/** Parse all entries from a session JSONL file */
function parseSessionEntries(sessionPath: string): SessionEntry[] {
  try {
    const content = fs.readFileSync(sessionPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const entries: SessionEntry[] = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        entries.push(entry);
      } catch {
        // skip unparseable
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Walk from leaf to root following parentId links */
function getActiveBranch(entries: SessionEntry[]): SessionEntry[] {
  if (entries.length === 0) return [];

  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    if (entry.id) byId.set(entry.id, entry);
  }

  const hasChildren = new Set<string>();
  for (const entry of entries) {
    if (entry.parentId) hasChildren.add(entry.parentId);
  }

  let leaf: SessionEntry | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].id && !hasChildren.has(entries[i].id!)) {
      leaf = entries[i];
      break;
    }
  }
  if (!leaf) leaf = entries[entries.length - 1];

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

function serializeEntryForHtml(entry: SessionEntry): Record<string, unknown> {
  const msg = entry.message;
  if (!msg) return { type: entry.type, id: entry.id, parentId: entry.parentId };

  const content = msg.content;
  let serializedContent: unknown[] = [];

  if (Array.isArray(content)) {
    serializedContent = (content as ContentBlock[]).map((block) => {
      if (block.type === "thinking") {
        return { type: "thinking", thinking: block.thinking };
      }
      if (block.type === "text") {
        return { type: "text", text: block.text };
      }
      if (block.type === "toolCall") {
        const safeArgs: Record<string, unknown> = {};
        if (block.arguments) {
          for (const [k, v] of Object.entries(block.arguments)) {
            if (typeof v === "string") {
              safeArgs[k] = v.length > 500 ? v.slice(0, 500) + "..." : v;
            } else if (typeof v === "number" || typeof v === "boolean") {
              safeArgs[k] = v;
            } else if (v === null) {
              safeArgs[k] = null;
            }
          }
        }
        return { type: "toolCall", name: block.name, id: block.id, arguments: safeArgs };
      }
      return block;
    });
  } else if (typeof content === "string") {
    serializedContent = [{ type: "text", text: content }];
  }

  return {
    type: "message",
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp || (msg.timestamp ? new Date(msg.timestamp).toISOString() : ""),
    role: msg.role,
    content: serializedContent,
    toolCallId: msg.toolCallId,
    toolName: msg.toolName,
    isError: msg.isError,
  };
}

// ─── CSS ──────────────────────────────────────────────────────────────────────────

function css(): string {
  return `
:root {
  --bg: #1a1b26;
  --bg-secondary: #24283b;
  --bg-tertiary: #1f2335;
  --fg: #c0caf5;
  --fg-dim: #9aa5ce;
  --fg-muted: #565f89;
  --accent: #7aa2f7;
  --accent-dim: #3d59a1;
  --green: #9ece6a;
  --red: #f7768e;
  --yellow: #e0af68;
  --border: #3b4261;
  --shadow: rgba(0,0,0,0.3);
  --radius: 6px;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-size: 14px;
  --line-height: 1.65;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: var(--font-sans);
  font-size: var(--font-size);
  line-height: var(--line-height);
  background: var(--bg);
  color: var(--fg);
  overflow: hidden;
  height: 100vh;
}

#app {
  display: flex;
  height: 100vh;
}

/* ── Sidebar ── */
#sidebar {
  width: 300px;
  min-width: 200px;
  max-width: 50%;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 14px 12px 10px;
  border-bottom: 1px solid var(--border);
}

.sidebar-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
}

.sidebar-meta {
  font-size: 11px;
  color: var(--fg-muted);
  line-height: 1.7;
  margin-top: 4px;
}

/* ── Toggles ── */
.toggles {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.toggles label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--fg-dim);
  cursor: pointer;
  user-select: none;
}

.toggles input[type="checkbox"] {
  accent-color: var(--accent);
}

/* ── Tree ── */
.tree-container {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
  font-size: 11px;
  font-family: var(--font-mono);
}

.tree-entry {
  padding: 2px 12px;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.1s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tree-entry:hover { background: var(--bg-tertiary); }
.tree-entry.active {
  background: var(--accent-dim);
  border-left-color: var(--accent);
}

.tree-entry .prefix { color: var(--fg-muted); margin-right: 4px; }
.tree-entry.thinking-entry { color: var(--fg-muted); font-style: italic; }
.tree-entry.toolcall-entry { color: var(--yellow); }
.tree-entry.toolresult-entry { color: var(--fg-dim); }
.tree-entry.toolresult-entry.error { color: var(--red); }

/* ── Resizer ── */
#resizer {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  flex-shrink: 0;
}
#resizer:hover, #resizer.active { background: var(--accent); }

/* ── Content ── */
#content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}

.message {
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: var(--radius);
  background: var(--bg-secondary);
}

.message.user {
  border-left: 3px solid var(--accent);
  margin-right: 48px;
}

.message.assistant {
  border-left: 3px solid var(--green);
  margin-left: 24px;
  margin-right: 24px;
}

.message .role-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.message.user .role-label { color: var(--accent); }
.message.assistant .role-label { color: var(--green); }

.message .timestamp {
  font-size: 10px;
  color: var(--fg-muted);
  margin-left: 8px;
  font-weight: normal;
}

.message .body {
  font-size: var(--font-size);
  line-height: 1.75;
}

.message .body p { margin-bottom: 8px; }
.message .body p:last-child { margin-bottom: 0; }

.message .body pre {
  background: var(--bg);
  padding: 10px 12px;
  border-radius: var(--radius);
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.5;
  margin: 8px 0;
}

.message .body code {
  font-family: var(--font-mono);
  font-size: 13px;
  background: var(--bg);
  padding: 1px 4px;
  border-radius: 3px;
}

.message .body pre code {
  background: none;
  padding: 0;
}

/* ── Thinking ── */
.thinking-block {
  margin: 8px 0;
  padding: 10px 14px;
  background: var(--bg-tertiary);
  border-radius: var(--radius);
  font-style: italic;
  color: var(--fg-dim);
  font-size: 13px;
  border-left: 2px solid var(--fg-muted);
  display: none;
}

/* ── Tool blocks ── */
.tool-block {
  margin: 8px 0;
  padding: 10px 14px;
  background: var(--bg);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-size: 13px;
  display: none;
}

.tool-block .tool-header {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.tool-block.call .tool-header { color: var(--yellow); }
.tool-block.result .tool-header { color: var(--fg-dim); }
.tool-block.result.error .tool-header { color: var(--red); }

.tool-block .tool-args {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-dim);
  margin-left: 16px;
  line-height: 1.6;
}

.tool-block .tool-output {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-dim);
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
  margin-top: 6px;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  line-height: 1.5;
}

.tool-block .tool-output.expandable {
  max-height: 100px;
  cursor: pointer;
}

.tool-block .tool-output.expanded { max-height: none; }

/* ── Tool result messages (separate) ── */
.message.toolResult {
  border-left-color: var(--fg-muted);
  display: none;
}

.message.toolResult.error { border-left-color: var(--red); }

.message.toolResult .role-label { color: var(--fg-dim); }

.message.toolResult .tool-output {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-dim);
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
  padding: 8px;
  background: var(--bg);
  border-radius: 4px;
  line-height: 1.5;
}

/* ── Back link ── */
.back-link {
  display: inline-block;
  margin-bottom: 16px;
  color: var(--accent);
  text-decoration: none;
  font-size: 13px;
}

.back-link:hover { text-decoration: underline; }

/* ── Empty state ── */
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--fg-muted);
  font-size: 16px;
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--fg-muted); }

/* ── Index page ── */
.index-container {
  max-width: 900px;
  margin: 40px auto;
  padding: 0 20px;
}

.index-container h1 {
  font-size: 24px;
  margin-bottom: 8px;
  color: var(--accent);
}

.index-container .meta {
  color: var(--fg-muted);
  font-size: 13px;
  margin-bottom: 28px;
  line-height: 1.7;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.session-card {
  background: var(--bg-secondary);
  border-radius: var(--radius);
  padding: 16px 20px;
  border-left: 3px solid var(--accent-dim);
  transition: border-color 0.15s, background 0.15s;
  cursor: pointer;
  text-decoration: none;
  color: inherit;
  display: block;
}

.session-card:hover {
  border-left-color: var(--accent);
  background: var(--bg-tertiary);
}

.session-card .session-date {
  font-size: 12px;
  color: var(--fg-muted);
  font-family: var(--font-mono);
}

.session-card .session-name {
  font-size: 15px;
  font-weight: 600;
  margin: 4px 0;
}

.session-card .session-stats {
  font-size: 12px;
  color: var(--fg-dim);
  margin-top: 4px;
}
`;
}

// ─── JavaScript ───────────────────────────────────────────────────────────────────

function sessionJs(): string {
  return `
const SESSION_DATA = JSON.parse(document.getElementById('session-data').textContent);
let showThinking = false;
let showToolCalls = false;

function buildTree(container) {
  container.innerHTML = '';
  const entries = SESSION_DATA.entries || [];
  if (entries.length === 0) return;

  const byId = {};
  const roots = [];
  for (const e of entries) {
    byId[e.id] = e;
  }
  for (const e of entries) {
    if (!e.parentId || !byId[e.parentId]) {
      roots.push(e);
    } else {
      const parent = byId[e.parentId];
      if (!parent.children) parent.children = [];
      parent.children.push(e);
    }
  }

  function renderNode(entry, depth) {
    const div = document.createElement('div');
    div.className = 'tree-entry';
    div.style.paddingLeft = (depth * 14 + 12) + 'px';
    div.setAttribute('data-id', entry.id);

    let prefix = '', label = '';

    if (entry.type === 'message') {
      if (entry.role === 'user') {
        prefix = '👤'; label = (extractText(entry.content) || '').slice(0, 50);
      } else if (entry.role === 'assistant') {
        prefix = '🤖'; label = (extractText(entry.content) || '').slice(0, 50);
        // Add thinking/tool sub-entries
        const subContainer = container;
        if (entry.content) {
          for (const block of entry.content) {
            if (block.type === 'toolCall') {
              const toolDiv = document.createElement('div');
              toolDiv.className = 'tree-entry toolcall-entry';
              toolDiv.style.paddingLeft = ((depth + 2) * 14 + 12) + 'px';
              toolDiv.innerHTML = '<span class="prefix">🔧</span> ' + (block.name || 'tool');
              toolDiv.onclick = (e) => {
                e.stopPropagation();
                const el = document.getElementById(entry.id + '_tool_' + block.name);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              };
              div.insertAdjacentElement('afterend', toolDiv);
            } else if (block.type === 'thinking') {
              const thinkDiv = document.createElement('div');
              thinkDiv.className = 'tree-entry thinking-entry';
              thinkDiv.style.paddingLeft = ((depth + 2) * 14 + 12) + 'px';
              thinkDiv.innerHTML = '<span class="prefix">💭</span> thinking';
              thinkDiv.onclick = (e) => {
                e.stopPropagation();
                const el = document.getElementById(entry.id + '_think');
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              };
              div.insertAdjacentElement('afterend', thinkDiv);
              break;
            }
          }
        }
      } else if (entry.role === 'toolResult') {
        prefix = '📋'; label = entry.toolName || 'result';
        div.className += ' toolresult-entry' + (entry.isError ? ' error' : '');
      }
    }

    div.innerHTML = '<span class="prefix">' + prefix + '</span> ' + label;
    div.onclick = () => {
      const el = document.getElementById('msg-' + entry.id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      container.querySelectorAll('.tree-entry.active').forEach(e => e.classList.remove('active'));
      div.classList.add('active');
    };
    container.appendChild(div);

    if (entry.children) {
      for (const child of entry.children) {
        renderNode(child, depth + 1);
      }
    }
  }

  for (const root of roots) renderNode(root, 0);
}

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content.filter(c => c.type === 'text' && c.text).map(c => c.text).join(' ').slice(0, 100);
}

function renderContent() {
  const container = document.getElementById('messages');
  const entries = SESSION_DATA.entries || [];
  let html = '';

  for (const entry of entries) {
    if (entry.type !== 'message') continue;

    const roleClass = entry.role === 'toolResult' ? 'toolResult' + (entry.isError ? ' error' : '') : entry.role;
    html += '<div class="message ' + roleClass + '" id="msg-' + entry.id + '">';

    if (entry.role === 'user') {
      html += '<div class="role-label">User<span class="timestamp">' + (entry.timestamp || '') + '</span></div>';
      html += '<div class="body">' + renderText(entry.content) + '</div>';
    } else if (entry.role === 'assistant') {
      html += '<div class="role-label">Assistant<span class="timestamp">' + (entry.timestamp || '') + '</span></div>';
      html += '<div class="body">';
      if (entry.content) {
        for (const block of entry.content) {
          if (block.type === 'text' && block.text) {
            html += formatMd(block.text);
          } else if (block.type === 'thinking' && block.thinking) {
            html += '<div class="thinking-block" id="' + entry.id + '_think"><strong>💭 Thinking:</strong><br>' + esc(block.thinking) + '</div>';
          } else if (block.type === 'toolCall') {
            const args = block.arguments || {};
            const argsStr = Object.entries(args)
              .filter(([,v]) => v !== null && v !== undefined)
              .map(([k,v]) => k + ': ' + (typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v)))
              .join('<br>');
            html += '<div class="tool-block call" id="' + entry.id + '_tool_' + (block.name||'') + '">' +
              '<div class="tool-header">🔧 ' + (block.name||'tool') + '</div>' +
              '<div class="tool-args">' + (argsStr||'(no args)') + '</div></div>';
          }
        }
      }
      html += '</div>';
    } else if (entry.role === 'toolResult') {
      html += '<div class="role-label">📋 ' + (entry.toolName||'result') + '<span class="timestamp">' + (entry.timestamp||'') + '</span></div>';
      const out = extractText(entry.content) || '(empty)';
      html += '<div class="tool-output">' + esc(out) + '</div>';
    }
    html += '</div>';
  }

  container.innerHTML = html;
  applyToggles();
}

function renderText(content) {
  if (!content) return '';
  if (typeof content === 'string') return formatMd(content);
  return content.filter(c => c.type === 'text' && c.text).map(c => formatMd(c.text)).join('');
}

function formatMd(text) {
  let html = esc(text);
  html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
  html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  html = html.replace(/(https?:\\/\\/[^\\s<]+)/g, '<a href="$1" target="_blank" style="color:var(--accent)">$1</a>');
  html = html.replace(/\\n/g, '<br>');
  return html;
}

function esc(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyToggles() {
  document.querySelectorAll('.thinking-block').forEach(el => {
    el.style.display = showThinking ? '' : 'none';
  });
  document.querySelectorAll('.tool-block').forEach(el => {
    el.style.display = showToolCalls ? '' : 'none';
  });
  document.querySelectorAll('.message.toolResult').forEach(el => {
    el.style.display = showToolCalls ? '' : 'none';
  });
  document.querySelectorAll('.tree-entry.toolcall-entry, .tree-entry.toolresult-entry').forEach(el => {
    el.style.display = showToolCalls ? '' : 'none';
  });
  document.querySelectorAll('.tree-entry.thinking-entry').forEach(el => {
    el.style.display = showThinking ? '' : 'none';
  });
}

function initResizer() {
  const sidebar = document.getElementById('sidebar');
  const resizer = document.getElementById('resizer');
  let sx, sw;
  resizer.addEventListener('mousedown', (e) => {
    sx = e.clientX; sw = sidebar.offsetWidth;
    resizer.classList.add('active');
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!resizer.classList.contains('active')) return;
    sidebar.style.width = Math.max(200, Math.min(sw + e.clientX - sx, innerWidth * 0.5)) + 'px';
  });
  document.addEventListener('mouseup', () => {
    resizer.classList.remove('active');
    document.body.style.userSelect = '';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  renderContent();
  buildTree(document.getElementById('tree-container'));
  document.getElementById('toggle-thinking').addEventListener('change', (e) => {
    showThinking = e.target.checked; applyToggles();
  });
  document.getElementById('toggle-tools').addEventListener('change', (e) => {
    showToolCalls = e.target.checked; applyToggles();
  });
  initResizer();
});
`;
}

function sessionHtml(sessionName: string, metadata: Record<string, unknown>, entriesJson: string): string {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>' + escHtml(sessionName) + ' — super_sessions</title>\n  <style>' + css() + '</style>\n</head>\n<body>\n  <div id="app">\n    <aside id="sidebar">\n      <div class="sidebar-header">\n        <h2>' + escHtml(sessionName) + '</h2>\n        <div class="sidebar-meta">\n          Date: ' + escHtml(String(metadata.date || "")) + '<br>\n          Messages: ' + (metadata.messageCount || 0) + '\n        </div>\n      </div>\n      <div class="toggles">\n        <label><input type="checkbox" id="toggle-thinking"> Show thinking</label>\n        <label><input type="checkbox" id="toggle-tools"> Show tools</label>\n      </div>\n      <div class="tree-container" id="tree-container"></div>\n    </aside>\n    <div id="resizer"></div>\n    <main id="content">\n      <a href="index.html" class="back-link">← All sessions</a>\n      <div id="messages"></div>\n    </main>\n  </div>\n  <script id="session-data" type="application/json">' + entriesJson + '</script>\n  <script>' + sessionJs() + '</script>\n</body>\n</html>';
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Index Page ───────────────────────────────────────────────────────────────────

function indexHtml(sessions: SessionMeta[]): string {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const cards = sorted
    .map((s) => {
      const dateStr = s.date;
      const shortId = s.id.length > 8 ? s.id.slice(0, 8) : s.id;
      const label = s.name || "Untitled session";
      const htmlFile = `${dateStr}_${shortId}.html`;
      return (
        '<a href="' + htmlFile + '" class="session-card">\n' +
        '  <div class="session-date">' + dateStr + '</div>\n' +
        '  <div class="session-name">' + escHtml(label) + '</div>\n' +
        '  <div class="session-stats">' + s.messageCount + ' messages · ' + shortId + '</div>\n' +
        '</a>'
      );
    })
    .join("\n");

  return (
    '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Session Archive — super_sessions</title>\n  <style>' +
    css() +
    "</style>\n</head>\n<body>\n  <div class=\"index-container\">\n    <h1>Session Archive</h1>\n    <div class=\"meta\">\n      Project: " +
    escHtml(process.cwd()) +
    "<br>\n      Generated: " +
    new Date().toISOString() +
    "<br>\n      Sessions: " +
    sorted.length +
    '\n    </div>\n    <div class="session-list">\n      ' +
    cards +
    "\n    </div>\n  </div>\n</body>\n</html>"
  );
}

// ─── Main Generator ───────────────────────────────────────────────────────────────

export function generateSessionHtml(
  sessionPath: string,
  meta: SessionMeta,
  htmlDir: string,
): string {
  // Parse session entries from JSONL
  const allEntries = parseSessionEntries(sessionPath);
  const branch = getActiveBranch(allEntries);
  const serialized = branch.map(serializeEntryForHtml);

  const sessionData = {
    sessionId: meta.id,
    date: meta.date,
    name: meta.name,
    entries: serialized,
  };

  const entriesJson = JSON.stringify(sessionData);
  const sessionName = meta.name || "Untitled session";
  const metadata = {
    date: meta.date,
    sessionId: meta.id,
    messageCount: meta.messageCount,
  };

  const dateStr = meta.date;
  const shortId = meta.id.length > 8 ? meta.id.slice(0, 8) : meta.id;
  const htmlFile = `${dateStr}_${shortId}.html`;

  const html = sessionHtml(sessionName, metadata, entriesJson);
  const htmlPath = path.join(htmlDir, htmlFile);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf-8");

  return htmlFile;
}

export function generateIndexHtml(sessions: SessionMeta[], htmlDir: string): string {
  const html = indexHtml(sessions);
  const indexPath = path.join(htmlDir, "index.html");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, html, "utf-8");
  return indexPath;
}
