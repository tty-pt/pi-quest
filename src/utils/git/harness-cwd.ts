// HIGH_LEVEL: #storage — harness working directory and environment synchronization.
import { existsSync } from "node:fs";
import { findPrimaryRepoRoot } from "./root";
import type { Pi } from "../../hooks/events";

let cachedPrimaryRoot: string | null = null;

export function safeCwd(): string {
  try {
    return process.cwd();
  } catch {
    return "";
  }
}

export function getPrimaryRoot(fallbackCwd?: string): string {
  if (!cachedPrimaryRoot) {
    const cwd = fallbackCwd ?? safeCwd();
    cachedPrimaryRoot = cwd ? findPrimaryRepoRoot(cwd) : "";
  }
  return cachedPrimaryRoot;
}

export function resetPrimaryRootCache(): void {
  cachedPrimaryRoot = null;
}

/**
 * Synchronizes Node's process.cwd() and process.env.PI_WORKTREE_PATH with the
 * active scratch worktree or primary repository root.
 *
 * This ensures that ACP providers (such as pi-antigravity-acp-provider) that bind
 * sessions to process.cwd() naturally initialize in the active worktree, and
 * native tool calls are strictly jailed to the worktree directory.
 */
export function syncHarnessCwd(targetPath?: string | null, pi?: Pi): void {
  const primary = getPrimaryRoot();
  const target = targetPath && existsSync(targetPath) ? targetPath : (primary && existsSync(primary) ? primary : null);

  if (target && existsSync(target)) {
    const current = safeCwd();
    if (current !== target) {
      try {
        process.chdir(target);
      } catch {
        // Best-effort in sandboxes or if chdir fails
      }
    }
  }

  if (targetPath && existsSync(targetPath)) {
    process.env.PI_WORKTREE_PATH = targetPath;
  } else {
    delete process.env.PI_WORKTREE_PATH;
  }

  try {
    pi?.refreshTools?.();
  } catch {
    // Best-effort capability invocation
  }
}
