import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import {
  FALLBACK_ADVANCE_WORD,
  clearIntentMemo,
  interpretUserTurn,
  isFallbackAdvance,
  parseExplicitSyntax,
} from "../../src/domain/intent.ts";
import { stubJudgeFetch } from "../judge-stub.ts";

const OFF: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "off" };
const ON: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: "http://judge.test" };

Deno.test("fallback has exactly one built-in word, exact-match only", () => {
  check(FALLBACK_ADVANCE_WORD === "go", "the single word");
  for (const t of ["go", "Go", " GO! ", "go."]) check(isFallbackAdvance(t), `"${t}" advances`);
  for (const t of ["go on", "we should go with B", "going", "ship it", "lgtm", "avança", ""]) {
    check(!isFallbackAdvance(t), `"${t}" is not a built-in advance`);
  }
});

Deno.test("operator phrases extend the fallback (diacritics/case/punctuation-insensitive)", () => {
  check(isFallbackAdvance("Avança!", ["avanca"]), "locale word from settings");
  check(!isFallbackAdvance("avança", []), "not built in");
});

Deno.test("explicit syntax is parsed without natural language", () => {
  check(parseExplicitSyntax("!sq fix leak")?.kind === "subquest_now", "!sq");
  check(parseExplicitSyntax("!later export csv")?.cleanText === "export csv", "!later");
  check(parseExplicitSyntax("must: use utf-8")?.kind === "constraint", "must:");
  check(parseExplicitSyntax("? what is this")?.kind === "chat", "? prefix");
  check(parseExplicitSyntax("please go on") === null, "prose is not syntax");
});

Deno.test("judge decides intent in any language; one judge call per message (memoized)", async () => {
  clearIntentMemo();
  let calls = 0;
  const restore = stubJudgeFetch(() => { calls += 1; return "question"; });
  try {
    const [a, b, c] = await Promise.all([
      interpretUserTurn("pode seguir em frente", "implementing", ON),
      interpretUserTurn("pode seguir em frente", "implementing", ON),
      interpretUserTurn("pode seguir em frente", "implementing", ON),
    ]);
    check(a.kind === "question" && a.source === "judge", "judge answer");
    check(b === a || b.kind === "question", "shared answer");
    check(c.kind === "question", "shared answer 3");
    check(calls === 1, `single judge call, got ${calls}`);
  } finally {
    restore();
    clearIntentMemo();
  }
});

Deno.test("a position-biased judge (always the first option) can never trigger an action", async () => {
  for (const phrase of ["we should go with approach B", "make sure you never touch the db"]) {
    clearIntentMemo();
    const restore = stubJudgeFetch((_id, _state, options) => options[0]);
    try {
      const r = await interpretUserTurn(phrase, "validating", ON);
      check(r.kind === "refinement", `"${phrase}" => ${r.kind}`);
    } finally {
      restore();
    }
  }
  // Same for a judge that always picks the LAST option: the reversed re-check disagrees.
  clearIntentMemo();
  const restore = stubJudgeFetch((_id, _state, options) => options[options.length - 1]);
  try {
    const r = await interpretUserTurn("obrigado pela ajuda", "validating", ON);
    check(r.kind === "refinement", `last-option bias => ${r.kind}`);
  } finally {
    restore();
  }
});

Deno.test("an actionable verdict needs the reversed-order re-check to agree", async () => {
  clearIntentMemo();
  let calls = 0;
  const restore = stubJudgeFetch(() => { calls += 1; return "advance"; });
  try {
    const r = await interpretUserTurn("pode seguir em frente", "validating", ON);
    check(r.kind === "advance" && r.source === "judge", "consistent judge advances");
    check(calls === 2, `exactly two judge calls for an actionable verdict, got ${calls}`);
  } finally {
    restore();
    clearIntentMemo();
  }
  clearIntentMemo();
  let n = 0;
  const flaky = stubJudgeFetch(() => (++n === 1 ? "advance" : "question"));
  try {
    check((await interpretUserTurn("hmm go with it?", "validating", ON)).kind === "refinement", "inconsistent => refinement");
  } finally {
    flaky();
    clearIntentMemo();
  }
});

Deno.test("judge failure or unknown label degrades to refinement, never to steering", async () => {
  for (const answer of [null, "banana"]) {
    clearIntentMemo();
    const restore = stubJudgeFetch(() => answer);
    try {
      const r = await interpretUserTurn("we should go with B instead", "drafting", ON);
      check(r.kind === "refinement" && r.source === "fallback", `answer=${answer}`);
    } finally {
      restore();
    }
  }
  clearIntentMemo();
  check((await interpretUserTurn("what does this do?", "drafting", OFF)).kind === "question", "trailing ? is a question");
  check((await interpretUserTurn("go", "drafting", OFF)).kind === "advance", "single word");
  clearIntentMemo();
});

Deno.test("long messages skip the judge and are directives", async () => {
  clearIntentMemo();
  let calls = 0;
  const restore = stubJudgeFetch(() => { calls += 1; return "advance"; });
  try {
    const r = await interpretUserTurn("x ".repeat(400), "drafting", ON);
    check(r.kind === "refinement" && calls === 0, "no judge call for long text");
  } finally {
    restore();
    clearIntentMemo();
  }
});
