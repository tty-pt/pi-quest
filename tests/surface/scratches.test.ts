import { check } from "../check.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectScratchSlots,
  formatSlotSummary,
  formatDuration,
  parsePorcelainStatus,
  parseGitLog,
} from "../../src/utils/git/pool-inspect.ts";
import { writeSlotLease, type SlotLease } from "../../src/utils/git/pool.ts";
import { scratchesTool } from "../../src/surface/tools/scratches.ts";
import { fakePi, fakeCtx } from "../fake-pi.ts";
import { getScratchesLines } from "../../src/surface/commands/index.ts";

Deno.test("scratches: formatDuration scales gracefully", () => {
  check(formatDuration(5000) === "5s", "5s");
  check(formatDuration(65000) === "1m 5s", "1m 5s");
  check(formatDuration(3720000) === "1h 2m", "1h 2m");
});

Deno.test("scratches: parsePorcelainStatus counts staged, unstaged, untracked", () => {
  const sample = "M  src/a.ts\n M src/b.ts\nMM src/c.ts\n?? src/d.ts\n";
  const parsed = parsePorcelainStatus(sample);
  check(parsed.staged === 2, "2 staged");
  check(parsed.unstaged === 2, "2 unstaged");
  check(parsed.untracked === 1, "1 untracked");
});

Deno.test("scratches: parseGitLog extracts commit fields", () => {
  const line = "abc1234|feat: add widget|5 minutes ago|Alice\n";
  const parsed = parseGitLog(line);
  check(parsed?.hash === "abc1234", "hash parsed");
  check(parsed?.subject === "feat: add widget", "subject parsed");
  check(parsed?.relativeDate === "5 minutes ago", "date parsed");
  check(parsed?.author === "Alice", "author parsed");

  check(parseGitLog("") === null, "empty log is null");
});

Deno.test("scratches: inspectScratchSlots detects idle and leased workspaces", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-scratches-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  const slot2 = join(poolDir, "slot-2");
  mkdirSync(slot1, { recursive: true });
  mkdirSync(slot2, { recursive: true });

  // Create quest doc in future/
  const futureDir = join(root, ".pi", "quest", "future");
  mkdirSync(futureDir, { recursive: true });
  writeFileSync(
    join(futureDir, "1xTEST.md"),
    "# 1xTEST\n\n## Original request\nDesign and build supersonic engine\n",
    "utf8",
  );

  const lease1: SlotLease = {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xTEST",
    leasedAt: Date.now() - 120000, // 2 minutes ago
    pid: process.pid,
    branch: "quest/1xTEST",
    baseCommit: "HEAD",
  };
  writeSlotLease(slot1, lease1);

  const lease2: SlotLease = {
    slotId: "slot-2",
    status: "idle",
    leasedToQid: null,
    leasedAt: null,
    pid: null,
    branch: null,
    baseCommit: null,
  };
  writeSlotLease(slot2, lease2);

  const pi = fakePi();
  try {
    const slots = await inspectScratchSlots(root, ".pi/scratch", pi);
    check(slots.length === 2, "found 2 slots");

    const s1 = slots.find((s) => s.slotId === "slot-1");
    check(s1 !== undefined, "slot-1 present");
    check(s1?.status === "leased", "slot-1 leased");
    check(s1?.assignedQid === "1xTEST", "assigned to 1xTEST");
    check(s1?.objective === "Design and build supersonic engine", "objective parsed");
    check(s1?.isPidAlive === true, "PID is alive");

    const s2 = slots.find((s) => s.slotId === "slot-2");
    check(s2 !== undefined, "slot-2 present");
    check(s2?.status === "idle", "slot-2 idle");

    const summary = formatSlotSummary(slots);
    const summaryText = summary.join("\n");
    check(summaryText.includes("slot-1 [LEASED]"), "summary shows slot-1 leased");
    check(summaryText.includes("Design and build supersonic engine"), "summary shows objective");
    check(summaryText.includes("slot-2 [IDLE]"), "summary shows slot-2 idle");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

Deno.test("scratches: quest_scratches tool execution and filtering", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-quest-tool-scratches-"));
  const poolDir = join(root, ".pi", "scratch");
  const slot1 = join(poolDir, "slot-1");
  mkdirSync(slot1, { recursive: true });

  const lease1: SlotLease = {
    slotId: "slot-1",
    status: "leased",
    leasedToQid: "1xDEMO",
    leasedAt: Date.now() - 30000,
    pid: process.pid,
    branch: "quest/1xDEMO",
    baseCommit: "HEAD",
  };
  writeSlotLease(slot1, lease1);

  const pi = fakePi();
  const ctx = fakeCtx(root);
  const tool = scratchesTool(pi);

  try {
    // Unfiltered execution
    const res = await tool.execute("call-1", {}, new AbortController().signal, () => {}, ctx);
    check(Boolean(res.content?.[0]?.text?.includes("slot-1 [LEASED]")), "tool text includes leased slot");

    // Filter to existing slot
    const resFiltered = await tool.execute("call-2", { slotId: "slot-1" }, new AbortController().signal, () => {}, ctx);
    check(Boolean(resFiltered.content?.[0]?.text?.includes("slot-1 [LEASED]")), "filtered includes slot-1");

    // Filter to non-existent slot
    const resMissing = await tool.execute("call-3", { slotId: "slot-99" }, new AbortController().signal, () => {}, ctx);
    check(Boolean(resMissing.content?.[0]?.text?.includes("not found")), "missing slot reported");

    // Command integration helper
    const cmdLines = await getScratchesLines(ctx, pi);
    check(cmdLines.join("\n").includes("slot-1 [LEASED]"), "command lines contain slot summary");
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
