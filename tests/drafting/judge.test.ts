import { strictEqual } from "node:assert";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { evaluateQuestIntent } from "../../src/drafting/judge.ts";

Deno.test("evaluateQuestIntent respects judgeMode off and offline fallback skip policies", async () => {
  // 1. Off mode
  const offCfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "off" };
  const resOff = await evaluateQuestIntent("Fix the critical memory leak", offCfg);
  strictEqual(resOff.isQuest, false);
  strictEqual(resOff.source, "skip");

  // 2. Offline fallback when embeddings are off or unavailable
  const downCfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "off",
  };

  const resSkip = await evaluateQuestIntent("Fix the corm_open leak in libcorm", downCfg);
  strictEqual(resSkip.isQuest, false);
  strictEqual(resSkip.degraded, true);
  strictEqual(resSkip.source, "skip");
});
