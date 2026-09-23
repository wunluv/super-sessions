/**
 * Per-session analysis layer for super_sessions.
 *
 * Calls a cheap LLM (deepseek-v4-flash) directly to extract topic-specific
 * observations from session .md files and writes structured analysis files.
 *
 * Designed to be called from the super_sessions_analyze tool's execute().
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { log } from "./log";
import { getAnalysesDir, getSessionsDir } from "./paths";
import { parseSessionFrontmatter } from "./extraction";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ─── Constants ────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_MODEL_PROVIDER = "deepseek";
/** Reasoning models spend output tokens on thinking first; a small budget
 *  returns an empty content field. 16k covers thinking plus the analysis. */
const DEFAULT_MAX_TOKENS = 16000;
const MAX_TOKENS_CEILING = 32000;

/** Directory where analysis prompts live */
const PROMPTS_DIR = path.join(__dirname, "prompts");

// ─── Retry Helper ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOnce<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    log.warn(`[super_sessions] First attempt failed for ${label}: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}. Retrying in 2s...`);
    await sleep(2000);
    return await fn();
  }
}

// ─── Topic → Prompt Template Mapping ─────────────────────────────────────────────

/**
 * Select the appropriate prompt template based on topic.
 * Uses substring matching: if topic contains 'engineering', 'meaning', or 'ideas',
 * use the corresponding specialized prompt. Otherwise uses a generic fallback.
 */
function selectPromptTemplate(topic: string): string {
  const lower = topic.toLowerCase();
  if (lower.includes("friction")) return "analyze-friction.md";
  if (lower.includes("engineering")) return "analyze-engineering.md";
  if (lower.includes("meaning")) return "analyze-meaning.md";
  if (lower.includes("ideas")) return "analyze-ideas.md";
  // Generic fallback — use engineering prompt as it's the most comprehensive
  return "analyze-engineering.md";
}

/**
 * Load and populate a prompt template with session data.
 *
 * Template variables:
 *   {date}            — session date (YYYY-MM-DD)
 *   {session_name}    — session name/title
 *   {raw_md_content}  — the full conversation body
 *   {focusPrompt}     — additional extraction guidance (optional)
 */
function buildAnalyzePrompt(
  topic: string,
  sessionName: string,
  date: string,
  rawContent: string,
  focusPrompt?: string,
): string {
  const promptFileName = selectPromptTemplate(topic);
  const promptPath = path.join(PROMPTS_DIR, promptFileName);

  let template: string;
  try {
    template = fs.readFileSync(promptPath, "utf-8");
  } catch {
    // Fallback inline prompt if template file is missing
    template = [
      `You are extracting ${topic} insights from a human+AI coding session.`,
      "",
      "Session: {date}, {session_name}",
      "",
      "Conversation:",
      "---",
      "{raw_md_content}",
      "---",
      "",
      `Extract observations about ${topic}. For each observation:`,
      "- **Context**: what was being discussed",
      "- **Observation**: the specific insight, decision, or pattern",
      "- **Evidence**: relevant quote or paraphrase from the conversation",
      "- **Significance**: why this matters to the project",
      "",
      "Format output as structured markdown.",
    ].join("\n");
  }

  let prompt = template
    .replace(/\{date\}/g, date)
    .replace(/\{session_name\}/g, sessionName)
    .replace(/\{raw_md_content\}/g, rawContent);

  if (focusPrompt) {
    prompt += `\n\n## Additional Focus\n\n${focusPrompt}\n`;
  }

  return prompt;
}

// ─── Session Metadata Extraction ──────────────────────────────────────────────────

/**
 * Extract session metadata (name, date) and body content from a session .md file.
 *
 * Session files have this structure (after optional YAML frontmatter):
 *   # {session_name}
 *   **Session:** {baseName}
 *   **Date:** {dateStr}
 *   ...
 *   ---
 *   {conversation body}
 */
function extractSessionMeta(filePath: string): {
  sessionName: string;
  date: string;
  body: string;
} {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Strip YAML frontmatter if present
  let bodyStart = 0;
  if (lines[0].trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        bodyStart = i + 1;
        break;
      }
    }
  }

  // Parse session name from first # heading after frontmatter
  let sessionName = "Untitled session";
  for (let i = bodyStart; i < lines.length; i++) {
    const match = lines[i].match(/^#\s+(.+)/);
    if (match) {
      sessionName = match[1].trim();
      break;
    }
  }

  // Parse date from **Date:** line
  let date = "";
  for (let i = bodyStart; i < Math.min(bodyStart + 10, lines.length); i++) {
    const match = lines[i].match(/^\*\*Date:\*\*\s+(.+)/);
    if (match) {
      date = match[1].trim();
      // Accept only YYYY-MM-DD dates; fall back to extracting from session line
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        break;
      }
    }
  }

  // Fallback: try to extract date from **Session:** line (format: YYYY-MM-DD_id)
  if (!date) {
    for (let i = bodyStart; i < Math.min(bodyStart + 10, lines.length); i++) {
      const match = lines[i].match(/^\*\*Session:\*\*\s+(\d{4}-\d{2}-\d{2})/);
      if (match) {
        date = match[1];
        break;
      }
    }
  }

  if (!date) {
    date = "unknown-date";
  }

  // Body is everything after the metadata separator line (---)
  // Find the --- separator after the metadata header
  let separatorLine = -1;
  for (let i = bodyStart; i < lines.length; i++) {
    if (lines[i].trim() === "---" && i > bodyStart) {
      separatorLine = i;
      break;
    }
  }

  const body =
    separatorLine >= 0
      ? lines.slice(separatorLine + 1).join("\n").trim()
      : lines.slice(bodyStart).join("\n").trim();

  return { sessionName, date, body };
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────────

/**
 * Call the cheap model for per-session analysis via its OpenAI-compatible API.
 *
 * Reuses the same pattern as callModelForTagging() in tagging.ts —
 * looks up the model via modelRegistry and makes a direct fetch call.
 */
export async function callAnalyzeModel(
  prompt: string,
  ctx: ExtensionContext,
): Promise<string | null> {
  const model = ctx.modelRegistry.find(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL);
  if (!model) {
    throw new Error(
      `Model "${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL}" not found in registry. ` +
        `Ensure your pi provider configuration includes it.`,
    );
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(
      `No API key configured for ${DEFAULT_MODEL_PROVIDER}: ${auth.error}`,
    );
  }

  const apiKey = auth.apiKey;
  const baseUrl = model.baseUrl || `https://api.${DEFAULT_MODEL_PROVIDER}.com`;
  const modelId = model.id;

  const modelMaxTokens = (model as unknown as { maxTokens?: number }).maxTokens;
  const maxTokens = Math.max(
    DEFAULT_MAX_TOKENS,
    Math.min(modelMaxTokens ?? DEFAULT_MAX_TOKENS, MAX_TOKENS_CEILING),
  );

  const url = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
    signal: ctx.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(
      `LLM API error (${response.status}): ${errorText.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string; reasoning_content?: string };
      finish_reason?: string;
    }>;
  };

  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) {
    throw new Error(
      `Empty content from LLM (finish_reason: ${choice?.finish_reason ?? "none"}, ` +
        `max_tokens: ${maxTokens}, prompt chars: ${prompt.length}). ` +
        `Reasoning likely consumed the output budget.`,
    );
  }

  return content;
}

// ─── Truncation ───────────────────────────────────────────────────────────────────

/** Truncate session body to stay within cheap model context window */
function truncateSessionBody(body: string, maxChars = 80000): string {
  if (body.length <= maxChars) return body;
  return (
    body.slice(0, maxChars) +
    `\n\n[... session truncated at ${maxChars} characters ...]`
  );
}

// ─── Analysis Result ──────────────────────────────────────────────────────────────

export interface AnalysisResult {
  file: string;
  success: boolean;
  error?: string;
}

// ─── Main Analysis Function ───────────────────────────────────────────────────────

/**
 * Analyze a single session for a given topic.
 *
 * Reads the session .md file, builds the extraction prompt, calls the cheap LLM,
 * and writes the structured analysis to analyses/{topic}/{session-name}.md.
 *
 * Returns an AnalysisResult indicating success or failure.
 */
export async function analyzeOneSession(
  sessionFilePath: string,
  analysisDestPath: string,
  topic: string,
  ctx: ExtensionContext,
  focusPrompt?: string,
): Promise<AnalysisResult> {
  const fileName = path.basename(sessionFilePath);

  // Extract session metadata and body
  let sessionName: string;
  let date: string;
  let body: string;

  try {
    const meta = extractSessionMeta(sessionFilePath);
    sessionName = meta.sessionName;
    date = meta.date;
    body = meta.body;
  } catch (err) {
    return {
      file: fileName,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Skip empty sessions
  if (!body.trim()) {
    return {
      file: fileName,
      success: false,
      error: "Empty session body — nothing to analyze",
    };
  }

  // Truncate body for LLM context window
  const truncated = truncateSessionBody(body);

  // Build the prompt
  const prompt = buildAnalyzePrompt(topic, sessionName, date, truncated, focusPrompt);

  // Call the LLM with retry
  let response: string | null;
  try {
    response = await retryOnce(
      () => callAnalyzeModel(prompt, ctx),
      `analyzing ${fileName}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Write error note to analysis file instead of crashing
    const errorNote = [
      `# Analysis: ${fileName}`,
      `**Topic:** ${topic}`,
      `**Session:** ${sessionName}`,
      `**Date:** ${date}`,
      `**Status:** ❌ Analysis failed`,
      ``,
      `**Error:** ${errorMessage}`,
      ``,
      `The session body was ${body.length} characters${body.length > 80000 ? ` (truncated to 80000)` : ""}.`,
    ].join("\n");

    fs.mkdirSync(path.dirname(analysisDestPath), { recursive: true });
    fs.writeFileSync(analysisDestPath, errorNote, "utf-8");

    return {
      file: fileName,
      success: false,
      error: errorMessage,
    };
  }

  if (!response) {
    return {
      file: fileName,
      success: false,
      error: "Empty response from LLM",
    };
  }

  // Write analysis file
  const header = [
    `# Analysis: ${fileName}`,
    `**Topic:** ${topic}`,
    `**Session:** ${sessionName}`,
    `**Date:** ${date}`,
    `**Status:** ✅ Complete`,
    ``,
    `---`,
    ``,
  ].join("\n");

  fs.mkdirSync(path.dirname(analysisDestPath), { recursive: true });
  fs.writeFileSync(analysisDestPath, header + response, "utf-8");

  return {
    file: fileName,
    success: true,
  };
}

// ─── Topic Analysis Over Sessions ─────────────────────────────────────────────────

export interface AnalyzeTopicOptions {
  topic: string;
  /** Glob matching session file names, e.g. "2026-06-*". Defaults to "all". */
  sessionGlob?: string;
  /** Only sessions whose frontmatter topics overlap this list. */
  topics?: string[];
  /** Extra extraction guidance appended to the prompt template. */
  focusPrompt?: string;
}

export interface AnalyzeTopicSummary {
  /** Markdown summary, identical for the tool and the command surface. */
  summary: string;
  details: Record<string, unknown>;
}

/**
 * Analyze every project-relevant session for a topic, skipping sessions that
 * already have an analysis file. Shared by the super_sessions_analyze tool and
 * the /super-sessions-friction command.
 */
export async function analyzeTopic(
  ctx: ExtensionContext,
  opts: AnalyzeTopicOptions,
): Promise<AnalyzeTopicSummary> {
  const cwd = ctx.cwd;
  const sessionsDir = getSessionsDir(cwd);
  const analysesDir = path.join(getAnalysesDir(cwd), opts.topic);
  const glob = opts.sessionGlob || "all";
  const topicFilter = opts.topics;

  if (!fs.existsSync(sessionsDir)) {
    return {
      summary: `No sessions directory found at ${sessionsDir}. Run /super_sessions first to export sessions.`,
      details: { topic: opts.topic, error: "no sessions directory" },
    };
  }

  const sessionFiles = fs
    .readdirSync(sessionsDir)
    .filter((f) => f.endsWith(".md") && !f.endsWith("_full.md"))
    .sort();

  if (sessionFiles.length === 0) {
    return {
      summary: `No session .md files found in ${sessionsDir}. Run /super_sessions first.`,
      details: { topic: opts.topic, error: "no session files" },
    };
  }

  const matched = sessionFiles.filter((f) => {
    if (glob === "all") return true;
    const globRe = new RegExp("^" + glob.replace(/\*/g, ".*") + ".*\\.md$");
    return globRe.test(f);
  });

  if (matched.length === 0) {
    return {
      summary: `No sessions matched glob "${glob}". Available: ${sessionFiles.join(", ")}`,
      details: { topic: opts.topic, error: "no glob match" },
    };
  }

  const relevant: string[] = [];
  const notRelevant: string[] = [];
  const topicMismatch: string[] = [];

  for (const file of matched) {
    const fm = parseSessionFrontmatter(path.join(sessionsDir, file));
    if (!fm.project_relevant) {
      notRelevant.push(file);
      continue;
    }
    if (topicFilter && topicFilter.length > 0) {
      const hasTopic = topicFilter.some((t) =>
        fm.topics.some((st) => st.toLowerCase() === t.toLowerCase()),
      );
      if (!hasTopic) {
        topicMismatch.push(file);
        continue;
      }
    }
    relevant.push(file);
  }

  if (relevant.length === 0) {
    const parts: string[] = ["No sessions available for analysis"];
    if (notRelevant.length > 0) parts.push(`${notRelevant.length} filtered out (not project relevant)`);
    if (topicMismatch.length > 0) parts.push(`${topicMismatch.length} filtered out (topic mismatch)`);
    return {
      summary: parts.join(". ") + ".",
      details: {
        topic: opts.topic,
        matched: matched.length,
        notRelevant: notRelevant.length,
        topicMismatch: topicMismatch.length,
      },
    };
  }

  fs.mkdirSync(analysesDir, { recursive: true });

  const toAnalyze: string[] = [];
  let alreadyAnalyzed = 0;
  for (const file of relevant) {
    if (fs.existsSync(path.join(analysesDir, file))) alreadyAnalyzed++;
    else toAnalyze.push(file);
  }

  if (toAnalyze.length === 0) {
    const parts = [
      `All ${relevant.length} relevant sessions already analyzed for topic "${opts.topic}".`,
      alreadyAnalyzed > 0 ? `${alreadyAnalyzed} already analyzed.` : "",
      notRelevant.length > 0 ? `${notRelevant.length} skipped (not project relevant).` : "",
      topicMismatch.length > 0 ? `${topicMismatch.length} skipped (topic mismatch).` : "",
    ].filter(Boolean);
    return {
      summary: parts.join(" "),
      details: {
        topic: opts.topic,
        total: relevant.length,
        alreadyAnalyzed,
        notRelevant: notRelevant.length,
        topicMismatch: topicMismatch.length,
        analysesDir,
      },
    };
  }

  const analyzed: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < toAnalyze.length; i++) {
    const file = toAnalyze[i];
    ctx.ui.notify(
      `Analyzing ${i + 1}/${toAnalyze.length}: ${file} for topic "${opts.topic}"...`,
      "info",
    );
    const result = await analyzeOneSession(
      path.join(sessionsDir, file),
      path.join(analysesDir, file),
      opts.topic,
      ctx,
      opts.focusPrompt,
    );
    if (result.success) analyzed.push(file);
    else {
      errors.push(`${file}: ${result.error}`);
      log.error(`[super_sessions] analysis failed for ${opts.topic} / ${file}: ${result.error}`);
      ctx.ui.notify(`⚠️ Analysis failed for ${file}: ${result.error}`, "warning");
    }
  }

  const summaryParts: string[] = [];
  if (analyzed.length > 0) {
    summaryParts.push(`Analyzed ${analyzed.length} session${analyzed.length !== 1 ? "s" : ""} for topic "${opts.topic}"`);
  }
  if (alreadyAnalyzed > 0) summaryParts.push(`${alreadyAnalyzed} skipped (already analyzed)`);
  if (notRelevant.length > 0) summaryParts.push(`${notRelevant.length} skipped (not project relevant)`);
  if (topicMismatch.length > 0) summaryParts.push(`${topicMismatch.length} skipped (topic mismatch)`);
  if (errors.length > 0) summaryParts.push(`${errors.length} error${errors.length !== 1 ? "s" : ""}`);
  if (topicFilter && topicFilter.length > 0) summaryParts.push(`Filtered by topics: ${topicFilter.join(", ")}`);

  const summary = [
    `## ✅ Analysis Complete — Topic: "${opts.topic}"`,
    "",
    summaryParts.join(". ") + ".",
    "",
    analyzed.length > 0 ? `**Output:** ${analysesDir}` : "",
    errors.length > 0
      ? ["", "### Errors", "", ...errors.map((e) => `- ${e}`), "", "Error notes have been written to the analysis files."].join("\n")
      : "",
    opts.focusPrompt ? `**Focus prompt used:** ${opts.focusPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary,
    details: {
      topic: opts.topic,
      analyzed: analyzed.length,
      alreadyAnalyzed,
      notRelevant: notRelevant.length,
      topicMismatch: topicMismatch.length,
      errors: errors.length,
      analysesDir,
    },
  };
}
