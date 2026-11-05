// HIGH_LEVEL: #validation — multi-repository, submodule-aware, and non-git change detection.
import { existsSync, statSync } from "node:fs";
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
 * Executes a git command safely using pi.exec if available,
 * with fallback to node:child_process execFile.
 */
export async function runGit(
  args: string[],
  cwd: string,
  pi?: Pi,
): Promise<{ exitCode: number; stdout: string }> {
  if (pi && typeof pi.exec === "function") {
    try {
      const res = (await pi.exec("git", args, { cwd })) as
        | { code?: number; exitCode?: number; stdout?: string; output?: string }
        | undefined;
      const code = res?.exitCode ?? res?.code ?? 1;
      const stdout = res?.stdout ?? res?.output ?? "";
      return { exitCode: code, stdout };
    } catch {
      /* fallback */
    }
  }

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: stdout ?? "" };
  } catch (err: unknown) {
    const exitCode = typeof (err as { code?: number })?.code === "number"
      ? (err as { code: number }).code
      : 1;
    const stdout = typeof (err as { stdout?: string })?.stdout === "string"
      ? (err as { stdout: string }).stdout
      : "";
    return { exitCode, stdout };
  }
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
          if (!untrackedFiles.includes(fullUntracked)) {
            untrackedFiles.push(fullUntracked);
          }
        }
      }
    }

    // B. Check if baseCommit is valid in this specific repo
    let diffWithBase = false;
    if (options.baseCommit) {
      const verifyRes = await runGit(["rev-parse", "--verify", `${options.baseCommit}^{commit}`], repo, pi);
      if (verifyRes.exitCode === 0) {
        diffWithBase = true;
        const diffRes = await runGit(["diff", options.baseCommit], repo, pi);
        if (diffRes.exitCode === 0 && diffRes.stdout.trim().length > 0) {
          repoDiff = diffRes.stdout.trim();
        }
      }
    }

    // C. Fallback to uncommitted HEAD changes, then HEAD~1 if not diffed with base
    if (!diffWithBase) {
      const isExplicitlyTouched = touchedFiles.some((f) => {
        const fullPath = isAbsolute(f) ? f : resolve(ctx.cwd, f);
        return findRepoRoot(fullPath) === repo;
      });
      const refs = isExplicitlyTouched || repoRoots.size === 1
        ? ["HEAD", "HEAD~1"]
        : ["HEAD"];

      for (const ref of refs) {
        const diffRes = await runGit(["diff", ref], repo, pi);
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
