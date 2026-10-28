// Quest-vs-conversation measurement (opt-in live part):
//   PI_QUEST_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/quest-intent-eval.test.ts
// Compares the production judge question against nearest-exemplar embeddings through the
// production gate. The state-changing verdict is "quest": a false quest opens a quest.
import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { QUEST_INTENT_QUESTION } from "../../src/drafting/judge.ts";
import { mergeExemplars } from "../../src/judge/nearest.ts";
import { QUEST_CORPUS, QUEST_CORPUS_B, QUEST_EXEMPLARS } from "./corpora/quest-intent.ts";
import { embedStrategy, judgeStrategy, runComparison } from "./harness.ts";

const LIVE = Deno.env.get("PI_QUEST_EVAL_JUDGE") === "1";
const URL_ = Deno.env.get("PI_QUEST_EVAL_URL") ?? "http://127.0.0.1:4242";

Deno.test("quest-intent corpus is large, balanced, bilingual and disjoint from the exemplars", () => {
  check(QUEST_CORPUS.length >= 40, `>= 40 cases, got ${QUEST_CORPUS.length}`);
  const quests = QUEST_CORPUS.filter((c) => c.want === "quest").length;
  check(quests >= 15 && QUEST_CORPUS.length - quests >= 15, `balanced labels (${quests} quest)`);
  check(QUEST_CORPUS.some((c) => /Corrige|Adiciona|Olá|Obrigado/.test(c.text)), "Portuguese cases present");
  check(new Set(QUEST_CORPUS.map((c) => c.text)).size === QUEST_CORPUS.length, "no duplicate cases");
  const exemplars = new Set(Object.values(QUEST_EXEMPLARS).flat().map((t) => t.toLowerCase()));
  for (const c of QUEST_CORPUS) check(!exemplars.has(c.text.toLowerCase()), `corpus case is an exemplar: ${c.text}`);
});

Deno.test("corpus B is held out: balanced, bilingual, no overlap with corpus A or the exemplars", () => {
  check(QUEST_CORPUS_B.length >= 40, `>= 40 cases, got ${QUEST_CORPUS_B.length}`);
  const quests = QUEST_CORPUS_B.filter((c) => c.want === "quest").length;
  check(quests >= 15 && QUEST_CORPUS_B.length - quests >= 15, `balanced labels (${quests} quest)`);
  check(QUEST_CORPUS_B.some((c) => /Adiciona|Preciso|Boa tarde|Ótimo/.test(c.text)), "Portuguese cases present");
  const others = new Set([...QUEST_CORPUS, ...Object.values(QUEST_EXEMPLARS).flat().map((t) => ({ text: t }))].map((c) => c.text.toLowerCase()));
  for (const c of QUEST_CORPUS_B) check(!others.has(c.text.toLowerCase()), `corpus B overlaps A or an exemplar: ${c.text}`);
});

/**
 * The judge's QUALITY is measured with a long timeout so a slow answer is still an answer
 * (otherwise load-induced timeouts make the comparison unsound); its real latency is the
 * p50/p95 printed by the report.
 */
const JUDGE_QUALITY_CFG = (cfg: QuestConfig): QuestConfig => ({ ...cfg, judgeTimeoutMs: 30_000 });

/** Pre-registered on corpus A (see the quest record); validated here on corpus B, never tuned after. */
const PREREGISTERED_MARGIN = 0.1;

Deno.test({
  name: "live: held-out corpus B at the pre-registered margin",
  ignore: !LIVE,
  fn: async () => {
    const cfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: URL_, judgeProtocol: "systemone" };
    const examples = mergeExemplars(QUEST_EXEMPLARS, {});
    const gateAt = (minMargin: number) => ({
      minSimilarity: cfg.intentMinSimilarity,
      minMargin,
      harmless: "conversation",
      actionable: new Set(["quest"]),
    });
    // Embedding-only reference first: a judge run that times out can leave the server busy.
    const ref = await runComparison("quest intent B @margin 0.075 (reference)", QUEST_CORPUS_B, cfg, embedStrategy(cfg, examples, gateAt(cfg.intentMinMargin)), null, new Set(["quest"]));
    const judge = judgeStrategy(JUDGE_QUALITY_CFG(cfg), QUEST_INTENT_QUESTION, (text) => `User: ${text}`);
    const pre = await runComparison("quest intent B @margin 0.10", QUEST_CORPUS_B, cfg, embedStrategy(cfg, examples, gateAt(PREREGISTERED_MARGIN)), judge, new Set(["quest"]));
    console.log(`B summary: pre-registered ${pre.embed.correct}/${pre.embed.total} fp ${pre.embed.falsePositives}; reference ${ref.embed.correct}/${ref.embed.total} fp ${ref.embed.falsePositives}`);
    check(pre.embed.total === QUEST_CORPUS_B.length, "every case evaluated");
  },
});

Deno.test({
  name: "live: quest-vs-conversation, judge vs embeddings",
  ignore: !LIVE,
  fn: async () => {
    const cfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: URL_, judgeProtocol: "systemone" };
    const embed = embedStrategy(cfg, mergeExemplars(QUEST_EXEMPLARS, {}), {
      minSimilarity: cfg.intentMinSimilarity,
      minMargin: cfg.intentMinMargin,
      harmless: "conversation",
      actionable: new Set(["quest"]),
    });
    const judge = judgeStrategy(JUDGE_QUALITY_CFG(cfg), QUEST_INTENT_QUESTION, (text) => `User: ${text}`);
    const out = await runComparison("quest intent", QUEST_CORPUS, cfg, embed, judge, new Set(["quest"]));
    check(out.embed.total === QUEST_CORPUS.length, "every case evaluated");
  },
});
