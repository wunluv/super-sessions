/**
 * HTML browser generation for session exports.
 * Generates per-session viewer and index.html selector.
 * Uses Alpine.js for reactive interactivity — no vanilla JS DOM manipulation.
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

function parseSessionEntries(sessionPath: string): SessionEntry[] {
  try {
    const content = fs.readFileSync(sessionPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const entries: SessionEntry[] = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]);
        entries.push(entry);
      } catch { /* skip unparseable */ }
    }
    return entries;
  } catch {
    return [];
  }
}

function getActiveBranch(entries: SessionEntry[]): SessionEntry[] {
  if (entries.length === 0) return [];
  const byId = new Map<string, SessionEntry>();
  for (const e of entries) { if (e.id) byId.set(e.id, e); }
  const hasChildren = new Set<string>();
  for (const e of entries) { if (e.parentId) hasChildren.add(e.parentId); }
  let leaf: SessionEntry | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].id && !hasChildren.has(entries[i].id!)) { leaf = entries[i]; break; }
  }
  if (!leaf) leaf = entries[entries.length - 1];
  const branch: SessionEntry[] = [];
  let cur: SessionEntry | undefined = leaf;
  while (cur) {
    branch.unshift(cur);
    if (cur.parentId) cur = byId.get(cur.parentId);
    else break;
  }
  return branch;
}

// ─── Serialization ────────────────────────────────────────────────────────────────

function serializeForHtml(entry: SessionEntry): Record<string, unknown> {
  const msg = entry.message;
  if (!msg) return { type: entry.type, id: entry.id, parentId: entry.parentId };

  const content = msg.content;
  let blocks: unknown[] = [];

  if (Array.isArray(content)) {
    blocks = (content as ContentBlock[]).map((block) => {
      if (block.type === "thinking") {
        return { type: "thinking", html: escHtml(block.thinking || "") };
      }
      if (block.type === "text") {
        return { type: "text", html: mdToHtml(block.text || "") };
      }
      if (block.type === "toolCall") {
        const args: Record<string, string> = {};
        if (block.arguments) {
          for (const [k, v] of Object.entries(block.arguments)) {
            if (typeof v === "string") args[k] = v;
            else if (typeof v === "number" || typeof v === "boolean") args[k] = String(v);
          }
        }
        return { type: "toolCall", name: block.name || "tool", id: block.id, args };
      }
      return block;
    });
  } else if (typeof content === "string") {
    blocks = [{ type: "text", html: mdToHtml(content) }];
  }

  // Flatten assistant content: produce separate "display" entries for each block
  // so Alpine can iterate and show/hide them individually
  const displayBlocks: Record<string, unknown>[] = [];
  if (msg.role === "assistant" && Array.isArray(blocks)) {
    for (const b of blocks as Record<string, unknown>[]) {
      displayBlocks.push({ ...b, entryId: entry.id || "" });
    }
  }

  return {
    type: "message",
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp || (msg.timestamp ? new Date(msg.timestamp).toISOString() : ""),
    role: msg.role,
    displayBlocks,
    toolCallId: msg.toolCallId,
    toolName: msg.toolName,
    isError: msg.isError,
    // For tool results, extract text
    resultText: msg.role === "toolResult" ? extractText(msg.content) : "",
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mdToHtml(text: string): string {
  let html = escHtml(text);
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Links
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
  // Line breaks
  html = html.replace(/\n/g, "<br>");
  return html;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────────

function css(): string {
  return `
:root {
  --bg: #1a1b26; --bg2: #24283b; --bg3: #1f2335;
  --fg: #c0caf5; --fg2: #9aa5ce; --fg3: #565f89;
  --accent: #7aa2f7; --accent2: #3d59a1;
  --green: #9ece6a; --red: #f7768e; --yellow: #e0af68;
  --border: #3b4261; --radius: 6px;
  --mono: 'JetBrains Mono','Fira Code',monospace;
  --sans: -apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--sans);font-size:14px;line-height:1.65;background:var(--bg);color:var(--fg)}
#app{display:flex;height:100vh;overflow:hidden}

/* Sidebar */
#sidebar{width:300px;min-width:200px;max-width:50%;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden}
.sidebar-hd{padding:14px 12px 10px;border-bottom:1px solid var(--border)}
.sidebar-hd h2{font-size:15px;font-weight:600;color:var(--accent)}
.sidebar-meta{font-size:11px;color:var(--fg3);line-height:1.7;margin-top:4px}
.toggles{padding:10px 12px;border-bottom:1px solid var(--border);display:flex;gap:16px;flex-wrap:wrap}
.toggles label{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--fg2);cursor:pointer;user-select:none}
.toggles input[type=checkbox]{accent-color:var(--accent)}

/* Tree */
.tree{flex:1;overflow-y:auto;padding:6px 0;font-size:11px;font-family:var(--mono)}
.tree-entry{padding:3px 12px;cursor:pointer;border-left:3px solid transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .1s}
.tree-entry:hover{background:var(--bg3)}
.tree-entry.active{background:var(--accent2);border-left-color:var(--accent)}
.tree-entry .pfx{color:var(--fg3);margin-right:4px}
.tree-entry.thk{color:var(--fg3);font-style:italic}
.tree-entry.tool{color:var(--yellow)}
.tree-entry.result{color:var(--fg2)}
.tree-entry.result.err{color:var(--red)}

/* Resizer */
#resizer{width:4px;cursor:col-resize;background:transparent;transition:background .15s;flex-shrink:0}
#resizer:hover,#resizer.drag{background:var(--accent)}

/* Content */
#content{flex:1;overflow-y:auto;padding:24px 32px}
.msg{margin-bottom:16px;padding:12px 16px;border-radius:var(--radius);background:var(--bg2)}
.msg.user{border-left:3px solid var(--accent);margin-right:48px}
.msg.assistant{border-left:3px solid var(--green);margin-left:24px;margin-right:24px}
.msg.toolResult{border-left:3px solid var(--fg3)}
.msg.toolResult.error{border-left-color:var(--red)}
.msg .lbl{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
.msg.user .lbl{color:var(--accent)}
.msg.assistant .lbl{color:var(--green)}
.msg.toolResult .lbl{color:var(--fg2)}
.msg .ts{font-size:10px;color:var(--fg3);margin-left:8px;font-weight:400}
.msg .body{font-size:14px;line-height:1.75}
.msg .body p{margin-bottom:8px}
.msg .body p:last-child{margin-bottom:0}
.msg .body pre{background:var(--bg);padding:10px 12px;border-radius:var(--radius);overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.5;margin:8px 0}
.msg .body code{font-family:var(--mono);font-size:13px;background:var(--bg);padding:1px 4px;border-radius:3px}
.msg .body pre code{background:none;padding:0}
.msg .body a{color:var(--accent)}

/* Thinking & Tool blocks */
.thk-block{margin:8px 0;padding:10px 14px;background:var(--bg3);border-radius:var(--radius);font-style:italic;color:var(--fg2);font-size:13px;border-left:2px solid var(--fg3)}
.tblock{margin:8px 0;padding:10px 14px;background:var(--bg);border-radius:var(--radius);border:1px solid var(--border);font-size:13px}
.tblock .thd{font-family:var(--mono);font-size:12px;font-weight:600;margin-bottom:6px;color:var(--yellow)}
.tblock .targs{font-family:var(--mono);font-size:12px;color:var(--fg2);margin-left:16px;line-height:1.6}
.tblock .tout{font-family:var(--mono);font-size:12px;color:var(--fg2);white-space:pre-wrap;max-height:300px;overflow-y:auto;margin-top:6px;padding:8px;background:var(--bg2);border-radius:4px;line-height:1.5}
.msg.toolResult .tout{font-family:var(--mono);font-size:12px;color:var(--fg2);white-space:pre-wrap;max-height:400px;overflow-y:auto;padding:8px;background:var(--bg);border-radius:4px;line-height:1.5}

/* Back link */
.back{display:inline-block;margin-bottom:16px;color:var(--accent);text-decoration:none;font-size:13px}
.back:hover{text-decoration:underline}

/* Scrollbar */
::-webkit-scrollbar{width:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--fg3)}

/* Index page */
.ic{max-width:900px;margin:40px auto;padding:0 20px}
.ic h1{font-size:24px;margin-bottom:8px;color:var(--accent)}
.ic .meta{color:var(--fg3);font-size:13px;margin-bottom:20px;line-height:1.7}
.ic .search{margin-bottom:20px}
.ic .search input{width:100%;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);color:var(--fg);font-size:14px;outline:none;font-family:var(--sans)}
.ic .search input:focus{border-color:var(--accent)}
.ic .search input::placeholder{color:var(--fg3)}
.slist{display:flex;flex-direction:column;gap:12px}
.scard{background:var(--bg2);border-radius:var(--radius);padding:16px 20px;border-left:3px solid var(--accent2);transition:border-color .15s,background .15s;cursor:pointer;text-decoration:none;color:inherit;display:block}
.scard:hover{border-left-color:var(--accent);background:var(--bg3)}
.scard .sd{font-size:12px;color:var(--fg3);font-family:var(--mono)}
.scard .sn{font-size:15px;font-weight:600;margin:4px 0}
.scard .ss{font-size:12px;color:var(--fg2);margin-top:4px}
`;
}

// ─── Alpine.js Session Viewer ─────────────────────────────────────────────────────

function alpineSessionHtml(
  sessionName: string,
  metadata: Record<string, unknown>,
  entriesJson: string,
): string {
  // Build tree items: each message entry becomes a tree node.
  // For assistant entries with displayBlocks, also create sub-nodes.
  const entries = JSON.parse(entriesJson).entries as Record<string, unknown>[];

  // Pre-build tree nodes for the sidebar
  const treeNodes: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const eid = String(entry.id || "");
    const role = String(entry.role || "");

    let prefix = "", cssClass = "";
    if (role === "user") { prefix = "👤"; }
    else if (role === "assistant") {
      prefix = "🤖";
      // Add thinking/tool sub-nodes
      const blocks = entry.displayBlocks as Record<string, unknown>[] | undefined;
      if (blocks) {
        for (const b of blocks) {
          if (b.type === "thinking") {
            const kid = `${eid}_think`;
            if (!seenIds.has(kid)) {
              seenIds.add(kid);
              treeNodes.push({ id: kid, label: "thinking", prefix: "💭", cssClass: "thk", depth: (entry._depth || 0) + 2, parentId: eid });
            }
          } else if (b.type === "toolCall") {
            const kid = `${eid}_tool_${b.name || "tool"}`;
            if (!seenIds.has(kid)) {
              seenIds.add(kid);
              treeNodes.push({ id: kid, label: String(b.name || "tool"), prefix: "🔧", cssClass: "tool", depth: (entry._depth || 0) + 2, parentId: eid });
            }
          }
        }
      }
    }
    else if (role === "toolResult") {
      prefix = "📋";
      cssClass = entry.isError ? "result err" : "result";
    }

    if (!seenIds.has(eid)) {
      seenIds.add(eid);
      // Extract label from first text block
      let label = "";
      const blocks = entry.displayBlocks as Record<string, unknown>[] | undefined;
      if (blocks) {
        for (const b of blocks) {
          if (b.type === "text" && b.html) {
            label = stripHtml(String(b.html)).slice(0, 50);
            break;
          }
        }
      }
      if (!label && role === "toolResult") label = String(entry.toolName || "result");

      treeNodes.push({
        id: eid,
        label,
        prefix,
        cssClass,
        depth: entry._depth || 0,
        parentId: entry.parentId || null,
      });
    }
  }

  // Determine depth from parentId chain
  const byId = new Map(treeNodes.map(n => [n.id, n]));
  for (const node of treeNodes) {
    if (!node.depth || node.depth === 0) {
      let d = 0;
      let cur = node.parentId ? byId.get(node.parentId as string) : null;
      while (cur) { d++; cur = cur.parentId ? byId.get(cur.parentId as string) : null; }
      node.depth = d;
    }
  }

  const treeJson = JSON.stringify(treeNodes);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(sessionName)} — super_sessions</title>
<style>${css()}</style>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
</head>
<body>
<div id="app" x-data="sessionViewer()" x-init="init($el)">
  <!-- Sidebar -->
  <aside id="sidebar">
    <div class="sidebar-hd">
      <h2>${escHtml(sessionName)}</h2>
      <div class="sidebar-meta">
        Date: ${escHtml(String(metadata.date || ""))}<br>
        Messages: ${metadata.messageCount || 0}
      </div>
    </div>
    <div class="toggles">
      <label><input type="checkbox" x-model="showThinking"> Show thinking</label>
      <label><input type="checkbox" x-model="showTools"> Show tools</label>
    </div>
    <div class="tree">
      <template x-for="node in filteredTree" :key="node.id">
        <div class="tree-entry"
             :class="[node.cssClass || '', activeId === node.id ? 'active' : '']"
             :style="'padding-left:' + (node.depth * 14 + 12) + 'px'"
             @click="scrollTo(node.id)">
          <span class="pfx" x-text="node.prefix"></span>
          <span x-text="node.label"></span>
        </div>
      </template>
    </div>
  </aside>

  <!-- Resizer -->
  <div id="resizer"
       @mousedown="resizeStart"
       :class="{ drag: resizing }"></div>

  <!-- Content -->
  <main id="content">
    <a href="index.html" class="back">← All sessions</a>
    <div id="messages">
      <template x-for="entry in entries" :key="entry.id">
        <div class="msg" :class="msgClass(entry)" :id="'msg-' + entry.id">
          <div class="lbl">
            <span x-text="roleLabel(entry)"></span>
            <span class="ts" x-text="entry.timestamp"></span>
          </div>

          <!-- Assistant: iterate display blocks -->
          <template x-if="entry.role === 'assistant'">
            <div class="body">
              <template x-for="b in entry.displayBlocks" :key="b.entryId + b.type">
                <div>
                  <div x-show="b.type === 'text'" x-html="b.html"></div>
                  <div x-show="b.type === 'thinking' && showThinking"
                       class="thk-block" :id="entry.id + '_think'">
                    <strong>💭 Thinking:</strong><br>
                    <span x-html="b.html"></span>
                  </div>
                  <div x-show="b.type === 'toolCall' && showTools"
                       class="tblock" :id="entry.id + '_tool_' + (b.name || 'tool')">
                    <div class="thd">🔧 <span x-text="b.name"></span></div>
                    <div class="targs">
                      <template x-for="(v, k) in b.args" :key="k">
                        <div><span x-text="k + ': ' + v"></span></div>
                      </template>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </template>

          <!-- User: simple text -->
          <template x-if="entry.role === 'user'">
            <div class="body" x-html="entry.displayBlocks?.[0]?.html || ''"></div>
          </template>

          <!-- Tool result -->
          <template x-if="entry.role === 'toolResult'">
            <div>
              <div class="tout" x-show="showTools" x-text="entry.resultText"></div>
            </div>
          </template>
        </div>
      </template>
    </div>
  </main>
</div>
<script id="session-data" type="application/json">${entriesJson}</script>
<script>
// Register Alpine component
document.addEventListener('alpine:init', () => {
  Alpine.data('sessionViewer', () => ({
    entries: [],
    treeNodes: ${treeJson},
    activeId: '',
    showThinking: false,
    showTools: false,
    resizing: false,

    get filteredTree() {
      return this.treeNodes.filter(n => {
        if (n.cssClass === 'thk' && !this.showThinking) return false;
        if ((n.cssClass === 'tool' || n.cssClass === 'result' || n.cssClass === 'result err') && !this.showTools) return false;
        return true;
      });
    },

    init(el) {
      const raw = el.querySelector('#session-data')?.textContent;
      if (raw) {
        const data = JSON.parse(raw);
        this.entries = data.entries || [];
      }
    },

    scrollTo(id) {
      this.activeId = id;
      const el = document.getElementById('msg-' + id.split('_')[0]);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },

    msgClass(entry) {
      if (entry.role === 'toolResult') return 'toolResult' + (entry.isError ? ' error' : '');
      return entry.role || '';
    },

    roleLabel(entry) {
      if (entry.role === 'toolResult') return '📋 ' + (entry.toolName || 'result');
      if (entry.role === 'user') return 'User';
      if (entry.role === 'assistant') return 'Assistant';
      return entry.role || '';
    },

    resizeStart(e) {
      this.resizing = true;
      const sidebar = document.getElementById('sidebar');
      const sx = e.clientX;
      const sw = sidebar.offsetWidth;
      const onMove = (ev) => {
        sidebar.style.width = Math.max(200, Math.min(sw + ev.clientX - sx, innerWidth * 0.5)) + 'px';
      };
      const onUp = () => {
        this.resizing = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.userSelect = 'none';
    }
  }));
});
</script>
</body>
</html>`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// ─── Alpine.js Index Page ─────────────────────────────────────────────────────────

function alpineIndexHtml(sessions: SessionMeta[]): string {
  const sorted = [...sessions].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const cardsJson = JSON.stringify(
    sorted.map((s) => ({
      date: s.date,
      name: s.name || "Untitled session",
      id: s.id.length > 8 ? s.id.slice(0, 8) : s.id,
      messages: s.messageCount,
      file: `${s.date}_${s.id.length > 8 ? s.id.slice(0, 8) : s.id}.html`,
    })),
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Session Archive — super_sessions</title>
<style>${css()}</style>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
</head>
<body>
<div class="ic" x-data="{ query: '', sessions: ${cardsJson} }">
  <h1>Session Archive</h1>
  <div class="meta">
    Project: ${escHtml(process.cwd())}<br>
    Generated: ${new Date().toISOString()}<br>
    Sessions: <span x-text="filtered.length"></span>
    <span x-show="query"> matching "<span x-text="query"></span>"</span>
  </div>
  <div class="search">
    <input type="text" x-model="query" placeholder="Search sessions..."
           @input="document.querySelectorAll('.scard').forEach(el => el.scrollIntoView === undefined ? null : null)">
  </div>
  <div class="slist">
    <template x-for="s in filtered" :key="s.file">
      <a :href="s.file" class="scard">
        <div class="sd" x-text="s.date"></div>
        <div class="sn" x-text="s.name"></div>
        <div class="ss"><span x-text="s.messages"></span> messages · <span x-text="s.id"></span></div>
      </a>
    </template>
    <div x-show="filtered.length === 0" style="color:var(--fg3);text-align:center;padding:40px">
      No sessions match "<span x-text="query"></span>"
    </div>
  </div>
</div>
<script>
document.addEventListener('alpine:init', () => {
  Alpine.data('indexData', () => ({
    query: '',
    sessions: ${cardsJson},
    get filtered() {
      if (!this.query) return this.sessions;
      const q = this.query.toLowerCase();
      return this.sessions.filter(s =>
        s.name.toLowerCase().includes(q) || s.date.includes(q) || s.id.includes(q)
      );
    }
  }));
});
</script>
</body>
</html>`;
}

// ─── Main Generator ───────────────────────────────────────────────────────────────

export function generateSessionHtml(
  sessionPath: string,
  meta: SessionMeta,
  htmlDir: string,
): string {
  const allEntries = parseSessionEntries(sessionPath);
  const branch = getActiveBranch(allEntries);

  // Assign depth
  const byId = new Map<string, SessionEntry>();
  for (const e of branch) { if (e.id) byId.set(e.id, e); }
  const serialized = branch.map((e) => {
    let depth = 0;
    let cur: SessionEntry | undefined = e;
    while (cur?.parentId) { depth++; cur = byId.get(cur.parentId); }
    const s = serializeForHtml(e);
    (s as any)._depth = depth;
    return s;
  });

  const sessionData = { sessionId: meta.id, date: meta.date, name: meta.name, entries: serialized };
  const entriesJson = JSON.stringify(sessionData);
  const sessionName = meta.name || "Untitled session";
  const metadata = { date: meta.date, sessionId: meta.id, messageCount: meta.messageCount };

  const dateStr = meta.date;
  const shortId = meta.id.length > 8 ? meta.id.slice(0, 8) : meta.id;
  const htmlFile = `${dateStr}_${shortId}.html`;

  const html = alpineSessionHtml(sessionName, metadata, entriesJson);
  const htmlPath = path.join(htmlDir, htmlFile);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf-8");

  return htmlFile;
}

export function generateIndexHtml(sessions: SessionMeta[], htmlDir: string): string {
  const html = alpineIndexHtml(sessions);
  const indexPath = path.join(htmlDir, "index.html");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, html, "utf-8");
  return indexPath;
}
