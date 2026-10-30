import { check } from "../check.ts";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getState, replaceState } from "../../src/app/store.ts";
import { detectSubstantiveRequest } from "../../src/drafting/detect.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { draftPath } from "../../src/domain/paths.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-quest-detect-"));
}

Deno.test("detection opens a provisional quest on substance via trigger prefix", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const created = await detectSubstantiveRequest(
    pi,
    fakeCtx(tmp()),
    "quest: Rebuild the review pipeline so verdicts carry severity and evidence.",
  );
  check(created, "created");
  check(getState().phase === "provisional", "provisional");
  check(getState().qid !== null, "qid assigned");
  check(pi.sent.length === 1, "agent steered");
  check(pi.appended.length === 1, "snapshot emitted");
  replaceState(IDLE_STATE);
});

Deno.test("detection pre-creates the draft scaffold file", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const cwd = tmp();
  const request = "quest: Rebuild the review pipeline so verdicts carry severity and evidence.";
  const created = await detectSubstantiveRequest(pi, fakeCtx(cwd), request);
  check(created, "created");
  check(getState().phase === "provisional", "flow unchanged: still provisional");
  check(getState().draft === null, "flow unchanged: first draft still later");
  const file = await readFile(join(cwd, draftPath(getState().qid!)), "utf8");
  check(file.includes("Rebuild the review pipeline"), "scaffold carries the objective");
  check(file.includes("## Implementation Plan"), "scaffold has plan section");
  replaceState(IDLE_STATE);
});

Deno.test("detection ignores acks, commands, and active quests", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const ctx = fakeCtx(tmp());
  check(!await detectSubstantiveRequest(pi, ctx, "thanks!"), "ack ignored");
  check(!await detectSubstantiveRequest(pi, ctx, "/quests"), "command ignored");
  check(!await detectSubstantiveRequest(pi, ctx, "what does this do?"), "short question ignored");
  check(getState().phase === "idle", "still idle");
  replaceState(createQuest("existing work", "abc123"));
  check(!await detectSubstantiveRequest(pi, ctx, "A whole new substantive request arrives."), "active quest blocks creation");
  replaceState(IDLE_STATE);
});

Deno.test("detection ignores casual narrative statements and memory probes", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const ctx = fakeCtx(tmp());
  check(!await detectSubstantiveRequest(pi, ctx, "I spoke to my grandfather under the cherry tree. The diagnostic token is CHERRY-PROBE-123."), "conversational memory probe ignored");
  check(!await detectSubstantiveRequest(pi, ctx, "Do you remember me speaking about my grandfather?"), "recall question ignored");
  check(getState().phase === "idle", "still idle");
  replaceState(IDLE_STATE);
});

Deno.test("detection uses embeddings to classify quest intent", async () => {
  const server = Deno.serve({ port: 0 }, async (req) => {
    const url = new URL(req.url);
    if (url.pathname.includes("/v1/systemone") || url.pathname.includes("/v1/classify")) {
      const body = await req.json();
      const choice = body.text.includes("Optimize") ? "quest" : "conversation";
      return new Response(JSON.stringify({
        choice,
        similarity: 0.95,
        margin: 0.35,
        scores: { quest: choice === "quest" ? 0.95 : 0.40, conversation: choice === "conversation" ? 0.95 : 0.40 },
        model: "bge-base",
      }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  });

  const port = server.addr.port;
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    embedUrl: `http://127.0.0.1:${port}`,
    embedModel: "bge-base",
  };

  try {
    // 1. When embeddings return quest
    replaceState(IDLE_STATE);
    const pi1 = fakePi();
    const ctx1 = fakeCtx(tmp());
    const resQuest = await detectSubstantiveRequest(pi1, ctx1, "Optimize database checkpoints", cfg);
    check(resQuest, "quest created by embedding decision");
    check(getState().phase === "provisional", "phase is provisional");

    // 2. When embeddings return conversation
    replaceState(IDLE_STATE);
    const pi2 = fakePi();
    const ctx2 = fakeCtx(tmp());
    const resConv = await detectSubstantiveRequest(pi2, ctx2, "My grandfather visited yesterday", cfg);
    check(!resConv, "conversation ignored by embedding decision");
    check(getState().phase === "idle", "phase remains idle");
    replaceState(IDLE_STATE);
  } finally {
    await server.shutdown();
  }
});

Deno.test("detection opens quest deterministically on trigger prefix without judge", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const ctx = fakeCtx(tmp());
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "off", // judge is off completely
  };

  const res1 = await detectSubstantiveRequest(pi, ctx, "quest: refactor the caching engine", cfg);
  check(res1, "quest created via 'quest:' prefix");
  check(getState().phase === "provisional", "phase is provisional");
  check(getState().objective === "refactor the caching engine", "objective prefix stripped");
  replaceState(IDLE_STATE);

  const res2 = await detectSubstantiveRequest(pi, ctx, "fix:memory timeout bug", cfg);
  check(res2, "quest created via 'fix:' prefix without space");
  check(getState().objective === "memory timeout bug", "objective stripped cleanly");
  replaceState(IDLE_STATE);

  const res3 = await detectSubstantiveRequest(pi, ctx, "@quest add doctor command", cfg);
  check(res3, "quest created via '@quest' prefix");
  check(getState().objective === "add doctor command", "objective stripped cleanly");
  replaceState(IDLE_STATE);
});

Deno.test("detection fails closed when judge is unreachable and no trigger is present", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const ctx = fakeCtx(tmp());
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "auto",
    judgeUrl: "http://127.0.0.1:59999", // Unreachable port
    judgeFallback: "skip",
  };

  const res = await detectSubstantiveRequest(pi, ctx, "Improve latency across all queries", cfg);
  check(!res, "failed closed without guessing via heuristics");
  check(getState().phase === "idle", "phase remains idle");
  replaceState(IDLE_STATE);
});
