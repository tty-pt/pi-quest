import type { Pi, PiCtx } from "../../hooks/events";
import { runGit } from "./exec";
import { mergeWorktreeBranch } from "./worktree";
import { rebaseSubmoduleBranch, alignPrimarySubmoduleBranches, restoreSubmoduleWorktrees } from "./submodules";
import { preflightWorktreeIntegration, promptConflictResolution, type PreflightCheckResult } from "./squash-preflight";

export { preflightWorktreeIntegration, promptConflictResolution, type PreflightCheckResult };

export interface SquashSummaryParams {
  qid: string;
  objective: string;
  requirements?: string[];
  milestones?: string[];
  verification?: string;
}

export interface ConfirmAndSquashOptions {
  beforeSquash?: () => Promise<void>;
  defaultConflictMode?: "keep" | "rebase";
}

/**
 * Returns oneline summaries of commits on the feature branch that are not in the base branch.
 */
export async function getBranchCommitSummaries(
  repoRoot: string,
  baseBranch: string,
  featureBranch: string,
  pi?: Pi,
): Promise<string[]> {
  try {
    const res = await runGit(
      ["log", "--oneline", `${baseBranch}..${featureBranch}`],
      repoRoot,
      pi,
    );
    if (res.exitCode !== 0 || !res.stdout) return [];
    return res.stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Returns diffstat string between base branch and feature branch.
 */
export async function getBranchDiffStat(
  repoRoot: string,
  baseBranch: string,
  featureBranch: string,
  pi?: Pi,
): Promise<string> {
  try {
    const res = await runGit(
      ["diff", "--stat", `${baseBranch}...${featureBranch}`],
      repoRoot,
      pi,
    );
    return res.exitCode === 0 ? res.stdout.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Synthesizes a structured, executive commit message for the squashed merge.
 */
export function synthesizeSquashCommitMessage(params: SquashSummaryParams): string {
  const lines: string[] = [];
  lines.push(`feat: ${params.objective} (quest ${params.qid})`, "");

  if (params.requirements && params.requirements.length > 0) {
    lines.push("Delivered requirements:");
    for (const req of params.requirements) {
      lines.push(`- ${req}`);
    }
    lines.push("");
  }

  if (params.milestones && params.milestones.length > 0) {
    lines.push("Feature branch milestones:");
    for (const ms of params.milestones) {
      lines.push(`- ${ms}`);
    }
    lines.push("");
  }

  if (params.verification) {
    lines.push("Verification:", params.verification, "");
  }

  lines.push(`Quest: ${params.qid}`);
  return lines.join("\n").trim();
}

/**
 * Executes a squash merge of featureBranch into the currently checked-out branch,
 * followed by committing the squashed changes with the provided message.
 * Does not stash-pop over overlapping dirty files (pre-flight guarantees no overlap).
 */
export async function squashMergeBranch(
  repoRoot: string,
  featureBranch: string,
  message: string,
  pi?: Pi,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await restoreSubmoduleWorktrees(repoRoot, pi);
    const mergeRes = await runGit(["merge", "--squash", featureBranch], repoRoot, pi);
    if (mergeRes.exitCode !== 0) {
      await runGit(["reset", "--merge"], repoRoot, pi);
      return { ok: false, error: mergeRes.stdout || `git merge --squash ${featureBranch} failed` };
    }

    const commitRes = await runGit(["commit", "-m", message], repoRoot, pi);
    if (commitRes.exitCode !== 0) {
      await runGit(["reset", "--merge"], repoRoot, pi);
      return { ok: false, error: commitRes.stdout || "git commit of squash merge failed" };
    }

    try {
      await runGit(["submodule", "update", "--init", "--no-fetch", "--force"], repoRoot, pi);
      await alignPrimarySubmoduleBranches(repoRoot, pi);
    } catch { /* best-effort submodule update */ }

    return { ok: true };
  } catch (err) {
    try { await runGit(["reset", "--merge"], repoRoot, pi); } catch { /* ignore */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Reconciles diverging submodules between targetRef and worktree feature branch.
 */
async function reconcileSubmodulesBeforeMerge(
  worktreePath: string,
  targetRef: string,
  pi?: Pi,
): Promise<{ ok: boolean; rebased: string[]; error?: string }> {
  try {
    const rawDiff = await runGit(["diff", targetRef, "HEAD", "--raw"], worktreePath, pi);
    if (rawDiff.exitCode !== 0 || !rawDiff.stdout) return { ok: true, rebased: [] };

    const rebased: string[] = [];
    for (const line of rawDiff.stdout.trim().split("\n")) {
      if (!line.includes(" 160000 ")) continue;
      const parts = line.split(/\s+/);
      const subPath = parts[parts.length - 1];

      const targetShaRes = await runGit(["rev-parse", `${targetRef}:${subPath}`], worktreePath, pi);
      if (targetShaRes.exitCode !== 0 || !targetShaRes.stdout.trim()) continue;
      const targetSha = targetShaRes.stdout.trim();

      const res = await rebaseSubmoduleBranch(worktreePath, subPath, targetSha, pi);
      if (!res.ok) {
        return { ok: false, rebased, error: res.error };
      }
      if (res.rebased) {
        rebased.push(subPath);
      }
    }

    if (rebased.length > 0) {
      await runGit(["commit", "-m", `reconcile submodule pointers with ${targetRef}`], worktreePath, pi);
    }
    return { ok: true, rebased };
  } catch (err) {
    return { ok: false, rebased: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 3-Stage Non-Destructive Integration:
 * 1) Pre-flight checks dirty overlap in repoRoot and mergeability against repoRoot's actual HEAD.
 * 2) If conflict/overlap is detected, prompts with Rebase / Keep / Cancel (defaulting to Rebase).
 * 3) If clean, prompts for Squash / Merge / Keep and executes integration only after user choice.
 */
export async function confirmAndSquashWorktree(
  pi: Pi,
  ctx: PiCtx,
  repoRoot: string,
  featureBranch: string,
  targetBranch: string,
  squashMessage: string,
  milestones: string[] = [],
  worktreePath?: string,
  options?: ConfirmAndSquashOptions,
): Promise<{ ok: boolean; mode: "squash" | "squash-keep-slot" | "merge" | "keep" | "keep-slot" | "rebase" | "cancel"; error?: string }> {
  const preflight = await preflightWorktreeIntegration(repoRoot, featureBranch, worktreePath, pi);
  const displayTarget = targetBranch && targetBranch !== "HEAD" ? targetBranch : preflight.primaryBranch;
  const targetRef = preflight.primaryHeadSha || targetBranch || "HEAD";
  const conflictDefault = options?.defaultConflictMode ?? "rebase";

  if (!preflight.clean) {
    const decision = await promptConflictResolution(
      ctx,
      featureBranch,
      displayTarget,
      preflight.conflictReason || "merge conflict",
      conflictDefault,
    );
    if (decision === "keep") {
      return { ok: true, mode: "keep" };
    }
    return {
      ok: false,
      mode: decision,
      error: preflight.conflictReason || `Conflict between ${featureBranch} and ${displayTarget}`,
    };
  }

  let choice: "squash" | "squash-keep-slot" | "merge" | "keep" | "keep-slot" | "cancel" = "squash";
  if (ctx.hasUI && typeof ctx.ui?.select === "function") {
    try {
      const summaryList = milestones.length > 0 ? ` (${milestones.length} milestone commits)` : "";
      const selected = await ctx.ui.select(
        `Squash-merge ${featureBranch}${summaryList} into ${displayTarget}?`,
        [
          `Squash and merge into ${displayTarget} (recommended)`,
          `Squash and merge into ${displayTarget} & keep slot`,
          `Keep work in slot for manual testing / next quest (do not reset slot)`,
          `Merge without squash (--no-ff)`,
          `Keep branch unmerged (${featureBranch}) & archive quest`,
          `Cancel archive (stay in quest)`,
        ],
      );
      if (selected === undefined || selected.startsWith("Cancel archive")) {
        choice = "cancel";
      } else if (selected.startsWith("Squash and merge") && selected.includes("keep slot")) {
        choice = "squash-keep-slot";
      } else if (selected.startsWith("Keep work in slot")) {
        choice = "keep-slot";
      } else if (selected.startsWith("Merge without")) {
        choice = "merge";
      } else if (selected.startsWith("Keep branch")) {
        choice = "keep";
      }
    } catch {
      choice = "squash";
    }
  }

  if (choice === "cancel") {
    return { ok: false, mode: "cancel", error: "staying in quest" };
  }

  if (choice === "keep-slot") {
    return { ok: true, mode: "keep-slot" };
  }

  if (choice === "keep") {
    return { ok: true, mode: "keep" };
  }

  if (worktreePath) {
    const reconcileRes = await reconcileSubmodulesBeforeMerge(worktreePath, targetRef, pi);
    if (!reconcileRes.ok) {
      const decision = await promptConflictResolution(ctx, featureBranch, displayTarget, reconcileRes.error || "submodule conflict", conflictDefault);
      if (decision === "keep") return { ok: true, mode: "keep" };
      return { ok: false, mode: decision, error: `Failed to reconcile diverging submodule branch: ${reconcileRes.error}` };
    }

    const isAncestor = await runGit(["merge-base", "--is-ancestor", targetRef, "HEAD"], worktreePath, pi);
    if (isAncestor.exitCode !== 0) {
      const syncRes = await runGit(["merge", "--no-ff", "-m", `Sync ${displayTarget} into ${featureBranch}`, targetRef], worktreePath, pi);
      if (syncRes.exitCode !== 0) {
        await runGit(["merge", "--abort"], worktreePath, pi);
        const decision = await promptConflictResolution(ctx, featureBranch, displayTarget, syncRes.stdout || "merge conflicts", conflictDefault);
        if (decision === "keep") return { ok: true, mode: "keep" };
        return { ok: false, mode: decision, error: `Feature branch ${featureBranch} cannot merge cleanly with ${displayTarget}` };
      }
      try {
        await runGit(["submodule", "update", "--init", "--no-fetch", "--force"], worktreePath, pi);
        await restoreSubmoduleWorktrees(repoRoot, pi);
      } catch { /* best-effort submodule update */ }
    }
  }

  if ((choice === "squash" || choice === "squash-keep-slot") && options?.beforeSquash) {
    await options.beforeSquash();
  }

  if (choice === "merge") {
    const mergeRes = await mergeWorktreeBranch(repoRoot, featureBranch, pi);
    return { ok: mergeRes.ok, mode: "merge", error: mergeRes.error };
  }

  const squashRes = await squashMergeBranch(repoRoot, featureBranch, squashMessage, pi);
  return { ok: squashRes.ok, mode: choice === "squash-keep-slot" ? "squash-keep-slot" : "squash", error: squashRes.error };
}
