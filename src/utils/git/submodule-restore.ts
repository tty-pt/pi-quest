import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Pi } from "../../hooks/events";
import { runGit } from "./exec";
import { findGitCommonDir } from "./root";

export const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Guards against committing an empty tree (4b825dc642cb6eb9a060e54bf8d69288fbee4904)
 * or committing when the submodule working tree directory is unpopulated.
 */
export async function guardSubmoduleWorkingTree(
  subPath: string,
  pi?: Pi,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (existsSync(subPath)) {
      const entries = readdirSync(subPath).filter((e) => e !== ".git");
      if (entries.length === 0) {
        const headCheck = await runGit(["ls-tree", "-r", "--name-only", "HEAD"], subPath, pi);
        if (headCheck.exitCode === 0 && headCheck.stdout.trim().length > 0) {
          await runGit(["reset", "HEAD"], subPath, pi);
          return {
            ok: false,
            error: `Refusing to stage/commit unpopulated submodule working tree at ${subPath} (working tree is empty but HEAD has files)`,
          };
        }
      }
    }

    const treeRes = await runGit(["write-tree"], subPath, pi);
    if (treeRes.exitCode === 0 && treeRes.stdout.trim() === EMPTY_TREE_SHA) {
      await runGit(["reset", "HEAD"], subPath, pi);
      return {
        ok: false,
        error: `Refusing to commit empty tree (${EMPTY_TREE_SHA}) in submodule at ${subPath}`,
      };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Restores core.worktree config for all submodules in primaryRoot, ensuring that
 * any linked worktree operations or submodule updates that mutated the shared
 * canonical .git/modules/<name>/config files are repaired back to primaryRoot.
 */
export async function restoreSubmoduleWorktrees(
  primaryRoot: string,
  pi?: Pi,
): Promise<void> {
  const gitmodulesPath = join(primaryRoot, ".gitmodules");
  if (!existsSync(gitmodulesPath)) return;

  try {
    const content = readFileSync(gitmodulesPath, "utf-8");
    const subPaths: string[] = [];
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*path\s*=\s*(.+)$/);
      if (match) subPaths.push(match[1].trim());
    }

    for (const subPath of subPaths) {
      const gitFile = join(primaryRoot, subPath, ".git");
      if (!existsSync(gitFile)) continue;

      let gitFileContent = "";
      try {
        gitFileContent = readFileSync(gitFile, "utf-8").trim();
      } catch {
        continue;
      }

      if (!gitFileContent.startsWith("gitdir:")) continue;
      const relGitDir = gitFileContent.replace(/^gitdir:\s*/, "").trim();
      const gitDir = resolve(primaryRoot, subPath, relGitDir);
      const cfgFile = join(gitDir, "config");
      if (!existsSync(cfgFile)) continue;

      const targetPath = join(primaryRoot, subPath);
      const expectedRelWorktree = relative(gitDir, targetPath);

      const res = await runGit(
        ["config", "--file", cfgFile, "core.worktree"],
        primaryRoot,
        pi,
      );
      if (res.exitCode !== 0 || res.stdout.trim() !== expectedRelWorktree) {
        await runGit(
          ["config", "--file", cfgFile, "core.worktree", expectedRelWorktree],
          primaryRoot,
          pi,
        );
      }
    }
  } catch {
    // Best-effort restoration
  }
}

function findSubmoduleWorktreeDirs(dir: string, results: string[] = []): string[] {
  if (!existsSync(dir)) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const full = join(dir, ent.name);
        if (ent.name === "worktrees") {
          results.push(full);
        } else if (ent.name !== ".git" && ent.name !== "objects") {
          findSubmoduleWorktreeDirs(full, results);
        }
      }
    }
  } catch { /* ignore */ }
  return results;
}

/**
 * Prunes worktree records in all registered submodules in primary repo.
 * Runs git worktree prune --expire=now to immediately remove dead slot records.
 */
export async function pruneSubmoduleWorktrees(
  primaryRoot: string,
  pi?: Pi,
): Promise<void> {
  await restoreSubmoduleWorktrees(primaryRoot, pi);
  try {
    const statusRes = await runGit(["submodule", "status"], primaryRoot, pi);
    if (statusRes.exitCode === 0 && statusRes.stdout) {
      for (const line of statusRes.stdout.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const primarySub = join(primaryRoot, parts[1]);
          if (existsSync(join(primarySub, ".git"))) {
            await runGit(["worktree", "prune", "--expire=now"], primarySub, pi);
          }
        }
      }
    }

    let modulesDir = join(primaryRoot, ".git", "modules");
    if (!existsSync(modulesDir)) {
      const common = findGitCommonDir(primaryRoot);
      if (common) modulesDir = join(common, "modules");
    }
    const wtDirs = findSubmoduleWorktreeDirs(modulesDir);
    for (const wtDir of wtDirs) {
      const gitDir = resolve(wtDir, "..");
      await runGit(["--git-dir=" + gitDir, "worktree", "prune", "--expire=now"], primaryRoot, pi);
      try {
        const entries = readdirSync(wtDir);
        for (const entry of entries) {
          const slotWtDir = join(wtDir, entry);
          const gitdirFile = join(slotWtDir, "gitdir");
          if (existsSync(gitdirFile)) {
            const target = readFileSync(gitdirFile, "utf-8").trim();
            if (!existsSync(target)) {
              rmSync(slotWtDir, { recursive: true, force: true });
            }
          }
        }
      } catch { /* ignore */ }
    }
  } catch {
    // Best-effort submodule prune
  }
}

/**
 * Ensures submodules in primaryRoot are attached to their local 'main' branch
 * rather than left in DETACHED HEAD after `git submodule update`.
 */
export async function alignPrimarySubmoduleBranches(
  primaryRoot: string,
  pi?: Pi,
): Promise<void> {
  try {
    const statusRes = await runGit(["submodule", "status"], primaryRoot, pi);
    if (statusRes.exitCode !== 0 || !statusRes.stdout) return;
    for (const line of statusRes.stdout.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;
      const primarySub = join(primaryRoot, parts[1]);
      if (!existsSync(join(primarySub, ".git"))) continue;

      const symRes = await runGit(["symbolic-ref", "-q", "HEAD"], primarySub, pi);
      if (symRes.exitCode === 0) continue;

      const mainCheck = await runGit(["rev-parse", "--verify", "refs/heads/main"], primarySub, pi);
      if (mainCheck.exitCode === 0) {
        const isAnc = await runGit(["merge-base", "--is-ancestor", "refs/heads/main", "HEAD"], primarySub, pi);
        if (isAnc.exitCode === 0) {
          await runGit(["checkout", "-B", "main", "HEAD"], primarySub, pi);
        }
      } else {
        await runGit(["checkout", "-B", "main", "HEAD"], primarySub, pi);
      }
    }
  } catch {
    // Best-effort submodule branch alignment
  }
}
