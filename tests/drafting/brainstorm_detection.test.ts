import assert from "node:assert";
import { parseExplicitSyntax } from "../../src/domain/intent.ts";
import { detectSubstantiveRequest } from "../../src/drafting/detect.ts";
import { DEFAULT_CONFIG, type QuestConfig } from "../../src/config.ts";
import { fakePi } from "../fake-pi.ts";
import { getState, replaceState } from "../../src/app/store.ts";
import { IDLE_STATE } from "../../src/domain/quest.ts";
import type { Pi, PiCtx } from "../../src/hooks/events.ts";

Deno.test("brainstorm_detection: parseExplicitSyntax recognizes explicit chat sigils", () => {
  const b1 = parseExplicitSyntax("? what do you think of this approach?");
  assert.strictEqual(b1?.kind, "chat");

  const b2 = parseExplicitSyntax("!chat can you look at seven-world?");
  assert.strictEqual(b2?.kind, "chat");

  const b3 = parseExplicitSyntax("chat: how does the texture cache work?");
  assert.strictEqual(b3?.kind, "chat");
});

Deno.test("brainstorm_detection: detectSubstantiveRequest does not open a quest for chat sigils", async () => {
  replaceState(IDLE_STATE);
  const pi = fakePi() as unknown as Pi;
  const ctx = { cwd: "/tmp", hasUI: false, mode: "headless" } as unknown as PiCtx;
  const cfg: QuestConfig = {
    ...DEFAULT_CONFIG,
    judgeMode: "off",
  };

  const isQuest1 = await detectSubstantiveRequest(pi, ctx, "? what do you think of this approach?", cfg);
  assert.strictEqual(isQuest1, false);
  assert.strictEqual(getState().qid, null);

  const isQuest2 = await detectSubstantiveRequest(pi, ctx, "!chat let's brainstorm about textures", cfg);
  assert.strictEqual(isQuest2, false);
  assert.strictEqual(getState().qid, null);
});
