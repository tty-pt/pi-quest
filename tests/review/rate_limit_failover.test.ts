import assert from "node:assert";
import type { Qid } from "../../src/domain/qid.ts";
import { createQuest } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { replaceState } from "../../src/app/store.ts";
import type { Pi } from "../../src/hooks/events.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import {
  reviewModelCandidates,
  extractProvider,
} from "../../src/review/model.ts";
import {
  clearReviewCooldowns,
  isModelInCooldown,
  recordModelCooldown,
  runIsolatedReview,
} from "../../src/review/flow.ts";

function flowBus(): { pi: Pi; emitted: Array<{ event: string; data: unknown }>; feed: (data: unknown) => void } {
  const pi = fakePi();
  pi.toolNames = ["subagent"];
  const emitted: Array<{ event: string; data: unknown }> = [];
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  (pi as { events: unknown }).events = {
    on: (event: string, handler: (data: unknown) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {};
    },
    emit: (event: string, data: unknown) => {
      emitted.push({ event, data });
    },
  };
  const feed = (data: unknown) => {
    for (const handler of handlers.get("prompt-template:subagent:response") ?? []) handler(data);
  };
  return { pi, emitted, feed };
}

function requests(emitted: Array<{ event: string; data: unknown }>): Array<Record<string, unknown>> {
  return emitted
    .filter((e) => e.event === "prompt-template:subagent:request")
    .map((e) => e.data as Record<string, unknown>);
}

async function waitForRequests(
  emitted: Array<{ event: string; data: unknown }>,
  count: number,
): Promise<void> {
  for (let i = 0; i < 200 && requests(emitted).length < count; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

Deno.test("rate_limit_failover: reviewModelCandidates auto-appends routerDefault, sessionModel, and inherit", () => {
  const cands = reviewModelCandidates("anthropic/claude-sonnet-5-5:low", ["other/model"], {
    routerDefault: "antigravity/gemini-3.8-flash",
    sessionModel: "antigravity/gemini-3.8-flash:high",
    appendInherit: true,
  });

  const models = cands.map((c) => c.model ?? c.label);
  assert.strictEqual(models.includes("anthropic/claude-sonnet-5-5:low"), true);
  assert.strictEqual(models.includes("anthropic/claude-sonnet-5-5"), true);
  assert.strictEqual(models.includes("other/model"), true);
  assert.strictEqual(models.includes("antigravity/gemini-3.8-flash"), true);
  assert.strictEqual(models.includes("antigravity/gemini-3.8-flash:high"), true);
  assert.strictEqual(models.includes("inherit"), true);
});

Deno.test("rate_limit_failover: extractProvider parses provider namespace", () => {
  assert.strictEqual(extractProvider("anthropic/claude-sonnet-5-5"), "anthropic");
  assert.strictEqual(extractProvider("antigravity/gemini-3.8-flash:low"), "antigravity");
  assert.strictEqual(extractProvider("openai/gpt-4o"), "openai");
  assert.strictEqual(extractProvider("bare-model-id"), "");
  assert.strictEqual(extractProvider(undefined), "");
});

Deno.test("rate_limit_failover: isModelInCooldown tracks active and expired cooldowns", () => {
  clearReviewCooldowns();
  const now = 1000000;
  recordModelCooldown("anthropic/claude-sonnet-5-5", 60000, now);

  assert.strictEqual(isModelInCooldown("anthropic/claude-sonnet-5-5", now + 1000), true);
  assert.strictEqual(isModelInCooldown("anthropic/claude-sonnet-5-5", now + 59999), true);
  assert.strictEqual(isModelInCooldown("anthropic/claude-sonnet-5-5", now + 60001), false);
  assert.strictEqual(isModelInCooldown("other/model", now), false);
  clearReviewCooldowns();
});

Deno.test("rate_limit_failover: runIsolatedReview skips cooling models and fails over across providers", async () => {
  clearReviewCooldowns();
  const qid = "rl0001" as Qid;
  replaceState(createDraft(createQuest("req", qid), "mat"));
  const { pi, emitted, feed } = flowBus();

  const pending = runIsolatedReview({
    pi,
    ctx: fakeCtx("/tmp"),
    qid,
    target: "target_rl_1",
    prompt: "review this",
    model: "anthropic/claude-sonnet-5-5:low",
    fallbackModels: ["anthropic/claude-haiku-3-5", "antigravity/gemini-3.8-flash"],
    routerDefault: "antigravity/gemini-3.8-flash",
  });

  // Attempt 1: anthropic/claude-sonnet-5-5:low fails with 429 quota error
  await waitForRequests(emitted, 1);
  const req1 = requests(emitted)[0];
  assert.strictEqual(req1["model"], "anthropic/claude-sonnet-5-5:low");

  feed({
    requestId: req1["requestId"],
    status: "error",
    error: "Subagent delegation failed (failed): Quota reached. 429 rate_limit_exceeded",
  });

  // Attempt 2: Both anthropic/claude-sonnet-5-5 (stripped variant) and anthropic/claude-haiku-3-5
  // (sibling model under provider:anthropic) should be SKIPPED due to provider cooldown!
  // Instead, it must fail over directly to antigravity/gemini-3.8-flash!
  await waitForRequests(emitted, 2);
  const req2 = requests(emitted)[1];
  assert.strictEqual(req2["model"], "antigravity/gemini-3.8-flash");

  // Attempt 2 succeeds with PASS verdict
  feed({
    requestId: req2["requestId"],
    status: "completed",
    result: { kind: "text", text: "VERDICT: PASS\nAll requirements verified." },
  });

  const outcome = await pending;
  assert.strictEqual(outcome.status, "verdict");
  if (outcome.status === "verdict") {
    assert.strictEqual(outcome.review.verdict, "PASS");
  }

  // Confirm anthropic model and provider are marked in cooldown
  assert.strictEqual(isModelInCooldown("anthropic/claude-sonnet-5-5:low"), true);
  assert.strictEqual(isModelInCooldown("anthropic/claude-sonnet-5-5"), true);
  assert.strictEqual(isModelInCooldown("provider:anthropic"), true);

  clearReviewCooldowns();
});
