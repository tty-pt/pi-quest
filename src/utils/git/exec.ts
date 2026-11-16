import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Pi } from "../../hooks/events";
import { findRepoRoot } from "./root";

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function execGitFallback(
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string }> {
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
    const stdout = typeof (err as { stdout?: string })?.stdout === "string" && (err as { stdout: string }).stdout
      ? (err as { stdout: string }).stdout
      : (typeof (err as { stderr?: string })?.stderr === "string" && (err as { stderr: string }).stderr
        ? (err as { stderr: string }).stderr
        : (typeof (err as { message?: string })?.message === "string" ? (err as { message: string }).message : ""));
    return { exitCode, stdout };
  }
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
        const stdout = (res?.stdout && res.stdout.trim().length > 0)
          ? res.stdout
          : (res?.stderr ?? res?.output ?? "");
        result = { exitCode: code, stdout };
      } catch (err: unknown) {
        result = { exitCode: 1, stdout: String(err) };
      }
    } else {
      result = await execGitFallback(args, cwd);
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
  const root = findRepoRoot(cwd) ?? cwd;
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
