import { strictEqual } from "node:assert";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { evaluateQuestDifficulty, evaluateQuestDifficultyHeuristic } from "../../src/drafting/difficulty.ts";

Deno.test("evaluateQuestDifficultyHeuristic calculates difficulty correctly based on file count", () => {
  const promptStandard = "Fix the bug in src/main.c and src/utils.c";
  strictEqual(evaluateQuestDifficultyHeuristic(promptStandard), "standard");

  const promptComplex = "Refactor components across src/a.c, src/b.c, src/c.c, and src/d.c";
  strictEqual(evaluateQuestDifficultyHeuristic(promptComplex), "complex");
});

Deno.test("evaluateQuestDifficulty uses embeddings and falls back to structural heuristic", async () => {
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "off",
  };

  const res1 = await evaluateQuestDifficulty("Refactor src/a.c, src/b.c, src/c.c, and src/d.c", cfg);
  strictEqual(res1.difficulty, "complex");
  strictEqual(res1.source, "heuristic");

  const res2 = await evaluateQuestDifficulty("Quick typo in README.md", cfg);
  strictEqual(res2.difficulty, "standard");
  strictEqual(res2.source, "heuristic");
});
