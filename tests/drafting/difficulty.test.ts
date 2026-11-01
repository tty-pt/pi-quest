import { strictEqual } from "node:assert";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { evaluateQuestDifficulty } from "../../src/drafting/difficulty.ts";

Deno.test("evaluateQuestDifficulty falls back to configured default without embeddings", async () => {
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "off",
  };

  const res1 = await evaluateQuestDifficulty("Refactor src/a.c, src/b.c, src/c.c, and src/d.c", cfg);
  strictEqual(res1.difficulty, "standard");
  strictEqual(res1.source, "default");
  strictEqual(res1.degraded, true);

  const res2 = await evaluateQuestDifficulty("Quick typo in README.md", cfg);
  strictEqual(res2.difficulty, "standard");
  strictEqual(res2.source, "default");
});
