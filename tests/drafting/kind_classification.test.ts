import assert from "node:assert";
import { KIND_EXEMPLARS, QUEST_KINDS } from "../../src/drafting/kind-exemplars.ts";
import { classifyQuestKindByEmbedding, evaluateQuestKind } from "../../src/drafting/judge.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { assertCompletionEligibility } from "../../src/validation/evidence-gate.ts";
import { createQuest } from "../../src/domain/quest.ts";

Deno.test("kind_classification: KIND_EXEMPLARS covers all quest kinds", () => {
  assert.ok(QUEST_KINDS.has("bugfix"));
  assert.ok(QUEST_KINDS.has("feature"));
  assert.ok(QUEST_KINDS.has("refactor"));
  assert.ok(QUEST_KINDS.has("docs"));
  assert.ok(QUEST_KINDS.has("analysis"));
  assert.ok(QUEST_KINDS.has("standard"));
  assert.strictEqual(QUEST_KINDS.size, 6);

  for (const kind of QUEST_KINDS) {
    assert.ok(Array.isArray(KIND_EXEMPLARS[kind]));
    assert.ok(KIND_EXEMPLARS[kind].length >= 3);
  }
});

Deno.test("kind_classification: evaluateQuestKind falls back to standard when judgeMode is off", async () => {
  const offCfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "off",
  };
  const res = await evaluateQuestKind("Fix the critical bug", offCfg);
  assert.strictEqual(res, "standard");
});

Deno.test("kind_classification: assertCompletionEligibility relaxes binary test commands for docs quests", async () => {
  const docsQuest = createQuest("Update documentation", "QDOCS1", null, "trivial", "docs");

  // Case 1: Docs quest with modified files -> passes without test receipts!
  await assertCompletionEligibility(docsQuest, {
    getDiffStat: () => Promise.resolve("README.md | 5 +++--"),
    getLatestTest: () => null,
  });

  // Case 2: Docs quest with NO modified files -> throws completion blocked error!
  let threw = false;
  try {
    await assertCompletionEligibility(docsQuest, {
      getDiffStat: () => Promise.resolve(""),
      getLatestTest: () => null,
    });
  } catch (err: unknown) {
    threw = true;
    assert.ok((err as Error).message.includes("No files have been modified"));
  }
  assert.ok(threw, "Expected empty diff to throw on docs quest");
});
