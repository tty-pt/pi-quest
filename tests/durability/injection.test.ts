import { check } from "../check.ts";
import { replaceState } from "../../src/app/store.ts";
import { injectQuestContext } from "../../src/durability/injection.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import type { Pi } from "../../src/hooks/events.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import { trackReview, cancelReview } from "../../src/review/tracker.ts";

Deno.test("injection names the draft file while drafting", () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = fakePi();
  (pi as { on: unknown }).on = (event: string, handler: unknown) => {
    handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
  };
  injectQuestContext(pi as unknown as Pi);
  const drafting = createDraft(createQuest("work", "abc123"), "work");
  replaceState(drafting);
  const injected = handlers.get("before_agent_start")!({}, fakeCtx("/tmp")) as
    | { message?: { content?: unknown } }
    | undefined;
  const content = String(injected?.message?.content ?? "");
  check(content.includes("future/abc123.md"), "draft path injected");
  check(content.includes("drafting"), "phase injected");
  check(content.includes('[User Objective & Instructions]: "work"'), "objective injected");
  check(content.includes("[Pre-Question Checklist]:"), "pre-question reminder injected");
  check(content.includes("verify that all user requests"), "reminder mentions verifying user requests");
  check(content.includes("[Compliance Criteria]"), "drafting context contains compliance criteria");
  replaceState(IDLE_STATE);
  const idle = handlers.get("before_agent_start")!({}, fakeCtx("/tmp"));
  check(idle === undefined, "idle injects nothing");
});

Deno.test("injection includes active directives and running subquests in implementing", () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = fakePi();
  (pi as { on: unknown }).on = (event: string, handler: unknown) => {
    handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
  };
  injectQuestContext(pi as unknown as Pi);

  const quest = {
    ...createQuest("work", "xyz789"),
    phase: "implementing" as const,
    refinements: ["Port must be 8080", "Don't touch auth.c"],
    children: [
      { qid: "child1" as Qid, brief: "Sub task 1", status: "running" as const, findings: null, acknowledged: false },
    ],
  };
  replaceState(quest);

  const injected = handlers.get("before_agent_start")!({}, fakeCtx("/tmp")) as
    | { message?: { content?: unknown } }
    | undefined;
  const content = String(injected?.message?.content ?? "");

  check(content.includes("[Active Mid-Quest Directives - Must be satisfied]:"), "directive block injected");
  check(content.includes('[User Objective & Instructions]: "work"'), "objective injected in implementing");
  check(content.includes("Port must be 8080"), "first directive injected");
  check(content.includes("Don't touch auth.c"), "second directive injected");
  check(content.includes("spawn via quest_subquest"), "actionable tool cue injected");
  check(content.includes("[Active Sub-Quests]: child1 (Sub task 1)"), "running subquest injected");
  check(!content.includes("[Compliance Criteria]"), "slim context omits compliance criteria during implementing");
});

Deno.test("injection includes active requirements checklist in implementing when rtm present", () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = fakePi();
  (pi as { on: unknown }).on = (event: string, handler: unknown) => {
    handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
  };
  injectQuestContext(pi as unknown as Pi);

  const quest = {
    ...createQuest("work", "xyz789"),
    phase: "implementing" as const,
    rtm: [
      { id: "R1", description: "Implement auth token refresh", status: "satisfied" as const },
      { id: "R2", description: "Add CSRF protection", status: "pending" as const },
    ],
  };
  replaceState(quest);

  const injected = handlers.get("before_agent_start")!({}, fakeCtx("/tmp")) as
    | { message?: { content?: unknown } }
    | undefined;
  const content = String(injected?.message?.content ?? "");

  check(content.includes("[Active Requirements Checklist]:"), "rtm checklist injected");
  check(content.includes("[x] R1: Implement auth token refresh"), "satisfied R1 with [x]");
  check(content.includes("[ ] R2: Add CSRF protection"), "pending R2 with [ ]");
});

Deno.test("injection injects review running directive when review is in flight", () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = fakePi();
  (pi as { on: unknown }).on = (event: string, handler: unknown) => {
    handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
  };
  injectQuestContext(pi as unknown as Pi);

  const quest = createQuest("work", "rev123" as Qid);
  quest.phase = "drafting";
  replaceState(quest);

  trackReview("rev123", "target1", () => {});
  try {
    const injected = handlers.get("before_agent_start")!({}, fakeCtx("/tmp")) as
      | { message?: { content?: unknown } }
      | undefined;
    const content = String(injected?.message?.content ?? "");
    check(content.includes("[IN-FLIGHT REVIEW RUNNING]:"), "in-flight notice injected");
    check(content.includes("Yield immediately and wait for the review verdict"), "yields on review");
    check(content.includes("[Conversational Priority]:"), "conversational priority injected");

    const sysEvent = { systemPromptOptions: { sections: {} as Record<string, string> } };
    const sysInjected = handlers.get("before_agent_start")!(sysEvent, fakeCtx("/tmp"));
    check(sysInjected === undefined, "returns undefined when systemPromptOptions present");
    check(Boolean(sysEvent.systemPromptOptions.sections["quest_context"]?.includes("rev123")), "populates quest_context section");
  } finally {
    cancelReview("rev123");
    replaceState(IDLE_STATE);
  }
});

Deno.test("injection injects explicit [PI-QUEST PAUSED] directive when paused", () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = fakePi();
  (pi as { on: unknown }).on = (event: string, handler: unknown) => {
    handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
  };
  injectQuestContext(pi as unknown as Pi);

  const pausedQuest = {
    ...createQuest("work", "paused1" as Qid),
    phase: "drafting" as const,
    disabled: true,
  };
  replaceState(pausedQuest);

  try {
    const injected = handlers.get("before_agent_start")!({}, fakeCtx("/tmp")) as
      | { message?: { content?: unknown } }
      | undefined;
    const content = String(injected?.message?.content ?? "");
    check(content.includes("[PI-QUEST PAUSED]:"), "paused notice injected");
    check(content.includes("Do NOT call quest_* tools"), "explicitly forbids calling quest tools while paused");
    check(content.includes("paused1"), "mentions paused quest id");

    const sysEvent = { systemPromptOptions: { sections: {} as Record<string, string> } };
    const sysInjected = handlers.get("before_agent_start")!(sysEvent, fakeCtx("/tmp"));
    check(sysInjected === undefined, "returns undefined when systemPromptOptions present");
    check(Boolean(sysEvent.systemPromptOptions.sections["quest_context"]?.includes("[PI-QUEST PAUSED]")), "populates quest_context section with paused notice");
  } finally {
    replaceState(IDLE_STATE);
  }
});



