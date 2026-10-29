import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import {
  FALLBACK_ADVANCE_WORD,
  clearIntentMemo,
  interpretUserTurn,
  isFallbackAdvance,
  parseExplicitSyntax,
} from "../../src/domain/intent.ts";
import { DEFAULT_INTENT_EXEMPLARS } from "../../src/domain/intent-exemplars.ts";
import { clearEmbedState } from "../../src/judge/embed.ts";
import { stubJudgeFetch } from "../judge-stub.ts";

const OFF: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "off", embedMode: "off" };
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

// ---- embedding classification (primary path) ----------------------------------------------
const KINDS = Object.keys(DEFAULT_INTENT_EXEMPLARS);
function unit(weights: Record<string, number>): number[] {
  return [...KINDS.map((k) => weights[k] ?? 0), weights["_other"] ?? 0];
}
/** Exemplar texts embed to their class axis; named probes embed to chosen mixtures. */
function toyEmbed(text: string): number[] {
  const probes: Record<string, number[]> = {
    "zzz-advance": unit({ advance: 1 }),
    "zzz-abort": unit({ abort: 1 }),
    "zzz-question": unit({ question: 1 }),
    "zzz-ambiguous": unit({ advance: 1, question: 0.97 }),
    "zzz-unrelated": unit({ _other: 1 }),
    "zzz-custom": unit({ advance: 1 }),
  };
  const probe = probes[text];
  if (probe !== undefined) return probe;
  const kind = KINDS.find((k) => (DEFAULT_INTENT_EXEMPLARS[k] ?? []).includes(text));
  return kind === undefined ? unit({ _other: 1 }) : unit({ [kind]: 1 });
}

async function withEmbed<T>(judge: () => string | null, fn: () => Promise<T>): Promise<T> {
  clearIntentMemo();
  clearEmbedState();
  const restore = stubJudgeFetch(judge, toyEmbed);
  try {
    return await fn();
  } finally {
    restore();
    clearIntentMemo();
    clearEmbedState();
  }
}

Deno.test("default exemplars cover every classifiable intent with enough examples", () => {
  for (const k of ["advance", "abort", "question", "ack", "refinement", "constraint", "subquest_now", "subquest_later"]) {
    const n = DEFAULT_INTENT_EXEMPLARS[k]?.length ?? 0;
    check(n >= 8, `${k} has ${n} exemplars`);
  }
});

Deno.test("embeddings classify steering with no judge call", async () => {
  let judgeCalls = 0;
  await withEmbed(() => { judgeCalls += 1; return "refinement"; }, async () => {
    const a = await interpretUserTurn("zzz-advance", "implementing", ON);
    check(a.kind === "advance" && a.source === "embed", `advance via embed, got ${a.kind}/${a.source}`);
    const x = await interpretUserTurn("zzz-abort", "implementing", ON);
    check(x.kind === "abort" && x.source === "embed", "abort via embed");
    const q = await interpretUserTurn("zzz-question", "implementing", ON);
    check(q.kind === "question" && q.source === "embed", "question via embed");
    check(judgeCalls === 0, `judge untouched, got ${judgeCalls}`);
  });
});

Deno.test("an ambiguous or unrelated message can never act: it is a recorded refinement", async () => {
  await withEmbed(() => "advance", async () => {
    const amb = await interpretUserTurn("zzz-ambiguous", "implementing", ON);
    check(amb.kind === "refinement" && amb.source === "embed", `margin gate, got ${amb.kind}/${amb.source}`);
    const far = await interpretUserTurn("zzz-unrelated", "implementing", ON);
    check(far.kind === "refinement" && far.source === "embed", `similarity gate, got ${far.kind}/${far.source}`);
  });
});

Deno.test("intentMinMargin is configurable", async () => {
  await withEmbed(() => null, async () => {
    const loose: QuestConfig = { ...ON, intentMinMargin: 0.001 };
    const r = await interpretUserTurn("zzz-ambiguous", "implementing", loose);
    check(r.kind === "advance" && r.source === "embed", `loosened gate acts, got ${r.kind}`);
  });
});

Deno.test("operator exemplars extend the defaults (any language)", async () => {
  await withEmbed(() => null, async () => {
    const custom: QuestConfig = { ...ON, intentExemplars: { advance: ["zzz-custom"] } };
    const r = await interpretUserTurn("zzz-custom", "implementing", custom);
    check(r.kind === "advance" && r.source === "embed", `custom exemplar, got ${r.kind}/${r.source}`);
  });
});

Deno.test("exemplars are embedded once; later messages cost one embedding request", async () => {
  clearIntentMemo();
  clearEmbedState();
  let embedRequests = 0;
  const restore = stubJudgeFetch(() => null, (t) => { embedRequests += 1; return toyEmbed(t); });
  try {
    await interpretUserTurn("zzz-advance", "implementing", ON);
    const afterFirst = embedRequests;
    await interpretUserTurn("zzz-abort", "implementing", ON);
    check(embedRequests - afterFirst === 1, `one more vector, got ${embedRequests - afterFirst}`);
  } finally {
    restore();
    clearIntentMemo();
    clearEmbedState();
  }
});

Deno.test("embeddings down => exact-word fallback only; the generative judge is never consulted", async () => {
  let judgeCalls = 0;
  clearIntentMemo();
  clearEmbedState();
  const restore = stubJudgeFetch(() => { judgeCalls += 1; return "advance"; });
  try {
    const r = await interpretUserTurn("pode seguir em frente", "implementing", ON);
    check(r.kind === "refinement" && r.source === "fallback", `no embeddings => refinement, got ${r.kind}/${r.source}`);
    const q = await interpretUserTurn("what does this do?", "implementing", ON);
    check(q.kind === "question" && q.source === "fallback", "trailing ? is still a question");
    const go = await interpretUserTurn("go", "implementing", ON);
    check(go.kind === "advance" && go.source === "fallback", "exact word");
    check(judgeCalls === 0, `judge untouched for steering, got ${judgeCalls}`);
  } finally {
    restore();
    clearIntentMemo();
    clearEmbedState();
  }
});

Deno.test("operator steeringPhrases still advance instantly, with no embedding request", async () => {
  let embedCalls = 0;
  clearIntentMemo();
  clearEmbedState();
  const restore = stubJudgeFetch(() => null, (t) => { embedCalls += 1; return toyEmbed(t); });
  try {
    const r = await interpretUserTurn("Avança!", "implementing", { ...ON, steeringPhrases: ["avanca"] });
    check(r.kind === "advance" && r.source === "fallback" && embedCalls === 0, `phrase wins, got ${r.source}/${embedCalls}`);
  } finally {
    restore();
    clearIntentMemo();
    clearEmbedState();
  }
});

Deno.test("embedMode off disables classification entirely", async () => {
  let embedCalls = 0;
  clearIntentMemo();
  clearEmbedState();
  const restore = stubJudgeFetch(() => null, (t) => { embedCalls += 1; return toyEmbed(t); });
  try {
    const r = await interpretUserTurn("zzz-advance", "implementing", { ...ON, embedMode: "off" });
    check(r.source === "fallback" && embedCalls === 0, `off => fallback, got ${r.source}/${embedCalls}`);
  } finally {
    restore();
    clearIntentMemo();
    clearEmbedState();
  }
});

Deno.test("long messages are directives: no embedding request", async () => {
  let embedCalls = 0;
  clearIntentMemo();
  clearEmbedState();
  const restore = stubJudgeFetch(() => null, (t) => { embedCalls += 1; return toyEmbed(t); });
  try {
    const r = await interpretUserTurn("x ".repeat(400), "drafting", ON);
    check(r.kind === "refinement" && embedCalls === 0, "no classification for long text");
  } finally {
    restore();
    clearIntentMemo();
    clearEmbedState();
  }
});
