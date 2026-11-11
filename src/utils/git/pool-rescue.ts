import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { Pi } from "../../hooks/events";
import { runGit } from "./exec";
import { commitDirtySubmodules, syncWorktreeSubmodulesToPrimary } from "./submodules";

/**
 * Rescues uncommitted changes in an orphaned or resetting slot onto its feature branch
 * (or a rescue branch) and syncs submodule objects before the slot is wiped.
 */
export async function rescueDirtySlotIfNeeded(
  primaryRoot: string,
  slotDir: string,
  qid: string | null,
  branchName: string | null,
  pi?: Pi,
  notifier?: { notify?: (message: string, level?: "info" | "warning" | "error") => void },
): Promise<{ rescued: boolean; branch?: string }> {
  if (!existsSync(join(slotDir, ".git"))) return { rescued: false };
  try {
    const statusRes = await runGit(["status", "--porcelain"], slotDir, pi);
    if (statusRes.exitCode !== 0 || statusRes.stdout.trim().length === 0) {
      return { rescued: false };
    }
    const rescueQid = qid || "orphan";
    const targetBranch = branchName || `quest/rescue-${rescueQid}`;
    notifier?.notify?.(`[Scratch Pool] Rescuing uncommitted work in ${slotDir} onto ${targetBranch}...`, "warning");

    const curRef = await runGit(["symbolic-ref", "--short", "HEAD"], slotDir, pi);
    const curBranch = curRef.exitCode === 0 ? curRef.stdout.trim() : "";
    if (curBranch !== targetBranch) {
      const verify = await runGit(["rev-parse", "--verify", `refs/heads/${targetBranch}`], primaryRoot, pi);
      const args = verify.exitCode === 0 ? ["checkout", targetBranch] : ["checkout", "-B", targetBranch];
      await runGit(args, slotDir, pi);
    }

    await commitDirtySubmodules(slotDir, `chore(${rescueQid}): auto-rescue uncommitted submodule work`, pi, targetBranch);
    await syncWorktreeSubmodulesToPrimary(primaryRoot, slotDir, targetBranch, pi);
    await runGit(["add", "-A"], slotDir, pi);
    const diffRes = await runGit(["diff", "--cached", "--quiet"], slotDir, pi);
    if (diffRes.exitCode !== 0) {
      await runGit(["commit", "-m", `chore(${rescueQid}): auto-rescue uncommitted slot work`], slotDir, pi);
    }
    return { rescued: true, branch: targetBranch };
  } catch {
    return { rescued: false };
  }
}

async function findSubmoduleBase(
  worktreePath: string,
  subRelPath: string,
  wtSub: string,
  branchName: string,
  parentBaseRef?: string,
  pi?: Pi,
): Promise<string | null> {
  if (parentBaseRef) {
    const gitlinkRes = await runGit(["rev-parse", `${parentBaseRef}:${subRelPath}`], worktreePath, pi);
    if (gitlinkRes.exitCode === 0 && gitlinkRes.stdout.trim()) {
      const exactSha = gitlinkRes.stdout.trim();
      const verifyInSub = await runGit(["cat-file", "-e", `${exactSha}^{commit}`], wtSub, pi);
      if (verifyInSub.exitCode === 0) return exactSha;
    }
  }
  const candidates = [parentBaseRef, "main", "master", "origin/main", "origin/master", "HEAD~1"].filter((c): c is string => Boolean(c));
  for (const cand of candidates) {
    const res = await runGit(["merge-base", `refs/heads/${branchName}`, cand], wtSub, pi);
    if (res.exitCode === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  return null;
}

/**
 * Squashes all commits on a feature branch in modified submodules ahead of merge-base into a single clean commit.
 */
export async function squashSubmoduleCommits(
  worktreePath: string,
  branchName: string,
  message: string,
  pi?: Pi,
  baseRef?: string,
): Promise<{ ok: boolean; squashed: string[]; error?: string }> {
  try {
    const statusRes = await runGit(["submodule", "status"], worktreePath, pi);
    if (statusRes.exitCode !== 0 || !statusRes.stdout) return { ok: true, squashed: [] };

    const squashed: string[] = [];
    for (const line of statusRes.stdout.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const subPath = parts[1];
      const wtSub = join(worktreePath, subPath);
      if (!existsSync(join(wtSub, ".git"))) continue;

      const checkBranch = await runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], wtSub, pi);
      if (checkBranch.exitCode !== 0) continue;

      const baseSha = await findSubmoduleBase(worktreePath, subPath, wtSub, branchName, baseRef, pi);
      if (!baseSha) continue;

      const countRes = await runGit(["rev-list", "--count", `${baseSha}..refs/heads/${branchName}`], wtSub, pi);
      const count = parseInt(countRes.stdout.trim(), 10);
      if (isNaN(count) || count <= 1) continue;

      await runGit(["checkout", branchName], wtSub, pi);
      const resetRes = await runGit(["reset", "--soft", baseSha], wtSub, pi);
      if (resetRes.exitCode !== 0) {
        return { ok: false, squashed, error: `Failed to soft-reset submodule ${subPath}: ${resetRes.stdout}` };
      }
      const commitRes = await runGit(["commit", "-m", message], wtSub, pi);
      if (commitRes.exitCode !== 0) {
        return { ok: false, squashed, error: `Failed to commit squashed changes in submodule ${subPath}: ${commitRes.stdout}` };
      }
      const stageRes = await runGit(["add", relative(worktreePath, wtSub)], worktreePath, pi);
      if (stageRes.exitCode !== 0) {
        return { ok: false, squashed, error: `Failed to stage squashed submodule pointer in parent: ${stageRes.stdout}` };
      }
      squashed.push(subPath);
    }
    return { ok: true, squashed };
  } catch (err) {
    return { ok: false, squashed: [], error: err instanceof Error ? err.message : String(err) };
  }
}
