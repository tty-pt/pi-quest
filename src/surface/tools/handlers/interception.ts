import { join, relative, isAbsolute } from "node:path";
import type { Pi, PiCtx, ToolCallEvent, BlockVerdict } from "../../../hooks/events";
import { getState } from "../../../app/store";
import { findPrimaryRepoRoot } from "../../../utils/git";
import { isPathAllowedByContract } from "../../../domain/contract";

/**
 * Checks whether a given file path should remain in the primary repository
 * (e.g. quest journals, harness settings, git control files).
 */
export function isExemptFromWorktreeJail(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  return (
    norm.includes(".pi/quest") ||
    norm.includes(".pi/settings.json") ||
    norm.includes(".pi/lsp.json") ||
    norm === ".git" ||
    norm.startsWith(".git/") ||
    norm.includes("/.git/") ||
    norm.endsWith("/.git")
  );
}

/**
 * Rewrites a file path to target the worktree root.
 */
export function rewritePathToWorktree(
  filePath: string,
  primaryRoot: string,
  worktreePath: string,
): string {
  if (isExemptFromWorktreeJail(filePath)) {
    return filePath;
  }

  // If path is already inside the worktree, return as-is to prevent path doubling
  if (filePath.startsWith(worktreePath)) {
    return filePath;
  }

  if (!isAbsolute(filePath)) {
    return join(worktreePath, filePath);
  }

  if (filePath.startsWith(primaryRoot)) {
    const rel = relative(primaryRoot, filePath);
    return join(worktreePath, rel);
  }

  return filePath;
}

/**
 * Wraps a bash or bg_run command to execute inside the worktree directory,
 * redirecting any explicit references to primaryRoot to the worktree while
 * preserving exempt paths (e.g. .pi/quest, .pi/settings.json, .pi/extensions).
 */
export function rewriteBashCommandToWorktree(
  command: string,
  worktreePath: string,
  primaryRoot?: string,
): string {
  let sanitized = command;
  if (primaryRoot && primaryRoot.length > 0 && primaryRoot !== worktreePath) {
    const esc = primaryRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${esc}(?!(?:/[^\\s"']*)?/\\.pi/(?:quest|settings\\.json|lsp\\.json))`, "g");
    sanitized = sanitized.replace(pattern, worktreePath);
  }
  const trimmed = sanitized.trim();
  if (trimmed.startsWith(`(cd "${worktreePath}"`) || trimmed.startsWith(`cd "${worktreePath}"`)) {
    return sanitized;
  }
  return `(cd "${worktreePath}" && {\n${sanitized}\n})`;
}

function checkFailClosedBarrier(state: ReturnType<typeof getState>, event: ToolCallEvent): BlockVerdict | undefined {
  if (state.phase === "implementing") {
    if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input["path"] === "string") {
      const targetPath = event.input["path"];
      if (!isExemptFromWorktreeJail(targetPath)) {
        return {
          block: true,
          reason: `CRITICAL SAFETY VIOLATION: Quest ${state.qid} is in phase 'implementing' but has no leased worktree. Writes to the primary repository are strictly blocked.`,
        };
      }
    }
  }
  return undefined;
}

function jailFileOperation(
  event: ToolCallEvent,
  state: ReturnType<typeof getState>,
  primaryRoot: string,
  worktreePath: string,
): BlockVerdict | undefined {
  if (
    (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") &&
    typeof event.input["path"] === "string"
  ) {
    const targetPath = event.input["path"];
    // Enforce contract allowedPaths on write and edit
    if (
      (event.toolName === "write" || event.toolName === "edit") &&
      state.contract &&
      state.contract.allowedPaths &&
      state.contract.allowedPaths.length > 0 &&
      !isExemptFromWorktreeJail(targetPath)
    ) {
      if (!isPathAllowedByContract(state.contract, targetPath, primaryRoot)) {
        const allowedStr = state.contract.allowedPaths.join(", ");
        return {
          block: true,
          reason: `Path '${targetPath}' is outside the declared allowedPaths for sub-quest ${state.qid}: [${allowedStr}]. Modify only allowed paths or request contract revision.`,
        };
      }
    }

    event.input["path"] = rewritePathToWorktree(targetPath, primaryRoot, worktreePath);
  }
  return undefined;
}

function jailSubagentOperation(
  event: ToolCallEvent,
  primaryRoot: string,
  worktreePath: string,
): void {
  if (event.toolName !== "subagent") return;
  const rawCwd = event.input["cwd"];
  if (typeof rawCwd !== "string" || rawCwd.trim() === "" || rawCwd === primaryRoot) {
    event.input["cwd"] = worktreePath;
  }
  const args = event.input["args"] as Record<string, unknown> | undefined;
  if (args && Array.isArray(args["tasks"])) {
    for (const t of args["tasks"] as Array<Record<string, unknown>>) {
      if (typeof t === "object" && t !== null) {
        if (typeof t["cwd"] !== "string" || t["cwd"].trim() === "" || t["cwd"] === primaryRoot) {
          t["cwd"] = worktreePath;
        }
      }
    }
  }
}

/**
 * Installs tool interception middleware onto the Pi instance.
 */
export function installToolInterception(pi: Pi): void {
  if (typeof pi.on !== "function") return;

  pi.on("tool_call", (event: ToolCallEvent, ctx: PiCtx): BlockVerdict | undefined => {
    if (!event || !event.toolName || !event.input) return undefined;

    const state = getState();
    if (state.disabled === true) return undefined;
    const worktreePath = state.worktreePath ?? state.contract?.worktreePath;
    const primaryRoot = findPrimaryRepoRoot(ctx.cwd);

    // Fail-closed barrier: If in implementing phase and NO worktree is leased,
    // block any write or edit tool from touching primary repository files!
    if (!worktreePath) {
      return checkFailClosedBarrier(state, event);
    }

    // 1. Jail bash and bg_run commands to the worktree
    if ((event.toolName === "bash" || event.toolName === "bg_run") && typeof event.input["command"] === "string") {
      event.input["command"] = rewriteBashCommandToWorktree(event.input["command"], worktreePath, primaryRoot);
      return undefined;
    }

    // 2. Jail file read/write/edit operations to the worktree
    const fileVerdict = jailFileOperation(event, state, primaryRoot, worktreePath);
    if (fileVerdict) return fileVerdict;

    // 3. Jail subagent delegations to the worktree cwd
    jailSubagentOperation(event, primaryRoot, worktreePath);

    return undefined;
  });
}
