import { check, assertEquals } from "../check.ts";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { installDurability } from "../../src/durability/index.ts";
import {
  buildSubquestCompactionPrompt,
  maybeTriggerPostSubquestCompaction,
  renderSubquestResumption,
  resetCompactionHandoff,
  stagePostSubquestCompaction,
  type SubquestHandbackInfo,
} from "../../src/durability/compaction-handoff.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

function injectedText(pi: ReturnType<typeof fakePi>, cwd: string): string {
  const handlers = pi.eventHandlers["before_agent_start"] ?? [];
  const out = handlers.map((h) => h({}, fakeCtx(cwd)) as { message?: { content: string } } | undefined);
  return out.map((o) => o?.message?.content ?? "").join("\n");
}

Deno.test("compaction writes a handoff and injects a one-shot pointer after it lands", async () => {
  resetCompactionHandoff();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-compact-"));
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "quest", "future", "1xKKKK.md"), "# 1xKKKK\n\n## Requirements\n- [x] R1: done thing\n- R2: open thing\n");
  replaceState({
    ...createQuest("keep everything", "1xKKKK"),
    phase: "implementing",
    exactNextAction: "Finish R2.",
    touchedFiles: ["src/foo.ts"],
    lastPassingTestReceipt: { command: "deno test", exitCode: 0, tailOutput: "ok", executedAt: 123 },
  });
  const pi = fakePi();
  installDurability(pi);

  const before = pi.eventHandlers["session_before_compact"]!;
  const results = await Promise.all(before.map((h) => h({ type: "session_before_compact" }, fakeCtx(cwd))));
  check(results.every((r) => r === undefined), "never cancels or replaces pi's compaction");
  const files = readdirSync(join(cwd, ".pi", "quest", "handoffs"));
  assertEquals(files.length, 1);

  check(!injectedText(pi, cwd).includes("[Post-Compaction Handoff]"), "not injected before compaction lands");
  for (const h of pi.eventHandlers["session_compact"]!) h({ type: "session_compact" }, fakeCtx(cwd));
  const first = injectedText(pi, cwd);
  check(first.includes("[Post-Compaction Handoff]") && first.includes(files[0]), first);
  check(first.includes("Objective: \"keep everything\""), "objective rendered in compaction handoff");
  check(first.includes("Quest: 1xKKKK (Phase: implementing)"), "quest and phase rendered");
  check(first.includes("Active Requirement: R1"), "active requirement rendered");
  check(first.includes("Modified files: src/foo.ts"), "modified files rendered");
  check(first.includes("Last Test Receipt: `deno test` (PASS)"), "test receipt rendered");
  check(first.includes("Requirements not yet verified: R1, R2") && first.includes("Next action: Finish R2."), first);
  check(!injectedText(pi, cwd).includes("[Post-Compaction Handoff]"), "one-shot");
  replaceState(IDLE_STATE);
});

Deno.test("compaction with no active quest writes nothing", async () => {
  resetCompactionHandoff();
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-compact-"));
  const pi = fakePi();
  installDurability(pi);
  for (const h of pi.eventHandlers["session_before_compact"]!) await h({ type: "session_before_compact" }, fakeCtx(cwd));
  let exists = true;
  try {
    readdirSync(join(cwd, ".pi", "quest", "handoffs"));
  } catch {
    exists = false;
  }
  check(!exists, "no handoffs dir");
});

Deno.test("post-subquest compaction staging, prompt building, and one-shot resumption injection", () => {
  resetCompactionHandoff();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-compact-"));
  const pi = fakePi();
  installDurability(pi);

  const info: SubquestHandbackInfo = {
    parentQid: "1xROOT",
    targetQid: "1xROOT",
    childQid: "1xCHLD",
    outcome: "COMPLETED",
    summary: "Built the feature cleanly",
    modifiedFiles: ["src/a.ts", "src/b.ts"],
    testCommand: "deno test",
    testPassed: true,
    assignedRequirements: ["R1"],
    openRequirements: ["R2", "R3"],
    exactNextAction: "Implement R2 in parent.",
    turnCount: 5,
  };

  const prompt = buildSubquestCompactionPrompt(info);
  check(prompt.includes("1xCHLD") && prompt.includes("1xROOT"), "prompt mentions child and parent");
  check(prompt.includes("src/a.ts, src/b.ts"), "prompt lists files");
  check(prompt.includes("deno test (PASS)"), "prompt records test receipt");
  check(prompt.includes("R2, R3"), "prompt records open requirements");

  stagePostSubquestCompaction(info);
  replaceState({ ...createQuest("root initiative", "1xROOT"), phase: "implementing", exactNextAction: "Implement R2." });

  // Before compaction lands, resumption is not yet active
  check(!injectedText(pi, cwd).includes("[Sub-Quest Handback & Context Resumption]"), "not injected before landing");

  // Compaction lands
  for (const h of pi.eventHandlers["session_compact"]!) h({ type: "session_compact" }, fakeCtx(cwd));

  // First post-compaction turn has resumption card
  const first = injectedText(pi, cwd);
  check(first.includes("[Sub-Quest Handback & Context Resumption]"), "has resumption card");
  check(first.includes("Sub-quest 1xCHLD completed (COMPLETED)"), "shows child outcome");
  check(first.includes("src/a.ts, src/b.ts"), "shows modified files");
  check(first.includes("Pending parent requirements: R2, R3"), "shows pending reqs");

  // Second turn is one-shot: cleared
  const second = injectedText(pi, cwd);
  check(!second.includes("[Sub-Quest Handback & Context Resumption]"), "resumption is one-shot");
  replaceState(IDLE_STATE);
});

Deno.test("maybeTriggerPostSubquestCompaction executes compaction when eligible and skips when unconfigured", () => {
  resetCompactionHandoff();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-compact-"));

  const info: SubquestHandbackInfo = {
    parentQid: "1xROOT",
    childQid: "1xCHLD",
    outcome: "COMPLETED",
    summary: "Built cleanly",
    modifiedFiles: ["src/a.ts"],
    testCommand: "npm test",
    testPassed: true,
    assignedRequirements: [],
    openRequirements: [],
    exactNextAction: "Next action",
    turnCount: 5,
  };

  // Case 1: ctx has no compact function -> safely returns false
  stagePostSubquestCompaction(info);
  const baseCtx = fakeCtx(cwd);
  assertEquals(maybeTriggerPostSubquestCompaction(baseCtx), false);

  // Case 2: ctx has compact function -> triggers compaction and calls ctx.compact
  stagePostSubquestCompaction(info);
  let compactCalls = 0;
  let passedInstructions = "";
  const compactCtx = {
    ...baseCtx,
    getContextUsage: () => ({ tokens: 50000, totalTokens: 50000 }),
    compact: (opts?: { customInstructions?: string }) => {
      compactCalls++;
      passedInstructions = opts?.customInstructions ?? "";
    },
  };

  const triggered = maybeTriggerPostSubquestCompaction(compactCtx);
  assertEquals(triggered, true);
  assertEquals(compactCalls, 1);
  check(passedInstructions.includes("1xCHLD"), "passes custom instructions with child id");
});

Deno.test("post-subquest compaction completion triggers followUp message to wake agent", () => {
  resetCompactionHandoff();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-compact-fu-"));

  const info: SubquestHandbackInfo = {
    parentQid: "1xROOT",
    childQid: "1xCHLD",
    outcome: "COMPLETED",
    summary: "Subquest done",
    modifiedFiles: ["src/feature.ts"],
    testCommand: "deno test",
    testPassed: true,
    assignedRequirements: [],
    openRequirements: [],
    exactNextAction: "Continue parent implementation",
    turnCount: 5,
  };

  stagePostSubquestCompaction(info);
  const sentMessages: Array<{ message: unknown; opts: unknown }> = [];
  const pi = fakePi();
  (pi as unknown as { sendMessage: unknown }).sendMessage = (msg: unknown, opts: unknown) => {
    sentMessages.push({ message: msg, opts });
  };

  const compactCtx = {
    ...fakeCtx(cwd),
    getContextUsage: () => ({ tokens: 50000, totalTokens: 50000 }),
    compact: (opts?: { customInstructions?: string; onComplete?: (result: unknown) => void; onError?: (error: Error) => void }) => {
      opts?.onComplete?.({});
    },
  };

  maybeTriggerPostSubquestCompaction(pi, compactCtx);
  assertEquals(sentMessages.length, 1);
  const first = sentMessages[0];
  const opts = first.opts as { deliverAs?: string; triggerTurn?: boolean };
  assertEquals(opts.deliverAs, "followUp");
  assertEquals(opts.triggerTurn, true);
  check(JSON.stringify(first.message).includes("1xCHLD concluded and transcript compacted"), "contains resumption message");
});
