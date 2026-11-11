import { check } from "../check.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getState, replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { draftPath } from "../../src/domain/paths.ts";
import { hashContent } from "../../src/drafting/plan-text.ts";
import {
  clearVerifiedApprovals,
  isApprovalQuestion,
  validatePlanBeforeApproval,
} from "../../src/drafting/plan-approval.ts";
import { buildPlanApprovalPrompt, type ReviewMaterial } from "../../src/review/prompts.ts";
import { askHumanTool } from "../../src/surface/tools/ask-human.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

const QID = "val001" as Qid;

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

function writeSampleDraft(cwd: string, qid: Qid, plan = "1. Step one\n2. Step two"): string {
  const content = [
    "## Requirements",
    "- Requirement 1: Build user login",
    "- Requirement 2: Add password reset",
    "",
    "## Evidence",
    "- src/auth.ts:1",
    "",
    "## Implementation Plan",
    plan,
    "",
  ].join("\n");
  mkdirSync(join(cwd, ".pi", "quest", "future"), { recursive: true });
  writeFileSync(join(cwd, draftPath(qid)), content, "utf8");
  return hashContent(content);
}

Deno.test("isApprovalQuestion: accurately classifies approval questions vs normal questions", () => {
  const draftingState = {
    ...createDraft(createQuest("Add feature", QID), "Add feature"),
    exactNextAction: "Investigate architecture",
  };

  // Keyword in question
  check(isApprovalQuestion("Approve implementation?", draftingState), "Approve keyword detected");
  check(isApprovalQuestion("Do you approve the implementation plan?", draftingState), "approve plan detected");
  check(isApprovalQuestion("Should I proceed with the plan?", draftingState), "proceed detected");
  check(isApprovalQuestion("Can I start coding?", draftingState), "start coding detected");
  check(isApprovalQuestion("Ready to implement?", draftingState), "implement detected");

  // Affirmative default answer
  check(isApprovalQuestion("Any feedback?", draftingState, "proceed"), "affirmative default detects approval question");
  check(isApprovalQuestion("Ready?", draftingState, "yes"), "yes default detects approval question");

  // exactNextAction indicates approval
  const awaitingApprovalState = {
    ...draftingState,
    exactNextAction: "Draft validated (PASS). Present analysis summary to operator and call quest_ask_human to request implementation approval.",
  };
  check(isApprovalQuestion("What do you think?", awaitingApprovalState, "looks good"), "exactNextAction detects approval");

  // Non-approval questions
  check(!isApprovalQuestion("Which port should we use?", draftingState, "8080"), "port question is not approval");
  check(!isApprovalQuestion("Do you want dark mode or light mode?", draftingState, "dark"), "color choice is not approval");

  // Outside drafting phase
  const implementingState = {
    ...draftingState,
    phase: "implementing" as const,
  };
  check(!isApprovalQuestion("Approve implementation?", implementingState), "not approval question when implementing");

  // Idle state
  check(!isApprovalQuestion("Approve implementation?", IDLE_STATE), "not approval question when idle");
});

Deno.test("buildPlanApprovalPrompt: formats strict user request coverage instructions", () => {
  const material: ReviewMaterial = {
    objective: "Implement feature X with constraint Y",
    plan: "1. Step 1\n2. Step 2",
    requirements: ["Requirement 1", "Requirement 2"],
    evidence: ["src/a.ts:1"],
    refinements: ["Must not break backwards compatibility"],
    amendments: [],
  };
  const prompt = buildPlanApprovalPrompt(QID, "hash123", material);
  check(prompt.includes(`PLAN APPROVAL VALIDATION: ${QID}`), "header included");
  check(prompt.includes("USER REQUEST COMPLETENESS & FIDELITY"), "completeness checklist included");
  check(prompt.includes("Implement feature X with constraint Y"), "objective included");
  check(prompt.includes("ACTIVE USER DIRECTIVES / REFINEMENTS"), "directives section included");
  check(prompt.includes("Must not break backwards compatibility"), "refinement directive included");
  check(prompt.includes("VERDICT: PASS | FAIL"), "output format included");
});

Deno.test("validatePlanBeforeApproval: catches missing plan file on disk", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-missing-plan-"));
  const drafting = createDraft(createQuest("Add feature", QID), "Add feature");
  replaceState(drafting);
  const pi = busPi();
  const ctx = fakeCtx(cwd);

  const result = await validatePlanBeforeApproval(pi, ctx, getState());
  check(!result.allowed, "not allowed when plan file missing");
  check(result.verdict === "FAIL", "verdict is FAIL");
  check(Boolean(result.findings?.includes("does not exist")), "findings explain missing plan file");
  replaceState(IDLE_STATE);
});

Deno.test("validatePlanBeforeApproval: catches empty implementation plan", async () => {
  replaceState(IDLE_STATE);
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-empty-plan-"));
  const hash = writeSampleDraft(cwd, QID, "   "); // Empty plan
  const drafting = createDraft(createQuest("Add feature", QID), "Add feature");
  replaceState({ ...drafting, draft: { ...drafting.draft!, contentHash: hash } });
  const pi = busPi();
  const ctx = fakeCtx(cwd);

  const result = await validatePlanBeforeApproval(pi, ctx, getState());
  check(!result.allowed, "not allowed when plan is empty");
  check(result.verdict === "FAIL", "verdict is FAIL");
  check(Boolean(result.findings?.includes("empty")), "findings explain empty plan");
  replaceState(IDLE_STATE);
});

Deno.test("askHumanTool: fires subagent immediately before approval question and asks immediately", async () => {
  replaceState(IDLE_STATE);
  clearVerifiedApprovals();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-ask-immediate-"));
  const hash = writeSampleDraft(cwd, QID);
  const drafting = createDraft(createQuest("Add feature X and feature Y", QID), "Add feature X and feature Y");
  replaceState({
    ...drafting,
    refinements: ["User directive: Make sure feature Y has logging"],
    draft: { ...drafting.draft!, planAuthored: true, contentHash: hash },
  });

  const pi = busPi();
  let uiInputCalled: boolean = false;
  const ctx = fakeCtx(cwd, [], {
    input: async () => {
      uiInputCalled = true;
      return "proceed";
    },
  });
  const withUI = { ...ctx, hasUI: true };

  const tool = askHumanTool(pi);
  const result = await tool.execute(
    "t1",
    { question: "Approve implementation?", default: "proceed" },
    undefined,
    undefined,
    withUI,
  );

  // Question came up immediately (UI input called right away)
  check(Boolean(uiInputCalled), "UI input was called immediately without waiting for subagent");
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "user", "user answered");
  check(details["answer"] === "proceed", "proceed answer recorded");

  // Subagent request was fired immediately before the question
  for (let i = 0; i < 25 && !pi.emitted.some((e) => e.event === "prompt-template:subagent:request"); i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const subagentReq = pi.emitted.find((e) => e.event === "prompt-template:subagent:request");
  check(subagentReq !== undefined, "subagent was fired immediately before approval question");
  const taskText = String((subagentReq!.data as Record<string, unknown>)["task"]);
  check(taskText.includes("PLAN APPROVAL VALIDATION"), "task is plan approval validation");
  check(taskText.includes("Add feature X and feature Y"), "objective included in subagent prompt");
  check(taskText.includes("User directive: Make sure feature Y has logging"), "directive included in subagent prompt");

  replaceState(IDLE_STATE);
});

Deno.test("askHumanTool: subagent PASS records validation verdict and promotes", async () => {
  replaceState(IDLE_STATE);
  clearVerifiedApprovals();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-ask-pass-"));
  const hash = writeSampleDraft(cwd, QID);
  const drafting = createDraft(createQuest("Add feature X", QID), "Add feature X");
  replaceState({
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true, contentHash: hash },
  });

  const pi = busPi();
  let uiInputCalled: boolean = false;
  const ctx = fakeCtx(cwd, [], {
    input: async () => {
      uiInputCalled = true;
      return "yes, start coding";
    },
  });
  const withUI = { ...ctx, hasUI: true };

  const tool = askHumanTool(pi);
  const executePromise = tool.execute(
    "t2",
    { question: "Approve implementation?", default: "proceed" },
    undefined,
    undefined,
    withUI,
  );

  // Question came up immediately
  const result = await executePromise;
  check(Boolean(uiInputCalled), "UI input was called immediately");
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "user", "answered by user");
  check(details["answer"] === "yes, start coding", "user answer recorded");
  check(getState().phase === "implementing", "promoted to implementing on operator approval");
  check(getState().draft?.approvedBy === "user", "approved by user recorded");

  replaceState(IDLE_STATE);
});

Deno.test("askHumanTool: non-approval questions bypass subagent validation", async () => {
  replaceState(IDLE_STATE);
  clearVerifiedApprovals();
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-non-appr-"));
  writeSampleDraft(cwd, QID);
  const drafting = createDraft(createQuest("Add feature", QID), "Add feature");
  replaceState(drafting);

  const pi = busPi();
  let uiInputCalled: boolean = false;
  const ctx = fakeCtx(cwd, [], {
    input: async () => {
      uiInputCalled = true;
      return "port 8080";
    },
  });
  const withUI = { ...ctx, hasUI: true };

  const tool = askHumanTool(pi);
  const result = await tool.execute(
    "t3",
    { question: "Which port should the server listen on?", default: "8080" },
    undefined,
    undefined,
    withUI,
  );

  const subagentReq = pi.emitted.find((e) => e.event === "prompt-template:subagent:request");
  check(subagentReq === undefined, "subagent was NOT fired for non-approval question");
  check(Boolean(uiInputCalled), "UI input was called directly");
  const details = result.details as Record<string, unknown>;
  check(details["answer"] === "port 8080", "received user answer");
  replaceState(IDLE_STATE);
});
