import { check } from "../check.ts";
import { replaceState } from "../../src/app/store.ts";
import { injectQuestContext } from "../../src/durability/injection.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import type { Pi } from "../../src/hooks/events.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

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
  check(content.includes("Port must be 8080"), "first directive injected");
  check(content.includes("Don't touch auth.c"), "second directive injected");
  check(content.includes("spawn via quest_subquest"), "actionable tool cue injected");
  check(content.includes("[Active Sub-Quests]: child1 (Sub task 1)"), "running subquest injected");
  check(!content.includes("[Compliance Criteria]"), "slim context omits compliance criteria during implementing");
});

