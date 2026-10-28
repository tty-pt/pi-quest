import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { askJudgeChoice, extractJevAnswer, isFabricatedAnswer, resolveChoice, type JudgeQuestion } from "../../src/judge/choice.ts";
import { stubJudgeFetch } from "../judge-stub.ts";
import { parseJevDifficultyChoice } from "../../src/drafting/difficulty.ts";
import { parseJevQuestChoice } from "../../src/drafting/judge.ts";

const OPTIONS = [{ key: "yes", description: "y" }, { key: "no", description: "n" }];
const Q: JudgeQuestion = { id: "q1", state: "s", instructions: "i", options: OPTIONS };
const ON: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: "http://judge.test" };

Deno.test("resolveChoice is exact: no substring or synonym matching", () => {
  check(resolveChoice(" YES ", OPTIONS) === "yes", "case/space tolerant");
  check(resolveChoice("not a task", OPTIONS) === null, "unknown label");
  check(resolveChoice("yes please", OPTIONS) === null, "no substring match");
  check(resolveChoice(undefined, OPTIONS) === null, "non-string");
});

Deno.test("extractJevAnswer reads keyed and array forms", () => {
  check(extractJevAnswer({ answers: { q1: { choice: "yes" } } }, "q1") === "yes", "keyed");
  check(extractJevAnswer({ answers: [{ id: "q1", choice: "no" }] }, "q1") === "no", "array");
  check(extractJevAnswer({ answers: [] }, "q1") === undefined, "empty");
  check(extractJevAnswer(null, "q1") === undefined, "null");
});

Deno.test("askJudgeChoice: choice, failure, unknown label, and judge off", async () => {
  let restore = stubJudgeFetch(() => "yes");
  try { check((await askJudgeChoice(ON, Q)) === "yes", "choice"); } finally { restore(); }
  restore = stubJudgeFetch(() => null);
  try { check((await askJudgeChoice(ON, Q)) === null, "http failure"); } finally { restore(); }
  restore = stubJudgeFetch(() => "maybe");
  try { check((await askJudgeChoice(ON, Q)) === null, "unknown label"); } finally { restore(); }
  check((await askJudgeChoice({ ...ON, judgeMode: "off" }, Q)) === null, "off => null");
  check((await askJudgeChoice({ ...ON, judgeUrl: undefined }, Q)) === null, "no url => null");
});

Deno.test("quest and difficulty parsers no longer accept synonym substrings", () => {
  let threw = 0;
  for (const bad of ["a software task", "chat", "minor", "epic"]) {
    for (const fn of [() => parseJevQuestChoice({ answers: { quest_intent: { choice: bad } } }), () => parseJevDifficultyChoice({ answers: { quest_difficulty: { choice: bad } } })]) {
      try { fn(); } catch { threw += 1; }
    }
  }
  check(threw === 8, `all synonyms rejected, got ${threw}`);
});

function stubRaw(entry: unknown): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ answers: { q1: entry } }), { status: 200 }))) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

Deno.test("askJudgeChoice rejects a null choice and the legacy fabricated 0.90/0.05 answer", async () => {
  let restore = stubRaw({ type: "choice", choice: null, error: "unparseable model output" });
  try { check((await askJudgeChoice(ON, Q)) === null, "null choice => unavailable"); } finally { restore(); }
  restore = stubRaw({ choice: "yes", confidence: 0.9, probabilities: { yes: 0.9, no: 0.05 } });
  try { check((await askJudgeChoice(ON, Q)) === null, "fabricated signature => unavailable"); } finally { restore(); }
  restore = stubRaw({ choice: "yes", confidence: 0.83, probabilities: { yes: 0.83, no: 0.17 } });
  try { check((await askJudgeChoice(ON, Q)) === "yes", "real probabilities are trusted"); } finally { restore(); }
  restore = stubRaw({ choice: "yes", confidence: 0.9, probabilities: { yes: 0.9, no: 0.1 } });
  try { check((await askJudgeChoice(ON, Q)) === "yes", "0.9 alone is not the signature"); } finally { restore(); }
});

Deno.test("isFabricatedAnswer only matches the exact legacy signature", () => {
  check(isFabricatedAnswer({ answers: { q1: { choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.05, c: 0.05 } } } }, "q1"), "signature");
  check(!isFabricatedAnswer({ answers: { q1: { choice: "a" } } }, "q1"), "no confidence");
  check(!isFabricatedAnswer({ answers: { q1: { choice: "a", confidence: 0.9, probabilities: { a: 0.9 } } } }, "q1"), "no other options");
  check(!isFabricatedAnswer(null, "q1"), "null");
});
