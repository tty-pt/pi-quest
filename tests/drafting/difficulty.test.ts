import { strictEqual, ok } from "node:assert";
import {
  evaluateQuestDifficultyHeuristic,
  parseJevDifficultyChoice,
  callJevDifficultyJudge,
  evaluateQuestDifficulty,
} from "../../src/drafting/difficulty.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";

Deno.test("difficulty heuristic: structural signals only, no keyword vocabulary", () => {
  // Many distinct files => complex.
  strictEqual(
    evaluateQuestDifficultyHeuristic(
      "Update handlers across src/a.ts, src/b.ts, src/c.ts, and src/d.ts to support new interface",
    ),
    "complex",
  );
  // Wording never changes the tier in any language: keywords are the judge's job.
  strictEqual(evaluateQuestDifficultyHeuristic("Architectural overhaul of state engine"), "standard");
  strictEqual(evaluateQuestDifficultyHeuristic("Corrigir erro de digitação no README"), "standard");
  strictEqual(evaluateQuestDifficultyHeuristic("Fix typo in README.md"), "standard");
  strictEqual(evaluateQuestDifficultyHeuristic("Implement search filter for playlist view"), "standard");
});

Deno.test("difficulty judge: parseJevDifficultyChoice parses documented and fallback structures", () => {
  // Documented keyed structure
  const docResp = {
    answers: {
      quest_difficulty: {
        type: "choice",
        choice: "trivial",
        confidence: 0.95,
      },
    },
  };
  strictEqual(parseJevDifficultyChoice(docResp), "trivial");

  const complexResp = {
    answers: {
      quest_difficulty: {
        type: "choice",
        choice: "complex",
        confidence: 0.99,
      },
    },
  };
  strictEqual(parseJevDifficultyChoice(complexResp), "complex");

  const standardResp = {
    answers: {
      difficulty: {
        type: "choice",
        choice: "standard",
        confidence: 0.91,
      },
    },
  };
  strictEqual(parseJevDifficultyChoice(standardResp), "standard");

  // Fallback array structure
  const arrResp = {
    answers: [
      { id: "quest_difficulty", choice: "trivial" },
    ],
  };
  strictEqual(parseJevDifficultyChoice(arrResp), "trivial");

  // Malformed rejection
  try {
    parseJevDifficultyChoice({ answers: { quest_difficulty: { choice: "unknown_tier" } } });
    ok(false, "Should have thrown for unknown tier");
  } catch (err: unknown) {
    ok(String(err).includes("Invalid Jev quest difficulty answer"));
  }
});

Deno.test("difficulty judge: mock server validates request payload and extracts choice", async () => {
  let receivedHeader = "";
  let receivedBody: Record<string, unknown> = {};

  const server = Deno.serve({ port: 0 }, async (req) => {
    receivedHeader = req.headers.get("Authorization") || "";
    receivedBody = await req.json();

    return new Response(JSON.stringify({
      model: "qwen",
      answers: {
        quest_difficulty: {
          type: "choice",
          choice: "trivial",
          confidence: 0.96,
        },
      },
    }), {
      headers: { "Content-Type": "application/json" },
    });
  });

  const port = server.addr.port;
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "systemone",
    judgeUrl: `http://127.0.0.1:${port}`,
    judgeModel: "qwen",
    judgeKey: "test-auth-key",
  };

  try {
    const difficulty = await callJevDifficultyJudge("Fix typo in docs", cfg);
    strictEqual(difficulty, "trivial");
    strictEqual(receivedHeader, "Bearer test-auth-key");
    strictEqual(receivedBody["model"], "qwen");
    strictEqual(receivedBody["state"], "User: Fix typo in docs");
    ok((receivedBody["questions"] as Record<string, unknown>)?.["quest_difficulty"]);
  } finally {
    await server.shutdown();
  }
});

Deno.test("difficulty judge: evaluateQuestDifficulty respects mode, offline fallback, and default policies", async () => {
  // 1. Off mode
  const offCfg: QuestConfig = { ...DEFAULT_CONFIG, difficultyMode: "off", defaultDifficulty: "standard" };
  const resOff = await evaluateQuestDifficulty("Fix typo in README", offCfg);
  strictEqual(resOff.difficulty, "standard");
  strictEqual(resOff.source, "default");

  // 2. Pure heuristic mode
  const heurCfg: QuestConfig = { ...DEFAULT_CONFIG, difficultyMode: "heuristic" };
  const resHeurTrivial = await evaluateQuestDifficulty("Fix typo in README", heurCfg);
  strictEqual(resHeurTrivial.difficulty, "standard");
  strictEqual(resHeurTrivial.source, "heuristic");

  const resHeurComplex = await evaluateQuestDifficulty("Touch src/a.ts src/b.ts src/c.ts src/d.ts", heurCfg);
  strictEqual(resHeurComplex.difficulty, "complex");
  strictEqual(resHeurComplex.source, "heuristic");

  // 3. Fallback on network failure in auto mode
  const downCfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    difficultyMode: "auto",
    judgeUrl: "http://127.0.0.1:59998", // Unreachable port
    judgeTimeoutMs: 100,
  };

  const resFallback = await evaluateQuestDifficulty("Fix typo in README", downCfg);
  strictEqual(resFallback.difficulty, "standard");
  strictEqual(resFallback.degraded, true);
  strictEqual(resFallback.source, "heuristic");

  // 4. Fallback on network failure in judge mode with skip
  const judgeSkipCfg: QuestConfig = {
    ...downCfg,
    difficultyMode: "judge",
    judgeFallback: "skip",
    defaultDifficulty: "standard",
  };
  const resSkip = await evaluateQuestDifficulty("Fix typo in README", judgeSkipCfg);
  strictEqual(resSkip.difficulty, "standard");
  strictEqual(resSkip.degraded, true);
  strictEqual(resSkip.source, "default");
});
