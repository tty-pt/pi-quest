// HIGH_LEVEL: #drafting — review retry backoff and reboot dispatch.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, updateState } from "../app/store";
import { sendWake } from "../app/interpreter";
import type { QuestConfig } from "../config";
import { draftPath } from "../domain/paths";
import type { Pi, PiCtx } from "../hooks/events";
import { isCurrentReview, supersedeReviewThenBootFresh } from "../review/tracker";
import { noteDraftUpdated } from "../durability/status";
import { bumpReviewCount, hashContent } from "./plan-text";

export const MAX_REVIEW_RETRIES = 3;
export const MAX_CONSECUTIVE_REVIEW_FAILS = 2;
export const REVIEW_RETRY_BASE_MS = 4000;

const retryAttempts = new Map<string, number>();
const consecutiveReviewFails = new Map<string, number>();

export function draftReviewRetryCount(qid: string): number {
  return retryAttempts.get(qid) ?? 0;
}

export function clearDraftReviewRetry(qid: string): void {
  retryAttempts.delete(qid);
}

export function noteReviewVerdictFailed(qid: string): number {
  const next = (consecutiveReviewFails.get(qid) ?? 0) + 1;
  consecutiveReviewFails.set(qid, next);
  return next;
}

export function clearReviewVerdictFails(qid: string): void {
  consecutiveReviewFails.delete(qid);
}

export function getReviewVerdictFails(qid: string): number {
  return consecutiveReviewFails.get(qid) ?? 0;
}

export type RetryDispatcher = (delayMs: number, fn: () => void) => void;
let dispatchRetry: RetryDispatcher = (delayMs, fn) => {
  setTimeout(fn, delayMs);
};

export function setReviewRetryDispatcher(next: RetryDispatcher): RetryDispatcher {
  const previous = dispatchRetry;
  dispatchRetry = next;
  return previous;
}

export function noteReviewLaunchFailed(
  pi: Pi,
  ctx: PiCtx,
  config: QuestConfig,
  qid: string,
  target: string,
  detail: string,
  userPathSteered: Set<string>,
  bootReview: (pi: Pi, ctx: PiCtx, target: string, config: QuestConfig) => Promise<void>,
): void {
  const attempts = retryAttempts.get(qid) ?? 0;
  if (attempts < MAX_REVIEW_RETRIES) {
    const attempt = attempts + 1;
    retryAttempts.set(qid, attempt);
    const delay = REVIEW_RETRY_BASE_MS * 2 ** (attempt - 1);
    dispatchRetry(delay, () => {
      void bumpReviewCountAndReboot(pi, ctx, config, attempt, target, bootReview);
    });
    return;
  }
  retryAttempts.delete(qid);
  userPathSteered.add(`${qid}:${target}`);
  sendWake(pi, `Draft review failed ${MAX_REVIEW_RETRIES} times (last error: ${detail}). Revise the plan and save to boot a fresh review — promotion requires a reviewer PASS or a live user "go" reply.`);
}

export async function bumpReviewCountAndReboot(
  pi: Pi,
  ctx: PiCtx,
  config: QuestConfig,
  attempt: number,
  retryTarget: string,
  bootReview: (pi: Pi, ctx: PiCtx, target: string, config: QuestConfig) => Promise<void>,
): Promise<void> {
  const state = getState();
  if (state.phase !== "drafting" || state.qid === null) return;
  const qid = state.qid;
  if (retryAttempts.get(qid) !== attempt) return;
  let file: string;
  try {
    file = join(ctx.cwd, draftPath(qid));
  } catch {
    return;
  }
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch {
    return;
  }
  if (hashContent(content) !== retryTarget) {
    clearDraftReviewRetry(qid);
    return;
  }
  const bumped = bumpReviewCount(content, attempt, getState().kind);
  if (bumped === content) {
    // Nothing to bump (e.g. empty plan section): don't drop the retry silently.
    clearDraftReviewRetry(qid);
    sendWake(pi, "Draft review retry dropped: the draft has no plan text to re-review. Author the plan and save to boot a fresh review.");
    return;
  }
  try {
    await writeFile(file, bumped, "utf8");
  } catch {
    return;
  }
  const hash = hashContent(bumped);
  updateState((s) => s.draft === null ? s : {
    ...s,
    draft: { ...s.draft, contentHash: hash },
    snapshotPending: true,
  });
  noteDraftUpdated(ctx);
  if (isCurrentReview(qid, hash)) return;
  supersedeReviewThenBootFresh(qid, hash, () => {
    void bootReview(pi, ctx, hash, config);
  });
}
