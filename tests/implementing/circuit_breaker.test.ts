import { IDLE_STATE, recordAdvisoryNote, resetTestFailures, disengageCircuitBreaker, type QuestState } from "../../src/domain/quest.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { decide } from "../../src/domain/gates.ts";

function check(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`CHECK FAILED: ${msg}`);
}

Deno.test("circuit breaker: trips after 2 consecutive test failures", () => {
  let state: QuestState = {
    ...IDLE_STATE,
    phase: "implementing",
    qid: "1xTest" as Qid,
  };

  check(!state.circuitBreakerActive, "initial breaker is inactive");
  check(state.consecutiveTestFailures === 0, "initial consecutive failures is 0");

  // First test failure
  state = recordAdvisoryNote(state, "Test failed: npm test", ["Exit code 1"], true);
  check(state.consecutiveTestFailures === 1, "failures incremented to 1");
  check(!state.circuitBreakerActive, "breaker still inactive after 1 failure");

  // Second test failure
  state = recordAdvisoryNote(state, "Test failed: npm test", ["Exit code 1"], true);
  check(state.consecutiveTestFailures === 2, "failures incremented to 2");
  check(state.circuitBreakerActive === true, "breaker tripped after 2 failures");

  // Mutating tools blocked
  const writeDec = decide(state, { toolName: "write", toolClass: "write", path: "src/foo.c" });
  check(!writeDec.allowed, "write blocked while breaker active");
  if (!writeDec.allowed) {
    check(writeDec.phaseName === "CIRCUIT_BREAKER_ACTIVE", "blocked reason is CIRCUIT_BREAKER_ACTIVE");
  }

  const editDec = decide(state, { toolName: "edit", toolClass: "write", path: "src/foo.c" });
  check(!editDec.allowed, "edit blocked while breaker active");

  // Read tools permitted
  const readDec = decide(state, { toolName: "read", toolClass: "read", path: "src/foo.c" });
  check(readDec.allowed, "read permitted while breaker active");

  // Journal tools permitted (to update state / diagnose)
  const journalDec = decide(state, { toolName: "quest_update_state", toolClass: "journal" });
  check(journalDec.allowed, "journal permitted while breaker active");

  // Disengage
  state = disengageCircuitBreaker(state);
  check(!state.circuitBreakerActive, "breaker disengaged");

  const writeDecAfter = decide(state, { toolName: "write", toolClass: "write", path: "src/foo.c" });
  check(writeDecAfter.allowed, "write permitted after disengage");
});

Deno.test("circuit breaker: resetTestFailures clears counter and active flag", () => {
  let state: QuestState = {
    ...IDLE_STATE,
    phase: "implementing",
    qid: "1xTest" as Qid,
    consecutiveTestFailures: 3,
    circuitBreakerActive: true,
  };

  state = resetTestFailures(state);
  check(state.consecutiveTestFailures === 0, "failures reset to 0");
  check(!state.circuitBreakerActive, "breaker reset to false");
});
