import type { Pi, PiCtx } from "../../hooks/events";
import { runGit } from "./exec";
import { getCurrentRef } from "./workspace-runner";

export interface PreflightCheckResult {
  clean: boolean;
  primaryBranch: string;
  primaryHeadSha: string;
  overlappingDirtyFiles: string[];
  conflictReason?: string;
}

function parsePorcelainFiles(stdout: string): string[] {
  const files: string[] = [];
  for (const line of stdout.split("\n")) {
    if (!line || line.length < 4) continue;
    const rawPath = line.slice(3).trim();
    const arrowIdx = rawPath.indexOf(" -> ");
    if (arrowIdx >= 0) {
      files.push(rawPath.slice(0, arrowIdx).trim());
      files.push(rawPath.slice(arrowIdx + 4).trim());
    } else {
      files.push(rawPath);
    }
  }
  return files;
}

/**
 * Resolves the primary repository's current branch/HEAD and checks for:
 * 1) Dirty uncommitted files in primaryRoot that overlap with files modified by featureBranch
 * 2) Clean mergeability between featureBranch and primaryHeadSha inside worktreePath
 * Never modifies primaryRoot.
 */
export async function preflightWorktreeIntegration(
  repoRoot: string,
  featureBranch: string,
  worktreePath?: string,
  pi?: Pi,
): Promise<PreflightCheckResult> {
  const ref = await getCurrentRef(repoRoot, pi);
  const primaryBranch = ref.branch || "HEAD";
  const primaryHeadSha = ref.commit || "HEAD";

  // 1. Identify files modified by featureBranch relative to primaryHeadSha
  const diffRes = await runGit(["diff", "--name-only", `${primaryHeadSha}...${featureBranch}`], repoRoot, pi);
  const changedByQuest = new Set<string>(
    diffRes.exitCode === 0 && diffRes.stdout
      ? diffRes.stdout.split("\n").map((s) => s.trim()).filter(Boolean)
      : [],
  );

  // 2. Check dirty files in primaryRoot for overlap with changedByQuest
  const statusRes = await runGit(["status", "--porcelain"], repoRoot, pi);
  const dirtyInPrimary = statusRes.exitCode === 0 && statusRes.stdout
    ? parsePorcelainFiles(statusRes.stdout)
    : [];
  const overlappingDirtyFiles = dirtyInPrimary.filter((f) => {
    const clean = f.replace(/\/+$/, "");
    return changedByQuest.has(clean) || [...changedByQuest].some((q) => q.startsWith(`${clean}/`) || clean.startsWith(`${q}/`));
  });

  if (overlappingDirtyFiles.length > 0) {
    return {
      clean: false,
      primaryBranch,
      primaryHeadSha,
      overlappingDirtyFiles,
      conflictReason: `Primary workspace has uncommitted changes in [${overlappingDirtyFiles.slice(0, 5).join(", ")}] that overlap with ${featureBranch}`,
    };
  }

  // 3. Test mergeability inside worktreePath without committing
  if (worktreePath && primaryHeadSha !== "HEAD") {
    const isAncestor = await runGit(["merge-base", "--is-ancestor", primaryHeadSha, "HEAD"], worktreePath, pi);
    if (isAncestor.exitCode !== 0) {
      const trialMerge = await runGit(["merge", "--no-commit", "--no-ff", primaryHeadSha], worktreePath, pi);
      await runGit(["merge", "--abort"], worktreePath, pi);
      if (trialMerge.exitCode !== 0) {
        return {
          clean: false,
          primaryBranch,
          primaryHeadSha,
          overlappingDirtyFiles: [],
          conflictReason: `Merge conflict between ${featureBranch} and ${primaryBranch} (${primaryHeadSha.slice(0, 7)})`,
        };
      }
    }
  }

  return {
    clean: true,
    primaryBranch,
    primaryHeadSha,
    overlappingDirtyFiles: [],
  };
}

/**
 * Prompts the operator with 3 predictable options when pre-flight or integration detects a conflict:
 * 1) Have the agent rebase & resolve conflicts in the worktree (default fallback)
 * 2) Keep branch unmerged & archive quest
 * 3) Cancel archive (stay in quest)
 */
export async function promptConflictResolution(
  ctx: PiCtx,
  featureBranch: string,
  primaryBranch: string,
  reason: string,
  defaultMode: "keep" | "rebase" = "rebase",
): Promise<"keep" | "rebase" | "cancel"> {
  if (ctx.hasUI && typeof ctx.ui?.select === "function") {
    try {
      const selected = await ctx.ui.select(
        `${featureBranch} cannot merge automatically into ${primaryBranch} (${reason}). What would you like to do?`,
        [
          `Have the agent rebase & resolve conflicts in the worktree (recommended)`,
          `Keep branch unmerged (${featureBranch}) & archive quest`,
          `Cancel archive (stay in quest)`,
        ],
      );
      if (selected?.startsWith("Have the agent rebase")) {
        return "rebase";
      }
      if (selected?.startsWith("Keep branch unmerged")) {
        return "keep";
      }
      if (selected?.startsWith("Cancel archive")) {
        return "cancel";
      }
      return defaultMode;
    } catch {
      return defaultMode;
    }
  }
  return defaultMode;
}
