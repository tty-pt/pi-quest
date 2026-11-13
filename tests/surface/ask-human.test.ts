import { check } from "../check.ts";
import { getState, replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { askHumanTool } from "../../src/surface/tools/ask-human.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

async function settingsCwd(settings: unknown): Promise<string> {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/.pi`, { recursive: true });
  await Deno.writeTextFile(`${dir}/.pi/settings.json`, JSON.stringify({ "pi-quest": settings }));
  return dir;
}

Deno.test("quest_ask_human asks via the input provider", async () => {
  replaceState(createQuest("work", "abc123"));
  const cwd = await settingsCwd({});
  const pi = fakePi();
  const ctx = fakeCtx(cwd, [], { input: async () => "green" });
  const withUI: typeof ctx = { ...ctx, hasUI: true };
  const result = await askHumanTool(pi).execute("t1", { question: "Which color?", default: "blue" }, undefined, undefined, withUI);
  const text = result.content.map((c) => c.text ?? "").join("\n");
  check(text.includes('Human answered: "green"'), "user answer reported");
  const details = result.details as Record<string, unknown>;
  check(details["provider"] === "input", "provider reported");
  check(details["answer"] === "green" && details["source"] === "user", "answer details");
  check(details["uiPresent"] === true, "ui presence reported");
  check(getState().humanAnswers.length === 1, "answer recorded");
  replaceState(IDLE_STATE);
});

Deno.test("quest_ask_human reports absence and no UI when headless", async () => {
  replaceState(createQuest("work", "abc123"));
  const cwd = await settingsCwd({});
  const pi = fakePi();
  const ctx = fakeCtx(cwd);
  const result = await askHumanTool(pi).execute("t3", { question: "Which color?", default: "blue" }, undefined, undefined, ctx);
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "default", "no UI defaults");
  check(details["provider"] === "input", "provider reported");
  check(details["uiPresent"] === false, "ui presence reported false without a UI");
  const text = result.content.map((c) => c.text ?? "").join("\n");
  check(text.includes("absence"), "absence surfaced in text");
  replaceState(IDLE_STATE);
});

Deno.test("quest_ask_human honors the settings timeout without an explicit one", async () => {
  replaceState(createQuest("work", "abc123"));
  const cwd = await settingsCwd({ askTimeoutMs: 50 });
  const pi = fakePi();
  const ctx = fakeCtx(cwd, [], { input: () => new Promise<never>(() => {}) });
  const withUI: typeof ctx = { ...ctx, hasUI: true };
  const result = await askHumanTool(pi).execute("t2", { question: "Which color?", default: "blue" }, undefined, undefined, withUI);
  const text = result.content.map((c) => c.text ?? "").join("\n");
  check(text.includes('proceeding with default: "blue"'), "settings timeout lapses to default");
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "default", "source is default");
  check(getState().humanAnswers.length === 1, "default recorded");
  replaceState(IDLE_STATE);
});

Deno.test("quest_ask_human renderCall prints plain analysis text directly before question", async () => {
  const dir = await Deno.makeTempDir();
  const qid = "rend01" as Qid;
  const draftDoc = [
    "## Requirements",
    "- req 1",
    "",
    "## Analysis",
    "Root cause identified: off-by-one error in allocator.",
    "Fix: adjust buffer size by 1.",
    "",
    "## Implementation Plan",
    "1. Fix allocator",
    "",
  ].join("\n");
  await Deno.mkdir(`${dir}/.pi/quest/future`, { recursive: true });
  await Deno.writeTextFile(`${dir}/.pi/quest/future/${qid}.md`, draftDoc);

  const drafting = createDraft(createQuest("fix bug", qid), "fix bug");
  replaceState(drafting);
  const pi = fakePi();
  const tool = askHumanTool(pi);

  check(tool.renderShell === "self", "renderShell is self to avoid boxed wrapping");
  check(typeof tool.renderCall === "function", "renderCall is defined");

  const component = tool.renderCall!({ question: "Approve implementation?" }, undefined, { cwd: dir });
  check(component !== undefined, "component returned");
  check(typeof component.invalidate === "function", "renderCall component has invalidate method");
  component.invalidate();
  const lines = component.render(80);
  const fullText = lines.join("\n");

  check(fullText.includes("### Analysis (Quest rend01)"), "analysis header rendered with Quest prefix");
  check(fullText.includes("Root cause identified: off-by-one error in allocator."), "analysis body line 1 rendered");
  check(fullText.includes("Fix: adjust buffer size by 1."), "analysis body line 2 rendered");
  check(fullText.includes("Approve implementation?"), "question rendered immediately after analysis");

  // Validate renderResult for operator-answered scenario
  const userResult = {
    content: [{ type: "text" as const, text: 'Human answered: "proceed"' }],
    details: { answer: "proceed", source: "user" },
  };
  const userComponent = tool.renderResult!(userResult, undefined, undefined, undefined);
  check(typeof userComponent.invalidate === "function", "userComponent has invalidate method");
  userComponent.invalidate();
  const userLines = userComponent.render(80);
  check(userLines.some((l) => l.includes('Operator answered: "proceed"')), "renderResult formats user answer");

  // Validate renderResult for timeout-to-default scenario
  const timeoutResult = {
    content: [{ type: "text" as const, text: 'No human answer (absence) — proceeding with default: "proceed"' }],
    details: { answer: "proceed", source: "default" },
  };
  const timeoutComponent = tool.renderResult!(timeoutResult, undefined, undefined, undefined);
  check(typeof timeoutComponent.invalidate === "function", "timeoutComponent has invalidate method");
  timeoutComponent.invalidate();
  const timeoutLines = timeoutComponent.render(80);
  check(timeoutLines.some((l) => l.includes('No operator answer (timeout): proceeding with default "proceed"')), "renderResult formats timeout default");

  // Validate renderResult for cancelled scenario (pressed Escape)
  const cancelResult = {
    content: [{ type: "text" as const, text: 'Operator cancelled/dismissed the question (pressed Escape). The plan was NOT approved.' }],
    details: { answer: "cancelled", source: "cancelled" },
  };
  const cancelComponent = tool.renderResult!(cancelResult, undefined, undefined, undefined);
  check(typeof cancelComponent.invalidate === "function", "cancelComponent has invalidate method");
  cancelComponent.invalidate();
  const cancelLines = cancelComponent.render(80);
  check(cancelLines.some((l) => l.includes('Operator cancelled (pressed Escape) — plan not approved')), "renderResult formats Escape cancellation");

  replaceState(IDLE_STATE);
});

Deno.test("quest_ask_human: approval question forces non-confirming default and minimum 5m timeout", async () => {
  const qid = "appr01" as Qid;
  const drafting = createDraft(createQuest("build feature", qid), "build feature");
  replaceState(drafting);
  const cwd = await settingsCwd({});
  const pi = fakePi();

  let capturedDefault = "";
  let capturedTimeout: number | undefined;

  const ctx = fakeCtx(cwd, [], {
    input: async (_title, placeholder, opts) => {
      capturedDefault = placeholder ?? "";
      capturedTimeout = opts?.timeout;
      return "hold";
    },
  });
  const withUI: typeof ctx = { ...ctx, hasUI: true };

  const result = await askHumanTool(pi).execute(
    "t_appr",
    { question: "Do you approve the implementation plan?", default: "proceed", timeoutMs: 10000 },
    undefined,
    undefined,
    withUI,
  );

  check(capturedDefault === "hold", `default answer was sanitized to hold (was "${capturedDefault}")`);
  check(capturedTimeout === 300000, `timeout was expanded to 5 minutes (was ${capturedTimeout})`);
  check(getState().phase === "drafting", "held in drafting: non-confirming default did not promote");
  replaceState(IDLE_STATE);
});

Deno.test("quest_ask_human: pressing Escape on approval cancels and plan does not go through", async () => {
  const qid = "appr02" as Qid;
  const drafting = createDraft(createQuest("build feature", qid), "build feature");
  replaceState({
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true, contentHash: "hash123" },
    lastReview: { verdict: "PASS", target: "hash123", findings: "" },
  });
  const cwd = await settingsCwd({});
  const pi = fakePi();

  const ctx = fakeCtx(cwd, [], { input: async () => undefined });
  const withUI: typeof ctx = { ...ctx, hasUI: true };

  const result = await askHumanTool(pi).execute(
    "t_esc",
    { question: "Do you approve the implementation plan?", default: "proceed" },
    undefined,
    undefined,
    withUI,
  );

  const text = result.content.map((c) => c.text ?? "").join("\n");
  check(text.includes("Operator cancelled/dismissed"), "cancelled text reported");
  check(text.includes("NOT approved"), "states not approved");
  const details = result.details as Record<string, unknown>;
  check(details["source"] === "cancelled", "source is cancelled");
  check(getState().phase === "drafting", "stays in drafting; plan did NOT go through");
  check(getState().draft?.approvedBy === null, "no approval recorded");
  replaceState(IDLE_STATE);
});

Deno.test("quest_ask_human renderCall gracefully renders question when no analysis exists", async () => {
  const dir = await Deno.makeTempDir();
  const qid = "rend02" as Qid;
  const drafting = createDraft(createQuest("fix bug", qid), "fix bug");
  replaceState(drafting);
  const pi = fakePi();
  const tool = askHumanTool(pi);

  const component = tool.renderCall!({ question: "Proceed?" }, undefined, { cwd: dir });
  check(component !== undefined, "component returned");
  check(typeof component.invalidate === "function", "renderCall component without analysis has invalidate method");
  component.invalidate();
  const lines = component.render(80);
  const fullText = lines.join("\n");

  check(fullText.includes("Proceed?"), "question rendered");
  check(!fullText.includes("### Analysis"), "no analysis header when analysis absent");
  replaceState(IDLE_STATE);
});
