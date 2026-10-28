// Plan-verification classifiability study (opt-in live part):
//   PI_QUEST_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/plan-verification-eval.test.ts
// Question: can embeddings decide "does this plan contain a step that proves the change
// works?" as well as the judge? The embedding strategy splits the plan into steps and
// says "yes" iff at least one step is nearest the `verify` exemplars through the gate.
// The state-changing verdict is "no": quality.ts adds a gap (and blocks in enforce mode)
// only on `=== false`, so a wrong "no" blocks a good plan. A wrong "yes" merely leaves
// a gap unflagged, which is also what an inert judge does; both directions are printed.
// The hermetic checks always run.
import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { judgeHasVerificationStep } from "../../src/drafting/quality.ts";
import { gate, mergeExemplars, nearestExemplar } from "../../src/judge/nearest.ts";
import { PLAN_CORPUS, STEP_EXEMPLARS } from "./corpora/plan-verification.ts";
import { runComparison, type Strategy } from "./harness.ts";

const LIVE = Deno.env.get("PI_QUEST_EVAL_JUDGE") === "1";
const URL_ = Deno.env.get("PI_QUEST_EVAL_URL") ?? "http://127.0.0.1:4242";

/** List items only, with their numbering/bullets stripped (prose and headings are not steps). */
export function planSteps(plan: string): string[] {
  return plan
    .split("\n")
    .map((l) => /^\s*(?:\d+[.)]|[-*+])\s+(\S.*)$/.exec(l)?.[1]?.trim() ?? "")
    .filter((s) => s !== "");
}

Deno.test("plan corpus is large, balanced, bilingual and disjoint from the exemplars", () => {
  check(PLAN_CORPUS.length >= 40, `>= 40 cases, got ${PLAN_CORPUS.length}`);
  const yes = PLAN_CORPUS.filter((c) => c.want === "yes").length;
  check(yes >= 15 && PLAN_CORPUS.length - yes >= 15, `balanced labels (${yes} yes)`);
  check(PLAN_CORPUS.some((c) => /Adicionar|Corrigir|Atualizar|Mover/.test(c.text)), "Portuguese cases present");
  check(new Set(PLAN_CORPUS.map((c) => c.text)).size === PLAN_CORPUS.length, "no duplicate cases");
  const exemplarTexts = new Set(Object.values(STEP_EXEMPLARS).flat().map((t) => t.toLowerCase()));
  for (const c of PLAN_CORPUS) {
    for (const step of planSteps(c.text)) {
      check(!exemplarTexts.has(step.toLowerCase()), `corpus step is an exemplar: ${step}`);
    }
  }
});

Deno.test("planSteps keeps list items and drops prose and headings", () => {
  const steps = planSteps("## Plan\nIntro paragraph\n1. First\n2) Second\n- Third\n* Fourth\n   - Nested");
  check(steps.join("|") === "First|Second|Third|Fourth|Nested", `got ${steps.join("|")}`);
});

Deno.test({
  name: "live: plan verification, judge vs embeddings",
  ignore: !LIVE,
  fn: async () => {
    const cfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: URL_, judgeProtocol: "systemone" };
    const examples = mergeExemplars(STEP_EXEMPLARS, {});
    const gateOptions = {
      minSimilarity: cfg.intentMinSimilarity,
      minMargin: cfg.intentMinMargin,
      harmless: "other",
      actionable: new Set(["verify"]),
    };
    const embed: Strategy = {
      name: `embeddings(${cfg.embedModel})`,
      classify: async (plan) => {
        const steps = planSteps(plan);
        if (steps.length === 0) return null;
        let anyAnswer = false;
        for (const step of steps) {
          const v = await nearestExemplar(cfg, examples, step);
          if (v === null) continue;
          anyAnswer = true;
          if (gate(v, gateOptions) === "verify") return "yes";
        }
        return anyAnswer ? "no" : null;
      },
    };
    const judge: Strategy = {
      name: `judge(${cfg.judgeModel ?? "default"})`,
      classify: async (plan) => {
        const r = await judgeHasVerificationStep(cfg, plan);
        return r === null ? null : r ? "yes" : "no";
      },
    };
    const out = await runComparison("plan verification", PLAN_CORPUS, cfg, embed, judge, new Set(["no"]));
    const recall = (r: typeof out.embed): string => `yes ${r.byLabel["yes"]?.correct}/${r.byLabel["yes"]?.total}, no ${r.byLabel["no"]?.correct}/${r.byLabel["no"]?.total}`;
    console.log(`recall embeddings: ${recall(out.embed)} (false "no" = plans wrongly blocked: ${out.embed.falsePositives})`);
    if (out.judge !== null) console.log(`recall judge: ${recall(out.judge)} (false "no" = plans wrongly blocked: ${out.judge.falsePositives})`);
    check(out.embed.total === PLAN_CORPUS.length, "every case evaluated");
  },
});
