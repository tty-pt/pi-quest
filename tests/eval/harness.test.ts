import { check } from "../check.ts";
import { type Case, evaluateStrategy, formatReport, gateDecision, percentile, type Report, type Strategy } from "./harness.ts";

const CORPUS: Case[] = [
  { text: "fix the bug", want: "quest" },
  { text: "refactor the parser", want: "quest" },
  { text: "hello there", want: "chat" },
  { text: "what is a monad?", want: "chat" },
  { text: "bom dia", want: "chat" },
];

function fake(name: string, answers: Record<string, string | null>, delayMs = 0): Strategy {
  return {
    name,
    classify: async (text) => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return answers[text] ?? null;
    },
  };
}

Deno.test("percentile uses nearest-rank on sorted samples", () => {
  check(percentile([5, 1, 3, 2, 4], 50) === 3, "p50");
  check(percentile([5, 1, 3, 2, 4], 95) === 5, "p95");
  check(percentile([], 50) === 0, "empty");
});

Deno.test("evaluateStrategy counts accuracy, false positives on state-changing labels and misses", async () => {
  const s = fake("fake", {
    "fix the bug": "quest",
    "refactor the parser": "chat", // missed quest: wrong but NOT a false positive
    "hello there": "chat",
    "what is a monad?": "quest", // false quest: the state-changing error
    "bom dia": "chat",
  });
  const r = await evaluateStrategy(s, CORPUS, { stateChanging: new Set(["quest"]) });
  check(r.total === 5 && r.correct === 3, `3/5 correct, got ${r.correct}/${r.total}`);
  check(r.falsePositives === 1, `1 false positive, got ${r.falsePositives}`);
  check(Math.abs(r.falsePositiveRate - 1 / 3) < 1e-9, "fp rate is over the cases whose truth is NOT state-changing");
  check(r.unavailable === 0, "none unavailable");
  check(r.misses.length === 2 && r.misses[0]?.includes("refactor the parser"), "misses listed");
  check(r.byLabel["quest"]?.correct === 1 && r.byLabel["quest"]?.total === 2, "per-label recall");
});

Deno.test("unavailable answers are neither correct nor false positives", async () => {
  const r = await evaluateStrategy(fake("down", {}), CORPUS, { stateChanging: new Set(["quest"]) });
  check(r.unavailable === 5 && r.correct === 0 && r.falsePositives === 0, "all unavailable");
  check(r.accuracy === 0, "accuracy 0");
});

Deno.test("latency percentiles are recorded", async () => {
  const r = await evaluateStrategy(fake("slow", { "fix the bug": "quest" }, 5), CORPUS.slice(0, 1), {
    stateChanging: new Set(["quest"]),
  });
  check(r.p50Ms >= 4 && r.p95Ms >= r.p50Ms, `latency recorded (${r.p50Ms}/${r.p95Ms})`);
});

Deno.test("formatReport lists the gate numbers and every miss", async () => {
  const r = await evaluateStrategy(fake("f", { "fix the bug": "chat" }), CORPUS.slice(0, 1), { stateChanging: new Set(["quest"]) });
  const text = formatReport("quest intent", r);
  check(text.includes("quest intent") && text.includes("f:"), "header names decision and strategy");
  check(text.includes("miss: fix the bug"), "miss listed");
  check(/acc \d+\.\d%/.test(text) && /fp \d+\/\d+/.test(text) && /p50 \d+ms/.test(text), "gate numbers present");
});

function rep(over: Partial<Report>): Report {
  return {
    name: "r", total: 10, correct: 9, accuracy: 0.9, falsePositives: 0, falsePositiveRate: 0,
    unavailable: 0, p50Ms: 10, p95Ms: 20, misses: [], byLabel: {}, ...over,
  };
}

Deno.test("gateDecision adopts only on accuracy parity with zero false state-changing verdicts", () => {
  check(gateDecision(rep({}), rep({ accuracy: 0.9 })).adopt, "equal accuracy adopts");
  check(gateDecision(rep({ accuracy: 0.95 }), rep({ accuracy: 0.9 })).adopt, "better accuracy adopts");
  check(!gateDecision(rep({ accuracy: 0.85 }), rep({ accuracy: 0.9 })).adopt, "worse accuracy retains");
  const fp = gateDecision(rep({ accuracy: 1, falsePositives: 1 }), rep({ accuracy: 0.5 }));
  check(!fp.adopt && fp.reason.includes("false state-changing"), "one false verdict retains regardless of accuracy");
  check(!gateDecision(rep({ unavailable: 2 }), rep({})).adopt, "unavailable embeddings never adopt");
  check(!gateDecision(rep({}), null).adopt, "unmeasured judge never adopts silently");
  check(!gateDecision(rep({}), rep({ unavailable: 3 })).adopt, "an unavailable judge makes the comparison unsound");
});

Deno.test("a strategy's own warmup runs once, before timing, instead of the first classify", async () => {
  let warmups = 0;
  let classifies = 0;
  const s: Strategy = {
    name: "w",
    warmup: () => { warmups += 1; return Promise.resolve(); },
    classify: () => { classifies += 1; return Promise.resolve("quest"); },
  };
  await evaluateStrategy(s, CORPUS.slice(0, 3), { stateChanging: new Set(["quest"]) });
  check(warmups === 1, `warmup once, got ${warmups}`);
  check(classifies === 3, `no extra warm-up classify, got ${classifies}`);
  const plain = { name: "p", classify: () => { classifies += 1; return Promise.resolve("chat"); } };
  classifies = 0;
  await evaluateStrategy(plain, CORPUS.slice(0, 3), { stateChanging: new Set(["quest"]) });
  check(classifies === 4, `without warmup the first classify warms up, got ${classifies}`);
});
