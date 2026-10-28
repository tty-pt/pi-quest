// Difficulty measurement (opt-in live part):
//   PI_QUEST_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/difficulty-eval.test.ts
// Judge (production DIFFICULTY_QUESTION) vs nearest-exemplar embeddings through the
// production gate. The state-changing error is a "trivial" verdict for a non-trivial
// request (it drops plan review). Embedding-only measurements run BEFORE the judge so a
// slow judge cannot leave the server busy for them.
import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { DIFFICULTY_QUESTION } from "../../src/drafting/difficulty.ts";
import { gate, mergeExemplars, nearestExemplar } from "../../src/judge/nearest.ts";
import { DIFFICULTY_CORPUS, DIFFICULTY_CORPUS_B, DIFFICULTY_CORPUS_C, DIFFICULTY_EXEMPLARS } from "./corpora/difficulty.ts";
import { type Case, embedStrategy, judgeStrategy, runComparison } from "./harness.ts";

const LIVE = Deno.env.get("PI_QUEST_EVAL_JUDGE") === "1";
const URL_ = Deno.env.get("PI_QUEST_EVAL_URL") ?? "http://127.0.0.1:4242";
const LEVELS = ["trivial", "standard", "complex"];

/** Judge QUALITY needs a long timeout so slow answers still count; latency is reported separately. */
const JUDGE_QUALITY_CFG = (cfg: QuestConfig): QuestConfig => ({ ...cfg, judgeTimeoutMs: 30_000 });

export function assertCorpus(name: string, corpus: Case[], exemplars: Record<string, string[]>, others: Case[] = []): void {
  check(corpus.length >= 40, `${name}: >= 40 cases, got ${corpus.length}`);
  for (const level of LEVELS) {
    check(corpus.filter((x) => x.want === level).length >= 12, `${name}: >= 12 ${level} cases`);
  }
  check(corpus.some((x) => /Corrige|Adiciona|Migra|Atualiza|Redesenha/.test(x.text)), `${name}: Portuguese cases present`);
  check(new Set(corpus.map((x) => x.text)).size === corpus.length, `${name}: no duplicate cases`);
  const seen = new Set([
    ...Object.values(exemplars).flat().map((x) => x.toLowerCase()),
    ...others.map((x) => x.text.toLowerCase()),
  ]);
  for (const x of corpus) check(!seen.has(x.text.toLowerCase()), `${name}: overlaps exemplars or another corpus: ${x.text}`);
}

Deno.test("difficulty corpus A is large, balanced, bilingual and disjoint from the exemplars", () => {
  assertCorpus("A", DIFFICULTY_CORPUS, DIFFICULTY_EXEMPLARS);
  check(LEVELS.every((l) => (DIFFICULTY_EXEMPLARS[l] ?? []).length >= 8), ">= 8 exemplars per level");
});

Deno.test("difficulty corpus B is held out: balanced, bilingual, no overlap with A or the exemplars", () => {
  assertCorpus("B", DIFFICULTY_CORPUS_B, DIFFICULTY_EXEMPLARS, DIFFICULTY_CORPUS);
});

/** Corpus B falsified the first pre-registration (margin 0.02: 3 wrong-trivial). */
const FALSIFIED_MARGIN = 0.02;

Deno.test("difficulty corpus C is held out: balanced, bilingual, no overlap with A, B or the exemplars", () => {
  assertCorpus("C", DIFFICULTY_CORPUS_C, DIFFICULTY_EXEMPLARS, [...DIFFICULTY_CORPUS, ...DIFFICULTY_CORPUS_B]);
});

/** Second pre-registration (after B, before C): the calibrated default margin. Never tuned after. */
const PREREGISTERED_MARGIN_C = 0.075;

Deno.test({
  name: "live: difficulty held-out corpus C at the pre-registered margin 0.075",
  ignore: !LIVE,
  fn: async () => {
    const cfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: URL_, judgeProtocol: "systemone" };
    const examples = mergeExemplars(DIFFICULTY_EXEMPLARS, {});
    const gateAt = (minMargin: number) => ({
      minSimilarity: cfg.intentMinSimilarity,
      minMargin,
      harmless: "standard",
      actionable: new Set(["trivial", "complex"]),
    });
    const judge = judgeStrategy(JUDGE_QUALITY_CFG(cfg), DIFFICULTY_QUESTION, (text) => `User: ${text}`);
    const out = await runComparison("difficulty C @margin 0.075", DIFFICULTY_CORPUS_C, cfg, embedStrategy(cfg, examples, gateAt(PREREGISTERED_MARGIN_C)), judge, new Set(["trivial"]));
    console.log(`C summary: ${out.embed.correct}/${out.embed.total} wrong-trivial ${out.embed.falsePositives} complex ${out.embed.byLabel["complex"]?.correct}/15; judge ${out.judge?.correct}/${out.judge?.total} wrong-trivial ${out.judge?.falsePositives}`);
    check(out.embed.total === DIFFICULTY_CORPUS_C.length, "every case evaluated");
  },
});

Deno.test({
  name: "live: difficulty corpus B at the (falsified) margin 0.02 and the 0.075 reference",
  ignore: !LIVE,
  fn: async () => {
    const cfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: URL_, judgeProtocol: "systemone" };
    const examples = mergeExemplars(DIFFICULTY_EXEMPLARS, {});
    const gateAt = (minMargin: number) => ({
      minSimilarity: cfg.intentMinSimilarity,
      minMargin,
      harmless: "standard",
      actionable: new Set(["trivial", "complex"]),
    });
    // Embedding-only first (reference at the production margin), judge last.
    const ref = await runComparison("difficulty B @margin 0.075 (reference)", DIFFICULTY_CORPUS_B, cfg, embedStrategy(cfg, examples, gateAt(cfg.intentMinMargin)), null, new Set(["trivial"]));
    const judge = judgeStrategy(JUDGE_QUALITY_CFG(cfg), DIFFICULTY_QUESTION, (text) => `User: ${text}`);
    const pre = await runComparison("difficulty B @margin 0.02", DIFFICULTY_CORPUS_B, cfg, embedStrategy(cfg, examples, gateAt(FALSIFIED_MARGIN)), judge, new Set(["trivial"]));
    console.log(`B summary: pre-registered ${pre.embed.correct}/${pre.embed.total} wrong-trivial ${pre.embed.falsePositives} complex ${pre.embed.byLabel["complex"]?.correct}/15; reference ${ref.embed.correct}/${ref.embed.total} wrong-trivial ${ref.embed.falsePositives}`);
    check(pre.embed.total === DIFFICULTY_CORPUS_B.length, "every case evaluated");
  },
});

Deno.test({
  name: "live: difficulty corpus A, embeddings first then judge",
  ignore: !LIVE,
  fn: async () => {
    const cfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: URL_, judgeProtocol: "systemone" };
    const examples = mergeExemplars(DIFFICULTY_EXEMPLARS, {});
    const gateAt = (minMargin: number) => ({
      minSimilarity: cfg.intentMinSimilarity,
      minMargin,
      harmless: "standard",
      actionable: new Set(["trivial", "complex"]),
    });
    // One raw verdict per case, then every margin is a free local re-gating.
    const raw = [];
    for (const x of DIFFICULTY_CORPUS) raw.push({ x, v: await nearestExemplar(cfg, examples, x.text) });
    console.log("margin sweep (corpus A, floor 0.6): margin | accuracy | wrong-trivial | complex recall");
    for (const m of [0, 0.02, 0.05, 0.075, 0.1, 0.125, 0.15]) {
      let ok = 0, wrongTrivial = 0, complexOk = 0;
      for (const { x, v } of raw) {
        const got = v === null ? null : gate(v, gateAt(m));
        if (got === x.want) { ok += 1; if (x.want === "complex") complexOk += 1; }
        else if (got === "trivial") wrongTrivial += 1;
      }
      console.log(`  ${m} | ${ok}/${DIFFICULTY_CORPUS.length} | ${wrongTrivial} | ${complexOk}/15`);
    }
    const judge = judgeStrategy(JUDGE_QUALITY_CFG(cfg), DIFFICULTY_QUESTION, (text) => `User: ${text}`);
    const out = await runComparison("difficulty A", DIFFICULTY_CORPUS, cfg, embedStrategy(cfg, examples, gateAt(cfg.intentMinMargin)), judge, new Set(["trivial"]));
    console.log(`complex recall: embeddings ${out.embed.byLabel["complex"]?.correct}/15` + (out.judge ? `, judge ${out.judge.byLabel["complex"]?.correct}/15` : ""));
    check(out.embed.total === DIFFICULTY_CORPUS.length, "every case evaluated");
  },
});
