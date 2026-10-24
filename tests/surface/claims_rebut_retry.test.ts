import { check } from "../check.ts";
import { checkPlanCitations } from "../../src/surface/tools/claims.ts";
import { rebutTool } from "../../src/surface/tools/rebut.ts";
import {
  draftReviewRetryCount,
  clearDraftReviewRetry,
  setReviewRetryDispatcher,
  noteReviewLaunchFailed,
  MAX_REVIEW_RETRIES,
  REVIEW_RETRY_BASE_MS,
} from "../../src/drafting/draft-retry.ts";
import { createQuest, IDLE_STATE, type QuestState } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import { getState, replaceState } from "../../src/app/store.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { type Qid } from "../../src/domain/qid.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import type { Pi, PiCtx } from "../../src/hooks/events.ts";
import { join } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";

Deno.test("claims: checkPlanCitations validates citations against repository files", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "claims_test" });
  try {
    const ctx = fakeCtx(tmpDir);

    // Create mock file with 10 lines
    const mockFile = join(tmpDir, "example.ts");
    const content = Array.from({ length: 10 }, (_, i) => `// Line ${i + 1}`).join("\n");
    await writeFile(mockFile, content, "utf8");

    // 1. Valid citation
    const validPlan = "See example.ts:5 for details.";
    const validResult = await checkPlanCitations(ctx, validPlan);
    check(validResult.includes("1 citations resolve"), `valid citation produces resolved report, got: ${validResult}`);

    // 2. Out of range citation
    const outOfRangePlan = "See example.ts:25 for details.";
    const outResult = await checkPlanCitations(ctx, outOfRangePlan);
    check(outResult.includes("beyond 10 lines"), "flags line beyond file length");

    // 3. Out of range range citation
    const rangePlan = "See example.ts:5-30 for details.";
    const rangeResult = await checkPlanCitations(ctx, rangePlan);
    check(rangeResult.includes("beyond 10 lines"), "flags range beyond file length");

    // 4. Missing file citation
    const missingPlan = "See missing_file.ts:5 for details.";
    const missingResult = await checkPlanCitations(ctx, missingPlan);
    check(missingResult.includes("not found"), "flags missing file");

    // 5. External URLs are not treated as local file citations
    const urlPlan = "Check http://example.com/sound.c:10 for spec.";
    const urlResult = await checkPlanCitations(ctx, urlPlan);
    check(urlResult === "", "ignores web URL that looks like a citation");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

Deno.test("rebut: rebutTool validates inputs and records rebuttal into reviewDialogue", async () => {
  const pi = fakePi();
  const tool = rebutTool(pi as unknown as Pi);

  // 1. Short rebuttal rejected
  replaceState(IDLE_STATE);
  const shortRes = await tool.execute("call1", { rebuttal: "Too short" }, undefined, undefined, fakeCtx("/tmp"));
  check(String(shortRes.content[0].text).includes("needs a substantive rebuttal"), "rejects short rebuttal");

  // 2. Rebut without active quest rejected
  const idleRes = await tool.execute("call2", { rebuttal: "This is a substantive rebuttal with facts" }, undefined, undefined, fakeCtx("/tmp"));
  check(String(idleRes.content[0].text).includes("Nothing under review"), "rejects rebuttal when idle");

  // 3. Rebut in implementing rejected
  const qid = "reb001" as Qid;
  const quest = createQuest("Task", qid);
  quest.phase = "implementing";
  replaceState(quest);
  const impRes = await tool.execute("call3", { rebuttal: "This is a substantive rebuttal with facts" }, undefined, undefined, fakeCtx("/tmp"));
  check(String(impRes.content[0].text).includes("Nothing under review"), "rejects rebuttal in implementing phase");

  // 4. Rebut without prior review verdict rejected
  const drafting = createDraft(createQuest("Task", qid), "task");
  replaceState(drafting);
  const noRevRes = await tool.execute("call4", { rebuttal: "This is a substantive rebuttal with facts" }, undefined, undefined, fakeCtx("/tmp"));
  check(String(noRevRes.content[0].text).includes("No review verdict recorded yet"), "rejects when no review exists");

  // 5. Aborted signal returns aborted error
  const abortController = new AbortController();
  abortController.abort();
  const withReview: QuestState = {
    ...drafting,
    lastReview: {
      verdict: "FAIL",
      target: "hash123",
      findings: "Omitted requirement R1",
    },
  };
  replaceState(withReview);
  const abortedRes = await tool.execute("call5", { rebuttal: "Evidence shows R1 is implemented in audio.c:10" }, abortController.signal, undefined, fakeCtx("/tmp"));
  check(String(abortedRes.content[0].text).includes("Rebuttal aborted"), "handles aborted signal");

  // 6. Successful rebuttal records dialogue round into reviewDialogue
  const withValidDraft: QuestState = {
    ...withReview,
    draft: {
      ...withReview.draft!,
      contentHash: "hash123",
    },
  };
  replaceState(withValidDraft);
  const successRes = await tool.execute(
    "call6",
    { rebuttal: "Evidence shows R1 is implemented in audio.c:10" },
    undefined,
    undefined,
    fakeCtx("/tmp"),
  );
  check(!successRes.details || !(successRes.details as { error?: string }).error, "rebuttal executed successfully");
  const dialogue = getState().reviewDialogue;
  check(dialogue.length === 1, "recorded 1 dialogue round into reviewDialogue");
  check(dialogue[0].implementerRebuttal === "Evidence shows R1 is implemented in audio.c:10", "recorded implementer rebuttal text");
  check(dialogue[0].reviewerFindings === "Omitted requirement R1", "recorded reviewer findings");
  check(dialogue[0].verdictBefore === "FAIL", "recorded verdictBefore as FAIL");
});

Deno.test("draft_retry: tracks retry counts, exponential backoff, and exhaustion wake", () => {
  const qid = "rtr001";
  clearDraftReviewRetry(qid);
  check(draftReviewRetryCount(qid) === 0, "initial retry count is 0");

  let scheduledDelay = -1;
  let scheduledCallback: (() => void) | null = null;
  setReviewRetryDispatcher((delayMs, fn) => {
    scheduledDelay = delayMs;
    scheduledCallback = fn;
  });

  const pi = fakePi();
  const ctx = fakeCtx("/tmp");
  const config = DEFAULT_CONFIG;
  const userPathSteered = new Set<string>();
  let bootCalled = false;
  const bootReview = async () => {
    bootCalled = true;
  };

  // Attempt 1: schedules retry with backoff
  noteReviewLaunchFailed(pi as unknown as Pi, ctx, config, qid, "target1", "model error", userPathSteered, bootReview);
  check(draftReviewRetryCount(qid) === 1, "retry count incremented to 1");
  check(scheduledDelay >= REVIEW_RETRY_BASE_MS, "scheduled delay is at least base ms");

  // Attempt 2
  noteReviewLaunchFailed(pi as unknown as Pi, ctx, config, qid, "target1", "model error", userPathSteered, bootReview);
  check(draftReviewRetryCount(qid) === 2, "retry count incremented to 2");

  // Attempt 3
  noteReviewLaunchFailed(pi as unknown as Pi, ctx, config, qid, "target1", "model error", userPathSteered, bootReview);
  check(draftReviewRetryCount(qid) === 3, "retry count incremented to 3");

  // Attempt 4: exceeds MAX_REVIEW_RETRIES (3) -> exhausts retries and emits wake
  noteReviewLaunchFailed(pi as unknown as Pi, ctx, config, qid, "target1", "model error", userPathSteered, bootReview);
  check(draftReviewRetryCount(qid) === 0, "retry count deleted on exhaustion");
  check(pi.sent.length > 0, "wake notification sent to pi on retry exhaustion");
  const wakeMessage = pi.sent.find((s) => String(s.message.content).includes("Draft review failed 3 times"));
  check(wakeMessage !== undefined, "wake message contains retry count and failure reason");

  // Clean clear
  clearDraftReviewRetry(qid);
  check(draftReviewRetryCount(qid) === 0, "clearDraftReviewRetry resets count");
});
