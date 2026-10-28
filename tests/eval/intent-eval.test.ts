// Opt-in live evaluation of embedding intent classification against a running
// axil-auren (default http://127.0.0.1:4242). Never part of the default suite:
//   PI_QUEST_EVAL_JUDGE=1 deno test --allow-all --sloppy-imports tests/eval/
// Prints accuracy plus every miss, and fails on any false advance/abort. The corpus
// is disjoint from the shipped exemplars so the numbers are held-out.
import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { clearIntentMemo, interpretUserTurn, type UserIntentKind } from "../../src/domain/intent.ts";
import { clearEmbedState } from "../../src/judge/embed.ts";

const LIVE = Deno.env.get("PI_QUEST_EVAL_JUDGE") === "1";
const URL_ = Deno.env.get("PI_QUEST_EVAL_URL") ?? "http://127.0.0.1:4242";

const CORPUS: Array<[string, UserIntentKind]> = [
  ["Go on", "advance"], ["Continua", "advance"], ["ok, ship it", "advance"], ["pode avançar", "advance"],
  ["looks good, proceed", "advance"], ["carry on", "advance"], ["keep going", "advance"], ["sim, podes continuar", "advance"],
  ["go ahead", "advance"], ["prossegue", "advance"], ["yes", "advance"], ["Go on.", "advance"], ["ok go", "advance"],
  ["perfect, continue please", "advance"], ["tudo bem, continua", "advance"], ["let's do it", "advance"],
  ["cancel everything", "abort"], ["stop, abandon this quest", "abort"], ["cancela tudo", "abort"], ["forget it, abort", "abort"],
  ["scrap this quest", "abort"], ["não quero continuar, apaga isto", "abort"],
  ["what does this do?", "question"], ["why did you change that file?", "question"], ["can you go on explaining the plan?", "question"],
  ["porque mudaste isso?", "question"], ["is this finished?", "question"], ["how many tests are there", "question"],
  ["we should go with approach B instead", "refinement"], ["tests are failing on the parser", "refinement"],
  ["use a hashmap here", "refinement"], ["go on and also rename the module to foo", "refinement"],
  ["make it faster", "refinement"], ["a função devia devolver null", "refinement"], ["continue, but use approach B", "refinement"],
  ["the second step is redundant", "refinement"],
  ["the code must never write to var/ directly", "constraint"], ["make sure no JS is added", "constraint"],
  ["não podes usar malloc aqui", "constraint"], ["it has to stay under 100 lines", "constraint"],
  ["fix the lint errors before you go on", "subquest_now"], ["antes de avançar, corrige o teste do parser", "subquest_now"],
  ["afterwards, we need a README section", "subquest_later"], ["depois disto, adiciona um changelog", "subquest_later"],
  ["thanks", "ack"], ["obrigado", "ack"], ["nice work", "ack"], ["hi", "ack"],
];

Deno.test({
  name: "live: embedding intent classification is accurate with zero false actions",
  ignore: !LIVE,
  fn: async () => {
    const cfg: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: URL_, judgeProtocol: "systemone" };
    const actionable = new Set<string>(["advance", "abort", "constraint", "subquest_now", "subquest_later"]);
    let ok = 0;
    let falseActions = 0;
    const misses: string[] = [];
    for (const [text, want] of CORPUS) {
      clearIntentMemo();
      clearEmbedState();
      const got = await interpretUserTurn(text, "implementing", cfg);
      if (got.kind === want) ok += 1;
      else misses.push(`${text} => ${got.kind} (${got.source}), want ${want}`);
      if (actionable.has(got.kind) && got.kind !== want) falseActions += 1;
    }
    console.log(`intent eval: ${ok}/${CORPUS.length} correct, ${falseActions} false actions`);
    for (const m of misses) console.log(`  miss: ${m}`);
    check(falseActions === 0, `${falseActions} false state-changing verdicts`);
    check(ok / CORPUS.length >= 0.8, `accuracy ${ok}/${CORPUS.length}`);
  },
});
