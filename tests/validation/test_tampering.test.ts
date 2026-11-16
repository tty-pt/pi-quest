import { detectTestTampering, assertCompletionEligibility } from "../../src/validation/evidence-gate.ts";
import { IDLE_STATE, type QuestState } from "../../src/domain/quest.ts";
import type { Qid } from "../../src/domain/qid.ts";

function check(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`CHECK FAILED: ${msg}`);
}

Deno.test("test tampering: catches commented-out assertions in test files", () => {
  const diff = `diff --git a/tests/unit/test_engine.c b/tests/unit/test_engine.c
--- a/tests/unit/test_engine.c
+++ b/tests/unit/test_engine.c
@@ -10,3 +10,3 @@
-  assert(engine != NULL);
+  // assert(engine != NULL);
`;

  const violations = detectTestTampering(diff);
  check(violations.length === 1, "caught 1 violation");
  check(violations[0].includes("commented out"), "violation mentions commented out assertion");
});

Deno.test("test tampering: catches deleted assertions without replacement in test files", () => {
  const diff = `diff --git a/tests/api.test.ts b/tests/api.test.ts
--- a/tests/api.test.ts
+++ b/tests/api.test.ts
@@ -20,4 +20,1 @@
-  expect(res.status).toBe(200);
-  expect(res.body.ok).toBe(true);
-  check(res.data.valid, "is valid");
+  console.log("running test");
`;

  const violations = detectTestTampering(diff);
  check(violations.length === 1, "caught deleted assertions");
  check(violations[0].includes("deleted without replacement"), "violation mentions deletion");
});

Deno.test("test tampering: allows refactored assertions with replacement", () => {
  const diff = `diff --git a/tests/api.test.ts b/tests/api.test.ts
--- a/tests/api.test.ts
+++ b/tests/api.test.ts
@@ -20,2 +20,2 @@
-  expect(res.status).toBe(200);
+  expect(res.status).toBe(201);
`;

  const violations = detectTestTampering(diff);
  check(violations.length === 0, "refactored assertion allowed");
});

Deno.test("test tampering: ignores non-test files", () => {
  const diff = `diff --git a/src/engine.c b/src/engine.c
--- a/src/engine.c
+++ b/src/engine.c
@@ -5,2 +5,1 @@
-  assert(ptr != NULL);
+  /* removed internal runtime assert */
`;

  const violations = detectTestTampering(diff);
  check(violations.length === 0, "non-test file changes ignored");
});

Deno.test("test tampering: assertCompletionEligibility blocks completion when tampering detected", async () => {
  const state: QuestState = {
    ...IDLE_STATE,
    phase: "implementing",
    qid: "1xDone" as Qid,
    difficulty: "standard",
  };

  const badDiff = `diff --git a/tests/foo.test.ts b/tests/foo.test.ts
--- a/tests/foo.test.ts
+++ b/tests/foo.test.ts
@@ -1,2 +1,2 @@
-  assert(x === 1);
+  // assert(x === 1);
`;

  let threw = false;
  try {
    await assertCompletionEligibility(state, {
      getDiffStat: async () => "1 file changed, 1 insertion(+), 1 deletion(-)",
      getDiffPatch: async () => badDiff,
      getLatestTest: () => ({ command: "npm test", exitCode: 0, tailOutput: "passed" }),
    });
  } catch (err: unknown) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    check(msg.includes("Test integrity violation"), "threw test integrity error");
  }
  check(threw, "assertCompletionEligibility threw on tampered test");
});
