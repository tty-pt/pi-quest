import { strictEqual, ok, rejects } from "node:assert";
import {
  normalizeJevUrl,
  parseJevQuestChoice,
  callJevQuestJudge,
  evaluateQuestIntent,
} from "../../src/drafting/judge.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";

Deno.test("jev quest judge: normalizeJevUrl formats endpoint correctly", () => {
  strictEqual(normalizeJevUrl("http://127.0.0.1:4242"), "http://127.0.0.1:4242/api/v1/systemone/");
  strictEqual(normalizeJevUrl("http://127.0.0.1:4242/"), "http://127.0.0.1:4242/api/v1/systemone/");
  strictEqual(normalizeJevUrl("http://localhost:8000/systemone"), "http://localhost:8000/systemone/");
  strictEqual(normalizeJevUrl("http://localhost:8000/systemone/"), "http://localhost:8000/systemone/");
});

Deno.test("jev quest judge: parseJevQuestChoice parses documented and fallback structures", () => {
  // Documented keyed answers.quest_intent.choice format
  const docResp = {
    model: "qwen",
    answers: {
      quest_intent: {
        type: "choice",
        choice: "quest",
        confidence: 0.95,
      },
    },
  };
  strictEqual(parseJevQuestChoice(docResp), "quest");

  const convResp = {
    model: "qwen",
    answers: {
      quest_intent: {
        type: "choice",
        choice: "conversation",
        confidence: 0.92,
      },
    },
  };
  strictEqual(parseJevQuestChoice(convResp), "conversation");

  // Fallback array structure
  const arrResp = {
    answers: [
      { id: "quest_intent", choice: "quest" },
    ],
  };
  strictEqual(parseJevQuestChoice(arrResp), "quest");

  // Malformed structure rejection
  try {
    parseJevQuestChoice({ answers: { quest_intent: { choice: "invalid_choice" } } });
    ok(false, "Should have thrown for invalid choice");
  } catch (err: unknown) {
    ok(String(err).includes("Invalid Jev quest choice answer"));
  }
});

Deno.test("jev quest judge: mock server validates request payload, bearer auth, and choice extraction", async () => {
  let receivedHeader = "";
  let receivedBody: Record<string, unknown> = {};

  const server = Deno.serve({ port: 0 }, async (req) => {
    receivedHeader = req.headers.get("Authorization") || "";
    receivedBody = await req.json();

    return new Response(JSON.stringify({
      model: "qwen",
      answers: {
        quest_intent: {
          type: "choice",
          choice: "quest",
          confidence: 0.98,
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
    judgeKey: "secret-token-123",
  };

  try {
    const choice = await callJevQuestJudge("Fix the broken memory leak in corm_open", cfg);
    strictEqual(choice, "quest");
    strictEqual(receivedHeader, "Bearer secret-token-123");
    strictEqual(receivedBody["model"], "qwen");
    strictEqual(receivedBody["state"], "User: Fix the broken memory leak in corm_open");
    ok((receivedBody["questions"] as Record<string, unknown>)?.["quest_intent"]);
  } finally {
    await server.shutdown();
  }
});

Deno.test("jev quest judge: evaluateQuestIntent respects judgeMode off, heuristic, and fallback policies", async () => {
  // 1. Off mode
  const offCfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "off" };
  const resOff = await evaluateQuestIntent("Fix the critical memory leak", offCfg);
  strictEqual(resOff.isQuest, false);
  strictEqual(resOff.source, "heuristic");

  // 2. Heuristic mode
  const heurCfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "heuristic" };
  const resHeur1 = await evaluateQuestIntent("Fix the corm_open leak in libcorm", heurCfg);
  strictEqual(resHeur1.isQuest, true);
  strictEqual(resHeur1.source, "heuristic");

  const resHeur2 = await evaluateQuestIntent("I spoke to my grandfather under the cherry tree", heurCfg);
  strictEqual(resHeur2.isQuest, false);
  strictEqual(resHeur2.source, "heuristic");

  // 3. Fallback on network failure
  const downCfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "auto",
    judgeUrl: "http://127.0.0.1:59999", // Unreachable port
    judgeTimeoutMs: 150,
    judgeFallback: "heuristic",
  };

  const resFallback = await evaluateQuestIntent("Fix the corm_open leak in libcorm", downCfg);
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
