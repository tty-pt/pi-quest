import { check } from "../check.ts";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  readSlotLease,
  writeSlotLease,
  initializeSlot,
  sanitizeSlot,
  auditAndReclaimPool,
  acquireWarmSlot,
  releaseWarmSlot,
  type SlotLease,
} from "../../src/utils/git/pool.ts";
import { DEFAULT_GIT_WORKFLOW_CONFIG } from "../../src/config/defaults.ts";
import type { Pi } from "../../src/hooks/events.ts";

function fakePi(commands: Array<{ cmd: string; args: string[]; cwd: string }> = []): Pi {
  return {
    exec: async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "submodule" && args[1] === "status") {
        return { code: 0, stdout: "" };
      }
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
        return { code: 1, stdout: "" }; // branch does not exist yet
      }
      return { code: 0, stdout: "" };
    },
  } as unknown as Pi;
}

Deno.test("pool: slot lease write and read integrity", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-quest-slot-"));
  try {
    const lease: SlotLease = {
      slotId: "slot-1",
      status: "leased",
      leasedToQid: "1xTEST",
      leasedAt: 12345678,
      pid: process.pid,
      branch: "quest/1xTEST",
      baseCommit: "abc1234",
    };
    writeSlotLease(dir, lease);
    const read = readSlotLease(dir);
    check(read !== null, "lease was read");
    check(read?.slotId === "slot-1", "slotId matches");
    check(read?.status === "leased", "status matches");
    check(read?.leasedToQid === "1xTEST", "leasedToQid matches");
    check(read?.pid === process.pid, "pid matches");
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pool: instant acquisition of idle slot without network", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-poolroot-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  mkdirSync(slot1, { recursive: true });
  mkdirSync(join(slot1, ".git"), { recursive: true });

  const initialLease: SlotLease = {
    slotId: "slot-1",
    status: "idle",
    leasedToQid: null,
    leasedAt: null,
    pid: null,
    branch: null,
    baseCommit: null,
  };
  writeSlotLease(slot1, initialLease);

  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi(commands);

    const res = await acquireWarmSlot(
      root,
      "1xTEST",
      "HEAD",
      DEFAULT_GIT_WORKFLOW_CONFIG,
      pi,
    );

    check(res.ok === true, "acquire succeeded");
    check(res.slotId === "slot-1", "acquired slot-1");
    check(res.slotPath === slot1, "slot path matches");
    check(res.slotBranch === "quest/1xTEST", "slot branch matches");

    // Verified: checkout -B quest/1xTEST was executed inside slot-1
    check(
      commands.some(
        (c) =>
          c.cwd === slot1 &&
          c.args.includes("checkout") &&
          c.args.includes("-B") &&
          c.args.includes("quest/1xTEST"),
      ),
      "executed git checkout -B in slot-1",
    );

    // Verified: lease was updated to leased
    const updated = readSlotLease(slot1);
    check(updated?.status === "leased", "lease status is leased");
    check(updated?.leasedToQid === "1xTEST", "leased to 1xTEST");
    check(updated?.pid === process.pid, "lease has current pid");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pool: dynamic allocation of slot-(N+1) when all slots are busy", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-poolelastic-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  mkdirSync(slot1, { recursive: true });
  mkdirSync(join(slot1, ".git"), { recursive: true });

  // slot-1 is actively leased to another quest and live pid
  writeSlotLease(slot1, {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xOTHER",
    leasedAt: Date.now(),
    pid: process.pid,
    branch: "quest/1xOTHER",
    baseCommit: "HEAD",
  });

  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi(commands);

    const notifications: string[] = [];
    const notifier = {
      notify: (msg: string) => { notifications.push(msg); },
    };

    const res = await acquireWarmSlot(
      root,
      "1xNEW",
      "HEAD",
      {
        ...DEFAULT_GIT_WORKFLOW_CONFIG,
        worktreePoolSize: 1,
        worktreePoolMaxSize: 4,
      },
      pi,
      notifier,
    );

    check(res.ok === true, "acquire succeeded via dynamic allocation");
    check(res.slotId === "slot-2", "allocated and leased slot-2");

    // Verified: submodule worktrees were pruned before slot-2 worktree creation
    const pruneIdx = commands.findIndex(
      (c) => c.cmd === "git" && c.args[0] === "submodule" && c.args[1] === "status",
    );
    const addWtIdx = commands.findIndex(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "add",
    );
    check(pruneIdx !== -1, "submodule worktree prune initiated before provisioning");
    check(pruneIdx < addWtIdx, "pruning executed before git worktree add");

    // Verified: progress notification was sent to user
    check(
      notifications.some((n) => n.includes("Allocating dynamic workspace slot-2")),
      "user received dynamic allocation notification",
    );

    // Verified: slot-2 directory was created and leased
    const slot2 = join(poolDir, "slot-2");
    check(existsSync(slot2), "slot-2 exists on disk");
    const lease2 = readSlotLease(slot2);
    check(lease2?.status === "leased", "slot-2 is leased");
    check(lease2?.leasedToQid === "1xNEW", "slot-2 leased to 1xNEW");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pool: release and sanitization resets slot back to idle", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-poolrel-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  mkdirSync(slot1, { recursive: true });
  mkdirSync(join(slot1, ".git"), { recursive: true });

  writeSlotLease(slot1, {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xDONE",
    leasedAt: Date.now(),
    pid: process.pid,
    branch: "quest/1xDONE",
    baseCommit: "HEAD",
  });

  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi(commands);

    const res = await releaseWarmSlot(root, slot1, "1xDONE", pi);
    check(res.ok === true, "release succeeded");

    // Verified: git checkout --detach HEAD and clean was run
    check(
      commands.some((c) => c.cwd === slot1 && c.args.includes("checkout") && c.args.includes("--detach")),
      "detached HEAD in slot-1",
    );
    check(
      commands.some((c) => c.cwd === slot1 && c.args.includes("clean")),
      "cleaned slot-1",
    );

    const lease = readSlotLease(slot1);
    check(lease?.status === "idle", "slot-1 is now idle");
    check(lease?.leasedToQid === null, "leasedToQid is null");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pool: stale lease recovery reclaims dead PID or inactive quest slots", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-poolstale-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  mkdirSync(slot1, { recursive: true });
  mkdirSync(join(slot1, ".git"), { recursive: true });

  // Leased to a PID that is guaranteed dead (e.g. 99999999)
  writeSlotLease(slot1, {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xDEAD",
    leasedAt: Date.now() - 100000,
    pid: 99999999,
    branch: "quest/1xDEAD",
    baseCommit: "HEAD",
  });

  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi(commands);

    const reclaimed = await auditAndReclaimPool(
      root,
      ".pi/scratch",
      new Set(["1xACTIVE"]),
      pi,
    );

    check(reclaimed.includes("slot-1"), "slot-1 was reclaimed");
    const lease = readSlotLease(slot1);
    check(lease?.status === "idle", "slot-1 lease reset to idle");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pool: forward-aligns slot worktree to primary HEAD, preserves branch by default, and deletes branch when deleteBranch is true", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-forwardalign-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  mkdirSync(slot1, { recursive: true });
  mkdirSync(join(slot1, ".git"), { recursive: true });

  writeSlotLease(slot1, {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xALIGN",
    leasedAt: Date.now(),
    pid: process.pid,
    branch: "quest/1xALIGN",
    baseCommit: "HEAD",
  });

  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi(commands);
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD" && opts?.cwd === root) {
        return { code: 0, stdout: "primarySha999\n" };
      }
      return { code: 0, stdout: "" };
    };

    // 1. Default release preserves the quest branch and detaches HEAD at current commit BEFORE fetch/reset
    const resKeep = await releaseWarmSlot(root, slot1, "1xALIGN", pi);
    check(resKeep.ok === true, "release succeeded");
    const detachHeadIdx = commands.findIndex(
      (c) => c.cwd === slot1 && c.args.includes("checkout") && c.args.includes("--detach") && c.args.includes("HEAD"),
    );
    const fetchIdx = commands.findIndex(
      (c) => c.cwd === slot1 && c.args.includes("fetch") && c.args.includes("primarySha999"),
    );
    const resetIdx = commands.findIndex(
      (c) => c.cwd === slot1 && c.args.includes("reset") && c.args.includes("--hard"),
    );
    check(detachHeadIdx !== -1 && detachHeadIdx < fetchIdx && detachHeadIdx < resetIdx, "detached HEAD at current commit before fetch and reset --hard");
    check(commands.some((c) => c.cwd === slot1 && c.args.includes("checkout") && c.args.includes("--detach") && c.args.includes("FETCH_HEAD")), "checked out FETCH_HEAD detached");
    check(!commands.some((c) => c.cwd === slot1 && c.args.includes("branch") && c.args.includes("-D")), "preserved quest branch by default when deleteBranch is omitted");

    // 2. Explicit deleteBranch: true deletes the ephemeral quest branch
    writeSlotLease(slot1, {
      slotId: "slot-1",
      status: "leased",
      leasedToQid: "1xALIGN",
      leasedAt: Date.now(),
      pid: process.pid,
      branch: "quest/1xALIGN",
      baseCommit: "HEAD",
    });
    const resDel = await releaseWarmSlot(root, slot1, "1xALIGN", pi, undefined, { deleteBranch: true });
    check(resDel.ok === true, "release with deleteBranch succeeded");
    check(commands.some((c) => c.cwd === slot1 && c.args.includes("branch") && c.args.includes("-D") && c.args.includes("quest/1xALIGN")), "deleted ephemeral quest branch when deleteBranch: true");

    // Verified: clean excludes var/chroot
    check(commands.some((c) => c.cwd === slot1 && c.args.includes("clean") && c.args.includes("var/chroot")), "clean excluded var/chroot");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pool: auditAndReclaimPool preserves live external PIDs and auto-rescues dirty work from dead PIDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-rescue-"));
  const poolDir = join(root, ".pi", "scratch");
  const slotLive = join(poolDir, "slot-1");
  const slotDead = join(poolDir, "slot-2");
  mkdirSync(join(slotLive, ".git"), { recursive: true });
  mkdirSync(join(slotDead, ".git"), { recursive: true });

  // PID 1 (init/systemd) is alive and NOT process.pid
  writeSlotLease(slotLive, {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xEXTERNAL",
    leasedAt: Date.now(),
    pid: 1,
    branch: "quest/1xEXTERNAL",
    baseCommit: "HEAD",
  });

  // Dead PID with uncommitted work
  writeSlotLease(slotDead, {
    slotId: "slot-2",
    status: "leased",
    leasedToQid: "1xCRASHED",
    leasedAt: Date.now() - 60000,
    pid: 99999999,
    branch: "quest/1xCRASHED",
    baseCommit: "HEAD",
  });

  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi = fakePi(commands);
    (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
      commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
      if (cmd === "git" && args[0] === "status" && args.includes("--porcelain") && opts?.cwd === slotDead) {
        return { code: 0, stdout: " M rescued.c\n" };
      }
      if (cmd === "git" && args[0] === "diff" && args.includes("--cached") && opts?.cwd === slotDead) {
        return { code: 1, stdout: "staged changes" };
      }
      return { code: 0, stdout: "" };
    };

    // Session B has empty activeQids
    const reclaimed = await auditAndReclaimPool(root, ".pi/scratch", new Set(), pi);
    check(!reclaimed.includes("slot-1"), "did NOT reclaim slot-1 owned by live external PID 1");
    check(reclaimed.includes("slot-2"), "reclaimed dead PID slot-2");

    // Verify dirty work in slot-2 was auto-rescued via git add -A and git commit before reset
    const commitIdx = commands.findIndex(
      (c) => c.cwd === slotDead && c.args[0] === "commit" && c.args.some((a) => a.includes("auto-rescue")),
    );
    const resetIdx = commands.findIndex(
      (c) => c.cwd === slotDead && c.args[0] === "reset" && c.args.includes("--hard"),
    );
    check(commitIdx !== -1, "committed auto-rescue checkpoint in dead slot-2");
    check(resetIdx !== -1 && commitIdx < resetIdx, "auto-rescue commit occurred before git reset --hard");
    check(!commands.some((c) => c.cwd === slotDead && c.args.includes("branch") && c.args.includes("-D")), "did not delete quest/1xCRASHED branch");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("pool: ensureQuestWorktreeAttached reuses parent slot for active sub-quest without allocating a new slot", async () => {
  const { ensureQuestWorktreeAttached } = await import("../../src/utils/git/pool.ts");
  const root = mkdtempSync(join(tmpdir(), "pi-quest-subattach-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  const slot2 = join(poolDir, "slot-2");
  mkdirSync(join(slot1, ".git"), { recursive: true });
  mkdirSync(join(slot2, ".git"), { recursive: true });

  writeSlotLease(slot1, {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xROOT",
    leasedAt: Date.now(),
    pid: process.pid,
    branch: "quest/1xROOT",
    baseCommit: "HEAD",
  });
  writeSlotLease(slot2, {
    slotId: "slot-2",
    status: "idle",
    leasedToQid: null,
    leasedAt: null,
    pid: null,
    branch: null,
    baseCommit: null,
  });

  try {
    const commands: Array<{ cmd: string; args: string[]; cwd: string }> = [];
    const pi: Pi = {
      exec: async (cmd: string, args: string[], opts?: { cwd?: string }) => {
        commands.push({ cmd, args, cwd: opts?.cwd ?? "" });
        if (cmd === "git" && args[0] === "symbolic-ref" && opts?.cwd === slot1) {
          return { code: 0, stdout: "quest/1xROOT\n" };
        }
        return { code: 0, stdout: "" };
      },
    } as unknown as Pi;

    const res = await ensureQuestWorktreeAttached(
      root,
      "1xSUB1",
      "HEAD",
      slot1,
      "quest/1xROOT",
      DEFAULT_GIT_WORKFLOW_CONFIG,
      pi,
      undefined,
      ["1xROOT", "1xSUB1"],
    );

    check(res.ok === true, "reattachment succeeded");
    check(res.slotPath === slot1, "kept parent slot-1 instead of allocating slot-2");
    check(res.slotBranch === "quest/1xROOT", "kept parent branch quest/1xROOT");
    check(readSlotLease(slot1)?.leasedToQid === "1xROOT", "slot-1 lease remains bound to root quest 1xROOT");
    check(readSlotLease(slot2)?.status === "idle", "slot-2 remains untouched and idle");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

