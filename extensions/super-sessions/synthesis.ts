/**
 * Cross-session synthesis layer for super_sessions.
 *
 * Calls a SOTA LLM (deepseek-v4-pro) directly to synthesize per-session
 * analyses into a coherent blueprint, summary, or timeline document.
 *
 * Writes the result to wisdom/{topic}.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

// ─── Constants ────────────────────────────────────────────────────────────────────

/** SOTA model for synthesis — explicitly named for clarity vs analysis.ts which uses deepseek-v4-flash */
const DEFAULT_MODEL = "deepseek-ai/deepseek-v4-pro";
const DEFAULT_MODEL_PROVIDER = "nvidia";
const DEFAULT_MAX_TOKENS = 8192;

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
    console.warn(`[super_sessions] First attempt failed for ${label}: ${firstErr instanceof Error ? firstErr.message : String(firstErr)}. Retrying in 2s...`);
    await sleep(2000);
    return await fn();
  }
}

// ─── Output Format Descriptions ───────────────────────────────────────────────────

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  blueprint: [
    "## Format: Blueprint",
    "",
    "Produce a structured blueprint document with the following sections:",
    "1. **Executive Summary** — 2-3 sentence overview of the state of \"{topic}\" across all sessions",
    "2. **Patterns & Themes** — recurring patterns and themes identified across sessions,",
    "   with references to specific sessions as evidence",
    "3. **Decision Evolution** — how key decisions evolved over time, tracked chronologically",
    "4. **Contradictions & Tensions** — unresolved tensions, contradictions between sessions,",
    "   or open questions that need further investigation",
    "5. **Key Decisions Map** — table of major decisions with session date, decision,",
    "   rationale, and current status (active/superseded/open)",
    "6. **Actionable Next Steps** — concrete next actions derived from the synthesis,",
    "   prioritized by impact",
  ].join("\n"),

  summary: [
    "## Format: Summary",
    "",
    "Produce a concise executive summary covering:",
    "1. **Overview** — 1 paragraph summary of what was discussed about \"{topic}\" across sessions",
    "2. **Key Findings** — 3-5 bullet points of the most important findings",
    "3. **Decisions Made** — key decisions and their current status",
    "4. **Open Questions** — things still unresolved",
    "5. **Next Steps** — 2-3 most important actions to take",
    "",
    "Keep the summary under 1000 words. Write for a busy reader who needs the essentials.",
  ].join("\n"),

  timeline: [
    "## Format: Timeline",
    "",
    "Produce a chronological timeline documenting the evolution of \"{topic}\":",
    "1. **Chronological Entries** — each session date as a heading with key observations",
    "2. **Evolution Arc** — how understanding, decisions, and priorities shifted over time",
    "3. **Decision Points** — mark moments where a significant decision was made",
    "4. **Pivot Points** — note when direction changed or new information emerged",
    "5. **Future Trajectory** — based on the trajectory, where things appear to be heading",
    "",
    "Order by date ascending. Use a consistent entry format.",
  ].join("\n"),
};

// ─── Synthesis Prompt Builder ─────────────────────────────────────────────────────

/**
 * Build the synthesis prompt from all per-session analyses, session timeline,
 * and output format instructions.
 */
function buildSynthesisPrompt(
  topic: string,
  format: string,
  analyses: { file: string; content: string }[],
  indexContent: string,
): string {
  const formatInstruction =
    FORMAT_INSTRUCTIONS[format] ||
    FORMAT_INSTRUCTIONS.blueprint.replace(/\{topic\}/g, topic);

  const sessionTimelineSection = indexContent
    ? [
        "## Session Timeline",
        "",
        "Below is the session manifest showing dates, names, and session IDs.",
        "Use this to understand the temporal context of the analyses.",
        "",
        indexContent.slice(0, 3000),
        "",
      ].join("\n")
    : "(No session timeline available)\n\n";

  const analysisSections = analyses
    .map(
      (a, i) =>
        `### Analysis ${i + 1}: ${a.file}\n\n${a.content.trim()}\n`,
    )
    .join("\n---\n\n");

  return [
    `# Synthesis: ${topic}`,
    "",
    `You are synthesizing a **${format}** about **${topic}** from ${analyses.length} per-session analysis files.`,
    "These analyses were extracted from coding and conversation sessions between a human developer and their AI assistant.",
    "",
    `## Instructions`,
    "",
    `Synthesize the analyses below into a coherent **${format}** about **${topic}**.`,
    "",
    `The synthesis must:`,
    `1. Identify patterns and recurring themes across sessions`,
    `2. Track evolution of decisions over time`,
    `3. Note contradictions or unresolved tensions`,
    `4. Highlight key decisions with session context`,
    `5. Provide actionable next steps`,
    "",
    `Reference specific sessions by date and filename where relevant.`,
    `Be specific and concrete — avoid generic observations that could apply to any project.`,
    "",
    formatInstruction,
    "",
    "---",
    "",
    sessionTimelineSection,
    "",
    "## Per-Session Analyses",
    "",
    `Below are the ${analyses.length} analysis files for topic "${topic}". Each file contains`,
    "structured observations extracted from a single session by a separate analysis model.",
    "",
    analysisSections,
    "",
    "---",
    "",
    "## Output Requirements",
    "",
    `Write a complete, polished ${format} document. Use markdown headings, tables,`,
    "and lists for structure. The document should be self-contained — someone reading it",
    "should understand the topic without needing to read the source sessions.",
    "",
    "Begin the document now.",
  ].join("\n");
}

// ─── Truncation ───────────────────────────────────────────────────────────────────

/** Ensure total prompt content fits within SOTA model context window */
function truncateForSynthesis(
  content: string,
  maxChars: number = 120000,
): string {
  if (content.length <= maxChars) return content;
  // Truncate from the middle, keeping head and tail
  const half = Math.floor(maxChars / 2);
  return (
    content.slice(0, half) +
    `\n\n[... content truncated at ${maxChars} characters — middle section omitted ...]\n\n` +
    content.slice(-half)
  );
}

// ─── LLM Call (SOTA Model) ───────────────────────────────────────────────────────

/**
 * Call the SOTA model for cross-session synthesis via its OpenAI-compatible API.
 *
 * Uses deepseek-v4-pro explicitly, parallel to callAnalyzeModel which uses
 * deepseek-v4-flash. Follows the same fetch pattern.
 */
export async function callSynthesisModel(
  prompt: string,
  ctx: ExtensionContext,
): Promise<string | null> {
  const model = ctx.modelRegistry.find(DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL);
  if (!model) {
    throw new Error(
      `Model "${DEFAULT_MODEL_PROVIDER}/${DEFAULT_MODEL}" not found in registry. ` +
        `This is the SOTA model required for cross-session synthesis. ` +
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
      temperature: 0.2,
    }),
    signal: ctx.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(
      `Synthesis LLM API error (${response.status}): ${errorText.slice(0, 500)}`,
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

// ─── Synthesis Entry Point ────────────────────────────────────────────────────────

export interface SynthesisInput {
  topic: string;
  format: string;
  analyses: { file: string; content: string }[];
  indexContent: string;
}

export interface SynthesisResult {
  success: boolean;
  content?: string;
  error?: string;
}

/**
 * Run cross-session synthesis.
 *
 * Builds the synthesis prompt from all per-session analyses, calls the SOTA model,
 * and returns the synthesized result.
 */
export async function runSynthesis(
  input: SynthesisInput,
  ctx: ExtensionContext,
): Promise<SynthesisResult> {
  // Truncate individual analyses if needed to stay within context window
  const totalChars = input.analyses.reduce(
    (sum, a) => sum + a.content.length,
    0,
  );
  const totalPromptChars =
    totalChars + input.indexContent.length + 8000; // buffer for prompt boilerplate

  // Apply truncation if prompt is too large
  const analyses =
    totalPromptChars > 120000
      ? input.analyses.map((a) => ({
          ...a,
          content: truncateForSynthesis(a.content, 10000),
        }))
      : input.analyses;

  // Note if only a single analysis (limited cross-session value)
  if (analyses.length === 1) {
    console.warn(
      `[super_sessions] Synthesis for "${input.topic}" uses only 1 analysis — cross-session pattern detection will be limited`,
    );
  }

  const prompt = buildSynthesisPrompt(
    input.topic,
    input.format,
    analyses,
    input.indexContent,
  );

  const truncatedPrompt = truncateForSynthesis(prompt, 150000);

  // Report prompt size for debugging
  const promptSizeKB = Math.round(truncatedPrompt.length / 1024);
  console.log(`[super_sessions] Synthesis prompt: ${promptSizeKB}KB across ${analyses.length} analyses`);

  try {
    const response = await retryOnce(
      () => callSynthesisModel(truncatedPrompt, ctx),
      `synthesize ${input.topic}`,
    );

    if (!response) {
      return {
        success: false,
        error: "Empty response from SOTA model",
      };
    }

    // If single analysis, prepend a note about limited cross-session scope
    let content = response;
    if (analyses.length === 1) {
      content =
        `> **Note:** This synthesis is based on a single analysis session. ` +
        `Cross-session patterns and evolution tracking require multiple sessions. ` +
        `Run super_sessions_analyze on additional sessions for a richer synthesis.\n\n` +
        response;
    }

    return {
      success: true,
      content,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
