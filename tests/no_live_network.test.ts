import { check } from "./check.ts";

// `npm test` preloads tests/no-live-network.ts. Opt-in live evaluations (and anyone running
// with PI_QUEST_ALLOW_LIVE=1) run without it, so these assertions only apply when it is active.
const GUARDED = (globalThis as { __piQuestNetworkGuard?: boolean }).__piQuestNetworkGuard === true;

async function refused(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return false;
  } catch (err) {
    return err instanceof Error && /live network is blocked/.test(err.message);
  }
}

Deno.test({
  name: "no-live-network guard: the real auren port and the public internet are refused during npm test",
  ignore: !GUARDED,
  fn: async () => {
    for (const url of ["http://127.0.0.1:4242/v1/models", "http://localhost:4242/v1/embeddings", "https://example.com/"]) {
      check(await refused(url), `${url} must be refused`);
    }
  },
});

Deno.test({
  name: "no-live-network guard: ephemeral loopback fake servers still work",
  ignore: !GUARDED,
  fn: async () => {
    const server = Deno.serve({ port: 0, onListen: () => {} }, () => new Response("ok"));
    try {
      const res = await fetch(`http://127.0.0.1:${server.addr.port}/`);
      check((await res.text()) === "ok", "fake server reachable");
    } finally {
      await server.shutdown();
    }
  },
});

Deno.test({
  name: "hermetic suite never auto-starts or provisions a local auren server",
  ignore: !GUARDED,
  fn: () => {
    check(Deno.env.get("PI_QUEST_AUTO_START_AUREN") === "0", "npm test must set PI_QUEST_AUTO_START_AUREN=0");
  },
});
