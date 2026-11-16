import type { Pi } from "../../hooks/events";
import { runGit, getGitHead } from "./exec";
import { findPrimaryRepoRoot } from "./root";
import { commitDirtySubmodules, syncWorktreeSubmodulesToPrimary } from "./submodules";

export type MilestoneType = "start" | "requirement" | "subquest" | "validation" | "manual";

export interface MilestoneSpec {
  qid: string;
  type: MilestoneType;
  label: string;
  reqId?: string;
  details?: string;
}

export interface MilestoneCommitResult {
  ok: boolean;
  commitHash?: string;
  committedSubmodules?: string[];
  branchedSubmodules?: string[];
  syncedSubmodules?: string[];
  error?: string;
  skipped?: boolean;
}

function formatCommitMessage(milestone: MilestoneSpec): string {
  let prefix = "feat";
  if (milestone.type === "start" || milestone.type === "subquest") {
    prefix = "chore";
  } else if (milestone.type === "validation") {
    prefix = "test";
  }

  const tag = milestone.reqId ? `[${milestone.reqId}] ` : "";
  const title = `${prefix}(${milestone.qid}): ${tag}${milestone.label}`;
  return milestone.details ? `${title}\n\n${milestone.details}` : title;
}

/**
 * Commits an achievement milestone to the feature branch inside a worktree.
 * Automatically commits dirty submodules first on the matching feature branch,
 * synchronizes them to the primary repository store, stages parent changes,
 * and creates a structured conventional commit.
 */
export async function commitMilestone(
  worktreePath: string,
  milestone: MilestoneSpec,
  pi?: Pi,
  branchName?: string,
): Promise<MilestoneCommitResult> {
  try {
    const subMessage = `${milestone.qid}: ${milestone.label}`;
    let targetBranch = branchName;
    if (!targetBranch) {
      const currentRef = await runGit(["symbolic-ref", "--short", "HEAD"], worktreePath, pi);
      targetBranch = currentRef.exitCode === 0 && currentRef.stdout.trim()
        ? currentRef.stdout.trim()
        : `quest/${milestone.qid}`;
    }

    const subRes = await commitDirtySubmodules(worktreePath, subMessage, pi, targetBranch);
    if (!subRes.ok) {
      return {
        ok: false,
        error: subRes.error,
        committedSubmodules: subRes.committed,
        branchedSubmodules: subRes.branched,
      };
    }

    let synced: string[] = [];
    const primaryRoot = findPrimaryRepoRoot(worktreePath);
    if (primaryRoot && subRes.committed.length > 0) {
      const syncRes = await syncWorktreeSubmodulesToPrimary(primaryRoot, worktreePath, targetBranch, pi);
      if (syncRes.ok) {
        synced = syncRes.synced;
      }
    }

    const stageRes = await runGit(["add", "-A"], worktreePath, pi);
    if (stageRes.exitCode !== 0) {
      return { ok: false, error: `Failed to stage worktree changes: ${stageRes.stdout}` };
    }

    const diffCheck = await runGit(["diff", "--cached", "--quiet"], worktreePath, pi);
    if (diffCheck.exitCode === 0) {
      // Nothing to commit
      return {
        ok: true,
        skipped: true,
        committedSubmodules: subRes.committed,
        branchedSubmodules: subRes.branched,
        syncedSubmodules: synced,
      };
    }

    const message = formatCommitMessage(milestone);
    const commitRes = await runGit(["commit", "-m", message], worktreePath, pi);
    if (commitRes.exitCode !== 0) {
      return { ok: false, error: `Failed to commit milestone: ${commitRes.stdout}` };
    }

    const hash = await getGitHead(worktreePath, pi);
    return {
      ok: true,
      commitHash: hash,
      committedSubmodules: subRes.committed,
      branchedSubmodules: subRes.branched,
      syncedSubmodules: synced,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
