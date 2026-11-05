import { check } from "../check.ts";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findGitCommonDir, findPrimaryRepoRoot, isGitWorktree } from "../../src/utils/git.ts";
import { canonicalWorkspaceRoot, draftFilePath, archiveFilePath } from "../../src/files.ts";
import { listDraftQids, ensureDraftFile } from "../../src/files.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { fakeCtx } from "../fake-pi.ts";

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
