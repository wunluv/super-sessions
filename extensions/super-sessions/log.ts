/**
 * File-backed logger for super_sessions.
 *
 * pi's TUI does not capture extension console output — console.* writes leak
 * into the terminal and corrupt the interface (mixed text, lost cursor).
 * All diagnostics therefore go to ~/.pi/agent/super-sessions.log instead of
 * stdout. User-facing status still flows through ctx.ui.notify().
 *
 * Logging is best-effort: failures are swallowed so logging never breaks an
 * operation.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const LOG_DIR = path.join(os.homedir(), ".pi", "agent");
const LOG_FILE = path.join(LOG_DIR, "super-sessions.log");

function write(level: "info" | "warn" | "error", message: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${stamp}] [${level}] ${message}\n`, "utf-8");
  } catch {
    // Never let logging break the calling code.
  }
}

export const log = {
  info: (message: string): void => write("info", message),
  warn: (message: string): void => write("warn", message),
  error: (message: string): void => write("error", message),
};
