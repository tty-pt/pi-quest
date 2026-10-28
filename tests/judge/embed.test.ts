import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { clearEmbedState, cosine, embedBaseUrl, embedTexts } from "../../src/judge/embed.ts";
import { stubJudgeFetch } from "../judge-stub.ts";

const ON: QuestConfig = { ...DEFAULT_CONFIG, judgeMode: "auto", judgeUrl: "http://judge.test/api/v1/systemone/" };

Deno.test("embedding base url is derived from the judge url unless embedUrl is set", () => {
  check(embedBaseUrl(ON) === "http://judge.test", "systemone suffix stripped");
  check(embedBaseUrl({ ...ON, embedUrl: "http://emb.test/" }) === "http://emb.test", "embedUrl wins, slash trimmed");
  check(embedBaseUrl({ ...ON, judgeUrl: undefined }) === null, "no url => unavailable");
  check(embedBaseUrl({ ...ON, embedMode: "off" }) === null, "embedMode off");
});

Deno.test("embedTexts returns unit vectors in input order, null on any failure", async () => {
  clearEmbedState();
  const restore = stubJudgeFetch(() => null, (t) => (t === "a" ? [3, 4] : [0, 2]));
  try {
    const v = await embedTexts(ON, ["a", "b"]);
    check(v !== null && v.length === 2, "two vectors");
    check(Math.abs((v?.[0]?.[0] ?? 0) - 0.6) < 1e-9 && Math.abs((v?.[0]?.[1] ?? 0) - 0.8) < 1e-9, "normalized");
    check(Math.abs(cosine(v?.[0] ?? [], v?.[1] ?? []) - 0.8) < 1e-9, "cosine of unit vectors");
  } finally {
    restore();
  }
  clearEmbedState();
  const down = stubJudgeFetch(() => null, () => null);
  try {
    check((await embedTexts(ON, ["a"])) === null, "HTTP failure => null");
  } finally {
    down();
  }
  clearEmbedState();
});

Deno.test("malformed embedding payloads are unavailable, never guessed", async () => {
  clearEmbedState();
  const real = globalThis.fetch;
  for (const body of [{}, { data: [] }, { data: [{ embedding: ["x"] }] }, { data: [{ embedding: [] }] }, { data: [{ embedding: [0, 0] }] }]) {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))) as typeof fetch;
    clearEmbedState();
    check((await embedTexts(ON, ["a"])) === null, `rejects ${JSON.stringify(body)}`);
  }
  globalThis.fetch = real;
  clearEmbedState();
});

Deno.test("after a failure the endpoint is skipped briefly instead of stalling every message", async () => {
  clearEmbedState();
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (() => { calls += 1; return Promise.reject(new Error("refused")); }) as typeof fetch;
  try {
    await embedTexts(ON, ["a"]);
    await embedTexts(ON, ["a"]);
    check(calls === 1, `second call is skipped during backoff, got ${calls} fetches`);
  } finally {
    globalThis.fetch = real;
    clearEmbedState();
  }
});
