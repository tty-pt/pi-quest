import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { evaluateQuestDifficulty } from "../../src/drafting/difficulty.ts";
import { DIFFICULTY_EXEMPLARS } from "../../src/drafting/difficulty-exemplars.ts";
import { clearEmbedState } from "../../src/judge/embed.ts";
import { clearNearestIndexes } from "../../src/judge/nearest.ts";
import { stubJudgeFetch } from "../judge-stub.ts";

const ON: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", embedMode: "auto", difficultyMode: "auto", judgeUrl: "http://judge.test", judgeProtocol: "systemone" };

const AXIS: Record<string, number[]> = { trivial: [1, 0, 0, 0], standard: [0, 1, 0, 0], complex: [0, 0, 1, 0] };

/** exemplars -> their level's axis, probes by exact text, anything else -> an orthogonal axis. */
function levelEmbed(probes: Record<string, number[]>, extra: Record<string, string> = {}): (t: string) => number[] {
  const byText = new Map<string, number[]>();
  for (const [level, texts] of Object.entries(DIFFICULTY_EXEMPLARS)) for (const t of texts) byText.set(t, AXIS[level] ?? [0, 0, 0, 1]);
  for (const [t, level] of Object.entries(extra)) byText.set(t, AXIS[level] ?? [0, 0, 0, 1]);
  return (text) => probes[text] ?? byText.get(text) ?? [0, 0, 0, 1];
}

function fresh(): void {
  clearEmbedState();
  clearNearestIndexes();
}

function judgeCounter(answer: string | null): { answer: () => string | null; calls: () => number } {
  let n = 0;
  return { answer: () => { n += 1; return answer; }, calls: () => n };
}

Deno.test("a clear embedding verdict sets the difficulty without consulting the judge", async () => {
  fresh();
  const j = judgeCounter("trivial");
  const restore = stubJudgeFetch(j.answer, levelEmbed({ "move to multi-region": AXIS["complex"] ?? [] }));
  try {
    const r = await evaluateQuestDifficulty("move to multi-region", ON);
    check(r.difficulty === "complex" && r.source === "embed", `complex via embeddings, got ${r.difficulty}/${r.source}`);
    check(j.calls() === 0, "judge not consulted");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("a thin margin or weak similarity is standard, never trivial or complex", async () => {
  fresh();
  const j = judgeCounter("trivial");
  const restore = stubJudgeFetch(j.answer, levelEmbed({
    "between trivial and standard": [1, 1, 0, 0], // tie => zero margin
    "far from everything": [0, 0, 0, 1],
  }));
  try {
    check((await evaluateQuestDifficulty("between trivial and standard", ON)).difficulty === "standard", "tie => standard");
    const weak = await evaluateQuestDifficulty("far from everything", ON);
    check(weak.difficulty === "standard" && weak.source === "embed", "below the floor => standard");
    check(j.calls() === 0, "the judge's false trivial is never reconsulted");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("difficultyMinMargin gates trivial/complex but never standard", async () => {
  fresh();
  const probe: Record<string, number[]> = { borderline: [2, 1, 0, 0], plain: [0, 2, 1, 0] };
  const restore = stubJudgeFetch(() => null, levelEmbed(probe));
  try {
    check((await evaluateQuestDifficulty("borderline", { ...ON, difficultyMinMargin: 0.075 })).difficulty === "trivial", "passes a low margin");
    check((await evaluateQuestDifficulty("borderline", { ...ON, difficultyMinMargin: 0.9 })).difficulty === "standard", "fails a high margin");
    check((await evaluateQuestDifficulty("plain", { ...ON, difficultyMinMargin: 0.9 })).difficulty === "standard", "standard is returned regardless");
    check((await evaluateQuestDifficulty("borderline", { ...ON, difficultyMinMargin: 0.9, intentMinMargin: 0, questMinMargin: 0 })).difficulty === "standard", "other margins are irrelevant");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("operator difficultyExemplars extend the shipped ones", async () => {
  fresh();
  const embed = (t: string): number[] => (t === "yeet the config" ? [0, 0, 0, 1] : levelEmbed({})(t));
  const restore = stubJudgeFetch(() => null, embed);
  try {
    check((await evaluateQuestDifficulty("yeet the config", ON)).difficulty === "standard", "unknown phrasing is standard by default");
    fresh();
    // The operator's sentence embeds like the probe (same text), on the trivial axis only via the table.
    const own = (t: string): number[] => (t === "yeet the config" ? [1, 0, 0, 0] : levelEmbed({})(t));
    const restoreOwn = stubJudgeFetch(() => null, own);
    try {
      const r = await evaluateQuestDifficulty("yeet the config", { ...ON, difficultyExemplars: { trivial: ["yeet the config"] } });
      check(r.difficulty === "trivial" && r.source === "embed", `operator exemplar recognised, got ${r.difficulty}/${r.source}`);
    } finally {
      restoreOwn();
    }
  } finally {
    restore();
    fresh();
  }
});

Deno.test("embeddings down falls to default difficulty", async () => {
  fresh();
  const bothDown = stubJudgeFetch(() => null);
  try {
    const r = await evaluateQuestDifficulty("touch a.ts b.ts c.ts d.ts", { ...ON, embedMode: "off" });
    check(r.difficulty === "standard" && r.source === "default" && r.degraded === true, "default fallback, degraded");
  } finally {
    bothDown();
    fresh();
  }
});

Deno.test("difficultyMode off never uses embeddings; auto does", async () => {
  fresh();
  let embedCalls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((url: unknown) => {
    if (String(url).includes("/v1/embeddings") || String(url).includes("/v1/systemone") || String(url).includes("/v1/classify")) embedCalls += 1;
    return Promise.resolve(new Response("x", { status: 500 }));
  }) as typeof fetch;
  try {
    await evaluateQuestDifficulty("x", { ...ON, difficultyMode: "off" });
    check(embedCalls === 0, `no embedding calls when off, got ${embedCalls}`);
    await evaluateQuestDifficulty("x", ON);
    check(embedCalls > 0, "auto consults embeddings first");
  } finally {
    globalThis.fetch = real;
    fresh();
  }
});
