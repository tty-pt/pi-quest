import { check } from "../check.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import {
  clearEmbedState,
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  resetCircuitBreaker,
  withCircuitBreaker,
} from "../../src/judge/embed.ts";
import { nearestExemplar } from "../../src/judge/nearest.ts";

const CFG: QuestConfig = {
  ...DEFAULT_CONFIG,
  judgeUrl: "http://test-server:4242",
  judgeMode: "auto",
  embedMode: "auto",
};

const EXAMPLES = [
  { kind: "quest", text: "fix the bug" },
  { kind: "conversation", text: "hello" },
];

Deno.test("circuit breaker: trips on connection refusal and suppresses subsequent calls", async () => {
  clearEmbedState();
  const real = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (() => {
    fetchCount++;
    return Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:4242"));
  }) as typeof fetch;

  try {
    check(!isCircuitOpen("http://test-server:4242"), "circuit initially closed");

    // First attempt fails fast and trips the circuit
    const res1 = await nearestExemplar(CFG, EXAMPLES, "fix bug in parser");
    check(res1 === null, "returns null on failure");
    check(fetchCount === 1, `first call attempted fetch once, got ${fetchCount}`);
    check(isCircuitOpen("http://test-server:4242"), "circuit now open");

    // Second attempt should fail-fast without touching fetch
    const t0 = performance.now();
    const res2 = await nearestExemplar(CFG, EXAMPLES, "hello there");
    const elapsed = performance.now() - t0;

    check(res2 === null, "second attempt returns null");
    check(fetchCount === 1, `second attempt did NOT call fetch (count remained ${fetchCount})`);
    check(elapsed < 10, `offline rejection took ${elapsed.toFixed(2)}ms (< 10ms target)`);
  } finally {
    globalThis.fetch = real;
    clearEmbedState();
  }
});

Deno.test("circuit breaker: withCircuitBreaker enforces timeout and trips on slow response", async () => {
  clearEmbedState();
  const real = globalThis.fetch;
  let fetchCount = 0;

  // Mock fetch that hangs forever
  globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => {
    fetchCount++;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    });
  }) as typeof fetch;

  try {
    const t0 = performance.now();
    const res = await withCircuitBreaker(
      "http://test-server:4242",
      async (signal) => {
        await globalThis.fetch("http://test-server:4242/v1/classify", { signal });
        return { ok: true };
      },
      { timeoutMs: 50 },
    );
    const elapsed = performance.now() - t0;

    check(res === null, "timed out call returns null / fallback");
    check(fetchCount === 1, "fetch called once");
    check(elapsed < 200, `aborted promptly in ${elapsed.toFixed(1)}ms`);
    check(isCircuitOpen("http://test-server:4242"), "circuit tripped on timeout");
  } finally {
    globalThis.fetch = real;
    clearEmbedState();
  }
});

Deno.test("circuit breaker: manual reset and success recovery clears open state", async () => {
  clearEmbedState();
  check(!isCircuitOpen("http://test-server:4242"), "initially closed");

  recordCircuitFailure("http://test-server:4242");
  check(isCircuitOpen("http://test-server:4242"), "circuit opened by failure");

  recordCircuitSuccess("http://test-server:4242");
  check(!isCircuitOpen("http://test-server:4242"), "circuit closed by success");

  recordCircuitFailure("http://test-server:4242");
  check(isCircuitOpen("http://test-server:4242"), "circuit opened again");

  resetCircuitBreaker();
  check(!isCircuitOpen("http://test-server:4242"), "resetCircuitBreaker resets circuit");
});
