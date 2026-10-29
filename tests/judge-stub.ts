// Test helper: replace global fetch with a deterministic judge so no test ever
// talks to a live auren server.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_INTENT_EXEMPLARS } from "../src/domain/intent-exemplars.ts";

/** `options` are the declared label keys in the order sent (reveals option ordering). */
export type JudgeAnswer = (questionId: string, state: string, options: string[]) => string | null;

/** Deterministic fake embedder: text -> vector. `null` => HTTP failure. */
export type EmbedAnswer = (text: string) => number[] | null;

/**
 * Install a fake judge (and optionally a fake `/v1/embeddings`); returns restore().
 * `null` answer => HTTP failure. Without `embed`, the embeddings endpoint is down,
 * so intent classification falls through to the judge exactly as before.
 */
export function stubJudgeFetch(answer: JudgeAnswer, embed?: EmbedAnswer): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: unknown, init?: { body?: string }) => {
    const urlStr = String(url);
    if (urlStr.includes("/v1/classify")) {
      // In the mock/stub environment for existing embed-counting tests,
      // return 404 to let tests testing local batch embedding and index caching fall back seamlessly
      return Promise.resolve(new Response("classify not available in mock", { status: 404 }));
    }
    if (urlStr.includes("/v1/embeddings")) {
      if (embed === undefined) return Promise.resolve(new Response("down", { status: 503 }));
      const input = (JSON.parse(init?.body ?? "{}") as { input?: string | string[] }).input ?? [];
      const texts = Array.isArray(input) ? input : [input];
      const vecs = texts.map((t) => embed(t));
      if (vecs.some((v) => v === null)) return Promise.resolve(new Response("down", { status: 503 }));
      const data = vecs.map((embedding, index) => ({ object: "embedding", index, embedding }));
      return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
    }
    const body = JSON.parse(init?.body ?? "{}") as { state?: string; questions?: Record<string, unknown> };
    const id = Object.keys(body.questions ?? {})[0] ?? "";
    const q = (body.questions ?? {})[id] as { criteria?: Record<string, string> } | undefined;
    const choice = answer(id, body.state ?? "", Object.keys(q?.criteria ?? {}));
    if (choice === null) return Promise.resolve(new Response("down", { status: 503 }));
    return Promise.resolve(new Response(JSON.stringify({ answers: { [id]: { choice } } }), { status: 200 }));
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

/** Write .pi/settings.json under cwd with the given pi-quest keys. */
export function writeQuestSettings(cwd: string, settings: Record<string, unknown>): void {
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi/settings.json"), JSON.stringify({ "pi-quest": settings }), "utf8");
}

export const JUDGE_ON = { judgeMode: "auto", embedMode: "auto", judgeUrl: "http://judge.test", judgeProtocol: "systemone" };
export const JUDGE_OFF = { judgeMode: "off", embedMode: "off" };

const INTENT_KINDS = Object.keys(DEFAULT_INTENT_EXEMPLARS);

/**
 * Deterministic intent embedder: every shipped exemplar embeds to its kind's axis and
 * each probe in `verdicts` (case-insensitive exact text) embeds to the axis of the kind
 * it should classify as; anything else lands on an orthogonal axis (=> refinement).
 */
export function toyIntentEmbed(verdicts: Record<string, string>): EmbedAnswer {
  const axis = (kind: string | undefined): number[] =>
    [...INTENT_KINDS.map((k) => (k === kind ? 1 : 0)), kind === undefined ? 1 : 0];
  const probes = new Map(Object.entries(verdicts).map(([t, k]) => [t.toLowerCase(), k]));
  return (text) => {
    const probe = probes.get(text.toLowerCase());
    if (probe !== undefined) return axis(probe);
    return axis(INTENT_KINDS.find((k) => (DEFAULT_INTENT_EXEMPLARS[k] ?? []).includes(text)));
  };
}

/** Install a fake embeddings server for steering classification; returns restore(). */
export function stubIntentEmbeddings(verdicts: Record<string, string>): () => void {
  return stubJudgeFetch(() => null, toyIntentEmbed(verdicts));
}
