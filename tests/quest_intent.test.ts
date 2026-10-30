import { check } from "./check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../src/config.ts";
import { evaluateQuestIntent } from "../src/drafting/judge.ts";
import { evaluateQuestKind } from "../src/drafting/judge.ts";
import { QUEST_EXEMPLARS } from "../src/drafting/quest-exemplars.ts";
import { KIND_EXEMPLARS } from "../src/drafting/kind-exemplars.ts";

const USER_BUG_REPORT =
  "You shouldn't draw as an ephemeral item soemthing that's supposed to be a stone or a rock. If it is a stone or a rock or a stone, just draw that.";
const NEGATIVE_SPEC =
  "It shouldn't do X when Y happens, it should do Z instead.";
const PT_BUG_REPORT =
  "Não devias desenhar pedras como itens efémeros. Se for uma pedra ou rocha, desenha isso.";
const CONVERSATION_QUESTION =
  "What do you think of this approach?";

Deno.test("evaluateQuestIntent skips quest creation when offline without guessing", async () => {
  const offlineCfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "off",
  };

  const res1 = await evaluateQuestIntent(USER_BUG_REPORT, offlineCfg);
  check(res1.isQuest === false, "offline skips quest creation without judge");
  check(res1.source === "skip", "source is skip");
  check(res1.degraded === true, "marked degraded");

  const resConv = await evaluateQuestIntent(CONVERSATION_QUESTION, offlineCfg);
  check(resConv.isQuest === false, "conversation question skipped");
  check(resConv.source === "skip", "source is skip");
});

Deno.test("evaluateQuestIntent classifies corrective directives as quest via mock embeddings", async () => {
  const server = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/v1/systemone") || url.pathname.includes("/v1/classify")) {
      const body = await req.json();
      const text = body.text ?? "";
      const isQuest = text.includes("ephemeral") || text.includes("stone") || text.includes("shouldn't");
      const choice = isQuest ? "quest" : "conversation";
      return new Response(JSON.stringify({
        choice,
        similarity: isQuest ? 0.88 : 0.45,
        margin: isQuest ? 0.25 : 0.05,
        scores: {
          quest: isQuest ? 0.88 : 0.45,
          conversation: isQuest ? 0.40 : 0.85,
        },
        model: "bge-base",
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });

  const port = server.addr.port;
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "auto",
    embedUrl: `http://127.0.0.1:${port}`,
    embedModel: "bge-base",
  };

  try {
    const res = await evaluateQuestIntent(USER_BUG_REPORT, cfg);
    check(res.isQuest === true, "classified as quest by embeddings");
    check(res.source === "embed", "source is embed");

    const resConv = await evaluateQuestIntent(CONVERSATION_QUESTION, cfg);
    check(resConv.isQuest === false, "conversation classified as not quest");
    check(resConv.source === "embed", "source is embed");
  } finally {
    await server.shutdown();
  }
});

Deno.test("evaluateQuestKind classifies corrective bug reports as bugfix via mock embeddings", async () => {
  const server = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/v1/systemone") || url.pathname.includes("/v1/classify")) {
      return new Response(JSON.stringify({
        choice: "bugfix",
        similarity: 0.89,
        margin: 0.30,
        scores: { bugfix: 0.89, feature: 0.40, standard: 0.35 },
        model: "bge-base",
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });

  const port = server.addr.port;
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedMode: "auto",
    embedUrl: `http://127.0.0.1:${port}`,
    embedModel: "bge-base",
  };

  try {
    const kind = await evaluateQuestKind(USER_BUG_REPORT, cfg);
    check(kind === "bugfix", `expected bugfix, got ${kind}`);
  } finally {
    await server.shutdown();
  }
});

Deno.test("exemplars list contains corrective bug reports and behavioral directives", () => {
  const questExemplars = QUEST_EXEMPLARS["quest"] ?? [];
  check(
    questExemplars.some((e) => e.toLowerCase().includes("ephemeral") || e.toLowerCase().includes("stone")),
    "QUEST_EXEMPLARS contains stone/ephemeral exemplar",
  );
  check(
    questExemplars.some((e) => e.toLowerCase().includes("shouldn't") || e.toLowerCase().includes("should not")),
    "QUEST_EXEMPLARS contains negative specification",
  );
  check(
    questExemplars.some((e) => e.toLowerCase().includes("não devias") || e.toLowerCase().includes("não devia")),
    "QUEST_EXEMPLARS contains Portuguese negative specification",
  );

  const bugfixExemplars = KIND_EXEMPLARS["bugfix"] ?? [];
  check(
    bugfixExemplars.some((e) => e.toLowerCase().includes("ephemeral") || e.toLowerCase().includes("stone") || e.toLowerCase().includes("shouldn't")),
    "KIND_EXEMPLARS.bugfix contains corrective bug report",
  );
});
