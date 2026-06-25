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
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ─── Constants ────────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_MODEL_PROVIDER = "deepseek";
const DEFAULT_MAX_TOKENS = 4096;

/** Directory where analysis prompts live */
const PROMPTS_DIR = path.join(__dirname, "prompts");

// ─── Topic → Prompt Template Mapping ─────────────────────────────────────────────

/**
 * Select the appropriate prompt template based on topic.
 * Uses substring matching: if topic contains 'engineering', 'meaning', or 'ideas',
 * use the corresponding specialized prompt. Otherwise uses a generic fallback.
 */
function selectPromptTemplate(topic: string): string {
  const lower = topic.toLowerCase();
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
      max_tokens: DEFAULT_MAX_TOKENS,
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
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!data.choices?.[0]?.message?.content) {
    return null;
  }

  return data.choices[0].message.content.trim();
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

  // Truncate body for LLM context window
  const truncated = truncateSessionBody(body);

  // Build the prompt
  const prompt = buildAnalyzePrompt(topic, sessionName, date, truncated, focusPrompt);

  // Call the LLM
  let response: string | null;
  try {
    response = await callAnalyzeModel(prompt, ctx);
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
