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
  const lines = component.render(80);
  const fullText = lines.join("\n");

  check(fullText.includes("### Analysis (rend01)"), "analysis header rendered");
  check(fullText.includes("Root cause identified: off-by-one error in allocator."), "analysis body line 1 rendered");
  check(fullText.includes("Fix: adjust buffer size by 1."), "analysis body line 2 rendered");
  check(fullText.includes("Approve implementation?"), "question rendered immediately after analysis");
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
  const lines = component.render(80);
  const fullText = lines.join("\n");

  check(fullText.includes("Proceed?"), "question rendered");
  check(!fullText.includes("### Analysis"), "no analysis header when analysis absent");
  replaceState(IDLE_STATE);
});
