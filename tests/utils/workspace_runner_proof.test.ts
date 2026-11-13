import { check } from "../check.ts";
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  acquireWorkspaceLock,
  releaseWorkspaceLock,
  withWorkspaceLock,
  isWorkspaceDirty,
  runTestInPrimaryWorkspace,
  runGit,
} from "../../src/utils/git/index.ts";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

Deno.test("proof 1: workspace lock mutual exclusion and stale PID reclamation", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-lock-"));
  mkdirSync(join(root, ".pi"), { recursive: true });

  try {
    // 1. Clean acquisition
    const acq1 = await acquireWorkspaceLock(root, "1xTEST1", { timeoutMs: 1000 });
    check(acq1.ok === true, "acquired lock 1");
    check(existsSync(join(root, ".pi/workspace-test.lock")), "lockfile created on disk");

    // 2. Mutual exclusion: concurrent attempt with short timeout fails
    const acq2 = await acquireWorkspaceLock(root, "1xTEST2", { timeoutMs: 300 });
    check(acq2.ok === false, "second acquisition timed out while lock held");

    // 3. Clean release
    const rel = await releaseWorkspaceLock(root, "1xTEST1");
    check(rel.ok === true, "released lock 1");
    check(!existsSync(join(root, ".pi/workspace-test.lock")), "lockfile removed on release");

    // 4. Stale lock reclamation (dead PID)
    writeFileSync(
      join(root, ".pi/workspace-test.lock"),
      JSON.stringify({ pid: 999999999, qid: "1xDEAD", acquiredAt: Date.now() - 5000, expiresAt: Date.now() + 60000 }),
    );
    const acqStale = await acquireWorkspaceLock(root, "1xTEST3", { timeoutMs: 500 });
    check(acqStale.ok === true, "stale lock reclaimed automatically");
    await releaseWorkspaceLock(root, "1xTEST3");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("proof 2: bit-for-bit SHA-256 dirty workspace preservation across worktree test", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-runner-proof-"));
  const wtDir = mkdtempSync(join(tmpdir(), "pi-quest-wt-proof-"));

  try {
    // Initialize primary git repository
    await runGit(["init", "-b", "main"], root);
    await runGit(["config", "user.name", "Test Runner"], root);
    await runGit(["config", "user.email", "test@test.local"], root);

    // Initial commit on main branch
    writeFileSync(join(root, "tracked.txt"), "base tracked content\n");
    writeFileSync(join(root, "modified.txt"), "base modified content\n");
    await runGit(["add", "."], root);
    await runGit(["commit", "-m", "Initial commit"], root);

    // Create a feature branch and commit feature code
    await runGit(["checkout", "-b", "quest/feature1"], root);
    writeFileSync(join(root, "feature_code.txt"), "function featureAlpha() { return 42; }\n");
    writeFileSync(join(root, "modified.txt"), "feature version of modified content\n");
    await runGit(["add", "."], root);
    await runGit(["commit", "-m", "Feature commit"], root);

    // Switch back to main branch
    await runGit(["checkout", "main"], root);

    // Create the worktree on quest/feature1
    await runGit(["worktree", "add", wtDir, "quest/feature1"], root);

    // Now introduce IN-FLIGHT HUMAN WORK in primary workspace:
    // 1. Unstaged modification
    const humanUnstaged = "HUMAN_UNSTAGED_EDIT_" + Date.now();
    writeFileSync(join(root, "modified.txt"), humanUnstaged);
    const unstagedHash = sha256(humanUnstaged);

    // 2. Staged modification
    const humanStaged = "HUMAN_STAGED_EDIT_" + Date.now();
    writeFileSync(join(root, "tracked.txt"), humanStaged);
    await runGit(["add", "tracked.txt"], root);
    const stagedHash = sha256(humanStaged);

    // 3. Untracked file
    const humanUntracked = "HUMAN_UNTRACKED_SCRATCH_" + Date.now();
    writeFileSync(join(root, "scratchpad.txt"), humanUntracked);
    const untrackedHash = sha256(humanUntracked);

    check(await isWorkspaceDirty(root) === true, "primary workspace is dirty before test");

    // Execute test in primary workspace
    // The test asserts that while running, feature_code.txt exists (meaning feature branch is active)
    const testCmd = "test -f feature_code.txt && grep -q 'featureAlpha' feature_code.txt";
    const receipt = await runTestInPrimaryWorkspace({
      primaryRoot: root,
      command: testCmd,
      qid: "1xPROOF",
      worktreePath: wtDir,
      worktreeBranch: "quest/feature1",
    });

    check(receipt.exitCode === 0, `Test passed in primary workspace: ${receipt.tailOutput}`);

    // Verify 100% bit-for-bit restoration:
    const postModified = readFileSync(join(root, "modified.txt"), "utf8");
    const postTracked = readFileSync(join(root, "tracked.txt"), "utf8");
    const postUntracked = readFileSync(join(root, "scratchpad.txt"), "utf8");

    check(sha256(postModified) === unstagedHash, "modified.txt restored with exact SHA-256 match");
    check(sha256(postTracked) === stagedHash, "tracked.txt restored with exact SHA-256 match");
    check(sha256(postUntracked) === untrackedHash, "scratchpad.txt restored with exact SHA-256 match");

    // Verify git status index preserved (tracked.txt is staged, modified.txt is unstaged)
    const statusRes = await runGit(["status", "--porcelain"], root);
    check(statusRes.stdout.includes("M  tracked.txt"), "staged index state preserved");
    check(statusRes.stdout.includes(" M modified.txt"), "unstaged worktree state preserved");
    check(statusRes.stdout.includes("?? scratchpad.txt"), "untracked file preserved");

    // Verify lock released
    check(!existsSync(join(root, ".pi/workspace-test.lock")), "workspace lock released after test");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wtDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("proof 3: crash and error resilience preserves workspace and releases lock", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-fail-proof-"));
  try {
    await runGit(["init", "-b", "main"], root);
    await runGit(["config", "user.name", "Test Runner"], root);
    await runGit(["config", "user.email", "test@test.local"], root);

    writeFileSync(join(root, "file.txt"), "initial\n");
    await runGit(["add", "."], root);
    await runGit(["commit", "-m", "init"], root);

    // Human dirty edit
    writeFileSync(join(root, "file.txt"), "HUMAN_DIRTY_CONTENT\n");
    const dirtyHash = sha256("HUMAN_DIRTY_CONTENT\n");

    // Failing command
    const receipt = await runTestInPrimaryWorkspace({
      primaryRoot: root,
      command: "exit 42",
      qid: "1xFAIL",
    });

    check(receipt.exitCode === 42, "correctly captured exit code 42");

    // Human content preserved
    const restored = readFileSync(join(root, "file.txt"), "utf8");
    check(sha256(restored) === dirtyHash, "content preserved after failing test command");
    check(!existsSync(join(root, ".pi/workspace-test.lock")), "lock released after failing test");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
