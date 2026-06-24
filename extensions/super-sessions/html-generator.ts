/**
 * HTML browser generation for session exports.
 * Generates per-session viewer and index.html selector.
 *
 * Styling: Tailwind CSS (Play CDN) — light theme, utility classes.
 * Interactivity: Alpine.js — no vanilla JS DOM manipulation.
 *
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
      try { entries.push(JSON.parse(lines[i])); } catch { /* skip */ }
    }
    return entries;
  } catch { return []; }
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

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape </ sequences in JSON for safe embedding inside <script> tags */
function escScriptJson(json: string): string {
  return json.replace(/<\//g, "<\\/");
}

function mdToHtml(text: string): string {
  let h = escHtml(text);
  h = h.replace(/```([\s\S]*?)```/g, "<pre class=\"bg-gray-100 rounded-lg p-3 overflow-x-auto text-xs font-mono leading-relaxed my-2 border border-gray-200\"><code>$1</code></pre>");
  h = h.replace(/`([^`]+)`/g, "<code class=\"bg-gray-100 px-1 py-0.5 rounded text-xs font-mono text-pink-600\">$1</code>");
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(https?:\/\/[^\s<]+)/g, "<a href=\"$1\" target=\"_blank\" class=\"text-blue-600 underline\">$1</a>");
  h = h.replace(/\n/g, "<br>");
  return h;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as ContentBlock[])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text!)
    .join("\n");
}

function serializeForHtml(entry: SessionEntry): Record<string, unknown> {
  const msg = entry.message;
  if (!msg) return { type: entry.type, id: entry.id, parentId: entry.parentId };

  const content = msg.content;
  let blocks: unknown[] = [];

  if (Array.isArray(content)) {
    blocks = (content as ContentBlock[]).map((block) => {
      if (block.type === "thinking") return { type: "thinking", html: escHtml(block.thinking || "") };
      if (block.type === "text") return { type: "text", html: mdToHtml(block.text || "") };
      if (block.type === "toolCall") {
        const args: Record<string, string> = {};
        if (block.arguments) {
          for (const [k, v] of Object.entries(block.arguments)) {
            if (typeof v === "string") args[k] = v;
            else if (typeof v === "number" || typeof v === "boolean") args[k] = String(v);
          }
        }
        return { type: "toolCall", name: block.name || "tool", args };
      }
      return block;
    });
  } else if (typeof content === "string") {
    blocks = [{ type: "text", html: mdToHtml(content) }];
  }

  const displayBlocks: Record<string, unknown>[] = [];
  if (Array.isArray(blocks)) {
    for (const b of blocks as Record<string, unknown>[]) {
      displayBlocks.push({ ...b, entryId: entry.id || "" });
    }
  }

  return {
    type: "message", id: entry.id, parentId: entry.parentId,
    timestamp: entry.timestamp || (msg.timestamp ? new Date(msg.timestamp).toISOString() : ""),
    role: msg.role, displayBlocks,
    toolName: msg.toolName, isError: msg.isError,
    resultText: msg.role === "toolResult" ? escHtml(extractText(msg.content)) : "",
  };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// ─── Shared Styles ────────────────────────────────────────────────────────────────

function sharedStyles(): string {
  return `
#resizer.dragging { cursor: col-resize; }
html { scroll-behavior: smooth; }
[x-cloak] { display: none !important; }
`;
}

// ─── Session Viewer HTML ──────────────────────────────────────────────────────────

function sessionViewerHtml(
  sessionName: string,
  metadata: Record<string, unknown>,
  entriesJson: string,
): string {
  const entries = JSON.parse(entriesJson).entries as Record<string, unknown>[];
  const treeNodes: Record<string, unknown>[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const eid = String(entry.id || "");
    const role = String(entry.role || "");
    const depth = Number(entry._depth || 0);

    if (role === "assistant") {
      const blocks = entry.displayBlocks as Record<string, unknown>[] | undefined;
      if (blocks) {
        for (const b of blocks) {
          if (b.type === "thinking") {
            const kid = `${eid}_think`;
            if (!seenIds.has(kid)) {
              seenIds.add(kid);
              treeNodes.push({ id: kid, label: "thinking", prefix: "💭", kind: "think", depth: depth + 2, parentId: eid });
            }
          } else if (b.type === "toolCall") {
            const kid = `${eid}_tool_${b.name || "tool"}`;
            if (!seenIds.has(kid)) {
              seenIds.add(kid);
              treeNodes.push({ id: kid, label: String(b.name || "tool"), prefix: "🔧", kind: "tool", depth: depth + 2, parentId: eid });
            }
          }
        }
      }
    }

    if (!seenIds.has(eid)) {
      seenIds.add(eid);
      const prefix = role === "user" ? "👤" : role === "assistant" ? "🤖" : role === "toolResult" ? "📋" : "📄";
      let label = "";
      const blocks = entry.displayBlocks as Record<string, unknown>[] | undefined;
      if (blocks) {
        for (const b of blocks) {
          if (b.type === "text" && b.html) { label = stripHtml(String(b.html)).slice(0, 50); break; }
        }
      }
      if (!label && role === "toolResult") label = String(entry.toolName || "result");
      treeNodes.push({ id: eid, label, prefix, kind: role, depth, parentId: entry.parentId || null });
    }
  }

  // Recalculate depth from parent chain
  const byId = new Map(treeNodes.map(n => [n.id, n]));
  for (const node of treeNodes) {
    let d = Number(node.depth || 0);
    if (d === 0) {
      let cur = node.parentId ? byId.get(node.parentId as string) : null;
      while (cur) { d++; cur = cur.parentId ? byId.get(cur.parentId as string) : null; }
      node.depth = d;
    }
  }

  const treeJson = JSON.stringify(treeNodes);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(sessionName)} — super_sessions</title>
<script src="https://cdn.tailwindcss.com"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
<style>${sharedStyles()}</style>
</head>
<body class="bg-white text-gray-900 font-sans antialiased">
<noscript><div class="flex items-center justify-center h-screen text-gray-400"><p>JavaScript required. Alpine.js may have failed to load.</p></div></noscript>
<div id="app" x-data="sessionViewer" x-init="init()" x-cloak class="flex h-screen overflow-hidden">

  <!-- === SIDEBAR === -->
  <aside id="sidebar"
    class="w-80 min-w-[200px] max-w-[50%] bg-gray-50 border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
    <!-- Header -->
    <div class="p-3 border-b border-gray-200 shrink-0">
      <h2 class="text-xs font-semibold text-blue-600 truncate leading-snug">${escHtml(sessionName)}</h2>
      <div class="text-[11px] text-gray-400 mt-1">
        ${escHtml(String(metadata.date || ""))} · ${metadata.messageCount || 0} msgs
      </div>
    </div>

    <!-- Toggles -->
    <div class="px-3 py-2 border-b border-gray-200 flex gap-4 shrink-0">
      <label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
        <input type="checkbox" x-model="showThinking"
               class="w-3.5 h-3.5 rounded border-gray-300 text-blue-600">
        <span>💭 Thinking</span>
      </label>
      <label class="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
        <input type="checkbox" x-model="showTools"
               class="w-3.5 h-3.5 rounded border-gray-300 text-blue-600">
        <span>🔧 Tools</span>
      </label>
    </div>

    <!-- Tree -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden py-1 font-sans text-xs leading-relaxed">
      <template x-for="node in filteredTree" :key="node.id">
        <div @click="scrollTo(node.id)"
             :class="{
               'bg-blue-100 border-l-blue-500 font-medium': activeId === node.id,
               'border-l-transparent hover:bg-gray-100': activeId !== node.id,
               'italic text-gray-400': node.kind === 'think',
               'text-amber-700': node.kind === 'tool',
               'text-gray-400 text-[11px]': node.kind === 'toolResult',
               'text-gray-800 font-medium': node.kind === 'user',
               'text-gray-600': node.kind === 'assistant'
             }"
             :style="'padding-left:' + (node.depth * 12 + 12) + 'px'"
             class="w-full py-1 pr-3 border-l-[3px] cursor-pointer truncate transition-colors"
             :title="node.label || 'user message'">
          <span class="mr-1.5" x-text="node.prefix"></span>
          <span x-text="node.label || '(message)'"></span>
        </div>
      </template>
    </div>
  </aside>

  <!-- === RESIZER === -->
  <div id="resizer"
       @mousedown="resizeStart"
       :class="{ 'dragging bg-blue-300': resizing }"
       class="w-1 cursor-col-resize bg-transparent hover:bg-blue-200 transition-colors shrink-0"></div>

  <!-- === CONTENT === -->
  <main class="flex-1 overflow-y-auto bg-gray-50/30">
    <div class="max-w-3xl mx-auto px-6 py-6">
      <a href="index.html" class="inline-block text-xs text-gray-400 hover:text-blue-600 mb-6 transition-colors">← All sessions</a>

      <div class="space-y-4">
        <template x-for="entry in entries" :key="entry.id">
          <div :id="'msg-' + entry.id">

            <!-- User message -->
            <div x-show="entry.role === 'user'"
                 class="border-l-4 border-blue-500 bg-white rounded-r-lg pl-4 py-3 mb-4 shadow-sm">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-blue-600">User</span>
                <span class="text-[10px] text-gray-400" x-text="entry.timestamp"></span>
              </div>
              <div class="text-sm leading-relaxed text-gray-700"
                   x-html="entry.displayBlocks?.[0]?.html || ''"></div>
            </div>

            <!-- Assistant message -->
            <div x-show="entry.role === 'assistant'"
                 class="border-l-4 border-emerald-500 bg-white rounded-r-lg pl-4 py-3 mb-4 ml-6 shadow-sm">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Assistant</span>
                <span class="text-[10px] text-gray-400" x-text="entry.timestamp"></span>
              </div>
              <div class="space-y-2">
                <template x-for="b in entry.displayBlocks" :key="b.entryId + b.type">
                  <div>
                    <div x-show="b.type === 'text'"
                         class="text-sm leading-relaxed text-gray-700"
                         x-html="b.html"></div>
                    <div x-show="b.type === 'thinking' && showThinking"
                         :id="entry.id + '_think'"
                         class="bg-gray-50 border-l-2 border-gray-300 pl-3 py-2 rounded-r text-[13px] text-gray-500 italic">
                      <div class="text-[10px] font-semibold text-gray-400 mb-1">💭 Thinking</div>
                      <span x-html="b.html"></span>
                    </div>
                    <div x-show="b.type === 'toolCall' && showTools"
                         :id="entry.id + '_tool_' + (b.name || 'tool')"
                         class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs">
                      <div class="font-mono font-semibold text-amber-600 mb-1.5">🔧 <span x-text="b.name"></span></div>
                      <div class="font-mono text-gray-500 ml-3 space-y-0.5">
                        <template x-for="(v, k) in b.args" :key="k">
                          <div><span x-text="k + ': ' + v"></span></div>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Tool result -->
            <div x-show="entry.role === 'toolResult' && showTools"
                 class="border-l-4 bg-white rounded-r-lg pl-4 py-3 mb-4 ml-12 shadow-sm"
                 :class="entry.isError ? 'border-red-500' : 'border-gray-300'">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-[10px] font-semibold uppercase tracking-wider"
                      :class="entry.isError ? 'text-red-600' : 'text-gray-500'">
                  📋 <span x-text="entry.toolName || 'result'"></span>
                </span>
                <span class="text-[10px] text-gray-400" x-text="entry.timestamp"></span>
              </div>
              <pre class="text-xs text-gray-600 font-mono leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto bg-gray-50 rounded-lg p-3 border border-gray-200"
                   x-text="entry.resultText"></pre>
            </div>

          </div>
        </template>
      </div>

      <div x-show="entries.length === 0" class="text-center text-gray-400 py-20">
        No messages in this session.
      </div>
    </div>
  </main>

  <!-- session-data MUST be inside #app so init() finds it -->
  <script id="session-data" type="application/json">${entriesJson}</script>
</div>
<!-- FALLBACK: shown when Alpine fails to load -->
<div id="fallback" class="hidden flex items-center justify-center h-screen text-gray-400 bg-white">
  <div class="text-center">
    <p class="text-lg mb-2">Unable to load session viewer.</p>
    <p class="text-sm">Check your network connection or open the <a href="index.html" class="text-blue-600 underline">session index</a>.</p>
  </div>
</div>
<script>
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
        if (n.kind === 'think' && !this.showThinking) return false;
        if ((n.kind === 'tool' || n.kind === 'toolResult') && !this.showTools) return false;
        return true;
      });
    },

    init() {
      const el = document.getElementById('session-data');
      if (el?.textContent) {
        const data = JSON.parse(el.textContent);
        this.entries = data.entries || [];
      }
    },

    scrollTo(id) {
      this.activeId = id;
      const baseId = id.split('_')[0];
      const msgEl = document.getElementById('msg-' + baseId);
      if (msgEl) {
        const subEl = document.getElementById(id);
        if (subEl && subEl !== msgEl) subEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else msgEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },

    resizeStart(e) {
      this.resizing = true;
      const bar = document.getElementById('sidebar');
      const sx = e.clientX, sw = bar.offsetWidth;
      const mv = (ev) => bar.style.width = Math.max(200, Math.min(sw + ev.clientX - sx, innerWidth * 0.5)) + 'px';
      const up = () => {
        this.resizing = false;
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
      document.body.style.userSelect = 'none';
    }
  }));
});
</script>
<script>
// Fallback: if Alpine doesn't init within 3s, show fallback
setTimeout(() => {
  const app = document.getElementById('app');
  if (app && app.hasAttribute('x-cloak')) {
    app.style.display = 'none';
    const fb = document.getElementById('fallback');
    if (fb) fb.style.display = 'flex';
  }
}, 3000);
</script>
</body>
</html>`;
  return html;
}

// ─── Index Page HTML ──────────────────────────────────────────────────────────────

function indexPageHtml(sessions: SessionMeta[]): string {
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
<script src="https://cdn.tailwindcss.com"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
<style>${sharedStyles()}</style>
</head>
<body class="bg-white text-gray-900 font-sans antialiased min-h-screen">
<noscript><div class="flex items-center justify-center min-h-screen text-gray-400"><p>JavaScript required to browse sessions.</p></div></noscript>
<div class="max-w-2xl mx-auto px-6 py-12" x-data="indexData" x-cloak>

  <div class="mb-8">
    <h1 class="text-2xl font-bold text-blue-600 mb-2">Session Archive</h1>
    <p class="text-sm text-gray-400">
      ${escHtml(process.cwd())}<br>
      Generated ${new Date().toISOString().split("T")[0]}
    </p>
  </div>

  <div class="mb-6">
    <input type="text" x-model="query" placeholder="Search sessions by name, date, or ID…"
           class="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700
                  placeholder:text-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200
                  transition-colors shadow-sm">
  </div>

  <div class="text-xs text-gray-400 mb-4" x-show="filtered.length > 0">
    <span x-text="filtered.length"></span> session<span x-show="filtered.length !== 1">s</span>
    <span x-show="query.trim()"> matching "<span class="text-gray-500" x-text="query"></span>"</span>
  </div>

  <div class="space-y-3">
    <template x-for="s in filtered" :key="s.file">
      <a :href="s.file"
         class="block bg-white border border-gray-200 rounded-lg p-4
                hover:border-blue-300 hover:shadow-sm transition-all
                group shadow-sm">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-sm font-medium text-gray-800 group-hover:text-blue-600 transition-colors truncate"
                 x-text="s.name"></div>
            <div class="text-xs text-gray-400 mt-1 font-mono">
              <span x-text="s.date"></span>
              <span class="mx-2">·</span>
              <span x-text="s.messages"></span> messages
            </div>
          </div>
          <div class="text-[10px] text-gray-300 font-mono shrink-0 mt-0.5" x-text="s.id"></div>
        </div>
      </a>
    </template>
  </div>

  <div x-show="filtered.length === 0 && query.trim()" class="text-center text-gray-400 py-16">
    <div class="text-4xl mb-3">📭</div>
    <div class="text-sm">No sessions match "<span class="text-gray-500" x-text="query"></span>"</div>
  </div>

</div>
<script>
document.addEventListener('alpine:init', () => {
  Alpine.data('indexData', () => ({
    query: '',
    sessions: ${cardsJson},
    get filtered() {
      const q = this.query.toLowerCase().trim();
      if (!q) return this.sessions;
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
  const entriesJson = escScriptJson(JSON.stringify(sessionData));
  const metadata = { date: meta.date, sessionId: meta.id, messageCount: meta.messageCount };

  const dateStr = meta.date;
  const shortId = meta.id.length > 8 ? meta.id.slice(0, 8) : meta.id;
  const htmlFile = `${dateStr}_${shortId}.html`;

  const html = sessionViewerHtml(meta.name || "Untitled session", metadata, entriesJson);
  const htmlPath = path.join(htmlDir, htmlFile);
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf-8");

  return htmlFile;
}

export function generateIndexHtml(sessions: SessionMeta[], htmlDir: string): string {
  const html = indexPageHtml(sessions);
  const indexPath = path.join(htmlDir, "index.html");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, html, "utf-8");
  return indexPath;
}
