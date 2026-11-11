import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Pi } from "../../hooks/events";
import { runGit, getModifiedSubmodules } from "./exec";
import {
  restoreSubmoduleWorktrees, pruneSubmoduleWorktrees, EMPTY_TREE_SHA, guardSubmoduleWorkingTree, alignPrimarySubmoduleBranches, pushPrimaryAndSubmodules,
} from "./submodule-restore";

export { pruneSubmoduleWorktrees, restoreSubmoduleWorktrees, EMPTY_TREE_SHA, guardSubmoduleWorkingTree, alignPrimarySubmoduleBranches, pushPrimaryAndSubmodules };

/**
 * Checks whether a repository or worktree root configures submodules via .gitmodules.
 */
export function hasSubmodules(repoRoot: string): boolean {
  return existsSync(join(repoRoot, ".gitmodules"));
}

/**
 * Initializes and checks out all submodules inside a worktree.
 * Uses native submodule worktrees connected directly to the primary repository's
 * canonical modules (.git/modules/<subPath>), guaranteeing instantaneous zero-network
 * checkouts that automatically support unpushed local commits.
 */
export async function initWorktreeSubmodules(
  repoRoot: string,
  worktreePath: string,
  pi?: Pi,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const statusRes = await runGit(["submodule", "status"], repoRoot, pi);
    if (statusRes.exitCode === 0 && statusRes.stdout) {
      const lines = statusRes.stdout.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const rawSha = parts[0].replace(/^[+-]/, "");
          const subPath = parts[1];
          const primarySubPath = join(repoRoot, subPath);
          const wtSubPath = join(worktreePath, subPath);

          if (!existsSync(join(primarySubPath, ".git"))) {
            try {
              await runGit(
                ["-c", "protocol.file.allow=always", "submodule", "update", "--init", subPath],
                repoRoot,
                pi,
              );
            } catch { /* best-effort primary init */ }
          }

          if (existsSync(join(primarySubPath, ".git"))) {
            if (existsSync(join(wtSubPath, ".git"))) continue;
            try {
              if (existsSync(wtSubPath) && readdirSync(wtSubPath).length === 0) {
                const { rmSync } = await import("node:fs");
                rmSync(wtSubPath, { recursive: true, force: true });
              }
            } catch { /* proceed */ }

            const relWtSubPath = relative(primarySubPath, wtSubPath);
            const addRes = await runGit(
              ["-c", "protocol.allow=file", "worktree", "add", "--detach", relWtSubPath, rawSha || "HEAD"],
              primarySubPath,
              pi,
            );
            if (addRes.exitCode !== 0) {
              await runGit(["-c", "protocol.allow=file", "worktree", "add", "--detach", relWtSubPath], primarySubPath, pi);
            }
          }
        }
      }
    }

    await restoreSubmoduleWorktrees(repoRoot, pi);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Commits uncommitted changes inside modified submodules in a worktree,
 * then stages their updated commit references (gitlinks) in the parent worktree.
 */
export async function commitDirtySubmodules(
  worktreePath: string,
  message: string,
  pi?: Pi,
  branchName?: string,
): Promise<{ ok: boolean; committed: string[]; branched: string[]; error?: string }> {
  try {
    const dirty = await getModifiedSubmodules(worktreePath, pi);
    const committed: string[] = [];
    const branched: string[] = [];

    for (const subPath of dirty) {
      const relPath = relative(worktreePath, subPath);
      if (branchName) {
        const currentRefRes = await runGit(["symbolic-ref", "--short", "HEAD"], subPath, pi);
        const currentBranch = currentRefRes.exitCode === 0 ? currentRefRes.stdout.trim() : undefined;
        if (currentBranch !== branchName) {
          const verifyBranch = await runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], subPath, pi);
          if (verifyBranch.exitCode === 0) {
            const branchSha = (await runGit(["rev-parse", `refs/heads/${branchName}`], subPath, pi)).stdout.trim();
            const headSha = (await runGit(["rev-parse", "HEAD"], subPath, pi)).stdout.trim();
            if (branchSha === headSha) {
              await runGit(["symbolic-ref", "HEAD", `refs/heads/${branchName}`], subPath, pi);
            } else {
              await runGit(["checkout", branchName], subPath, pi);
            }
          } else {
            await runGit(["checkout", "-b", branchName], subPath, pi);
          }
          branched.push(relPath);
        }
      }

      const stageRes = await runGit(["add", "-A"], subPath, pi);
      if (stageRes.exitCode !== 0) {
        return { ok: false, committed, branched, error: `Failed to stage changes in submodule ${subPath}: ${stageRes.stdout}` };
      }

      const guardRes = await guardSubmoduleWorkingTree(subPath, pi);
      if (!guardRes.ok) {
        return { ok: false, committed, branched, error: guardRes.error };
      }

      const diffCheck = await runGit(["diff", "--cached", "--quiet"], subPath, pi);
      if (diffCheck.exitCode !== 0) {
        const commitRes = await runGit(["commit", "-m", message], subPath, pi);
        if (commitRes.exitCode !== 0) {
          return { ok: false, committed, branched, error: `Failed to commit submodule ${subPath}: ${commitRes.stdout}` };
        }
      }

      const stageParentRes = await runGit(["add", relPath], worktreePath, pi);
      if (stageParentRes.exitCode !== 0) {
        return { ok: false, committed, branched, error: `Failed to stage submodule pointer ${relPath} in parent: ${stageParentRes.stdout}` };
      }
      committed.push(relPath);
    }

    return { ok: true, committed, branched };
  } catch (err) {
    return { ok: false, committed: [], branched: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Synchronizes committed submodule feature branches and objects from a worktree
 * back into the primary repository's canonical submodule object stores (.git/modules/<subPath>).
 */
export async function syncWorktreeSubmodulesToPrimary(
  primaryRoot: string,
  worktreePath: string,
  branchName: string,
  pi?: Pi,
): Promise<{ ok: boolean; synced: string[]; error?: string }> {
  try {
    const statusRes = await runGit(["submodule", "status"], primaryRoot, pi);
    if (statusRes.exitCode !== 0 || !statusRes.stdout) return { ok: true, synced: [] };

    const synced: string[] = [];
    for (const line of statusRes.stdout.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const subPath = parts[1];
      const wtSub = join(worktreePath, subPath);
      const primarySub = join(primaryRoot, subPath);
      if (!existsSync(join(wtSub, ".git")) || !existsSync(join(primarySub, ".git"))) continue;

      const checkBranch = await runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], wtSub, pi);
      if (checkBranch.exitCode === 0) {
        const relWtSub = relative(primarySub, wtSub);
        const fetchRes = await runGit(
          ["-c", "protocol.file.allow=always", "fetch", relWtSub, `refs/heads/${branchName}:refs/heads/${branchName}`],
          primarySub,
          pi,
        );
        if (fetchRes.exitCode === 0) synced.push(subPath);
      }
    }
    return { ok: true, synced };
  } catch (err) {
    return { ok: false, synced: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Rebase a submodule's feature branch onto an updated target commit.
 */
export async function rebaseSubmoduleBranch(
  worktreePath: string,
  subPath: string,
  targetCommit: string,
  pi?: Pi,
): Promise<{ ok: boolean; rebased: boolean; error?: string }> {
  const wtSub = join(worktreePath, subPath);
  if (!existsSync(join(wtSub, ".git"))) return { ok: true, rebased: false };

  try {
    const isAncestor = await runGit(["merge-base", "--is-ancestor", targetCommit, "HEAD"], wtSub, pi);
    if (isAncestor.exitCode === 0) return { ok: true, rebased: false };

    const headIsAncestor = await runGit(["merge-base", "--is-ancestor", "HEAD", targetCommit], wtSub, pi);
    if (headIsAncestor.exitCode === 0) {
      await runGit(["reset", "--hard", targetCommit], wtSub, pi);
      await runGit(["add", relative(worktreePath, wtSub)], worktreePath, pi);
      return { ok: true, rebased: true };
    }

    const rebaseRes = await runGit(["rebase", targetCommit], wtSub, pi);
    if (rebaseRes.exitCode !== 0) {
      await runGit(["rebase", "--abort"], wtSub, pi);
      return { ok: false, rebased: false, error: `Submodule ${subPath} rebase conflict: ${rebaseRes.stdout}` };
    }

    await runGit(["add", relative(worktreePath, wtSub)], worktreePath, pi);
    return { ok: true, rebased: true };
  } catch (err) {
    return { ok: false, rebased: false, error: err instanceof Error ? err.message : String(err) };
  }
}
