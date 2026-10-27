import { strictEqual, ok } from "node:assert";
import {
  evaluateQuestDifficultyHeuristic,
  parseJevDifficultyChoice,
  callJevDifficultyJudge,
  evaluateQuestDifficulty,
} from "../../src/drafting/difficulty.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";

Deno.test("difficulty heuristic: accurately classifies trivial, standard, and complex requests", () => {
  // Trivial tasks
  strictEqual(evaluateQuestDifficultyHeuristic("Fix typo in README.md"), "trivial");
  strictEqual(evaluateQuestDifficultyHeuristic("Fix spelling mistake in documentation"), "trivial");
  strictEqual(evaluateQuestDifficultyHeuristic("Bump version to 1.3.0"), "trivial");
  strictEqual(evaluateQuestDifficultyHeuristic("Minor cleanup of comments in app.ts"), "trivial");
  strictEqual(evaluateQuestDifficultyHeuristic("quick fix in header guard"), "trivial");

  // Complex tasks
  strictEqual(evaluateQuestDifficultyHeuristic("Architectural overhaul of state engine"), "complex");
  strictEqual(evaluateQuestDifficultyHeuristic("Full migration to web HAL runtime"), "complex");
  strictEqual(evaluateQuestDifficultyHeuristic("Redesign cross-module communications and rewrite store"), "complex");
  strictEqual(
    evaluateQuestDifficultyHeuristic(
      "Update handlers across src/a.ts, src/b.ts, src/c.ts, and src/d.ts to support new interface",
    ),
    "complex",
  );

  // Standard tasks
  strictEqual(evaluateQuestDifficultyHeuristic("Implement search filter for playlist view"), "standard");
  strictEqual(evaluateQuestDifficultyHeuristic("Fix memory leak in corm_open when file not found"), "standard");
  strictEqual(evaluateQuestDifficultyHeuristic("Add pagination support to table view"), "standard");
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
  strictEqual(resHeurTrivial.difficulty, "trivial");
  strictEqual(resHeurTrivial.source, "heuristic");

  const resHeurComplex = await evaluateQuestDifficulty("Architectural overhaul of core", heurCfg);
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
  strictEqual(resFallback.difficulty, "trivial");
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
