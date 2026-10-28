import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { askJudgeChoice, extractJevAnswer, resolveChoice, type JudgeQuestion } from "../../src/judge/choice.ts";
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
