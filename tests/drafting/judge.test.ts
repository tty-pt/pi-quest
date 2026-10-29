import { strictEqual } from "node:assert";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { evaluateQuestIntent } from "../../src/drafting/judge.ts";

Deno.test("evaluateQuestIntent respects judgeMode off, heuristic, and fallback policies", async () => {
  // 1. Off mode
  const offCfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "off" };
  const resOff = await evaluateQuestIntent("Fix the critical memory leak", offCfg);
  strictEqual(resOff.isQuest, false);
  strictEqual(resOff.source, "heuristic");

  // 2. Explicit heuristic mode
  const heurCfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "heuristic" };
  const resHeur1 = await evaluateQuestIntent("# Quest: fix the corm_open leak", heurCfg);
  strictEqual(resHeur1.isQuest, true);
  strictEqual(resHeur1.source, "heuristic");
  const resHeurFree = await evaluateQuestIntent("Fix the corm_open leak in libcorm", heurCfg);
  strictEqual(resHeurFree.isQuest, false);

  const resHeur2 = await evaluateQuestIntent("I spoke to my grandfather under the cherry tree", heurCfg);
  strictEqual(resHeur2.isQuest, false);
  strictEqual(resHeur2.source, "heuristic");

  // 3. Fallback when embeddings are off or unavailable
  const downCfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "off",
    judgeFallback: "heuristic",
  };

  const resFallback = await evaluateQuestIntent("# Quest: fix the corm_open leak", downCfg);
  strictEqual(resFallback.isQuest, true);
  strictEqual(resFallback.degraded, true);
  strictEqual(resFallback.source, "heuristic");

  const skipDownCfg: QuestConfig = {
    ...downCfg,
    judgeFallback: "skip",
  };
  const resSkip = await evaluateQuestIntent("Fix the corm_open leak in libcorm", skipDownCfg);
  strictEqual(resSkip.isQuest, false);
  strictEqual(resSkip.degraded, true);
});
