import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Finds the enclosing Git repository root by walking up directories
 * looking for a `.git` directory or gitfile (submodules/worktrees).
 */
export function findRepoRoot(startPath: string): string | undefined {
  try {
    let curr = isAbsolute(startPath) ? startPath : resolve(startPath);
    if (existsSync(curr)) {
      try {
        const st = statSync(curr);
        if (!st.isDirectory()) {
          curr = dirname(curr);
        }
      } catch {
        curr = dirname(curr);
      }
    } else {
      curr = dirname(curr);
    }

    let prev = "";
    while (curr !== prev) {
      if (existsSync(join(curr, ".git"))) {
        return curr;
      }
      prev = curr;
      curr = dirname(curr);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Reads the git common directory for a repository or worktree.
 * In a main repository, returns `<repo>/.git`.
 * In a secondary worktree, returns the primary repo's `.git` directory.
 */
export function findGitCommonDir(startPath: string): string | undefined {
  const repo = findRepoRoot(startPath);
  if (!repo) return undefined;
  const gitPath = join(repo, ".git");
  try {
    const st = statSync(gitPath);
    if (st.isDirectory()) {
      return gitPath;
    }
    if (st.isFile()) {
      const content = readFileSync(gitPath, "utf8");
      const match = content.match(/gitdir:\s*(.+)/);
      if (match) {
        const rawGitDir = match[1].trim();
        const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(repo, rawGitDir);
        const commondirFile = join(gitDir, "commondir");
        if (existsSync(commondirFile)) {
          const commonRel = readFileSync(commondirFile, "utf8").trim();
          return resolve(gitDir, commonRel);
        }
        return gitDir;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Discovers the canonical primary repository root.
 * If startPath is in a git worktree, this returns the main repository root
 * where .git lives, ensuring quest documents and archives are anchored canonically.
 */
export function findPrimaryRepoRoot(startPath: string): string {
  const normalized = isAbsolute(startPath) ? startPath : resolve(startPath);
  const scratchIdx = normalized.indexOf("/.pi/scratch/");
  if (scratchIdx !== -1) {
    const candidate = normalized.slice(0, scratchIdx);
    if (existsSync(join(candidate, ".git"))) return candidate;
  }
  const wtIdx = normalized.indexOf("/.pi/worktrees/");
  if (wtIdx !== -1) {
    const candidate = normalized.slice(0, wtIdx);
    if (existsSync(join(candidate, ".git"))) return candidate;
  }
  const common = findGitCommonDir(startPath);
  if (common) {
    const modulesIdx = common.indexOf("/.git/modules");
    if (modulesIdx !== -1) {
      const candidate = common.slice(0, modulesIdx);
      if (existsSync(join(candidate, ".git"))) return candidate;
    }
    const root = dirname(common);
    if (existsSync(root)) return root;
  }
  return findRepoRoot(startPath) ?? normalized;
}

/**
 * Returns true if startPath is inside a secondary git worktree.
 */
export function isGitWorktree(startPath: string): boolean {
  const repo = findRepoRoot(startPath);
  if (!repo) return false;
  const gitPath = join(repo, ".git");
  try {
    const st = statSync(gitPath);
    if (st.isFile()) {
      const content = readFileSync(gitPath, "utf8");
      const match = content.match(/gitdir:\s*(.+)/);
      if (match) {
        const rawGitDir = match[1].trim();
        const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(repo, rawGitDir);
        return existsSync(join(gitDir, "commondir"));
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}
