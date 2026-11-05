// HIGH_LEVEL: #validation — multi-repository, submodule-aware, and non-git change detection.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { Pi, PiCtx } from "../hooks/events";

export const MAX_DIFF_CHARS = 30000;

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
  const common = findGitCommonDir(startPath);
  if (common) {
    const root = dirname(common);
    if (existsSync(root)) return root;
  }
  return findRepoRoot(startPath) ?? (isAbsolute(startPath) ? startPath : resolve(startPath));
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a git command safely using pi.exec if available,
 * with fallback to node:child_process execFile, with backoff
 * retries on index.lock contention.
 */
export async function runGit(
  args: string[],
  cwd: string,
  pi?: Pi,
  maxRetries = 3,
): Promise<{ exitCode: number; stdout: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let result: { exitCode: number; stdout: string };
    if (pi && typeof pi.exec === "function") {
      try {
        const res = (await pi.exec("git", args, { cwd })) as
          | { code?: number; exitCode?: number; stdout?: string; output?: string; stderr?: string }
          | undefined;
        const code = res?.exitCode ?? res?.code ?? 1;
        const stdout = res?.stdout ?? res?.output ?? "";
        result = { exitCode: code, stdout };
      } catch (err: unknown) {
        result = { exitCode: 1, stdout: String(err) };
      }
    } else {
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        const { stdout } = await execFileAsync("git", args, {
          cwd,
          maxBuffer: 10 * 1024 * 1024,
        });
        result = { exitCode: 0, stdout: stdout ?? "" };
      } catch (err: unknown) {
        const exitCode = typeof (err as { code?: number })?.code === "number"
          ? (err as { code: number }).code
          : 1;
        const stdout = typeof (err as { stdout?: string })?.stdout === "string"
          ? (err as { stdout: string }).stdout
          : (typeof (err as { message?: string })?.message === "string" ? (err as { message: string }).message : "");
        result = { exitCode, stdout };
      }
    }

    if (result.exitCode !== 0 && result.stdout.includes("index.lock") && attempt < maxRetries) {
      await sleep(100 * (attempt + 1));
      continue;
    }
    return result;
  }
  return { exitCode: 1, stdout: "git failed after index.lock retries" };
}

/**
 * Returns the current HEAD commit hash for a given directory,
 * or undefined if not a git repository.
 */
export async function getGitHead(cwd: string, pi?: Pi): Promise<string | undefined> {
  const root = findRepoRoot(cwd);
  if (!root) return undefined;
  const res = await runGit(["rev-parse", "HEAD"], root, pi);
  if (res.exitCode === 0 && res.stdout.trim().length >= 7) {
    return res.stdout.trim();
  }
  return undefined;
}

/**
 * Discovers modified or dirty submodules inside a git repository root.
 */
export async function getModifiedSubmodules(root: string, pi?: Pi): Promise<string[]> {
  const res = await runGit(["status", "--porcelain"], root, pi);
  if (res.exitCode !== 0 || !res.stdout) return [];

  const submodules: string[] = [];
  for (const rawLine of res.stdout.split("\n")) {
    if (!rawLine || rawLine.length < 4) continue;
    const relPath = rawLine.slice(3).trim();
    if (!relPath) continue;
    const fullPath = join(root, relPath);
    if (existsSync(join(fullPath, ".git"))) {
      submodules.push(fullPath);
    }
  }
  return submodules;
}

export interface UnifiedChangesResult {
  diff: string;
  hasVcsDiff: boolean;
  touchedNonGitFiles: string[];
  untrackedFiles: string[];
  repositories: string[];
}

/**
 * Captures a unified diff across primary repo, submodules, and external repos.
 * If no VCS diff is available, returns touched non-git files.
 */
export async function captureUnifiedDiff(
  ctx: PiCtx,
  options: {
    pi?: Pi;
    touchedFiles?: string[];
    baseCommit?: string;
    maxChars?: number;
  } = {},
): Promise<UnifiedChangesResult> {
  const maxChars = options.maxChars ?? MAX_DIFF_CHARS;
  const touchedFiles = options.touchedFiles ?? [];
  const pi = options.pi;

  const repoRoots = new Set<string>();
  const touchedNonGitFiles: string[] = [];
  const untrackedFiles: string[] = [];

  // 1. Check primary workspace root
  const primaryRoot = findRepoRoot(ctx.cwd);
  if (primaryRoot) {
    repoRoots.add(primaryRoot);
  }

  // 2. Classify touched files into repos or non-git paths
  for (const file of touchedFiles) {
    const fullPath = isAbsolute(file) ? file : resolve(ctx.cwd, file);
    const repo = findRepoRoot(fullPath);
    if (repo) {
      repoRoots.add(repo);
    } else {
      if (!touchedNonGitFiles.includes(fullPath)) {
        touchedNonGitFiles.push(fullPath);
      }
    }
  }

  // 3. Inspect primary repo for dirty submodules
  if (primaryRoot) {
    const submodules = await getModifiedSubmodules(primaryRoot, pi);
    for (const sm of submodules) {
      repoRoots.add(sm);
    }
  }

  const diffBlocks: Array<{ label: string; text: string }> = [];

  for (const repo of repoRoots) {
    let repoDiff = "";

    // A. Check untracked files
    const statusRes = await runGit(["status", "--porcelain"], repo, pi);
    if (statusRes.exitCode === 0 && statusRes.stdout) {
      for (const rawLine of statusRes.stdout.split("\n")) {
        if (rawLine.startsWith("?? ")) {
          const relUntracked = rawLine.slice(3).trim();
          const fullUntracked = join(repo, relUntracked);
          if (touchedFiles.length > 0 && !touchedFiles.some((tf) => {
            const fullTf = isAbsolute(tf) ? tf : resolve(ctx.cwd, tf);
            return fullTf === fullUntracked;
          })) {
            continue;
          }
          if (!untrackedFiles.includes(fullUntracked)) {
            untrackedFiles.push(fullUntracked);
          }
        }
      }
    }

    const repoTouchedRelPaths: string[] = [];
    for (const f of touchedFiles) {
      const fullPath = isAbsolute(f) ? f : resolve(ctx.cwd, f);
      if (fullPath === repo || fullPath.startsWith(repo + "/")) {
        const rel = fullPath === repo ? "." : fullPath.slice(repo.length + 1);
        if (rel && !rel.startsWith(".pi/quest/")) {
          repoTouchedRelPaths.push(rel);
        }
      }
    }
    const pathArgs = repoTouchedRelPaths.length > 0 ? ["--", ...repoTouchedRelPaths] : [];

    // B. Check if baseCommit is valid in this specific repo
    let diffWithBase = false;
    if (options.baseCommit) {
      const verifyRes = await runGit(["rev-parse", "--verify", `${options.baseCommit}^{commit}`], repo, pi);
      if (verifyRes.exitCode === 0) {
        diffWithBase = true;
        const diffRes = await runGit(["diff", options.baseCommit, ...pathArgs], repo, pi);
        if (diffRes.exitCode === 0 && diffRes.stdout.trim().length > 0) {
          repoDiff = diffRes.stdout.trim();
        }
      }
    }

    // C. Fallback to uncommitted HEAD changes, then HEAD~1 if not diffed with base
    if (!diffWithBase) {
      const isExplicitlyTouched = repoTouchedRelPaths.length > 0;
      const refs = isExplicitlyTouched || repoRoots.size === 1
        ? ["HEAD", "HEAD~1"]
        : ["HEAD"];

      for (const ref of refs) {
        const diffRes = await runGit(["diff", ref, ...pathArgs], repo, pi);
        if (diffRes.exitCode === 0 && diffRes.stdout.trim().length > 0) {
          repoDiff = diffRes.stdout.trim();
          break;
        }
      }
    }

    if (repoDiff.length > 0) {
      let label = repo;
      if (primaryRoot && repo.startsWith(primaryRoot) && repo !== primaryRoot) {
        label = `SUBMODULE: ${repo.slice(primaryRoot.length).replace(/^[/\\]+/, "")}`;
      } else if (repo === primaryRoot) {
        label = `WORKSPACE: ${repo}`;
      } else {
        label = `EXTERNAL REPOSITORY: ${repo}`;
      }
      diffBlocks.push({ label, text: repoDiff });
    }
  }

  // Synthesize diff text (prioritize external/touched repos)
  const sortedBlocks = [...diffBlocks].sort((a, b) => {
    const aIsExternal = a.label.startsWith("EXTERNAL REPOSITORY:");
    const bIsExternal = b.label.startsWith("EXTERNAL REPOSITORY:");
    if (aIsExternal && !bIsExternal) return -1;
    if (!aIsExternal && bIsExternal) return 1;
    return 0;
  });

  let combinedDiff = "";
  if (sortedBlocks.length === 1 && sortedBlocks[0].label.startsWith("WORKSPACE:")) {
    // Single workspace repo diff: keep simple without extra headers
    combinedDiff = sortedBlocks[0].text;
  } else if (sortedBlocks.length > 0) {
    combinedDiff = sortedBlocks
      .map((b) => `=== ${b.label} ===\n${b.text}`)
      .join("\n\n");
  }

  // If there are untracked files touched, mention them
  if (untrackedFiles.length > 0) {
    const untrackedText = `\n\n=== UNTRACKED NEW FILES ===\n${untrackedFiles.map((u) => `- ${u}`).join("\n")}`;
    combinedDiff = combinedDiff.length > 0 ? `${combinedDiff}${untrackedText}` : untrackedText.trim();
  }

  const boundedDiff = combinedDiff.length > maxChars
    ? `${combinedDiff.slice(0, maxChars)}\n... (changes truncated for context limit)`
    : combinedDiff;

  return {
    diff: boundedDiff,
    hasVcsDiff: boundedDiff.trim().length > 0,
    touchedNonGitFiles,
    untrackedFiles,
    repositories: Array.from(repoRoots),
  };
}
