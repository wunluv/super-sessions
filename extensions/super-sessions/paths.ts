/**
 * Shared path derivation for the super_sessions insights tree.
 *
 * INSIGHTS_DIR (.memory/project_insights) is the current layout for
 * pi-agent-memory projects. Pre-memory projects used a top-level
 * <cwd>/project_insights/ dir. Prefer whichever exists; default to the
 * .memory layout (current convention).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const INSIGHTS_DIR = ".memory/project_insights";
export const SESSIONS_SUBDIR = "sessions";
export const HTML_SUBDIR = "html";
export const ANALYSES_SUBDIR = "analyses";
export const WISDOM_SUBDIR = "wisdom";
export const AUDIT_SUBDIR = "audit";

export function getInsightsRoot(cwd: string): string {
  const memRoot = path.join(cwd, INSIGHTS_DIR);
  const legacyRoot = path.join(cwd, "project_insights");
  if (fs.existsSync(memRoot)) return memRoot;
  if (fs.existsSync(legacyRoot)) return legacyRoot;
  return memRoot;
}

export function getSessionsDir(cwd: string): string {
  return path.join(getInsightsRoot(cwd), SESSIONS_SUBDIR);
}

export function getHtmlDir(cwd: string): string {
  return path.join(getInsightsRoot(cwd), HTML_SUBDIR);
}

export function getAnalysesDir(cwd: string): string {
  return path.join(getInsightsRoot(cwd), ANALYSES_SUBDIR);
}

export function getWisdomDir(cwd: string): string {
  return path.join(getInsightsRoot(cwd), WISDOM_SUBDIR);
}

export function getAuditDir(cwd: string): string {
  return path.join(getInsightsRoot(cwd), AUDIT_SUBDIR);
}
