import { check } from "../check.ts";
import { createQuest } from "../../src/domain/quest.ts";
import { createDraft, promote } from "../../src/domain/transitions.ts";
import { validationBrief } from "../../src/validation/flow.ts";
import { fakeCtx } from "../fake-pi.ts";
import { replaceState } from "../../src/app/store.ts";

Deno.test("promote: persists rtm onto QuestState", () => {
  const quest = createQuest("Implement features", "testQid");
  const draft = createDraft(quest, "testDraft");
  const withPlan = {
    ...draft,
    draft: {
      ...draft.draft!,
      planAuthored: true,
      contentHash: "hash123",
    },
  };

  const rtm = [
    { id: "R1", description: "First requirement", status: "satisfied" as const },
    { id: "R2", description: "Second requirement", status: "pending" as const },
  ];

  const promoted = promote(withPlan, "user", rtm);
  check(promoted.phase === "implementing", "promoted to implementing");
  check(promoted.rtm !== undefined, "rtm is defined");
  check(promoted.rtm!.length === 2, "2 rtm items persisted");
  check(promoted.rtm![0].id === "R1", "R1 preserved");
  check(promoted.rtm![0].status === "satisfied", "satisfied status preserved");
});

Deno.test("validationBrief: renders rtmChecklist from state.rtm", async () => {
  const quest = createQuest("Implement features", "testQid");
  const draft = createDraft(quest, "testDraft");
  const rtm = [
    { id: "R1", description: "First requirement", status: "satisfied" as const },
    { id: "R2", description: "Second requirement", status: "pending" as const },
  ];
  const state = {
    ...promote({ ...draft, draft: { ...draft.draft!, planAuthored: true } }, "user", rtm),
    phase: "validating" as const,
  };
  replaceState(state);

  const ctx = fakeCtx("/tmp");
  const brief = await validationBrief(ctx, state);

  check(brief.rtmChecklist !== undefined, "rtmChecklist is present");
  check(brief.rtmChecklist!.includes("- [x] R1: First requirement"), "satisfied item rendered with [x]");
  check(brief.rtmChecklist!.includes("- [ ] R2: Second requirement"), "pending item rendered with [ ]");
});
