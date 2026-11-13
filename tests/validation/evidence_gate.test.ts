import { SITE_LINT_RULES } from "../lint-rules.ts";
import { check } from "../check.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { createQuest, type QuestState } from "../../src/domain/quest.ts";
import { assertCompletionEligibility, isTestCommand, type VerificationReceipt } from "../../src/validation/evidence-gate.ts";
import type { SubQuestContract } from "../../src/domain/contract.ts";
import { encodeSnapshot, decodeSnapshot } from "../../src/durability/snapshots.ts";

const QID = "test01" as Qid;

Deno.test("assertCompletionEligibility rejects if unfinished children exist", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.children = [
    { qid: "child1" as Qid, brief: "Child 1", status: "running", findings: null, acknowledged: false },
  ];

  let threw = false;
  let errMsg = "";
  try {
    await assertCompletionEligibility(quest, {
      getDiffStat: async () => "1 file changed",
      getLatestTest: () => ({ command: "make test", exitCode: 0, tailOutput: "ok" }),
    });
  } catch (err) {
    threw = true;
    errMsg = (err as Error).message;
  }

  check(threw, "threw on running children");
  check(errMsg.includes("unfinished children child1"), "error message names child");
});

Deno.test("assertCompletionEligibility rejects standard quest if zero files modified", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";

  let threw = false;
  let errMsg = "";
  try {
    await assertCompletionEligibility(quest, {
      getDiffStat: async () => "",
      getLatestTest: () => ({ command: "make test", exitCode: 0, tailOutput: "ok" }),
    });
  } catch (err) {
    threw = true;
    errMsg = (err as Error).message;
  }

  check(threw, "threw on empty diff");
  check(errMsg.includes("No files have been modified"), "names no files modified");
});

Deno.test("assertCompletionEligibility rejects standard quest if no test run", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";

  let threw = false;
  let errMsg = "";
  try {
    await assertCompletionEligibility(quest, {
      getDiffStat: async () => "mods/song/parser.c | 5 +++++\n 1 file changed",
      getLatestTest: () => null,
    });
  } catch (err) {
    threw = true;
    errMsg = (err as Error).message;
  }

  check(threw, "threw on no test receipt");
  check(errMsg.includes("No build/test verification command was executed"), "names missing verification");
});

Deno.test("assertCompletionEligibility rejects standard quest if test failed", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";

  let threw = false;
  let errMsg = "";
  try {
    await assertCompletionEligibility(quest, {
      getDiffStat: async () => "mods/song/parser.c | 5 +++++\n 1 file changed",
      getLatestTest: () => ({ command: "make test", exitCode: 2, tailOutput: "FAIL: syntax error" }),
    });
  } catch (err) {
    threw = true;
    errMsg = (err as Error).message;
  }

  check(threw, "threw on failed test");
  check(errMsg.includes("last test execution failed (exit code 2)"), "names exit code");
});

Deno.test("assertCompletionEligibility allows standard quest with modified files and passing tests", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";

  await assertCompletionEligibility(quest, {
    getDiffStat: async () => "mods/song/parser.c | 5 +++++\n 1 file changed",
    getLatestTest: () => ({ command: "make test", exitCode: 0, tailOutput: "All 10 tests passed" }),
  });
  // No exception thrown
});

Deno.test("assertCompletionEligibility accommodates analysis quest without file diff or test run", async () => {
  const quest = createQuest("Analysis task", QID);
  quest.phase = "implementing";
  quest.kind = "analysis";

  await assertCompletionEligibility(quest, {
    getDiffStat: async () => "",
    getLatestTest: () => null,
  });
  // No exception thrown for analysis quest
});

Deno.test("assertCompletionEligibility accommodates trivial quest with clean tree and no test run", async () => {
  const quest = createQuest("Trivial chore", QID, null, "trivial");
  quest.phase = "implementing";
  quest.kind = "standard";

  await assertCompletionEligibility(quest, {
    getDiffStat: async () => "",
    getLatestTest: () => null,
  });
  // No exception thrown for trivial difficulty quest even with clean tree
});

Deno.test("isTestCommand matches custom commands specified in contract.requiredTestCommands", () => {
  check(isTestCommand("make test"), "standard make test recognized");
  check(isTestCommand("deno test tests/"), "standard deno test recognized");
  check(!isTestCommand("./custom-check.py"), "arbitrary script not recognized by default");

  const contract: SubQuestContract = {
    qid: "sub1" as Qid,
    parentQid: "root1" as Qid,
    title: "Sub",
    assignedRequirements: [],
    allowedPaths: [],
    requiredTestCommands: ["./custom-check.py", "python -m unittest"],
    acceptanceCriteria: [],
  };

  check(isTestCommand("./custom-check.py", contract), "contract required command recognized");
  check(isTestCommand("python -m unittest discover", contract), "substring match in required command recognized");
});

Deno.test("lastTestReceipt survives encodeSnapshot and decodeSnapshot roundtrip", () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  const receipt: VerificationReceipt = {
    command: "./test.sh",
    exitCode: 0,
    tailOutput: "PASS",
    executedAt: 12345678,
  };
  quest.lastTestReceipt = receipt;

  const encoded = encodeSnapshot(quest);
  const decoded = decodeSnapshot(encoded);
  check(decoded !== null, "decoded successfully");
  check(decoded?.lastTestReceipt !== undefined, "lastTestReceipt present in decoded");
  check(decoded?.lastTestReceipt?.command === "./test.sh", "command preserved");
  check(decoded?.lastTestReceipt?.exitCode === 0, "exitCode preserved");
  check(decoded?.lastTestReceipt?.tailOutput === "PASS", "tailOutput preserved");
});

Deno.test("assertCompletionEligibility uses state.lastTestReceipt if available", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";
  quest.lastTestReceipt = {
    command: "make test",
    exitCode: 0,
    tailOutput: "OK",
  };

  await assertCompletionEligibility(quest, {
    getDiffStat: async () => "file.c | 1 +",
  });
  // passes without throwing because state.lastTestReceipt was used
});

Deno.test("assertCompletionEligibility rejects if semantic lint violations are detected", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";
  quest.lastTestReceipt = {
    command: "make test",
    exitCode: 0,
    tailOutput: "OK",
  };

  const badPatch = `
diff --git a/mods/song/ux/song.c b/mods/song/ux/song.c
--- a/mods/song/ux/song.c
+++ b/mods/song/ux/song.c
@@ -10,2 +10,3 @@
+#ifdef __wasm__
`;

  let threw = false;
  let errMsg = "";
  try {
    await assertCompletionEligibility(quest, {
      getDiffStat: async () => "mods/song/ux/song.c | 1 +",
      getDiffPatch: async () => badPatch,
      lintRules: SITE_LINT_RULES,
    });
  } catch (err) {
    threw = true;
    errMsg = (err as Error).message;
  }

  check(threw, "rejected on semantic lint violation");
  check(errMsg.includes("Semantic boundary violation"), "error mentions boundary violation");
  check(errMsg.includes("no-ux-compile-branch"), "error mentions specific ruleId");
});



Deno.test("isTestCommand matches runner tokens, not words anywhere in the command line", () => {
  check(isTestCommand("npm --prefix pkg test"), "npm test with flags");
  check(isTestCommand("cd x && make -j4"), "make after cd");
  check(isTestCommand("CI=1 pytest -q"), "env prefix");
  check(isTestCommand("./test"), "./test script");
  check(isTestCommand("cargo test --release | tail"), "cargo test in a pipeline");
  check(!isTestCommand('git commit -m "make it work"'), "make inside a commit message");
  check(!isTestCommand("echo test"), "the word test alone");
  check(!isTestCommand("npm install"), "npm install is not a test");
  check(isTestCommand("./ci-run.sh", undefined, ["./ci-run.sh"]), "operator testCommands extend the set");
});

Deno.test("isTestCommand matches targeted test scripts, check scripts, and unit runners", () => {
  check(isTestCommand("sh tests/unit/run-test-lamina-bridge.sh"), "sh run-test script recognized");
  check(isTestCommand("sh scripts/check-module-boundaries.sh"), "sh check script recognized");
  check(isTestCommand("./scripts/check-no-site-specific-js.sh"), "direct check script recognized");
  check(isTestCommand("node tests/unit/test-lamina-bridge-routing.mjs"), "node test script recognized");
  check(isTestCommand("bash tests/pages/10-pages-render.sh"), "pages test script recognized");
  check(isTestCommand("make site-wasm"), "make target recognized");
  check(isTestCommand("make test-mod MOD=song"), "make test-mod recognized");
  check(isTestCommand("make test-fast"), "make test-fast recognized");
  check(!isTestCommand("cat tests/unit/run-test-lamina-bridge.sh"), "cat of test file not recognized as runner");
  check(!isTestCommand("git diff scripts/check-module-boundaries.sh"), "git diff not recognized as runner");
});

Deno.test("assertCompletionEligibility accepts lastPassingTestReceipt if executed after file modifications", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";
  quest.lastFileModifiedAt = 1000;
  quest.lastPassingTestReceipt = {
    command: "make test-mod MOD=song",
    exitCode: 0,
    tailOutput: "OK",
    executedAt: 2000,
  };

  // Latest test is a failing out-of-scope command
  await assertCompletionEligibility(quest, {
    getDiffStat: async () => "file.c | 1 +",
    getLatestTest: () => ({
      command: "make test",
      exitCode: 1,
      tailOutput: "Unrelated flake",
      executedAt: 3000,
    }),
  });
  // Completes cleanly because passing test was executed at 2000 > modified at 1000
});

Deno.test("assertCompletionEligibility rejects superficial single-file touch when multi-requirement plan exists", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";
  quest.difficulty = "major";
  quest.rtm = [
    { id: "R1", description: "First req", status: "pending" },
    { id: "R2", description: "Second req", status: "pending" },
    { id: "R3", description: "Third req", status: "pending" },
  ];

  let threw = false;
  let errMsg = "";
  try {
    await assertCompletionEligibility(quest, {
      getDiffStat: async () => "mods/song/parser.c | 1 +\n 1 file changed",
      getDiffPatch: async () => "+x",
      getLatestTest: () => ({ command: "make test", exitCode: 0, tailOutput: "ok" }),
    });
  } catch (err) {
    threw = true;
    errMsg = (err as Error).message;
  }

  check(threw, "threw on superficial touch with 3 requirements");
  check(errMsg.includes("Implementation depth check failed"), "mentions implementation depth");
});

Deno.test("assertCompletionEligibility allows multi-requirement task when substantive diff is present", async () => {
  const quest = createQuest("Task", QID);
  quest.phase = "implementing";
  quest.kind = "standard";
  quest.difficulty = "major";
  quest.rtm = [
    { id: "R1", description: "First req", status: "pending" },
    { id: "R2", description: "Second req", status: "pending" },
    { id: "R3", description: "Third req", status: "pending" },
  ];

  await assertCompletionEligibility(quest, {
    getDiffStat: async () => "mods/song/parser.c | 50 +++\nmods/song/test.c | 20 ++\n 2 files changed",
    getDiffPatch: async () => "diff --git a/mods/song/parser.c b/mods/song/parser.c\n+ substantive implementation text here with multiple lines and functions",
    getLatestTest: () => ({ command: "make test", exitCode: 0, tailOutput: "ok" }),
  });
  // No exception thrown
});

