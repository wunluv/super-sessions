/**
 * Classification / tagging layer for super_sessions.
 *
 * Reads untagged session .md files, calls a cheap LLM to generate YAML frontmatter
 * (project_relevant, topics, summary, noise_stripped), and prepends it to the file.
 *
 * Idempotent: skips files with existing YAML frontmatter (first line is `---`).
 * Project context: reads AGENTS.md from project root for relevance detection.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ─── Constants ────────────────────────────────────────────────────────────────────

const INSIGHTS_DIR = "project_insights";
const SESSIONS_DIR = "sessions";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_MODEL_PROVIDER = "deepseek";

/** Directory where tagging prompts live */
const PROMPTS_DIR = path.join(__dirname, "prompts");

// ─── Helpers ──────────────────────────────────────────────────────────────────────

function getInsightsRoot(cwd: string): string {
  return path.join(cwd, INSIGHTS_DIR);
}

function getSessionsDir(cwd: string): string {
  return path.join(getInsightsRoot(cwd), SESSIONS_DIR);
}

function getAgentsMdPath(cwd: string): string {
  return path.join(cwd, "AGENTS.md");
}

/** Check if a .md file already has YAML frontmatter (first line is `---`) */
function hasFrontmatter(filePath: string): boolean {
  try {
    const firstLine = fs.readFileSync(filePath, "utf-8").split("\n")[0];
    return firstLine.trim() === "---";
  } catch {
    return false;
  }
}

/** Read project context from AGENTS.md, or return a fallback string */
function readProjectContext(cwd: string): string {
  const agentsPath = getAgentsMdPath(cwd);
  try {
    if (fs.existsSync(agentsPath)) {
      const content = fs.readFileSync(agentsPath, "utf-8");
      return content.trim() || "No project context available.";
    }
  } catch {
    // fall through
  }
  return "No project context available.";
}

/** Load the tagging prompt template, replacing placeholders */
function buildTaggingPrompt(sessionBody: string, projectContext: string): string {
  const promptPath = path.join(PROMPTS_DIR, "tag-session.md");
  let template: string;
  try {
    template = fs.readFileSync(promptPath, "utf-8");
  } catch {
    // Fallback inline prompt if file doesn't exist
    template = [
      "You are tagging a developer session transcript for a project knowledge base.",
      "",
      "Project context:",
      "{project_context}",
      "",
      "Session transcript:",
      "---",
      "{session_body}",
      "---",
      "",
      "Analyze the session and return ONLY valid YAML frontmatter (no code fences, no extra text):",
      "",
      "```yaml",
      "project_relevant: true",
      "topics:",
      "  - topic1",
      "  - topic2",
      "summary: \"One-sentence description of what happened.\"",
      "noise_stripped: false",
      "```",
      "",
      "Rules:",
      "- `project_relevant` must be `true` or `false` (no quotes)",
      "- `topics` must be an array of 2-5 lowercase strings",
      "- `summary` must be a single sentence, 10-20 words",
      "- `noise_stripped` must be `false`",
      "- Return ONLY the YAML frontmatter block, nothing else",
    ].join("\n");
  }

  return template
    .replace(/\{project_context\}/g, projectContext)
    .replace(/\{session_body\}/g, sessionBody);
}

/** Parse the LLM response into YAML frontmatter lines. Returns null on failure. */
function parseTagResponse(response: string): string[] | null {
  // Strip code fences if present
  let clean = response.trim();
  clean = clean.replace(/^```yaml\s*/i, "").replace(/```\s*$/i, "");
  clean = clean.trim();

  // Ensure it starts with ---
  if (!clean.startsWith("---")) {
    clean = "---\n" + clean;
  }

  // Ensure it ends with ---
  if (!clean.endsWith("---")) {
    clean = clean + "\n---";
  }

  // Basic validation: must have at least project_relevant, topics, summary
  if (
    !clean.includes("project_relevant") ||
    !clean.includes("topics") ||
    !clean.includes("summary") ||
    !clean.includes("noise_stripped")
  ) {
    return null;
  }

  return clean.split("\n");
}

/** Truncate session body to stay within cheap model context window (~1M tokens ~ 4M chars, keep it reasonable) */
function truncateSessionBody(body: string, maxChars = 50000): string {
  if (body.length <= maxChars) return body;
  return (
    body.slice(0, maxChars) +
    `\n\n[... session truncated at ${maxChars} characters ...]`
  );
}

/** Extract the body content from a session .md file (skip any existing frontmatter) */
function extractSessionBody(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // If first line is ---, skip frontmatter
  if (lines[0].trim() === "---") {
    // Find closing ---
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        closingIndex = i;
        break;
      }
    }
    if (closingIndex >= 0) {
      return lines.slice(closingIndex + 1).join("\n").trim();
    }
  }

  return content.trim();
}

// ─── LLM Call ─────────────────────────────────────────────────────────────────────

/**
 * Call the model via its OpenAI-compatible API endpoint.
 *
 * Uses the modelRegistry from ExtensionContext to find the model and resolve API keys,
 * then makes a direct fetch call.
 */
async function callModelForTagging(
  prompt: string,
  ctx: ExtensionContext,
): Promise<string | null> {
  // Find the model in the registry
  const model = ctx.modelRegistry.find(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL);
  if (!model) {
    throw new Error(
      `Model "${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL}" not found in registry. ` +
      `Ensure your pi provider configuration includes it.`,
    );
  }

  // Resolve API key
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(`No API key configured for ${DEFAULT_MODEL_PROVIDER}: ${auth.error}`);
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
      messages: [
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
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

// ─── Frontmatter Prepending ───────────────────────────────────────────────────────

/** Prepend YAML frontmatter lines to a file */
function prependFrontmatter(filePath: string, frontmatterLines: string[]): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const fullContent = frontmatterLines.join("\n") + "\n" + content;
  fs.writeFileSync(filePath, fullContent, "utf-8");
}

// ─── Main Tagging Logic ──────────────────────────────────────────────────────────

export interface TagResult {
  file: string;
  success: boolean;
  error?: string;
  projectRelevant?: boolean;
}

export interface TagSummary {
  tagged: TagResult[];
  skipped: string[];
  errors: TagResult[];
}

/**
 * Tag a single session .md file with YAML frontmatter.
 *
 * Returns the tags if successful, or throws if the LLM call fails.
 * Does NOT throw if the file already has frontmatter — returns null instead.
 */
export async function tagOneSession(
  filePath: string,
  ctx: ExtensionContext,
): Promise<TagResult | null> {
  if (hasFrontmatter(filePath)) {
    return null; // already tagged, caller handles skip
  }

  const projectContext = readProjectContext(ctx.cwd);
  const sessionBody = extractSessionBody(filePath);
  const truncated = truncateSessionBody(sessionBody);

  const prompt = buildTaggingPrompt(truncated, projectContext);
  const response = await callModelForTagging(prompt, ctx);

  if (!response) {
    return {
      file: path.basename(filePath),
      success: false,
      error: "Empty response from LLM",
    };
  }

  const frontmatterLines = parseTagResponse(response);
  if (!frontmatterLines) {
    return {
      file: path.basename(filePath),
      success: false,
      error: "Could not parse LLM response as YAML frontmatter",
    };
  }

  // Determine project_relevant from the parsed frontmatter
  const projectRelevant = frontmatterLines.some(
    (l) => l.trim() === "project_relevant: true" || l.trim() === "project_relevant: true #",
  );

  prependFrontmatter(filePath, frontmatterLines);

  return {
    file: path.basename(filePath),
    success: true,
    projectRelevant,
  };
}

/**
 * Tag all untagged sessions in the sessions directory.
 *
 * Discovers session .md files (excluding _full.md), checks for existing frontmatter,
 * and processes each via tagOneSession.
 */
export async function tagAllUntagged(
  ctx: ExtensionContext,
  options?: { force?: boolean },
): Promise<TagSummary> {
  const sessionsDir = getSessionsDir(ctx.cwd);

  if (!fs.existsSync(sessionsDir)) {
    return { tagged: [], skipped: [], errors: [] };
  }

  const sessionFiles = fs
    .readdirSync(sessionsDir)
    .filter((f) => f.endsWith(".md") && !f.endsWith("_full.md"))
    .sort();

  const tagged: TagResult[] = [];
  const skipped: string[] = [];
  const errors: TagResult[] = [];

  for (const file of sessionFiles) {
    const filePath = path.join(sessionsDir, file);

    // Skip if already has frontmatter (unless --force)
    if (!options?.force && hasFrontmatter(filePath)) {
      skipped.push(file);
      continue;
    }

    try {
      const result = await tagOneSession(filePath, ctx);
      if (result === null) {
        skipped.push(file);
      } else if (result.success) {
        tagged.push(result);
      } else {
        errors.push(result);
      }
    } catch (err) {
      errors.push({
        file,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { tagged, skipped, errors };
}

/**
 * Tag all sessions — command entry point.
 */
export async function handleTagCommand(
  _args: string,
  ctx: ExtensionCommandContext,
  options?: { force?: boolean; stripNoise?: boolean },
): Promise<void> {
  ctx.ui.notify("Tagging untagged sessions...", "info");

  const summary = await tagAllUntagged(ctx, { force: options?.force });

  const taggedCount = summary.tagged.length;
  const skippedCount = summary.skipped.length;
  const errorCount = summary.errors.length;

  const parts: string[] = [];
  if (taggedCount > 0) {
    const relevant = summary.tagged.filter((r) => r.projectRelevant).length;
    parts.push(`Tagged ${taggedCount} session${taggedCount !== 1 ? "s" : ""}`);
    if (relevant !== taggedCount) {
      parts.push(`${taggedCount - relevant} marked not project-relevant`);
    }
  }
  if (skippedCount > 0) {
    parts.push(`${skippedCount} already tagged (skipped)`);
  }
  if (errorCount > 0) {
    parts.push(`${errorCount} failed`);
  }

  const message = parts.join(". ") || "No untagged sessions found.";
  ctx.ui.notify(`✅ ${message}`, errorCount > 0 ? "warning" : "info");

  // Log errors
  for (const err of summary.errors) {
    console.error(`[super_sessions] Tag error for ${err.file}: ${err.error}`);
  }
}
