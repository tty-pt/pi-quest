import { check } from "../check.ts";
import { fakeCtx } from "../fake-pi.ts";
import { replaceState } from "../../src/app/store.ts";
import { IDLE_STATE, createQuest } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { noteDraftUpdated, questStatus, refreshStatus } from "../../src/durability/index.ts";

Deno.test("status shows one icon per phase", () => {
  check(questStatus(IDLE_STATE) === "💤 idle", "idle quest shows 💤 idle");
  const cases = [
    ["provisional", "🔍"],
    ["drafting", "📝"],
    ["implementing", "🔨"],
    ["validating", "🧪"],
    ["archived", "📦"],
  ] as const;
  for (const [phase, icon] of cases) {
    const text = questStatus({ ...IDLE_STATE, phase, qid: "abc123" as Qid });
    check(text === `${icon} abc123`, `${phase} maps to ${icon} without the phase word`);
  }
  check(questStatus({ ...IDLE_STATE, phase: "idle", qid: null }) === "💤 idle", "no qid shows 💤 idle");
});

Deno.test("status text mode puts the phase where the icon goes", () => {
  const text = questStatus({ ...IDLE_STATE, phase: "drafting", qid: "abc123" as Qid }, "text");
  check(text === "drafting abc123", "phase word plus qid");
  check(questStatus(IDLE_STATE, "text") === "idle", "text mode shows idle without quest");
});

Deno.test("status displays sub-quest depth when depth > 0", () => {
  const root = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 0 });
  check(root === "🔨 1xMjwo", "root quest has no depth prefix");

  const child = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 1 });
  check(child === "🔨 ↳ 1xMjwo", "child sub-quest shows ↳ prefix");

  const grandchild = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 2 });
  check(grandchild === "🔨 ↳₂ 1xMjwo", "grandchild sub-quest shows ↳₂ prefix");

  const childText = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 1 }, "text");
  check(childText === "implementing 1xMjwo:1", "text mode displays depth suffix");
});

Deno.test("status prefers readable quest name over qid and shows 👀 during active review", () => {
  const named = questStatus({
    ...IDLE_STATE,
    phase: "implementing",
    qid: "1xMjwo" as Qid,
    name: "fix-seams",
    depth: 1,
  });
  check(named === "🔨 ↳ fix-seams", "shows readable name with depth prefix");

  const activeRev = { target: "hash1", kind: "draft" as const };
  const reviewing = questStatus({
    ...IDLE_STATE,
    phase: "drafting",
    qid: "1xMjwo" as Qid,
    name: "fix-seams",
    activeReview: activeRev,
  });
  check(reviewing === "👀 fix-seams", "shows 👀 icon when review is active");
  check(
    questStatus({ ...IDLE_STATE, phase: "drafting", qid: "1xMjwo" as Qid, name: "fix-seams", activeReview: activeRev }, "text") ===
      "reviewing fix-seams",
    "text mode shows reviewing when review is active",
  );
});

Deno.test("status renders slot and passing test receipt without bracket soup", () => {
  const quest = {
    ...IDLE_STATE,
    phase: "implementing" as const,
    qid: "hud123" as Qid,
    name: "fix-seams",
    rtm: [
      { id: "R1", description: "First", status: "satisfied" as const },
      { id: "R2", description: "Second", status: "pending" as const },
    ],
    touchedFiles: ["src/a.ts", "src/b.ts"],
    lastPassingTestReceipt: { command: "npm test", exitCode: 0, tailOutput: "ok" },
  };

  const iconText = questStatus(quest);
  check(iconText === "🔨 fix-seams ✓", "includes passing test checkmark without RTM or file count");

  const plainText = questStatus(quest, "text");
  check(plainText === "implementing fix-seams ✓", "text mode includes passing test checkmark");

  // Scratch pool slot without passing tests
  const slotQuest = {
    ...quest,
    worktreePath: "/home/user/repo/.pi/scratch/slot-2",
    lastPassingTestReceipt: undefined,
  };
  check(questStatus(slotQuest) === "🔨 fix-seams (2)", "shows scratch slot identifier (2)");
  check(questStatus(slotQuest, "text") === "implementing fix-seams (2)", "text mode shows scratch slot (2)");

  // Scratch pool slot with passing tests
  const slotWithTest = {
    ...quest,
    worktreePath: "/home/user/repo/.pi/scratch/slot-1",
  };
  check(questStatus(slotWithTest) === "🔨 fix-seams (1) ✓", "shows (1) and ✓ cleanly");
  check(questStatus(slotWithTest, "text") === "implementing fix-seams (1) ✓", "text mode shows (1) and ✓");

  // Ad-hoc worktree
  const adhocQuest = {
    ...quest,
    worktreePath: "/home/user/repo/.pi/worktrees/feat-x",
  };
  check(questStatus(adhocQuest) === "🔨 fix-seams (wt) ✓", "shows ad-hoc worktree (wt) ✓");
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DIM_FRAME = "📝 dim";
const dimFrame = `\x1b[2m${DIM_FRAME}\x1b[0m`;
const BLINK_FRAME = "📝 blink";
const blinkDimFrame = `\x1b[2m${BLINK_FRAME}\x1b[0m`;
const brightFrame = `\x1b[97m${BLINK_FRAME}\x1b[0m`;

Deno.test("steady status renders dim without obtrusive [^Q] hint", () => {
  replaceState(createDraft(createQuest("dim work", "abc123"), "dim"));
  const calls: Array<string | undefined> = [];
  const ctx = fakeCtx("/tmp", [], {
    setStatus: (_key: string, text: string | undefined) => {
      calls.push(text);
    },
  });
  try {
    refreshStatus(ctx);
    check(calls.length === 1 && calls[0] === dimFrame, "dim frame with readable draft name");
    check(!/[\x00-\x08\x0b\x0c\x0e-\x1a]/.test(calls[0] ?? ""), "escapes only, no raw control bytes");
  } finally {
    replaceState(IDLE_STATE);
  }
});

function draftingCtx() {
  replaceState(createDraft(createQuest("blink work", "abc123"), "blink"));
  const calls: Array<string | undefined> = [];
  const ctx = fakeCtx("/tmp", [], {
    setStatus: (_key: string, text: string | undefined) => {
      calls.push(text);
    },
  });
  return { calls, ctx };
}

Deno.test("draft update flashes bright then relaxes to dim", async () => {
  const { calls, ctx } = draftingCtx();
  try {
    noteDraftUpdated(ctx, { intervalMs: 10, windowMs: 35 });
    check(calls.length === 1 && calls[0] === brightFrame, "bright flash shows immediately");
    refreshStatus(ctx);
    check(calls[calls.length - 1] === brightFrame, "refresh keeps the blink frame");
    await sleep(60);
    check(calls.length >= 3, "blink toggles at least once mid-window");
    check(calls.some((text) => text === blinkDimFrame), "dim frame returns mid-window");
    check(calls[calls.length - 1] === blinkDimFrame, "relaxes back to the dim token");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("rapid draft saves restart the blink window", async () => {
  const { calls, ctx } = draftingCtx();
  try {
    noteDraftUpdated(ctx, { intervalMs: 10, windowMs: 40 });
    await sleep(25);
    const before = calls.length;
    noteDraftUpdated(ctx, { intervalMs: 10, windowMs: 40 });
    check(calls[before] === brightFrame, "restart re-asserts bright immediately");
    await sleep(60);
    check(calls[calls.length - 1] === blinkDimFrame, "restarted window still relaxes to dim");
    check(calls.length <= before + 8, "no duplicate interval survives the restart");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("blink stays silent without an active quest", async () => {
  replaceState(IDLE_STATE);
  const calls: Array<string | undefined> = [];
  const ctx = fakeCtx("/tmp", [], {
    setStatus: (_key: string, text: string | undefined) => {
      calls.push(text);
    },
  });
  noteDraftUpdated(ctx, { intervalMs: 10, windowMs: 25 });
  await sleep(40);
  check(calls.length > 0, "idle still asserts status");
  check(calls.every((text) => text?.includes("💤 idle")), "idle never flashes, stays idle");
});
