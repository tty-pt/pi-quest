import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { clearEmbedState } from "../../src/judge/embed.ts";
import { clearNearestIndexes, gate, mergeExemplars, nearestExemplar } from "../../src/judge/nearest.ts";
import { stubJudgeFetch } from "../judge-stub.ts";

const ON: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", embedMode: "auto", judgeUrl: "http://judge.test" };

const TABLE = { a: ["alpha one", "alpha two"], b: ["beta one"], c: ["gamma one"] };

/** alpha -> x, beta -> y, gamma -> z, "mix" -> halfway between x and y, anything else -> w. */
function axisEmbed(text: string): number[] {
  if (text.includes("mix")) return [1, 1, 0, 0];
  if (text.includes("alpha")) return [1, 0, 0, 0];
  if (text.includes("beta")) return [0, 1, 0, 0];
  if (text.includes("gamma")) return [0, 0, 1, 0];
  return [0, 0, 0, 1];
}

function fresh(): void {
  clearEmbedState();
  clearNearestIndexes();
}

Deno.test("mergeExemplars de-duplicates, adds operator examples and drops unknown kinds", () => {
  const merged = mergeExemplars(TABLE, { a: ["alpha one", "alpha three"], zzz: ["ignored"] }, new Set(["a", "b", "c"]));
  const keys = merged.map((e) => `${e.kind}:${e.text}`);
  check(keys.length === 5, `5 unique examples, got ${keys.length}`);
  check(keys.includes("a:alpha three"), "operator example merged");
  check(!keys.some((k) => k.startsWith("zzz")), "unknown kind dropped");
  check(mergeExemplars(TABLE, {}).length === 4, "no allow-list keeps every kind");
});

Deno.test("nearestExemplar returns the best kind with similarity and margin", async () => {
  fresh();
  const restore = stubJudgeFetch(() => null, axisEmbed);
  try {
    const examples = mergeExemplars(TABLE, {});
    const hit = await nearestExemplar(ON, examples, "alpha question");
    check(hit?.kind === "a", `kind a, got ${hit?.kind}`);
    check(Math.abs((hit?.similarity ?? 0) - 1) < 1e-9, "similarity 1");
    check(Math.abs((hit?.margin ?? 0) - 1) < 1e-9, "margin 1 over an orthogonal runner-up");
    const tie = await nearestExemplar(ON, examples, "mix");
    check(Math.abs((tie?.margin ?? 1)) < 1e-9, "a tie has zero margin");
  } finally {
    restore();
    fresh();
  }
});

Deno.test("nearestExemplar embeds the examples once and reuses the index", async () => {
  fresh();
  let batches = 0;
  const real = globalThis.fetch;
  const restore = stubJudgeFetch(() => null, axisEmbed);
  const stubbed = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: { body?: string }) => {
    const input = (JSON.parse(init?.body ?? "{}") as { input?: string | string[] }).input;
    if (Array.isArray(input) && input.length > 1) batches += 1;
    return stubbed(url as string, init as RequestInit);
  }) as typeof fetch;
  try {
    const examples = mergeExemplars(TABLE, {});
    await nearestExemplar(ON, examples, "alpha 1");
    await nearestExemplar(ON, examples, "beta 1");
    check(batches === 1, `examples batch-embedded once, got ${batches}`);
    // A different example set is a different index.
    await nearestExemplar(ON, mergeExemplars({ a: ["alpha only"], b: ["beta only"] }, {}), "alpha 1");
    check(batches === 2, `new example set re-embeds, got ${batches}`);
  } finally {
    globalThis.fetch = real;
    restore();
    fresh();
  }
});

Deno.test("nearestExemplar is null when embeddings are off, down or malformed", async () => {
  fresh();
  const examples = mergeExemplars(TABLE, {});
  check((await nearestExemplar({ ...ON, embedMode: "off" }, examples, "alpha")) === null, "off => null");
  check((await nearestExemplar({ ...ON, judgeUrl: undefined }, examples, "alpha")) === null, "no url => null");
  const down = stubJudgeFetch(() => null, () => null);
  try {
    check((await nearestExemplar(ON, examples, "alpha")) === null, "server down => null");
  } finally {
    down();
    fresh();
  }
  check((await nearestExemplar(ON, [], "alpha")) === null, "no examples => null");
});

Deno.test("gate: floor sends everything weak to the harmless kind; margin only binds actionable kinds", () => {
  const opts = { minSimilarity: 0.6, minMargin: 0.1, harmless: "chat", actionable: new Set(["go"]) };
  check(gate({ kind: "go", similarity: 0.9, margin: 0.5 }, opts) === "go", "strong actionable passes");
  check(gate({ kind: "go", similarity: 0.5, margin: 0.5 }, opts) === "chat", "below the floor is harmless");
  check(gate({ kind: "go", similarity: 0.9, margin: 0.05 }, opts) === "chat", "thin margin on an actionable kind is harmless");
  check(gate({ kind: "other", similarity: 0.9, margin: 0.0 }, opts) === "other", "margin does not bind non-actionable kinds");
  check(gate({ kind: "other", similarity: 0.3, margin: 0.9 }, opts) === "chat", "floor binds every kind");
});
