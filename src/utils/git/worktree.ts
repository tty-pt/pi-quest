import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync, realpathSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Pi } from "../../hooks/events";
import { runGit } from "./exec";
import { hasSubmodules, initWorktreeSubmodules, pruneSubmoduleWorktrees, alignPrimarySubmoduleBranches, restoreSubmoduleWorktrees } from "./submodules";

export interface CreateWorktreeOptions {
  initSubmodules?: boolean;
}

function setupWorktreeNodeModules(repoRoot: string, worktreePath: string): void {
  const primaryNodeModules = join(repoRoot, "node_modules");
  const wtNodeModules = join(worktreePath, "node_modules");
  if (!existsSync(primaryNodeModules)) return;

  try {
    const wtStat = lstatSync(wtNodeModules, { throwIfNoEntry: false });
    if (wtStat?.isSymbolicLink()) {
      unlinkSync(wtNodeModules);
    }
    mkdirSync(wtNodeModules, { recursive: true });

    for (const entry of readdirSync(primaryNodeModules, { withFileTypes: true })) {
      if (entry.name === "@tty-pt" || entry.name === "@ttypt") continue;
      const dst = join(wtNodeModules, entry.name);
      if (!lstatSync(dst, { throwIfNoEntry: false })) {
        try { symlinkSync(join(primaryNodeModules, entry.name), dst); } catch { /* ignore */ }
      }
    }

    const primaryTtyPt = join(primaryNodeModules, "@tty-pt");
    if (existsSync(primaryTtyPt)) {
      const wtTtyPt = join(wtNodeModules, "@tty-pt");
      mkdirSync(wtTtyPt, { recursive: true });
      for (const pkg of readdirSync(primaryTtyPt, { withFileTypes: true })) {
        const srcPkg = join(primaryTtyPt, pkg.name);
        const dstPkg = join(wtTtyPt, pkg.name);
        try {
          const target = pkg.isSymbolicLink() ? readlinkSync(srcPkg) : join("../../external", `lib${pkg.name}`, "npm");
          if (lstatSync(dstPkg, { throwIfNoEntry: false })) unlinkSync(dstPkg);
          symlinkSync(target, dstPkg);
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

function excludeWorktreeNodeModulesFromGit(worktreePath: string): void {
  try {
    const gitFile = join(worktreePath, ".git");
    if (!existsSync(gitFile)) return;
    let gitDir = gitFile;
    const content = readFileSync(gitFile, "utf8").trim();
    if (content.startsWith("gitdir:")) {
      gitDir = resolve(worktreePath, content.slice(7).trim());
    }
    const infoExclude = join(gitDir, "info", "exclude");
    if (existsSync(infoExclude)) {
      const excludeText = readFileSync(infoExclude, "utf8");
      if (!excludeText.includes("node_modules")) {
        writeFileSync(infoExclude, excludeText + "\nnode_modules\n", "utf8");
      }
    }
  } catch { /* ignore */ }
}

function fixEscapingSymlinks(repoRoot: string, worktreePath: string, dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        const primaryPath = join(repoRoot, relative(worktreePath, fullPath));
        if (existsSync(primaryPath) && lstatSync(primaryPath).isSymbolicLink()) {
          const target = realpathSync(primaryPath);
          if (existsSync(target) && !existsSync(fullPath)) {
            try { unlinkSync(fullPath); } catch { /* ignore */ }
            symlinkSync(target, fullPath);
          }
        }
      } catch { /* ignore */ }
    } else if (entry.isDirectory() && relative(worktreePath, fullPath).split("/").length <= 3) {
      fixEscapingSymlinks(repoRoot, worktreePath, fullPath);
    }
  }
}

/**
 * Fixes relative symlinks that escape the repository and provisions isolated worktree node_modules.
 */
export function setupWorktreeEnvironment(
  repoRoot: string,
  worktreePath: string,
): { ok: boolean; error?: string } {
  try {
    setupWorktreeNodeModules(repoRoot, worktreePath);
    excludeWorktreeNodeModulesFromGit(worktreePath);
    fixEscapingSymlinks(repoRoot, worktreePath, worktreePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Creates a new git worktree on an isolated branch and optionally
 * initializes submodules using the local .git/modules cache.
 * @param repoRoot Root of the primary git repository
 * @param worktreePath Target directory for the new worktree
 * @param branch Branch name to create and check out
 * @param pi Optional Pi instance for command execution
 * @param options Optional configuration (e.g. initSubmodules)
 */
export async function createWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  pi?: Pi,
  options?: CreateWorktreeOptions,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await runGit(["worktree", "prune", "--expire=now"], repoRoot, pi);
    const branchCheck = await runGit(["rev-parse", "--verify", `refs/heads/${branch}`], repoRoot, pi);
    const branchExists = branchCheck.exitCode === 0;

    const args = branchExists
      ? ["worktree", "add", "-f", worktreePath, branch]
      : ["worktree", "add", "-f", "-b", branch, worktreePath, "HEAD"];

    const res = await runGit(args, repoRoot, pi);
    if (res.exitCode !== 0) {
      return { ok: false, error: res.stdout || "git worktree add failed" };
    }

    // Set up worktree environment (symlinks, node_modules)
    setupWorktreeEnvironment(repoRoot, worktreePath);

    const shouldInitSubmodules = options?.initSubmodules ?? hasSubmodules(repoRoot);
    if (shouldInitSubmodules) {
      const subRes = await initWorktreeSubmodules(repoRoot, worktreePath, pi);
      if (!subRes.ok) {
        return { ok: false, error: `worktree created but submodule init failed: ${subRes.error}` };
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Merges a worktree branch into the current branch of the repository.
 * @param repoRoot Root of the git repository
 * @param branch Branch name to merge
 * @param pi Optional Pi instance for command execution
 */
export async function mergeWorktreeBranch(
  repoRoot: string,
  branch: string,
  pi?: Pi,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await restoreSubmoduleWorktrees(repoRoot, pi);
    const res = await runGit(["merge", "--no-ff", "-m", `Merge branch '${branch}'`, branch], repoRoot, pi);
    if (res.exitCode !== 0) {
      await runGit(["merge", "--abort"], repoRoot, pi);
      return { ok: false, error: res.stdout || `git merge ${branch} failed` };
    }
    try {
      await runGit(["submodule", "update", "--init", "--no-fetch", "--force"], repoRoot, pi);
      await alignPrimarySubmoduleBranches(repoRoot, pi);
    } catch { /* best-effort submodule update */ }
    return { ok: true };
  } catch (err) {
    try { await runGit(["merge", "--abort"], repoRoot, pi); } catch { /* ignore */ }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Removes a git worktree and optionally deletes its branch.
 * @param repoRoot Root of the primary git repository
 * @param worktreePath Directory of the worktree to remove
 * @param branch Optional branch name to delete after worktree removal
 * @param pi Optional Pi instance for command execution
 */
export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  branch?: string,
  pi?: Pi,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await runGit(["worktree", "remove", "--force", worktreePath], repoRoot, pi);
    if (res.exitCode !== 0) {
      try {
        const wtGit = join(worktreePath, ".git");
        if (existsSync(wtGit)) rmSync(wtGit, { force: true });
      } catch { /* ignore */ }
      await runGit(["worktree", "prune"], repoRoot, pi);
    }
    if (branch) {
      try { await runGit(["branch", "-D", branch], repoRoot, pi); } catch { /* ignore */ }
    }

    // Prune submodule worktree registries so no orphaned prunable records remain
    await pruneSubmoduleWorktrees(repoRoot, pi);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
