import { check } from "../check.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { nearestExemplar } from "../../src/judge/nearest.ts";

Deno.test("nearestExemplar uses /v1/systemone when server responds 200", async () => {
  const real = globalThis.fetch;
  let systemoneCalled = false;
  let embedCalled = false;

  globalThis.fetch = ((url: unknown, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes("/v1/systemone")) {
      systemoneCalled = true;
      const parsed = JSON.parse(init?.body ?? "{}");
      check(parsed.text === "run unit tests", "probe text matches");
      check(parsed.labels?.verify !== undefined, "labels passed");
      return Promise.resolve(new Response(JSON.stringify({
        decision: "verify",
        choice: "verify",
        confidence: 0.92,
        similarity: 0.92,
        margin: 0.25,
        scores: { verify: 0.92, other: 0.67 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (u.includes("/v1/embeddings")) {
      embedCalled = true;
      return Promise.resolve(new Response("down", { status: 503 }));
    }
    return real(url as string, init as RequestInit);
  }) as typeof fetch;

  try {
    const res = await nearestExemplar(
      { ...DEFAULT_CONFIG, judgeUrl: "http://test-server:4242", judgeMode: "auto", embedMode: "auto" },
      [{ kind: "verify", text: "run tests" }, { kind: "other", text: "edit readme" }],
      "run unit tests",
    );
    check(res !== null, "verdict returned");
    check(res?.kind === "verify", `kind matches choice: ${res?.kind}`);
    check(res?.similarity === 0.92, `similarity matches: ${res?.similarity}`);
    check(res?.margin === 0.25, `margin matches: ${res?.margin}`);
    check(systemoneCalled, "/v1/systemone called");
    check(!embedCalled, "/v1/embeddings was not called (avoided float over TCP)");
  } finally {
    globalThis.fetch = real;
  }
});
