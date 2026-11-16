import { check } from "../check.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getState, replaceState } from "../../src/app/store.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { draftPath } from "../../src/domain/paths";
import { bootDraftReview } from "../../src/drafting/reviews.ts";
import { hashContent } from "../../src/drafting/plan-text.ts";
import { askHumanTool } from "../../src/surface/tools/ask-human.ts";
import { writeAnalysisToDraft } from "../../src/surface/tools/draft-writer.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

const QID = "apprv01" as Qid;

function createTestDraft(cwd: string, withAnalysis = true): string {
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(cwd, "src", "b.ts"), "export const b = 2;\n");
  const lines = [
    "## Requirements",
    "- first requirement",
    "- second requirement",
    "",
    "## Evidence",
    "- src/a.ts:1",
    "- src/b.ts:1",
    "",
    ...(withAnalysis ? ["## Analysis", "Root cause analyzed in src/a.ts:1 and src/b.ts:1.", ""] : []),
    "## Implementation Plan",
    "1. Step one via src/a.ts:1",
    "2. Step two via src/b.ts:1",
    "3. Run make test to verify",
    "",
  ];
  const content = lines.join("\n");
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, draftPath(QID)), content, "utf8");
  return hashContent(content);
}

function busPi(): ReturnType<typeof fakePi> & { emitted: Array<{ event: string; data: unknown }>; feed: (data: unknown) => void } {
  const pi = fakePi();
  pi.toolNames = ["subagent"];
  const emitted: Array<{ event: string; data: unknown }> = [];
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  (pi as { events: unknown }).events = {
    on: (event: string, handler: (data: unknown) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    emit: (event: string, data: unknown) => {
      emitted.push({ event, data });
    },
  };
  const feed = (data: unknown) => {
    for (const handler of handlers.get("prompt-template:subagent:response") ?? []) handler(data);
  };
  return Object.assign(pi, { emitted, feed });
}

Deno.test("standard quests can author ## Analysis via writeAnalysisToDraft", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-analysis-"));
  const target = createTestDraft(cwd, false);
  const drafting = createDraft(createQuest("build feature", QID), "build feature");
  replaceState({ ...drafting, draft: { ...drafting.draft!, contentHash: target } });
  const pi = fakePi();
  const ctx = fakeCtx(cwd);

  const updatedState = await writeAnalysisToDraft(pi, ctx, getState(), "Root cause analyzed at src/index.ts:1.");
  check(updatedState.draft !== null, "draft exists");
  const doc = await Deno.readTextFile(join(cwd, draftPath(QID)));
  check(doc.includes("## Analysis"), "## Analysis section exists");
  check(doc.includes("Root cause analyzed at src/index.ts:1."), "analysis text was written");
  replaceState(IDLE_STATE);
});

Deno.test("approvalGate: reviewer PASS validates draft but holds for operator approval", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-gate-"));
  const target = createTestDraft(cwd, true);
  const drafting = createDraft(createQuest("build feature", QID), "build feature");
  replaceState({ ...drafting, draft: { ...drafting.draft!, planAuthored: true, contentHash: target } });
  const pi = busPi();
  const ctx = fakeCtx(cwd);

  const config = { ...DEFAULT_CONFIG, approvalGate: true };
  const pending = bootDraftReview(pi, ctx, target, config);
  await new Promise((r) => setTimeout(r, 50));
  const request = pi.emitted.find((e) => e.event === "prompt-template:subagent:request");
  check(request !== undefined, "review launched");
  pi.feed({
    requestId: (request!.data as Record<string, unknown>)["requestId"],
    status: "completed",
    result: { kind: "text", text: "VERDICT: PASS\nSEVERITY: NONE\n" },
  });
  await pending;

  check(getState().phase === "drafting", "held in drafting awaiting operator approval");
  check(getState().lastReview?.verdict === "PASS", "validation recorded as PASS");
  replaceState(IDLE_STATE);
});

Deno.test("approvalGate: live operator approval via quest_ask_human promotes to implementing", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-ask-appr-"));
  const target = createTestDraft(cwd, true);
  const drafting = createDraft(createQuest("build feature", QID), "build feature");
  replaceState({
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true, contentHash: target },
    lastReview: { verdict: "PASS", target, findings: "" },
  });
  const pi = fakePi();
  const ctx = fakeCtx(cwd, [], { input: async () => "yes, proceed with implementation" });
  const withUI = { ...ctx, hasUI: true };

  const tool = askHumanTool(pi);
  const result = await tool.execute("t1", { question: "Approve implementation?", default: "proceed" }, undefined, undefined, withUI);
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "user", "answered by user");
  check(getState().phase === "implementing", "promoted to implementing on operator approval");
  check(getState().draft?.approvedBy === "user", "approved by user recorded");
  replaceState(IDLE_STATE);
});

Deno.test("approvalGate: pressing Escape does NOT promote to implementing (plan does not go through)", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-ask-esc-"));
  const target = createTestDraft(cwd, true);
  const drafting = createDraft(createQuest("build feature", QID), "build feature");
  replaceState({
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true, contentHash: target },
    lastReview: { verdict: "PASS", target, findings: "" },
  });
  const pi = fakePi();
  // User cancels the prompt (presses Escape -> input returns undefined)
  const ctx = fakeCtx(cwd, [], { input: async () => undefined });
  const withUI = { ...ctx, hasUI: true };

  const tool = askHumanTool(pi);
  const result = await tool.execute("t_esc", { question: "Approve implementation?", default: "proceed" }, undefined, undefined, withUI);
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "cancelled", "marked as cancelled by user");
  check(getState().phase === "drafting", "held in drafting: plan did NOT go through on Escape");
  check(getState().draft?.approvedBy === null, "no approval recorded");
  replaceState(IDLE_STATE);
});

Deno.test("approvalGate: quest_ask_human timeout does NOT promote to implementing (never defaults to confirming)", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-ask-timeout-"));
  const target = createTestDraft(cwd, true);
  const drafting = createDraft(createQuest("build feature", QID), "build feature");
  replaceState({
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true, contentHash: target },
    lastReview: { verdict: "PASS", target, findings: "" },
  });
  const pi = fakePi();
  const ctx = fakeCtx(cwd); // headless, times out immediately to default
  const tool = askHumanTool(pi);
  const result = await tool.execute("t2", { question: "Approve implementation?", default: "proceed" }, undefined, undefined, ctx);
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "default", "timed out to default");
  check(details["answer"] === "hold", "default was forced to hold (non-confirming)");
  check(getState().phase === "drafting", "held in drafting: timeout does NOT default to confirming");
  check(getState().draft?.approvedBy === null, "not approved on timeout");
  replaceState(IDLE_STATE);
});

Deno.test("approvalGate: quest_ask_human timeout does NOT promote when draft is unvalidated", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-ask-noval-"));
  const target = createTestDraft(cwd, true);
  const drafting = createDraft(createQuest("build feature", QID), "build feature");
  replaceState({
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true, contentHash: target },
    lastReview: null, // unvalidated!
  });
  const pi = fakePi();
  const ctx = fakeCtx(cwd);
  const tool = askHumanTool(pi);
  const result = await tool.execute("t3", { question: "Approve implementation?", default: "proceed" }, undefined, undefined, ctx);
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "default", "timed out to default");
  check(details["answer"] === "hold", "default was forced to hold");
  check(getState().phase === "drafting", "NOT promoted: draft was unvalidated");
  replaceState(IDLE_STATE);
});

Deno.test("approvalGate: Reviewer PASS while waiting for operator approval does NOT auto-promote", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-timeout-pass-"));
  const target = createTestDraft(cwd, true);
  const drafting = createDraft(createQuest("build feature", QID), "build feature");
  replaceState({
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true, contentHash: target },
    lastReview: null,
  });
  const pi = busPi();
  const ctx = fakeCtx(cwd);

  const config = { ...DEFAULT_CONFIG, approvalGate: true };
  const pendingReview = bootDraftReview(pi, ctx, target, config);
  await new Promise((r) => setTimeout(r, 50));
  const request = pi.emitted.find((e) => e.event === "prompt-template:subagent:request");
  check(request !== undefined, "review launched and in flight");

  // Call quest_ask_human while review is in flight (headless, so times out immediately to default)
  const tool = askHumanTool(pi);
  const result = await tool.execute("t4", { question: "Approve implementation?", default: "proceed" }, undefined, undefined, ctx);
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "default", "timed out to default");
  check(getState().phase === "drafting", "still in drafting awaiting review verdict");

  // Now the in-flight review delivers PASS
  pi.feed({
    requestId: (request!.data as Record<string, unknown>)["requestId"],
    status: "completed",
    result: { kind: "text", text: "VERDICT: PASS\nSEVERITY: NONE\n" },
  });
  await pendingReview;

  check(getState().phase === "drafting", "still held in drafting awaiting live human approval");
  check(getState().lastReview?.verdict === "PASS", "validation recorded as PASS");
  replaceState(IDLE_STATE);
});
