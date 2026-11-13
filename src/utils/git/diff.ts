import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Pi, PiCtx } from "../../hooks/events";
import { findRepoRoot } from "./root";
import { getModifiedSubmodules, runGit } from "./exec";

export const MAX_DIFF_CHARS = 30000;

export interface UnifiedChangesResult {
  diff: string;
  hasVcsDiff: boolean;
  touchedNonGitFiles: string[];
  untrackedFiles: string[];
  repositories: string[];
}

export interface DiffOptions {
  pi?: Pi;
  touchedFiles?: string[];
  baseCommit?: string;
  maxChars?: number;
  worktreePath?: string;
}

interface RepoClassification {
  primaryRoot: string | undefined;
  repoRoots: Set<string>;
  touchedNonGitFiles: string[];
}

async function classifyRepos(
  ctx: PiCtx,
  touchedFiles: string[],
  pi?: Pi,
  worktreePath?: string,
): Promise<RepoClassification> {
  const repoRoots = new Set<string>();
  const touchedNonGitFiles: string[] = [];
  const primaryRoot = findRepoRoot(ctx.cwd);
  if (primaryRoot) repoRoots.add(primaryRoot);
  if (worktreePath && existsSync(worktreePath)) {
    const wtRoot = findRepoRoot(worktreePath);
    if (wtRoot) repoRoots.add(wtRoot);
  }

  for (const file of touchedFiles) {
    const fullPath = isAbsolute(file) ? file : resolve(ctx.cwd, file);
    const repo = findRepoRoot(fullPath);
    if (repo) {
      repoRoots.add(repo);
    } else if (!touchedNonGitFiles.includes(fullPath)) {
      touchedNonGitFiles.push(fullPath);
    }
  }

  const scanRoots = [primaryRoot, worktreePath].filter((r): r is string => typeof r === "string" && existsSync(r));
  for (const r of scanRoots) {
    const submodules = await getModifiedSubmodules(r, pi);
    for (const sm of submodules) repoRoots.add(sm);
  }

  return { primaryRoot, repoRoots, touchedNonGitFiles };
}

async function collectUntrackedFiles(
  repo: string,
  touchedFiles: string[],
  cwd: string,
  pi?: Pi,
): Promise<string[]> {
  const untracked: string[] = [];
  const statusRes = await runGit(["status", "--porcelain"], repo, pi);
  if (statusRes.exitCode !== 0 || !statusRes.stdout) return untracked;

  for (const rawLine of statusRes.stdout.split("\n")) {
    if (!rawLine.startsWith("?? ")) continue;
    const relUntracked = rawLine.slice(3).trim();
    const fullUntracked = join(repo, relUntracked);
    if (touchedFiles.length > 0 && !touchedFiles.some((tf) => {
      const fullTf = isAbsolute(tf) ? tf : resolve(cwd, tf);
      return fullTf === fullUntracked;
    })) {
      continue;
    }
    untracked.push(fullUntracked);
  }
  return untracked;
}

function getRepoRelativePaths(repo: string, touchedFiles: string[], cwd: string): string[] {
  const repoTouchedRelPaths: string[] = [];
  for (const f of touchedFiles) {
    const fullPath = isAbsolute(f) ? f : resolve(cwd, f);
    if (fullPath === repo || fullPath.startsWith(repo + "/")) {
      const rel = fullPath === repo ? "." : fullPath.slice(repo.length + 1);
      if (rel && !rel.startsWith(".pi/quest/")) {
        repoTouchedRelPaths.push(rel);
      }
    }
  }
  return repoTouchedRelPaths;
}

async function getRepoDiff(
  repo: string,
  repoTouchedRelPaths: string[],
  baseCommit?: string,
  repoCount = 1,
  pi?: Pi,
): Promise<string> {
  const pathArgs = repoTouchedRelPaths.length > 0 ? ["--", ...repoTouchedRelPaths] : [];
  if (baseCommit) {
    const verifyRes = await runGit(["rev-parse", "--verify", `${baseCommit}^{commit}`], repo, pi);
    if (verifyRes.exitCode === 0) {
      const diffRes = await runGit(["diff", baseCommit, ...pathArgs], repo, pi);
      if (diffRes.exitCode === 0 && diffRes.stdout.trim().length > 0) {
        return diffRes.stdout.trim();
      }
      return "";
    }
  }

  const isExplicitlyTouched = repoTouchedRelPaths.length > 0;
  const refs = isExplicitlyTouched || repoCount === 1 ? ["HEAD", "HEAD~1"] : ["HEAD"];
  for (const ref of refs) {
    const diffRes = await runGit(["diff", ref, ...pathArgs], repo, pi);
    if (diffRes.exitCode === 0 && diffRes.stdout.trim().length > 0) {
      return diffRes.stdout.trim();
    }
  }
  return "";
}

function formatRepoLabel(repo: string, primaryRoot?: string, worktreePath?: string): string {
  if (primaryRoot && repo.startsWith(primaryRoot) && repo !== primaryRoot) {
    return `SUBMODULE: ${repo.slice(primaryRoot.length).replace(/^[/\\]+/, "")}`;
  }
  if (worktreePath && repo.startsWith(worktreePath) && repo !== worktreePath) {
    return `SUBMODULE: ${repo.slice(worktreePath.length).replace(/^[/\\]+/, "")}`;
  }
  if (repo === primaryRoot) return `WORKSPACE: ${repo}`;
  if (worktreePath && repo === worktreePath) return `WORKTREE: ${repo}`;
  return `EXTERNAL REPOSITORY: ${repo}`;
}

function synthesizeDiff(
  diffBlocks: Array<{ label: string; text: string }>,
  untrackedFiles: string[],
  maxChars: number,
): string {
  const sorted = [...diffBlocks].sort((a, b) => {
    const aExt = a.label.startsWith("EXTERNAL REPOSITORY:");
    const bExt = b.label.startsWith("EXTERNAL REPOSITORY:");
    if (aExt && !bExt) return -1;
    if (!aExt && bExt) return 1;
    return 0;
  });

  let combined = "";
  if (sorted.length === 1 && sorted[0].label.startsWith("WORKSPACE:")) {
    combined = sorted[0].text;
  } else if (sorted.length > 0) {
    combined = sorted.map((b) => `=== ${b.label} ===\n${b.text}`).join("\n\n");
  }

  if (untrackedFiles.length > 0) {
    const untrackedText = `\n\n=== UNTRACKED NEW FILES ===\n${untrackedFiles.map((u) => `- ${u}`).join("\n")}`;
    combined = combined.length > 0 ? `${combined}${untrackedText}` : untrackedText.trim();
  }

  if (combined.length > maxChars) {
    return `${combined.slice(0, maxChars)}\n... (changes truncated for context limit)`;
  }
  return combined;
}

/**
 * Captures a unified diff across primary repo, submodules, and external repos.
 * If no VCS diff is available, returns touched non-git files.
 */
export async function captureUnifiedDiff(
  ctx: PiCtx,
  options: DiffOptions = {},
): Promise<UnifiedChangesResult> {
  const maxChars = options.maxChars ?? MAX_DIFF_CHARS;
  const touchedFiles = options.touchedFiles ?? [];
  const pi = options.pi;

  const { primaryRoot, repoRoots, touchedNonGitFiles } = await classifyRepos(
    ctx,
    touchedFiles,
    pi,
    options.worktreePath,
  );
  const untrackedFiles: string[] = [];
  const diffBlocks: Array<{ label: string; text: string }> = [];

  for (const repo of repoRoots) {
    const newUntracked = await collectUntrackedFiles(repo, touchedFiles, ctx.cwd, pi);
    for (const u of newUntracked) {
      if (!untrackedFiles.includes(u)) untrackedFiles.push(u);
    }

    const relPaths = getRepoRelativePaths(repo, touchedFiles, ctx.cwd);
    const repoDiff = await getRepoDiff(repo, relPaths, options.baseCommit, repoRoots.size, pi);
    if (repoDiff.length > 0) {
      diffBlocks.push({ label: formatRepoLabel(repo, primaryRoot, options.worktreePath), text: repoDiff });
    }
  }

  const boundedDiff = synthesizeDiff(diffBlocks, untrackedFiles, maxChars);
  return {
    diff: boundedDiff,
    hasVcsDiff: boundedDiff.trim().length > 0,
    touchedNonGitFiles,
    untrackedFiles,
    repositories: Array.from(repoRoots),
  };
}
