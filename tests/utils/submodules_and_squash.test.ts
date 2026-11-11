import { check } from "../check.ts";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  createWorktree,
  hasSubmodules,
  initWorktreeSubmodules,
  commitDirtySubmodules,
  commitMilestone,
  syncWorktreeSubmodulesToPrimary,
  captureUnifiedDiff,
  synthesizeSquashCommitMessage,
  squashMergeBranch,
  confirmAndSquashWorktree,
  squashSubmoduleCommits,
  rebaseSubmoduleBranch,
  restoreSubmoduleWorktrees,
  pruneSubmoduleWorktrees,
  EMPTY_TREE_SHA,
  guardSubmoduleWorkingTree,
} from "../../src/utils/git/index.ts";
import { archiveActiveQuest } from "../../src/surface/tools/archive/core.ts";
import { replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { implementationFingerprint } from "../../src/review/flow.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

Deno.test("submodule detection & creation: initializes submodules recursively in worktrees", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-submod-"));
  try {
    check(hasSubmodules(root) === false, "initially no submodules");
    writeFileSync(join(root, ".gitmodules"), "[submodule \"external/libtest\"]\n\tpath = external/libtest\n");
    check(hasSubmodules(root) === true, "detects .gitmodules");

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "rev-parse") return { code: 1, stdout: "" };
      return { code: 0, stdout: "" };
    };

    const res = await createWorktree(root, join(root, ".pi/worktrees/wt1"), "quest/wt1", pi, { initSubmodules: true });
    check(res.ok === true, "createWorktree succeeded with submodules");
    check(!commands.some((c) => c.args.includes("submodule") && c.args.includes("update")), "avoided mutating submodule update");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("dirty submodule commit: commits submodules first then updates parent gitlink", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-dirtysub-"));
  try {
    const subPath = join(root, "external/libtest");
    mkdirSync(join(subPath, ".git"), { recursive: true });

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "status" && opts?.cwd === root) {
        return { code: 0, stdout: " M external/libtest\n" };
      }
      if (cmd === "git" && args[0] === "diff" && args.includes("--cached")) {
        return { code: 1, stdout: "has changes" }; // 1 indicates staged changes exist
      }
      return { code: 0, stdout: "" };
    };

    const res = await commitDirtySubmodules(root, "test commit", pi);
    check(res.ok === true, "commitDirtySubmodules succeeded");
    check(res.committed.includes("external/libtest"), "committed external/libtest");

    // Verified: submodule staged & committed inside subPath
    check(commands.some((c) => c.cwd === subPath && c.args.includes("add")), "staged inside submodule");
    check(commands.some((c) => c.cwd === subPath && c.args.includes("commit")), "committed inside submodule");

    // Verified: submodule pointer staged in parent worktree
    check(commands.some((c) => c.cwd === root && c.args.includes("add") && c.args.includes("external/libtest")), "staged pointer in parent worktree");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("syncWorktreeSubmodulesToPrimary: fetches worktree submodule branch into primary submodule repo without network", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-syncsub-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-syncwt-"));
  try {
    const subPath = "external/libtest";
    const primarySub = join(root, subPath);
    const wtSub = join(wt, subPath);
    mkdirSync(join(primarySub, ".git"), { recursive: true });
    mkdirSync(join(wtSub, ".git"), { recursive: true });

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
        return { code: 0, stdout: " M external/libtest\n" };
      }
      if (cmd === "git" && args[0] === "rev-parse" && args.includes("refs/heads/quest/1xTEST")) {
        return { code: 0, stdout: "a1b2c3d\n" };
      }
      return { code: 0, stdout: "" };
    };

    const res = await syncWorktreeSubmodulesToPrimary(root, wt, "quest/1xTEST", pi);
    check(res.ok === true, "syncWorktreeSubmodulesToPrimary succeeded");
    check(res.synced.includes("external/libtest"), "synced external/libtest");

    // Verified: git fetch was called with protocol.file.allow=always inside primarySub targeting wtSub
    const relWtSub = relative(primarySub, wtSub);
    check(
      commands.some(
        (c) =>
          c.cwd === primarySub &&
          c.args.includes("fetch") &&
          (c.args.includes(wtSub) || c.args.includes(relWtSub)) &&
          c.args.includes("refs/heads/quest/1xTEST:refs/heads/quest/1xTEST"),
      ),
      "executed git fetch from wtSub into primarySub",
    );
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("Just-in-Time submodule branching: symbolic-ref when branch matches HEAD commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-jitmatch-"));
  try {
    const subPath = join(root, "external/libtest");
    mkdirSync(join(subPath, ".git"), { recursive: true });

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "status" && opts?.cwd === root) {
        return { code: 0, stdout: " M external/libtest\n" };
      }
      if (cmd === "git" && args[0] === "symbolic-ref" && args.includes("--short")) {
        return { code: 1, stdout: "" }; // Detached HEAD
      }
      if (cmd === "git" && args[0] === "rev-parse" && args.includes("refs/heads/quest/1xTEST")) {
        return { code: 0, stdout: "c0ffee\n" }; // Branch already exists
      }
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
        return { code: 0, stdout: "c0ffee\n" }; // Matches branch SHA
      }
      if (cmd === "git" && args[0] === "diff" && args.includes("--cached")) {
        return { code: 1, stdout: "has changes" };
      }
      return { code: 0, stdout: "" };
    };

    const res = await commitDirtySubmodules(root, "commit message", pi, "quest/1xTEST");
    check(res.ok === true, "commitDirtySubmodules succeeded");
    check(res.committed.includes("external/libtest"), "committed external/libtest");
    check(res.branched.includes("external/libtest"), "branched external/libtest");

    // Verified: used symbolic-ref to attach branch without checkout
    check(
      commands.some(
        (c) =>
          c.cwd === subPath &&
          c.args[0] === "symbolic-ref" &&
          c.args[1] === "HEAD" &&
          c.args[2] === "refs/heads/quest/1xTEST",
      ),
      "used symbolic-ref to attach branch without dirty checkout",
    );
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("milestone commits: formats conventional commit messages and records commit hashes", async () => {
  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    if (cmd === "git" && args[0] === "status") return { code: 0, stdout: "" };
    if (cmd === "git" && args[0] === "diff" && args.includes("--cached")) return { code: 1, stdout: "staged" };
    if (cmd === "git" && args[0] === "rev-parse" && args.includes("HEAD")) return { code: 0, stdout: "a1b2c3d4e5f6\n" };
    return { code: 0, stdout: "" };
  };

  const res = await commitMilestone("/worktree", {
    qid: "1xTEST",
    type: "requirement",
    reqId: "R1",
    label: "Implement zero-mean centering",
  }, pi);

  check(res.ok === true, "commitMilestone succeeded");
  check(Boolean(res.commitHash?.startsWith("a1b2c3d")), "returned commit hash");
  check(commands.some((c) => c.args.includes("commit") && c.args.some((a) => a.includes("feat(1xTEST): [R1] Implement zero-mean centering"))), "formatted feat message");
});

Deno.test("squash merge: synthesizes structured executive message and merges with confirmation", async () => {
  const msg = synthesizeSquashCommitMessage({
    qid: "1xTEST",
    objective: "Support worktrees and submodules",
    requirements: ["R1: Auto worktrees", "R2: Submodule recursive checkout"],
    milestones: ["a1b2c3d chore: start", "b2c3d4e feat: [R1] done"],
    verification: "Unit tests 100% pass",
  });

  check(msg.includes("feat: Support worktrees and submodules (quest 1xTEST)"), "has title");
  check(msg.includes("Delivered requirements:"), "has requirements section");
  check(msg.includes("- R1: Auto worktrees"), "lists R1");
  check(msg.includes("Feature branch milestones:"), "has milestones section");
  check(msg.includes("Verification:"), "has verification section");

  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    return { code: 0, stdout: "" };
  };

  const ctx = fakeCtx("/repo");
  // UI returns squash option
  ctx.hasUI = true;
  ctx.ui.select = async () => "Squash and merge into dev branch (recommended)";

  const res = await confirmAndSquashWorktree(pi, ctx, "/repo", "quest/1xTEST", "backup", msg, ["a1b2c3d"]);
  check(res.ok === true, "confirmAndSquashWorktree succeeded");
  check(res.mode === "squash", "squash mode chosen");
  check(commands.some((c) => c.args.includes("merge") && c.args.includes("--squash")), "executed git merge --squash");
});

Deno.test("squash merge failure: resets merge cleanly without stash roulette", async () => {
  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    // Simulate merge conflict on merge --squash
    if (cmd === "git" && args[0] === "merge" && args.includes("--squash")) {
      return { code: 1, stdout: "CONFLICT: Merge conflict in dirty.txt" };
    }
    return { code: 0, stdout: "" };
  };

  const { squashMergeBranch } = await import("../../src/utils/git/squash.ts");
  const res = await squashMergeBranch("/repo", "quest/1xTEST", "feat: test", pi);
  check(res.ok === false, "squash merge reported error");
  check(commands.some((c) => c.args.includes("reset") && c.args.includes("--merge")), "cleaned up with git reset --merge");
  check(!commands.some((c) => c.args.includes("stash")), "did not run risky git stash pop in primary repo");
});

Deno.test("3-stage integration: preflight detects dirty overlap and offers Keep / Rebase / Cancel", async () => {
  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    if (cmd === "git" && args[0] === "symbolic-ref") return { code: 0, stdout: "main\n" };
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: "aaa1111\n" };
    if (cmd === "git" && args[0] === "diff" && args.includes("--name-only")) return { code: 0, stdout: "src/app.ts\n" };
    if (cmd === "git" && args[0] === "status" && args.includes("--porcelain")) return { code: 0, stdout: " M src/app.ts\n" };
    return { code: 0, stdout: "" };
  };

  const ctx = fakeCtx("/repo");
  ctx.hasUI = true;
  ctx.ui.select = async () => "Have the agent rebase & resolve conflicts in the worktree";

  const resRebase = await confirmAndSquashWorktree(pi, ctx, "/repo", "quest/1xCONFLICT", "HEAD", "feat: msg", [], "/wt");
  check(resRebase.ok === false && resRebase.mode === "rebase", "returned rebase mode when user selected rebase");
  check(Boolean(resRebase.error && resRebase.error.includes("src/app.ts")), "reported overlapping dirty file");

  ctx.ui.select = async () => "Keep branch unmerged (quest/1xCONFLICT) & archive quest";
  const resKeep = await confirmAndSquashWorktree(pi, ctx, "/repo", "quest/1xCONFLICT", "HEAD", "feat: msg", [], "/wt");
  check(resKeep.ok === true && resKeep.mode === "keep", "returned keep mode when user selected keep on conflict");

  ctx.hasUI = false;
  const resNonUi = await confirmAndSquashWorktree(pi, ctx, "/repo", "quest/1xCONFLICT", "HEAD", "feat: msg", [], "/wt");
  check(resNonUi.ok === false && resNonUi.mode === "rebase", "non-UI fallback defaults to rebase instead of archiving unmerged");
});

Deno.test("squashSubmoduleCommits: resolves exact <baseCommit>:<subPath> gitlink SHA first", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-exactsub-"));
  const subPath = "external/libtest";
  const wtSub = join(root, subPath);
  mkdirSync(join(wtSub, ".git"), { recursive: true });

  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
      return { code: 0, stdout: " 1a2b3c4d external/libtest (heads/quest/1xEXACT)\n" };
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "parentBaseSha:external/libtest") {
      return { code: 0, stdout: "exactSubSha777\n" };
    }
    if (cmd === "git" && args[0] === "cat-file" && args[1] === "-e" && args[2] === "exactSubSha777^{commit}") {
      return { code: 0, stdout: "" };
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
      return { code: 0, stdout: "head999\n" };
    }
    if (cmd === "git" && args[0] === "rev-list" && args[1] === "--count") {
      return { code: 0, stdout: "3\n" };
    }
    return { code: 0, stdout: "" };
  };

  try {
    const res = await squashSubmoduleCommits(root, "quest/1xEXACT", "feat: exact base", pi, "parentBaseSha");
    check(res.ok === true, "squashSubmoduleCommits succeeded");
    check(
      commands.some((c) => c.cwd === wtSub && c.args.includes("reset") && c.args.includes("--soft") && c.args.includes("exactSubSha777")),
      "soft-reset submodule to exact parentBaseSha:external/libtest gitlink SHA without guessing main",
    );
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("archive pre-teardown submodule sync: records archive findings when submodules are preserved", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-archsub-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-archwt-"));
  try {
    const subPath = "external/libtest";
    const primarySub = join(root, subPath);
    const wtSub = join(wt, subPath);
    mkdirSync(join(primarySub, ".git"), { recursive: true });
    mkdirSync(join(wtSub, ".git"), { recursive: true });

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
        return { code: 0, stdout: " M external/libtest\n" };
      }
      if (cmd === "git" && args[0] === "rev-parse" && args.includes("refs/heads/quest/1xTEST")) {
        return { code: 0, stdout: "a1b2c3d\n" };
      }
      return { code: 0, stdout: "" };
    };

    const draft = createDraft(createQuest("test objective", "1xTEST"), "thing");
    const stateCandidate = {
      ...draft,
      draft: { ...draft.draft!, planAuthored: true },
      qid: "1xTEST" as Qid,
      phase: "validating" as const,
      worktreePath: wt,
      worktreeBranch: "quest/1xTEST",
    };
    const target = implementationFingerprint(stateCandidate);
    const state = {
      ...stateCandidate,
      lastReview: { verdict: "PASS" as const, target, findings: "ok" },
    };
    replaceState(state);

    const ctx = fakeCtx(root);
    const res = await archiveActiveQuest(pi, ctx, "COMPLETED", "task finished");

    check(
      res.findings.some((f: string) => f.includes("Submodule feature branch quest/1xTEST preserved for upstream PRs in: external/libtest")),
      "recorded submodule preservation finding in archive metadata",
    );
  } finally {
    replaceState(IDLE_STATE);
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("archive abandoned with integrate action: commits dirty worktree edits and squash-merges", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-absub-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-abwt-"));
  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "diff" && args.includes("--cached")) {
        return { code: 1, stdout: "" }; // simulate dirty staged changes
      }
      if (cmd === "git" && args[0] === "log" && args.some((a) => a.includes("HEAD..quest/1xABANDON"))) {
        return { code: 0, stdout: "a1b2c3d commit 1\n" };
      }
      return { code: 0, stdout: "" };
    };

    const draft = createDraft(createQuest("abandoned objective", "1xABANDON"), "thing");
    const state = {
      ...draft,
      qid: "1xABANDON" as Qid,
      phase: "implementing" as const,
      worktreePath: wt,
      worktreeBranch: "quest/1xABANDON",
    };
    replaceState(state);

    const ctx = fakeCtx(root);
    const res = await archiveActiveQuest(pi, ctx, "ABANDONED", "killed", { confirmDiscard: true, action: "integrate" });
    check(res.archivedQid === "1xABANDON", "archived abandoned");
    check(commands.some((c) => c.args.includes("commit") && c.args.some((a) => a.includes("pre-archive checkpoint"))), "committed pre-archive checkpoint");
    check(commands.some((c) => c.args.includes("merge") && c.args.includes("--squash")), "executed squash merge into current branch");
  } finally {
    replaceState(IDLE_STATE);
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("native submodule worktree init: checks out submodules via native worktrees linked to primary modules", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-nativesub-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-nativewt-"));
  try {
    const subPath = "external/libtest";
    const primarySub = join(root, subPath);
    mkdirSync(join(primarySub, ".git"), { recursive: true });

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
        return { code: 0, stdout: " 1a2b3c4d external/libtest (heads/main)\n" };
      }
      return { code: 0, stdout: "" };
    };

    const res = await initWorktreeSubmodules(root, wt, pi);
    check(res.ok === true, "initWorktreeSubmodules succeeded");

    // Verified: git worktree add --detach was invoked inside primarySub targeting wt/sub
    const relWtSub = relative(primarySub, join(wt, subPath));
    check(
      commands.some(
        (c) =>
          c.cwd === primarySub &&
          c.args.includes("worktree") &&
          c.args.includes("add") &&
          c.args.includes("--detach") &&
          (c.args.includes(join(wt, subPath)) || c.args.includes(relWtSub)),
      ),
      "executed native git worktree add --detach inside primary submodule",
    );
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("captureUnifiedDiff worktree awareness: inspects modified submodules inside worktreePath", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-diffwt-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-diffwt-wt-"));
  try {
    const subPath = "external/libtest";
    const primarySub = join(root, subPath);
    const wtSub = join(wt, subPath);
    mkdirSync(join(primarySub, ".git"), { recursive: true });
    mkdirSync(join(wtSub, ".git"), { recursive: true });

    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      if (cmd === "git" && args[0] === "status" && opts?.cwd === wt) {
        return { code: 0, stdout: " M external/libtest\n" };
      }
      if (cmd === "git" && args[0] === "diff" && opts?.cwd === wtSub) {
        return { code: 0, stdout: "diff --git a/foo.c b/foo.c\n+new worktree edit\n" };
      }
      return { code: 0, stdout: "" };
    };

    const ctx = fakeCtx(root);
    const unified = await captureUnifiedDiff(ctx, { pi, worktreePath: wt });
    check(unified.hasVcsDiff === true, "hasVcsDiff is true");
    check(unified.diff.includes("SUBMODULE: external/libtest"), "diff includes worktree submodule section");
    check(unified.diff.includes("+new worktree edit"), "diff includes worktree submodule changes");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("squashSubmoduleCommits: collapses multi-commit feature branch into single commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-sqsub-"));
  const subPath = "external/libtest";
  const wtSub = join(root, subPath);
  mkdirSync(join(wtSub, ".git"), { recursive: true });

  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
      return { code: 0, stdout: " 1a2b3c4d external/libtest (heads/quest/1xQ)\n" };
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
      return { code: 0, stdout: "commit123\n" };
    }
    if (cmd === "git" && args[0] === "merge-base") {
      return { code: 0, stdout: "base000\n" };
    }
    if (cmd === "git" && args[0] === "rev-list" && args[1] === "--count") {
      return { code: 0, stdout: "4\n" }; // 4 commits ahead of base
    }
    return { code: 0, stdout: "" };
  };

  try {
    const res = await squashSubmoduleCommits(root, "quest/1xQ", "feat(libtest): release v1.0", pi);
    check(res.ok === true, "squashSubmoduleCommits succeeded");
    check(res.squashed.includes("external/libtest"), "squashed external/libtest");

    // Verified: checkout branch, soft-reset base, commit squashed, git add in parent
    check(commands.some((c) => c.cwd === wtSub && c.args.includes("checkout") && c.args.includes("quest/1xQ")), "checked out feature branch");
    check(commands.some((c) => c.cwd === wtSub && c.args.includes("reset") && c.args.includes("--soft") && c.args.includes("base000")), "soft-reset to merge-base");
    check(commands.some((c) => c.cwd === wtSub && c.args.includes("commit") && c.args.includes("feat(libtest): release v1.0")), "committed with squash message");
    check(commands.some((c) => c.cwd === root && c.args.includes("add") && c.args.includes("external/libtest")), "staged squashed gitlink in parent");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("rebaseSubmoduleBranch: cleanly rebases diverging submodule onto target commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-rebsub-"));
  const subPath = "external/libtest";
  const wtSub = join(root, subPath);
  mkdirSync(join(wtSub, ".git"), { recursive: true });

  const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
    if (cmd === "git" && args[0] === "merge-base" && args[1] === "--is-ancestor") {
      return { code: 1, stdout: "" }; // neither is ancestor, diverged!
    }
    if (cmd === "git" && args[0] === "rebase") {
      return { code: 0, stdout: "Successfully rebased\n" };
    }
    return { code: 0, stdout: "" };
  };

  try {
    const res = await rebaseSubmoduleBranch(root, subPath, "targetSha123", pi);
    check(res.ok === true, "rebaseSubmoduleBranch succeeded");
    check(res.rebased === true, "rebased was true");

    // Verified: git rebase targetSha123 was run in submodule and pointer staged in parent
    check(commands.some((c) => c.cwd === wtSub && c.args.includes("rebase") && c.args.includes("targetSha123")), "executed git rebase targetSha123");
    check(commands.some((c) => c.cwd === root && c.args.includes("add") && c.args.includes("external/libtest")), "staged rebased pointer in parent");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("restoreSubmoduleWorktrees: repairs submodule core.worktree pointing to scratch slots", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-restoresub-"));
  try {
    const subPath = "external/libtest";
    const subDir = join(root, subPath);
    const gitDir = join(root, ".git", "modules", subPath);
    mkdirSync(subDir, { recursive: true });
    mkdirSync(gitDir, { recursive: true });

    // .gitmodules entry
    writeFileSync(join(root, ".gitmodules"), `[submodule "${subPath}"]\n\tpath = ${subPath}\n\turl = ../libtest.git\n`);

    // submodule .git file pointing to gitDir
    writeFileSync(join(subDir, ".git"), `gitdir: ../../.git/modules/${subPath}\n`);

    // submodule config pointing erroneously to slot-4
    const badWorktree = "../../../../../../.pi/scratch/slot-4/external/libtest";
    writeFileSync(join(gitDir, "config"), `[core]\n\trepositoryformatversion = 0\n\tworktree = ${badWorktree}\n`);

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "config" && args[3] === "core.worktree") {
        // Return bad worktree when querying
        return { code: 0, stdout: badWorktree + "\n" };
      }
      return { code: 0, stdout: "" };
    };

    await restoreSubmoduleWorktrees(root, pi);

    // Verify git config --file <cfgFile> core.worktree was invoked to overwrite badWorktree
    const configFix = commands.find(
      (c) => c.cmd === "git" && c.args[0] === "config" && c.args[1] === "--file" && c.args[3] === "core.worktree" && c.args.length === 5,
    );
    check(Boolean(configFix), "git config --file ... core.worktree <expected> was called");
    check(configFix?.args[4] === `../../../../${subPath}`, "expected relative worktree was restored");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("guardSubmoduleWorkingTree: rejects unpopulated submodule directory when HEAD has tracked files", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-guard-empty-"));
  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "ls-tree" && args.includes("HEAD")) {
        return { code: 0, stdout: "src/main.c\nMakefile\n" };
      }
      return { code: 0, stdout: "" };
    };

    const res = await guardSubmoduleWorkingTree(root, pi);
    check(res.ok === false, "rejected unpopulated working tree");
    check(Boolean(res.error && res.error.includes("unpopulated submodule working tree")), "error mentions unpopulated submodule");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("guardSubmoduleWorkingTree: rejects empty tree SHA and unstages accidental deletions", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-guard-tree-"));
  try {
    writeFileSync(join(root, "dummy.txt"), "hello");
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "write-tree") {
        return { code: 0, stdout: `${EMPTY_TREE_SHA}\n` };
      }
      return { code: 0, stdout: "" };
    };

    const res = await guardSubmoduleWorkingTree(root, pi);
    check(res.ok === false, "rejected empty tree SHA");
    check(Boolean(res.error && res.error.includes(EMPTY_TREE_SHA)), "error mentions empty tree SHA");
    check(commands.some((c) => c.cmd === "git" && c.args[0] === "reset" && c.args[1] === "HEAD"), "reset HEAD was called to unstage");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pruneSubmoduleWorktrees: runs --expire=now and purges dead worktree registrations", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-prunewt-"));
  try {
    const deadDir = join(root, ".git", "modules", "external", "axil", "worktrees", "slot-dead");
    const liveDir = join(root, ".git", "modules", "external", "axil", "worktrees", "slot-live");
    mkdirSync(deadDir, { recursive: true });
    mkdirSync(liveDir, { recursive: true });

    const liveTarget = join(root, "live-target", ".git");
    mkdirSync(liveTarget, { recursive: true });

    writeFileSync(join(deadDir, "gitdir"), "/non/existent/path/.git\n");
    writeFileSync(join(liveDir, "gitdir"), `${liveTarget}\n`);

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      return { code: 0, stdout: "" };
    };

    await pruneSubmoduleWorktrees(root, pi);

    check(commands.some((c) => c.cmd === "git" && c.args.includes("prune") && c.args.includes("--expire=now")), "called worktree prune with --expire=now");
    const { existsSync } = await import("node:fs");
    check(!existsSync(deadDir), "dead worktree registration removed");
    check(existsSync(liveDir), "live worktree registration preserved");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("initWorktreeSubmodules: attaches .pi/extensions and avoids remote submodule update", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-extsub-"));
  const wt = mkdtempSync(join(tmpdir(), "pi-quest-extwt-"));
  try {
    const extSub = ".pi/extensions/pi-quest";
    const primarySub = join(root, extSub);
    mkdirSync(join(primarySub, ".git"), { recursive: true });

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
        return { code: 0, stdout: ` 1234567 ${extSub}\n` };
      }
      return { code: 0, stdout: "" };
    };

    const res = await initWorktreeSubmodules(root, wt, pi);
    check(res.ok === true, "initWorktreeSubmodules succeeded");

    // Verify .pi/extensions was NOT skipped and worktree add was invoked
    const wtAdd = commands.find(
      (c) => c.cmd === "git" && c.args.includes("worktree") && c.args.includes("add") && c.cwd === primarySub,
    );
    check(Boolean(wtAdd), "worktree add was invoked for .pi/extensions/pi-quest");

    // Verify NO git submodule update was invoked
    const subUpdate = commands.find(
      (c) => c.cmd === "git" && c.args.includes("submodule") && c.args.includes("update"),
    );
    check(!subUpdate, "no git submodule update was invoked");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("commitDirtySubmodules: aborts commit and resets index if staged files produce empty tree", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-subempty-"));
  try {
    const subPath = "external/libempty";
    const subDir = join(root, subPath);
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, ".git"), "gitdir: ../../.git\n");

    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi();
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "status" && args.includes("--porcelain")) {
        return { code: 0, stdout: ` M ${subPath}\n` };
      }
      if (cmd === "git" && args[0] === "write-tree") {
        return { code: 0, stdout: `${EMPTY_TREE_SHA}\n` };
      }
      return { code: 0, stdout: "" };
    };

    const res = await commitDirtySubmodules(root, "test commit", pi);
    check(res.ok === false, "aborted empty-tree commit");
    check(Boolean(res.error && res.error.includes(EMPTY_TREE_SHA)), "error message specifies empty tree SHA");

    // Verified: git add -A ran, then guard ran git reset HEAD, and git commit was NOT called
    const addIdx = commands.findIndex((c) => c.cmd === "git" && c.args.includes("add") && c.args.includes("-A"));
    const resetIdx = commands.findIndex((c) => c.cmd === "git" && c.args[0] === "reset" && c.args[1] === "HEAD");
    const commitIdx = commands.findIndex((c) => c.cmd === "git" && c.args[0] === "commit");

    check(addIdx !== -1, "git add -A was run before write-tree check");
    check(resetIdx !== -1, "git reset HEAD was run after empty tree detected");
    check(addIdx < resetIdx, "add -A preceded reset HEAD");
    check(commitIdx === -1, "git commit was NOT executed");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});


