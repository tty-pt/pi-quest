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

Deno.test("detection opens a provisional quest on substance", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi();
  const created = await detectSubstantiveRequest(
    pi,
    fakeCtx(tmp()),
    "Rebuild the review pipeline so verdicts carry severity and evidence.",
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
  const request = "Rebuild the review pipeline so verdicts carry severity and evidence.";
  const created = await detectSubstantiveRequest(pi, fakeCtx(cwd), request);
  check(created, "created");
  check(getState().phase === "provisional", "flow unchanged: still provisional");
  check(getState().draft === null, "flow unchanged: first draft still later");
  const file = await readFile(join(cwd, draftPath(getState().qid!)), "utf8");
  check(file.includes(request), "scaffold carries the request");
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

Deno.test("detection uses Jev System One judge to classify quest intent", async () => {
  let simulatedChoice: "quest" | "conversation" = "quest";

  const server = Deno.serve({ port: 0 }, async () => {
    return new Response(JSON.stringify({
      model: "qwen",
      answers: {
        quest_intent: {
          type: "choice",
          choice: simulatedChoice,
          confidence: 0.99,
        },
      },
    }), {
      headers: { "Content-Type": "application/json" },
    });
  });

  const port = server.addr.port;
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "systemone",
    judgeUrl: `http://127.0.0.1:${port}`,
    judgeModel: "qwen",
  };

  try {
    // 1. When Jev returns quest
    replaceState(IDLE_STATE);
    const pi1 = fakePi();
    const ctx1 = fakeCtx(tmp());
    simulatedChoice = "quest";
    const resQuest = await detectSubstantiveRequest(pi1, ctx1, "Optimize database checkpoints", cfg);
    check(resQuest, "quest created by Jev decision");
    check(getState().phase === "provisional", "phase is provisional");

    // 2. When Jev returns conversation
    replaceState(IDLE_STATE);
    const pi2 = fakePi();
    const ctx2 = fakeCtx(tmp());
    simulatedChoice = "conversation";
    const resConv = await detectSubstantiveRequest(pi2, ctx2, "My grandfather visited yesterday", cfg);
    check(!resConv, "conversation ignored by Jev decision");
    check(getState().phase === "idle", "phase remains idle");
    replaceState(IDLE_STATE);
  } finally {
    await server.shutdown();
  }
});
