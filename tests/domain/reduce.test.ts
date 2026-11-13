import { assertEquals, check } from "../check.ts";

function assert(cond: boolean, msg = "assertion failed"): void {
  check(cond, msg);
}
import { IDLE_STATE } from "../../src/domain/quest.ts";
import { reduce } from "../../src/domain/reduce.ts";
import type { QuestEvent } from "../../src/domain/effects.ts";
import type { Qid } from "../../src/domain/qid.ts";

Deno.test("reduce: QuestCreated creates provisional quest and emits EmitSnapshot", () => {
  const event: QuestEvent = {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
    difficulty: "standard",
    kind: "standard",
  };
  const { state, effects } = reduce(IDLE_STATE, event);
  assertEquals(state.phase, "provisional");
  assertEquals(state.qid, "1xTEST");
  assertEquals(state.objective, "Implement unified reducer");
  assertEquals(effects.length, 1);
  assertEquals(effects[0].kind, "EmitSnapshot");
});

Deno.test("reduce: DraftCreated transitions provisional to drafting", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state, effects } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  assertEquals(state.phase, "drafting");
  assertEquals(state.draft?.name, "unified-reducer");
  assertEquals(state.draft?.planAuthored, false);
  assertEquals(effects.some((e) => e.kind === "EmitSnapshot"), true);
});

Deno.test("reduce: DraftContentChanged updates hash and planAuthored flag", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  const { state } = reduce(drafting, {
    type: "DraftContentChanged",
    contentHash: "hash123",
    planAuthored: true,
  });
  assertEquals(state.draft?.contentHash, "hash123");
  assertEquals(state.draft?.planAuthored, true);
});

Deno.test("reduce: PlanPromoted transitions standard quest to implementing", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  const { state: authored } = reduce(drafting, {
    type: "DraftContentChanged",
    contentHash: "hash123",
    planAuthored: true,
  });
  const { state: implementing, effects } = reduce(authored, {
    type: "PlanPromoted",
    approvedBy: "review",
  });
  assertEquals(implementing.phase, "implementing");
  assertEquals(implementing.draft?.approvedPlanHash, "hash123");
  assert(effects.some((e) => e.kind === "Promote"));
  assert(effects.some((e) => e.kind === "CancelReview"));
});

Deno.test("reduce: SetbackRecorded activates circuit breaker on consecutive failures", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  const { state: authored } = reduce(drafting, {
    type: "DraftContentChanged",
    contentHash: "hash123",
    planAuthored: true,
  });
  const { state: implementing } = reduce(authored, {
    type: "PlanPromoted",
    approvedBy: "review",
  });

  const { state: fail1, effects: eff1 } = reduce(implementing, {
    type: "SetbackRecorded",
    reason: "test 1 failed",
    evidence: ["exit 1"],
    isTest: true,
  });
  assertEquals(fail1.consecutiveTestFailures, 1);
  assertEquals(fail1.circuitBreakerActive, false);
  assert(eff1.some((e) => e.kind === "Steer" && e.text.includes("Setback recorded")));

  const { state: fail2, effects: eff2 } = reduce(fail1, {
    type: "SetbackRecorded",
    reason: "test 2 failed",
    evidence: ["exit 1"],
    isTest: true,
  });
  assertEquals(fail2.consecutiveTestFailures, 2);
  assertEquals(fail2.circuitBreakerActive, true);
  assert(eff2.some((e) => e.kind === "Steer" && e.text.includes("CIRCUIT BREAKER ACTIVATED")));
});

Deno.test("reduce: TestRunRecorded resets failures and circuit breaker on pass", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  const { state: authored } = reduce(drafting, {
    type: "DraftContentChanged",
    contentHash: "hash123",
    planAuthored: true,
  });
  const { state: implementing } = reduce(authored, {
    type: "PlanPromoted",
    approvedBy: "review",
  });
  const { state: fail1 } = reduce(implementing, {
    type: "SetbackRecorded",
    reason: "test failed",
    evidence: ["exit 1"],
    isTest: true,
  });
  const { state: fail2 } = reduce(fail1, {
    type: "SetbackRecorded",
    reason: "test failed again",
    evidence: ["exit 1"],
    isTest: true,
  });
  assertEquals(fail2.circuitBreakerActive, true);

  const { state: passed } = reduce(fail2, {
    type: "TestRunRecorded",
    receipt: { command: "npm test", exitCode: 0, executedAt: Date.now(), tailOutput: "ok" },
  });
  assertEquals(passed.consecutiveTestFailures, 0);
  assertEquals(passed.circuitBreakerActive, false);
  assertEquals(passed.lastPassingTestReceipt?.exitCode, 0);
});

Deno.test("reduce: FileModified records touched paths deduplicated", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: f1 } = reduce(provisional, {
    type: "FileModified",
    path: "/site/src/domain/reduce.ts",
  });
  assertEquals(f1.touchedFiles, ["/site/src/domain/reduce.ts"]);

  const { state: f2 } = reduce(f1, {
    type: "FileModified",
    path: "/site/src/domain/reduce.ts",
  });
  assertEquals(f2.touchedFiles?.length, 1);
});

Deno.test("reduce: ReviewStarted and ReviewVerdictReceived transition and emit Wake", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  const { state: inReview, effects: launchEffects } = reduce(drafting, {
    type: "ReviewStarted",
    target: "targetHash",
    reviewKind: "draft",
  });
  assertEquals(inReview.activeReview?.target, "targetHash");
  assert(launchEffects.some((e) => e.kind === "LaunchReview"));

  const { state: reviewPassed, effects: passEffects } = reduce(inReview, {
    type: "ReviewVerdictReceived",
    target: "targetHash",
    verdict: "PASS",
    findings: "",
  });
  assertEquals(reviewPassed.lastReview?.verdict, "PASS");
  assert(passEffects.some((e) => e.kind === "Wake"));
});

Deno.test("reduce: QuestDemoted transitions to drafting or implementing with appropriate effects", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  const { state: authored } = reduce(drafting, {
    type: "DraftContentChanged",
    contentHash: "hash123",
    planAuthored: true,
  });
  const { state: implementing } = reduce(authored, {
    type: "PlanPromoted",
    approvedBy: "user",
  });

  const { state: demotedToDraft, effects: demoteEff1 } = reduce(implementing, {
    type: "QuestDemoted",
    to: "drafting",
    exactNextAction: "Revise plan",
  });
  assertEquals(demotedToDraft.phase, "drafting");
  assertEquals(demotedToDraft.draft?.outstandingFindings, true);
  assertEquals(demotedToDraft.exactNextAction, "Revise plan");
  assert(demoteEff1.some((e) => e.kind === "Demote"));

  const { state: demotedToImp, effects: demoteEff2 } = reduce(
    { ...implementing, phase: "validating" },
    { type: "QuestDemoted", to: "implementing" },
  );
  assertEquals(demotedToImp.phase, "implementing");
  assert(demoteEff2.some((e) => e.kind === "Demote"));
});

Deno.test("reduce: ReviewCancelled clears active review and emits CancelReview", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xTEST" as Qid,
    objective: "Implement unified reducer",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "unified-reducer",
  });
  const { state: inReview } = reduce(drafting, {
    type: "ReviewStarted",
    target: "targetHash",
    reviewKind: "draft",
  });
  assertEquals(inReview.activeReview !== null, true);

  const { state: cancelled, effects } = reduce(inReview, {
    type: "ReviewCancelled",
    qid: "1xTEST" as Qid,
  });
  assertEquals(cancelled.activeReview, null);
  assert(effects.some((e) => e.kind === "CancelReview"));
});

Deno.test("reduce: PlanPromoted on analysis quest transitions directly to validating", () => {
  const { state: provisional } = reduce(IDLE_STATE, {
    type: "QuestCreated",
    qid: "1xANALYSIS" as Qid,
    objective: "Analyze architecture",
    kind: "analysis",
  });
  const { state: drafting } = reduce(provisional, {
    type: "DraftCreated",
    draftName: "analysis-doc",
    kind: "analysis",
  });
  const { state: authored } = reduce(drafting, {
    type: "DraftContentChanged",
    contentHash: "hash-analysis",
    planAuthored: true,
  });
  const { state: validating, effects } = reduce(authored, {
    type: "PlanPromoted",
    approvedBy: "review",
  });
  assertEquals(validating.phase, "validating");
  assertEquals(validating.draft?.approvedPlanHash, "hash-analysis");
  assert(effects.some((e) => e.kind === "Promote"));
});

Deno.test("reduce: TurnEnded emits EmitSnapshot only when snapshotPending is true", () => {
  const cleanState = { ...IDLE_STATE, snapshotPending: false };
  const { effects: cleanEffects } = reduce(cleanState, { type: "TurnEnded" });
  assertEquals(cleanEffects.length, 0);

  const pendingState = { ...IDLE_STATE, snapshotPending: true };
  const { effects: pendingEffects } = reduce(pendingState, { type: "TurnEnded" });
  assertEquals(pendingEffects.length, 1);
  assertEquals(pendingEffects[0].kind, "EmitSnapshot");
});

Deno.test("reduce: full multi-event lifecycle progression", () => {
  const events: QuestEvent[] = [
    { type: "QuestCreated", qid: "1xLIFECYCLE" as Qid, objective: "Full lifecycle test" },
    { type: "DraftCreated", draftName: "lifecycle-plan" },
    { type: "DraftContentChanged", contentHash: "hash-v1", planAuthored: true },
    { type: "PlanPromoted", approvedBy: "user" },
    { type: "FileModified", path: "/site/src/code.c" },
    { type: "TestRunRecorded", receipt: { command: "test.sh", exitCode: 0, executedAt: 1, tailOutput: "ok" } },
    { type: "CompletionClaimed" },
    { type: "QuestArchived", outcome: "COMPLETED" },
  ];

  const finalState = events.reduce((s, e) => reduce(s, e).state, IDLE_STATE);
  assertEquals(finalState.phase, "archived");
  assertEquals(finalState.archivedOutcome, "COMPLETED");
  assertEquals(finalState.qid, "1xLIFECYCLE");
  assertEquals(finalState.touchedFiles, ["/site/src/code.c"]);
  assertEquals(finalState.lastPassingTestReceipt?.exitCode, 0);
});
