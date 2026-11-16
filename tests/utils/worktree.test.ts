import { check } from "../check.ts";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GIT_WORKFLOW_CONFIG } from "../../src/config/defaults.ts";
import { runTestTool } from "../../src/surface/tools/run-test.ts";
import { replaceState } from "../../src/app/store.ts";
import { IDLE_STATE, createQuest } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { findGitCommonDir, findPrimaryRepoRoot, isGitWorktree, createWorktree, mergeWorktreeBranch, removeWorktree } from "../../src/utils/git.ts";
import { canonicalWorkspaceRoot, draftFilePath, archiveFilePath } from "../../src/files.ts";
import { listDraftQids, ensureDraftFile } from "../../src/files.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

Deno.test("worktree detection: recognizes main repo, secondary worktree, and non-git directory", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-wt-test-"));
  try {
    // 1. Non-git directory
    check(isGitWorktree(root) === false, "non-git is not worktree");
    check(findPrimaryRepoRoot(root) === root, "primary repo root of non-git is itself");
    check(findGitCommonDir(root) === undefined, "no git common dir in non-git");

    // 2. Standard main repo with .git directory
    const mainRepo = join(root, "main-repo");
    mkdirSync(join(mainRepo, ".git"), { recursive: true });
    check(isGitWorktree(mainRepo) === false, "main repo is not worktree");
    check(findPrimaryRepoRoot(mainRepo) === mainRepo, "primary repo root is main repo");
    check(findGitCommonDir(mainRepo) === join(mainRepo, ".git"), "git common dir is .git");

    // 3. Subdirectory inside main repo
    const subDir = join(mainRepo, "src/components");
    mkdirSync(subDir, { recursive: true });
    check(isGitWorktree(subDir) === false, "subdir is not worktree");
    check(findPrimaryRepoRoot(subDir) === mainRepo, "primary repo root from subdir is main repo");
    check(findGitCommonDir(subDir) === join(mainRepo, ".git"), "git common dir from subdir is .git");

    // 4. Secondary git worktree with gitfile pointing to main .git/worktrees/wt1
    const wtDir = join(root, "worktrees/wt1");
    mkdirSync(wtDir, { recursive: true });
    const mainGitWorktreesDir = join(mainRepo, ".git/worktrees/wt1");
    mkdirSync(mainGitWorktreesDir, { recursive: true });
    // Write commondir file pointing back to main .git
    writeFileSync(join(mainGitWorktreesDir, "commondir"), "../..\n");
    // Write .git file in wtDir
    writeFileSync(join(wtDir, ".git"), `gitdir: ${mainGitWorktreesDir}\n`);

    check(isGitWorktree(wtDir) === true, "secondary worktree recognized");
    check(findPrimaryRepoRoot(wtDir) === mainRepo, "primary repo root of worktree anchors to main repo");
    check(findGitCommonDir(wtDir) === join(mainRepo, ".git"), "git common dir of worktree points to main .git");

    // Subdirectory inside worktree
    const wtSubDir = join(wtDir, "lib/deep");
    mkdirSync(wtSubDir, { recursive: true });
    check(isGitWorktree(wtSubDir) === true, "subdir in worktree is recognized as worktree");
    check(findPrimaryRepoRoot(wtSubDir) === mainRepo, "primary repo root from wt subdir anchors to main repo");

    // 5. Nested scratch slot directory: .pi/scratch/slot-5/.pi/scratch/slot-5
    const nestedScratch = join(mainRepo, ".pi/scratch/slot-5/.pi/scratch/slot-5/sub/deep");
    mkdirSync(nestedScratch, { recursive: true });
    check(findPrimaryRepoRoot(nestedScratch) === mainRepo, "primary repo root strips nested .pi/scratch/");

    // 6. Submodule module gitdir: .git/modules/external/axil
    const subGitDir = join(mainRepo, ".git/modules/external/axil");
    mkdirSync(subGitDir, { recursive: true });
    check(findPrimaryRepoRoot(subGitDir) === mainRepo, "primary repo root strips .git/modules");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("worktree path anchoring: quest drafts and archives anchor to primary repo root", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-wt-paths-"));
  try {
    const mainRepo = join(root, "main");
    mkdirSync(join(mainRepo, ".git"), { recursive: true });

    const wtDir = join(root, "wt-child");
    mkdirSync(wtDir, { recursive: true });
    const mainGitWtDir = join(mainRepo, ".git/worktrees/wt-child");
    mkdirSync(mainGitWtDir, { recursive: true });
    writeFileSync(join(mainGitWtDir, "commondir"), "../..\n");
    writeFileSync(join(wtDir, ".git"), `gitdir: ${mainGitWtDir}\n`);

    check(canonicalWorkspaceRoot(wtDir) === mainRepo, "canonical root from worktree is mainRepo");
    check(draftFilePath(wtDir, "1xWT01" as Qid) === join(mainRepo, ".pi/quest/future/1xWT01.md"), "draftFilePath anchors to main");
    check(archiveFilePath(wtDir, "1xWT01" as Qid) === join(mainRepo, ".pi/quest/archive/1xWT01.zip"), "archiveFilePath anchors to main");

    // Writing draft from worktree context puts file in mainRepo/.pi/quest/future
    const ctx = fakeCtx(wtDir);
    await ensureDraftFile(ctx, "1xWT01", "wt-test", "Do worktree testing");

    check(existsSync(join(mainRepo, ".pi/quest/future/1xWT01.md")), "draft exists in main repo");
    check(!existsSync(join(wtDir, ".pi/quest/future/1xWT01.md")), "draft was not trapped in ephemeral worktree");

    const drafts = await listDraftQids(wtDir);
    check(drafts.includes("1xWT01"), "listDraftQids from worktree sees main repo drafts");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("worktree git operations: createWorktree, mergeWorktreeBranch, and removeWorktree", async () => {
  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    if (cmd === "git" && args[0] === "rev-parse") {
      return { code: 1, stdout: "" };
    }
    return { code: 0, stdout: "" };
  };

  const resCreate = await createWorktree("/repo", "/repo/.pi/worktrees/wt1", "quest/wt1", pi);
  check(resCreate.ok === true, "createWorktree succeeded");
  check(commands.some((c) => c.args.includes("worktree") && c.args.includes("add") && c.args.includes("-b")), "executed worktree add -b");

  const resMerge = await mergeWorktreeBranch("/repo", "quest/wt1", pi);
  check(resMerge.ok === true, "mergeWorktreeBranch succeeded");
  check(commands.some((c) => c.args.includes("merge") && c.args.includes("quest/wt1")), "executed git merge");

  const resRemove = await removeWorktree("/repo", "/repo/.pi/worktrees/wt1", "quest/wt1", pi);
  check(resRemove.ok === true, "removeWorktree succeeded");
  check(commands.some((c) => c.args.includes("worktree") && c.args.includes("remove")), "executed worktree remove");
  check(commands.some((c) => c.args.includes("branch") && c.args.includes("-D")), "executed branch delete");
});

Deno.test("worktree configuration defaults: testInPrimaryWorkspace defaults to false", () => {
  check(DEFAULT_GIT_WORKFLOW_CONFIG.testInPrimaryWorkspace === false, "default git workflow config disables primary workspace test hijacking");
});

Deno.test("quest_run_test: executes natively in worktreePath without touching primary repo when testInPrimaryWorkspace is false", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-runtest-native-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-runtest-wt-"));
  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      return { code: 0, stdout: "test passed\n" };
    };

    const draft = createDraft(createQuest("test task", "1xTEST"), "thing");
    replaceState({
      ...draft,
      qid: "1xTEST" as Qid,
      phase: "implementing",
      worktreePath: wt,
      worktreeBranch: "quest/1xTEST",
    });

    const tool = runTestTool(pi);
    const ctx = fakeCtx(root);
    const res = await tool.execute("call-1", { command: "deno test" }, undefined, undefined, ctx);

    check(typeof res.content[0]?.text === "string" && res.content[0].text.includes("PASS ✓"), "test tool reported pass");
    // Verified: test was executed inside worktree directory wt, not in primary repo root
    check(commands.some((c) => c.cwd === wt), "executed test command inside worktreePath");
    check(!commands.some((c) => c.args.includes("stash") && c.args.includes("push")), "did NOT execute git stash in primary workspace");
  } finally {
    replaceState(IDLE_STATE);
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("removeWorktree submodule pruning: executes git worktree prune in primary submodules", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-subprune-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-subprune-wt-"));
  try {
    const subPath = "external/libtest";
    const primarySub = join(root, subPath);
    mkdirSync(join(primarySub, ".git"), { recursive: true });

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
        return { code: 0, stdout: " 1a2b3c4d external/libtest\n" };
      }
      return { code: 0, stdout: "" };
    };

    const res = await removeWorktree(root, wt, undefined, pi);
    check(res.ok === true, "removeWorktree succeeded");
    check(
      commands.some((c) => c.cwd === primarySub && c.args[0] === "worktree" && c.args[1] === "prune"),
      "executed git worktree prune inside primary submodule store",
    );
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("removeWorktree resilient cleanup: prunes registry and deletes .git when remove --force fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-resilient-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-resilient-wt-"));
  try {
    const wtGit = join(wt, ".git");
    writeFileSync(wtGit, "gitdir: /repo/.git/worktrees/wt\n");

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "worktree" && args[1] === "remove") {
        return { code: 1, stdout: "fatal: directory not empty\n" }; // simulated failure due to locked files
      }
      return { code: 0, stdout: "" };
    };

    const res = await removeWorktree(root, wt, "quest/wt1", pi);
    check(res.ok === true, "removeWorktree returned ok despite locked files");
    check(!existsSync(wtGit), "deleted .git file so worktree is prunable");
    check(commands.some((c) => c.args.includes("worktree") && c.args.includes("prune")), "executed git worktree prune fallback");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
