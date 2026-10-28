// HIGH_LEVEL: #implementing — setbacks recorded with evidence, nothing blocks.
// SPEC: B1.7 (advisory — recorded condition, never a gate).
import type { ToolResultEvent } from "../hooks/events";
import { isTestCommand } from "../utils/commands";

export interface SetbackSignal {
  reason: string;
  evidence: string[];
}

// Commands whose exit status 1 means "nothing found" by long-standing Unix
// convention (grep, diff, find ...), not failure. Tool vocabulary, not language.
const NO_MATCH_EXIT_ONE = new Set(["rg", "grep", "egrep", "fgrep", "ag", "ack", "diff", "cmp", "test", "["]);

function commandNames(cmd: string): string[] {
  return cmd
    .split(/&&|\|\||;|\|/)
    .map((seg) => seg.trim().split(/\s+/)[0] ?? "")
    .filter((name) => name !== "");
}

function outputText(event: ToolResultEvent): string {
  return event.content.map((c) => c.text ?? "").join("\n");
}

function exitCode(event: ToolResultEvent): unknown {
  const details = event.details as Record<string, unknown> | undefined;
  return details?.["exitCode"] ?? details?.["code"];
}

export function detectSetback(event: ToolResultEvent): SetbackSignal | null {
  if (event.toolName === "bash") {
    const raw = event.input["command"];
    const cmd = typeof raw === "string" ? raw : "";
    if (cmd.trim() === "") return null;
    const output = outputText(event);
    // The exit status is the only language-neutral failure signal. Output text is
    // never scraped: "0 failed" in a passing run must not read as a failure.
    const code = exitCode(event);
    const failed = event.isError || (typeof code === "number" && code !== 0);
    if (!failed) return null;
    if (code === 1 && commandNames(cmd).every((name) => NO_MATCH_EXIT_ONE.has(name))) return null;
    if (isTestCommand(cmd)) {
      return {
        reason: `Test/build command failed: ${cmd.slice(0, 200)}`,
        evidence: [output.slice(0, 1500) || `Command '${cmd}' failed`],
      };
    }
    return {
      reason: `Command failed with error: ${cmd.slice(0, 200)}`,
      evidence: [output.slice(0, 1500) || `Command '${cmd}' failed with error`],
    };
  }
  if ((event.toolName === "edit" || event.toolName === "write") && event.isError) {
    return {
      reason: `File ${event.toolName} failed`,
      evidence: [outputText(event).slice(0, 1500) || `${event.toolName} reported an error`],
    };
  }
  return null;
}
