import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { evaluateQuestIntent } from "../../src/drafting/judge.ts";
import { QUEST_EXEMPLARS } from "../../src/drafting/quest-exemplars.ts";
import { clearEmbedState } from "../../src/judge/embed.ts";
import { clearNearestIndexes } from "../../src/judge/nearest.ts";
import { stubJudgeFetch } from "../judge-stub.ts";

const ON: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", embedMode: "auto", judgeUrl: "http://judge.test", judgeProtocol: "systemone" };

/** quest exemplars -> x, conversation exemplars -> y, probes by exact text, anything else -> z. */
function questEmbed(probes: Record<string, "quest" | "conversation" | "mix">, extra: string[] = []): (t: string) => number[] {
  const quest = new Set([...QUEST_EXEMPLARS["quest"] ?? [], ...extra]);
  const chat = new Set(QUEST_EXEMPLARS["conversation"] ?? []);
  return (text) => {
    const p = probes[text];
    if (p === "mix") return [1, 1, 0];
    if (p === "quest" || quest.has(text)) return [1, 0, 0];
    if (p === "conversation" || chat.has(text)) return [0, 1, 0];
    return [0, 0, 1];
  };
}

function fresh(): void {
  clearEmbedState();
  clearNearestIndexes();
}

function judgeCounter(answer: string | null): { answer: () => string | null; calls: () => number } {
  let n = 0;
  return { answer: () => { n += 1; return answer; }, calls: () => n };
}

Deno.test("a clear embedding quest verdict opens a quest without consulting the judge", async () => {
  fresh();
  const j = judgeCounter("conversation");
  const restore = stubJudgeFetch(j.answer, questEmbed({ "fix the thing": "quest" }));
  try {
    const r = await evaluateQuestIntent("fix the thing", ON);
    check(r.isQuest === true && r.source === "embed", `quest via embeddings, got ${r.isQuest}/${r.source}`);
    check(j.calls() === 0, "judge not consulted");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("an embedding conversation verdict is final: no quest, judge not consulted", async () => {
  fresh();
  const j = judgeCounter("quest");
  const restore = stubJudgeFetch(j.answer, questEmbed({ "good morning": "conversation" }));
  try {
    const r = await evaluateQuestIntent("good morning", ON);
    check(r.isQuest === false && r.source === "embed", `conversation via embeddings, got ${r.isQuest}/${r.source}`);
    check(j.calls() === 0, "the judge's false quests are never reconsulted");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("a thin margin or weak similarity is conversation, never a quest", async () => {
  fresh();
  const j = judgeCounter("quest");
  const restore = stubJudgeFetch(j.answer, questEmbed({ "half sure": "mix" }));
  try {
    check((await evaluateQuestIntent("half sure", ON)).isQuest === false, "tie between kinds => conversation");
    check((await evaluateQuestIntent("something unrelated", ON)).isQuest === false, "below the similarity floor => conversation");
    check(j.calls() === 0, "judge not consulted");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("questMinMargin gates quests independently of the steering margin", async () => {
  fresh();
  // sim ~0.894, margin ~0.447 for [2,1,0]-style probe: passes 0.1, fails a 0.9 margin.
  const embed = (t: string): number[] => (t === "borderline" ? [2, 1, 0] : questEmbed({})(t));
  const restore = stubJudgeFetch(() => null, embed);
  try {
    check((await evaluateQuestIntent("borderline", { ...ON, questMinMargin: 0.1 })).isQuest === true, "passes 0.1");
    check((await evaluateQuestIntent("borderline", { ...ON, questMinMargin: 0.9 })).isQuest === false, "fails 0.9");
    check((await evaluateQuestIntent("borderline", { ...ON, questMinMargin: 0.9, intentMinMargin: 0 })).isQuest === false, "steering margin is irrelevant");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("operator questExemplars extend the shipped ones", async () => {
  fresh();
  // The phrasing lives on its own axis: only an operator exemplar with the same text can match it.
  const embed = (t: string): number[] => (t === "zorp the widgets" ? [0, 0, 1] : questEmbed({})(t));
  const restore = stubJudgeFetch(() => null, embed);
  try {
    const without = await evaluateQuestIntent("zorp the widgets", ON);
    check(without.isQuest === false, "unknown phrasing is not a quest by default");
    fresh();
    const withOwn = await evaluateQuestIntent("zorp the widgets", { ...ON, questExemplars: { quest: ["zorp the widgets"] } });
    check(withOwn.isQuest === true && withOwn.source === "embed", "operator exemplar recognised");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("embeddings down falls to the structural fallback", async () => {
  fresh();
  const bothDown = stubJudgeFetch(() => null);
  try {
    const r = await evaluateQuestIntent("build me a thing", { ...ON, embedMode: "off", judgeFallback: "heuristic" });
    check(r.isQuest === false && r.source === "heuristic" && r.degraded === true, "structural fallback, degraded");
    const header = await evaluateQuestIntent("# Quest: do it", { ...ON, embedMode: "off", judgeFallback: "heuristic" });
    check(header.isQuest === true, "a pasted quest header still counts");
  } finally {
    bothDown();
    fresh();
  }
});

Deno.test("judgeMode off or heuristic never calls the embeddings server", async () => {
  fresh();
  let embedCalls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (() => { embedCalls += 1; return Promise.resolve(new Response("x", { status: 500 })); }) as typeof fetch;
  try {
    check((await evaluateQuestIntent("fix the thing", { ...ON, judgeMode: "off" })).isQuest === false, "off => no quest");
    check((await evaluateQuestIntent("# Quest: x", { ...ON, judgeMode: "heuristic" })).isQuest === true, "heuristic header");
    check(embedCalls === 0, `no network, got ${embedCalls} calls`);
  } finally {
    globalThis.fetch = real;
    fresh();
  }
});
