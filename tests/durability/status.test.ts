import { check } from "../check.ts";
import { fakeCtx } from "../fake-pi.ts";
import { replaceState } from "../../src/app/store.ts";
import { IDLE_STATE, createQuest } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { noteDraftUpdated, questStatus, refreshStatus } from "../../src/durability/index.ts";

const STD_DIFF_ICON = "\x1b[32m₃\x1b[39m";

Deno.test("status shows one icon per phase with tinted difficulty and depth subscripts", () => {
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
    check(text === `${icon} abc123${STD_DIFF_ICON}₁`, `${phase} maps to ${icon} with tinted difficulty and depth ₁`);
  }
  check(questStatus({ ...IDLE_STATE, phase: "idle", qid: null }) === "💤 idle", "no qid shows 💤 idle");
});

Deno.test("status text mode puts the phase where the icon goes", () => {
  const text = questStatus({ ...IDLE_STATE, phase: "drafting", qid: "abc123" as Qid }, "text");
  check(text === "drafting abc123:3:1", "phase word plus qid and difficulty:depth");
  check(questStatus(IDLE_STATE, "text") === "idle", "text mode shows idle without quest");
});

Deno.test("status displays tinted difficulty subscript before depth subscript after quest name", () => {
  const root = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 0 });
  check(root === `🔨 1xMjwo${STD_DIFF_ICON}₁`, "root quest shows tinted difficulty subscript then ₁ depth subscript");

  const child = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 1 });
  check(child === `🔨 1xMjwo${STD_DIFF_ICON}₂`, "child sub-quest shows difficulty then ₂ depth subscript");

  const grandchild = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 2, difficulty: "complex" });
  check(grandchild === "🔨 1xMjwo\x1b[31m₅\x1b[39m₃", "grandchild sub-quest shows red ₅ difficulty then ₃ depth subscript");

  const childText = questStatus({ ...IDLE_STATE, phase: "implementing", qid: "1xMjwo" as Qid, depth: 1 }, "text");
  check(childText === "implementing 1xMjwo:3:2", "text mode displays difficulty and depth suffix");
});

Deno.test("status prefers readable quest name over qid and shows 👀 during active review", () => {
  const named = questStatus({
    ...IDLE_STATE,
    phase: "implementing",
    qid: "1xMjwo" as Qid,
    name: "fix-seams",
    depth: 1,
  });
  check(named === `🔨 fix-seams${STD_DIFF_ICON}₂`, "shows readable name with difficulty and depth subscripts");

  const activeRev = { target: "hash1", kind: "draft" as const };
  const reviewing = questStatus({
    ...IDLE_STATE,
    phase: "drafting",
    qid: "1xMjwo" as Qid,
    name: "fix-seams",
    activeReview: activeRev,
  });
  check(reviewing === `👀 fix-seams${STD_DIFF_ICON}₁`, "shows 👀 icon when review is active");
  check(
    questStatus({ ...IDLE_STATE, phase: "drafting", qid: "1xMjwo" as Qid, name: "fix-seams", activeReview: activeRev }, "text") ===
      "reviewing fix-seams:3:1",
    "text mode shows reviewing when review is active",
  );
});

Deno.test("status renders slot after status icon without parentheses and passing test receipt", () => {
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
  check(iconText === `🔨 fix-seams${STD_DIFF_ICON}₁ ✓`, "includes passing test checkmark without RTM or file count");

  const plainText = questStatus(quest, "text");
  check(plainText === "implementing fix-seams:3:1 ✓", "text mode includes passing test checkmark");

  // Scratch pool slot without passing tests (slot placed right after status icon without parentheses)
  const slotQuest = {
    ...quest,
    worktreePath: "/home/user/repo/.pi/scratch/slot-2",
    lastPassingTestReceipt: undefined,
  };
  check(questStatus(slotQuest) === `🔨 2 fix-seams${STD_DIFF_ICON}₁`, "shows scratch slot 2 after icon without parentheses");
  check(questStatus(slotQuest, "text") === "implementing 2 fix-seams:3:1", "text mode shows scratch slot 2 after phase");

  // Scratch pool slot with passing tests
  const slotWithTest = {
    ...quest,
    worktreePath: "/home/user/repo/.pi/scratch/slot-1",
  };
  check(questStatus(slotWithTest) === `🔨 1 fix-seams${STD_DIFF_ICON}₁ ✓`, "shows 1 after icon and ✓ at end cleanly");
  check(questStatus(slotWithTest, "text") === "implementing 1 fix-seams:3:1 ✓", "text mode shows 1 after phase and ✓");

  // Ad-hoc worktree
  const adhocQuest = {
    ...quest,
    worktreePath: "/home/user/repo/.pi/worktrees/feat-x",
  };
  check(questStatus(adhocQuest) === `🔨 wt fix-seams${STD_DIFF_ICON}₁ ✓`, "shows ad-hoc worktree wt after icon and ✓");
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DIM_FRAME = `📝 dim${STD_DIFF_ICON}₁`;
const dimFrame = `\x1b[2m${DIM_FRAME}\x1b[0m`;
const BLINK_FRAME = `📝 blink${STD_DIFF_ICON}₁`;
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
