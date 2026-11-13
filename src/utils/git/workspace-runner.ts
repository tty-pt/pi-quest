import { join } from "node:path";
import type { Pi } from "../../hooks/events";
import type { VerificationReceipt } from "../../domain/quest";
import { runGit, getGitHead } from "./exec";
import { commitMilestone } from "./milestones";
import { withWorkspaceLock } from "./workspace-lock";

export interface TestExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Checks whether the workspace has uncommitted changes (staged, unstaged, or untracked).
 */
export async function isWorkspaceDirty(repoRoot: string, pi?: Pi): Promise<boolean> {
  const res = await runGit(["status", "--porcelain"], repoRoot, pi);
  return res.exitCode === 0 && res.stdout.trim().length > 0;
}

/**
 * Resolves current branch name or detached commit hash.
 */
export async function getCurrentRef(
  repoRoot: string,
  pi?: Pi,
): Promise<{ branch?: string; commit: string }> {
  const branchRes = await runGit(["symbolic-ref", "--short", "HEAD"], repoRoot, pi);
  const headRes = await runGit(["rev-parse", "HEAD"], repoRoot, pi);
  const commit = headRes.stdout.trim();
  const branch = branchRes.exitCode === 0 && branchRes.stdout.trim() ? branchRes.stdout.trim() : undefined;
  return { branch, commit };
}

/**
 * Safely stashes uncommitted changes, including untracked files.
 */
export async function stashDirtyWorkspace(
  repoRoot: string,
  qid: string,
  pi?: Pi,
): Promise<{ ok: boolean; error?: string }> {
  const msg = `pi-quest:temp-test-stash-${qid}-${Date.now()}`;
  const res = await runGit(["stash", "push", "--include-untracked", "-m", msg], repoRoot, pi);
  if (res.exitCode !== 0) {
    return { ok: false, error: res.stdout || "git stash push failed" };
  }
  return { ok: true };
}

/**
 * Restores original branch and pops the stash with index.
 * Does NOT execute git clean or git reset --hard, preserving all human untracked files.
 */
export async function restoreWorkspaceState(
  repoRoot: string,
  originalRef: string,
  wasStashed: boolean,
  pi?: Pi,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await runGit(["checkout", originalRef], repoRoot, pi);
    await runGit(["submodule", "update", "--no-fetch"], repoRoot, pi);

    if (wasStashed) {
      const popRes = await runGit(["stash", "pop", "--index"], repoRoot, pi);
      if (popRes.exitCode !== 0) {
        return { ok: false, error: `git stash pop warning: ${popRes.stdout}` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function execTestShell(
  command: string,
  cwd: string,
  pi?: Pi,
): Promise<TestExecutionResult> {
  const start = Date.now();
  if (pi && typeof pi.exec === "function") {
    try {
      const res = (await pi.exec("bash", ["-c", command], { cwd })) as
        | { code?: number; exitCode?: number; stdout?: string; output?: string; stderr?: string }
        | undefined;
      const exitCode = res?.exitCode ?? res?.code ?? 1;
      const stdout = res?.stdout ?? res?.output ?? "";
      const stderr = res?.stderr ?? "";
      return { exitCode, stdout, stderr, durationMs: Date.now() - start };
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: String(err), durationMs: Date.now() - start };
    }
  }

  const { exec } = await import("node:child_process");
  return new Promise((resolve) => {
    exec(command, { cwd, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      const exitCode = err && typeof err.code === "number" ? err.code : err ? 1 : 0;
      resolve({ exitCode, stdout: stdout ?? "", stderr: stderr ?? "", durationMs: Date.now() - start });
    });
  });
}

/**
 * Executes a test command inside the primary repository root while safely
 * preserving human uncommitted work and holding an advisory workspace lock.
 */
export async function runTestInPrimaryWorkspace(params: {
  primaryRoot: string;
  command: string;
  qid: string;
  worktreePath?: string;
  worktreeBranch?: string;
  pi?: Pi;
}): Promise<VerificationReceipt> {
  const { primaryRoot, command, qid, worktreePath, worktreeBranch, pi } = params;

  return await withWorkspaceLock(primaryRoot, qid, async () => {
    // If not running in a worktree, execute directly in primary root
    if (!worktreePath || !worktreeBranch) {
      const res = await execTestShell(command, primaryRoot, pi);
      return {
        command,
        exitCode: res.exitCode,
        tailOutput: (res.stdout + (res.stderr ? `\n${res.stderr}` : "")).slice(-2000),
        executedAt: Date.now(),
      };
    }

    // In worktree: commit any dirty edits first
    await commitMilestone(worktreePath, { qid, type: "manual", label: "test checkpoint" }, pi);

    const featureHead = await getGitHead(worktreePath, pi);
    const targetRef = featureHead ?? worktreeBranch;

    const original = await getCurrentRef(primaryRoot, pi);
    const dirty = await isWorkspaceDirty(primaryRoot, pi);

    if (dirty) {
      const stashRes = await stashDirtyWorkspace(primaryRoot, qid, pi);
      if (!stashRes.ok) {
        throw new Error(`Failed to stash dirty primary workspace before testing: ${stashRes.error}`);
      }
    }

    try {
      const checkoutRes = await runGit(["checkout", "--detach", targetRef], primaryRoot, pi);
      if (checkoutRes.exitCode !== 0) {
        throw new Error(`Failed to checkout test target ${targetRef} in primary workspace: ${checkoutRes.stdout}`);
      }

      // Synchronize submodules to match the test commit with zero network calls
      await runGit(["submodule", "update", "--no-fetch"], primaryRoot, pi);

      const execRes = await execTestShell(command, primaryRoot, pi);
      const combined = execRes.stdout + (execRes.stderr ? `\n${execRes.stderr}` : "");

      return {
        command,
        exitCode: execRes.exitCode,
        tailOutput: combined.slice(-2000),
        executedAt: Date.now(),
      };
    } finally {
      await restoreWorkspaceState(primaryRoot, original.branch ?? original.commit, dirty, pi);
    }
  });
}
