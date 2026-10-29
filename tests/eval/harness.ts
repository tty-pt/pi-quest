// Shared measurement harness for "can embeddings replace the judge for this decision?".
// A decision is a labelled corpus plus one or more strategies (judge, embeddings). The
// harness reports accuracy, wrong state-changing verdicts, latency percentiles and every
// miss, then `gateDecision` applies the adoption rule: embeddings must match or beat the
// judge's accuracy with ZERO wrong state-changing verdicts and no unavailable answers.
// The live runners are opt-in (PI_QUEST_EVAL_JUDGE=1) and never part of `npm test`;
// everything here that does not touch a server is unit-tested with fake strategies.
import { type QuestConfig } from "../../src/config.ts";
import { askJudgeChoice, type JudgeQuestion } from "../../src/judge/choice.ts";
import { embedBaseUrl, embedTexts } from "../../src/judge/embed.ts";
import { type Exemplar, gate, type GateOptions, nearestExemplar } from "../../src/judge/nearest.ts";

export interface Case {
  text: string;
  want: string;
}

export interface Strategy {
  name: string;
  /** The decided label, or null when the strategy is unavailable for this input. */
  classify: (text: string) => Promise<string | null>;
  /**
   * Cold-start work (model load, exemplar index build) with its own generous timeout.
   * Without it, the first `classify` is the warm-up, and a production-sized timeout
   * aborting a cold generation can leave the server saturated for the whole run.
   */
  warmup?: () => Promise<void>;
}

export interface Report {
  name: string;
  total: number;
  correct: number;
  accuracy: number;
  /** Wrong verdicts whose label is state-changing (any such verdict is a gate failure). */
  falsePositives: number;
  /** falsePositives over the cases whose truth is NOT state-changing (informative; the gate uses the count). */
  falsePositiveRate: number;
  unavailable: number;
  p50Ms: number;
  p95Ms: number;
  misses: string[];
  byLabel: Record<string, { correct: number; total: number }>;
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? 0;
}

export async function evaluateStrategy(
  strategy: Strategy,
  corpus: readonly Case[],
  opts: { stateChanging: ReadonlySet<string>; warmup?: boolean },
): Promise<Report> {
  const first = corpus[0];
  // Warm-up (exemplar index build, model load) is not part of the steady-state latency.
  if (opts.warmup !== false) {
    if (strategy.warmup !== undefined) await strategy.warmup();
    else if (first !== undefined) await strategy.classify(first.text);
  }
  const times: number[] = [];
  const misses: string[] = [];
  const byLabel: Report["byLabel"] = {};
  let correct = 0;
  let falsePositives = 0;
  let unavailable = 0;
  let negatives = 0;
  for (const c of corpus) {
    const slot = (byLabel[c.want] ??= { correct: 0, total: 0 });
    slot.total += 1;
    if (!opts.stateChanging.has(c.want)) negatives += 1;
    const t0 = performance.now();
    const got = await strategy.classify(c.text);
    times.push(Math.round(performance.now() - t0));
    if (got === null) {
      unavailable += 1;
      misses.push(`${c.text} => unavailable, want ${c.want}`);
      continue;
    }
    if (got === c.want) {
      correct += 1;
      slot.correct += 1;
    } else {
      misses.push(`${c.text} => ${got}, want ${c.want}`);
      if (opts.stateChanging.has(got)) falsePositives += 1;
    }
  }
  return {
    name: strategy.name,
    total: corpus.length,
    correct,
    accuracy: corpus.length === 0 ? 0 : correct / corpus.length,
    falsePositives,
    falsePositiveRate: negatives === 0 ? 0 : falsePositives / negatives,
    unavailable,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    misses,
    byLabel,
  };
}

export function formatReport(decision: string, r: Report): string {
  const lines = [
    `${decision} | ${r.name}: ${r.correct}/${r.total} correct, acc ${(r.accuracy * 100).toFixed(1)}%, ` +
      `fp ${r.falsePositives}/${r.total} (rate ${(r.falsePositiveRate * 100).toFixed(1)}%), ` +
      `unavailable ${r.unavailable}, p50 ${r.p50Ms}ms, p95 ${r.p95Ms}ms`,
    `  per label: ${Object.entries(r.byLabel).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(", ")}`,
    ...r.misses.map((m) => `  miss: ${m}`),
  ];
  return lines.join("\n");
}

export interface GateDecision {
  adopt: boolean;
  reason: string;
}

/** The R2 adoption rule. A judge that could not be measured never makes embeddings "win" silently. */
export function gateDecision(embed: Report, judge: Report | null): GateDecision {
  if (embed.falsePositives > 0) return { adopt: false, reason: `${embed.falsePositives} false state-changing verdicts` };
  if (embed.unavailable > 0) return { adopt: false, reason: `${embed.unavailable} answers unavailable (server down?)` };
  if (judge === null) return { adopt: false, reason: "judge not measured; nothing to compare against" };
  if (judge.unavailable > 0) return { adopt: false, reason: `judge unavailable for ${judge.unavailable} cases; comparison unsound` };
  if (embed.accuracy < judge.accuracy) {
    return { adopt: false, reason: `embeddings ${(embed.accuracy * 100).toFixed(1)}% < judge ${(judge.accuracy * 100).toFixed(1)}%` };
  }
  return {
    adopt: true,
    reason: `embeddings ${(embed.accuracy * 100).toFixed(1)}% >= judge ${(judge.accuracy * 100).toFixed(1)}%, 0 false state-changing verdicts`,
  };
}

// ---- live strategies --------------------------------------------------------------------

/** Embedding strategy: nearest exemplar through the production gate. */
export function embedStrategy(cfg: QuestConfig, examples: readonly Exemplar[], gateOptions: GateOptions): Strategy {
  return {
    name: `embeddings(${cfg.embedModel})`,
    classify: async (text) => {
      const v = await nearestExemplar(cfg, examples, text);
      return v === null ? null : gate(v, gateOptions);
    },
  };
}

/** Cold model loads can take over a minute; the production 6 s timeout would abort them. */
export const JUDGE_WARMUP_TIMEOUT_MS = 180_000;

/** Judge strategy executing via askJudgeChoice seam when configured. */
export function judgeStrategy(cfg: QuestConfig, question: JudgeQuestion, state: (text: string) => string): Strategy {
  return {
    name: `judge(${cfg.judgeModel ?? "default"})`,
    classify: async (text: string) => {
      const q: JudgeQuestion = {
        ...question,
        instructions: state(text),
      };
      return await askJudgeChoice(cfg, q);
    },
    warmup: async () => {},
  };
}

/** One line identifying the servers a measurement ran against, so numbers are reproducible. */
export async function serverInfo(cfg: QuestConfig): Promise<string> {
  const base = embedBaseUrl(cfg);
  let embedOk = "n/a";
  if (base !== null) {
    const t0 = performance.now();
    const v = await embedTexts(cfg, ["ping"], { timeoutMs: 5000 });
    embedOk = v === null ? "DOWN" : `up (${Math.round(performance.now() - t0)}ms)`;
  }
  return `judge ${cfg.judgeUrl ?? "-"} model=${cfg.judgeModel ?? "-"} protocol=${cfg.judgeProtocol}; ` +
    `embed ${base ?? "-"} model=${cfg.embedModel} ${embedOk}; ${new Date().toISOString()}`;
}

/** Run both strategies on a corpus, print the comparison and the gate decision. */
export async function runComparison(
  title: string,
  corpus: readonly Case[],
  cfg: QuestConfig,
  embed: Strategy,
  judge: Strategy | null,
  stateChanging: ReadonlySet<string>,
): Promise<{ embed: Report; judge: Report | null; decision: GateDecision }> {
  console.log(`\n=== ${title} (${corpus.length} cases) ===\n${await serverInfo(cfg)}`);
  const e = await evaluateStrategy(embed, corpus, { stateChanging });
  console.log(formatReport(title, e));
  const j = judge === null ? null : await evaluateStrategy(judge, corpus, { stateChanging });
  if (j !== null) console.log(formatReport(title, j));
  const decision = gateDecision(e, j);
  console.log(`${title} => ${decision.adopt ? "ADOPT embeddings" : "RETAIN judge"}: ${decision.reason}`);
  return { embed: e, judge: j, decision };
}
