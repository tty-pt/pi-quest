// HIGH_LEVEL: #review and validation communication.
// HIGH_LEVEL: #review request — brief identifies qid, type, target, plan, evidence, criteria.
// HIGH_LEVEL: #review result — exactly one verdict, recorded in history.
// HIGH_LEVEL: #stale results — only the current target can change state.
// HIGH_LEVEL: #independent review contexts — fresh context per run.
// HIGH_LEVEL: #no direct mutation — the flow records evidence, transitions stay in domain.
import { createHash } from "node:crypto";
import { updateState } from "../app/store";
import { sendSteer } from "../app/interpreter";
import type { Pi, PiCtx } from "../hooks/events";
import type { Qid } from "../domain/qid";
import type { QuestState } from "../domain/quest";
import { recordReviewResult } from "../domain/quest";
import { createRunner, isReviewerAvailable } from "./runner";
import {
  extractProvider,
  isModelResolutionOrProviderError,
  resolveDefaultReviewModel,
  resolveReviewThinking,
  reviewModelCandidates,
  stripThinkingSuffix,
} from "./model";
import { isRateLimitOrQuotaError } from "../utils/provider-error.ts";
import { parseReviewText, type ParsedReview } from "./verdicts";
import {
  cancelReview,
  isCurrentReview,
  settleReview,
  trackReview,
} from "./tracker";

export type FlowOutcome =
  | { status: "verdict"; review: ParsedReview; settled: boolean }
  | { status: "no-runner" }
  | { status: "aborted" }
  | { status: "failed"; detail: string };

export interface FlowArgs {
  pi: Pi;
  ctx: PiCtx;
  qid: Qid;
  target: string;
  prompt: string;
  runnerTool?: string;
  model?: string;
  fallbackModels?: readonly string[];
  routerDefault?: string | string[];
  sessionModel?: string;
  appendInherit?: boolean;
  cooldownMs?: number;
  thinking?: string;
  maxDurationMs?: number;
  inactivityLimitMs?: number;
}

export function reviewerAvailable(pi: Pi): boolean {
  return isReviewerAvailable(pi);
}

// One short notice per review target: the main agent must end its turn and
// wait — the verdict (which resumes work) arrives separately as a new turn.
// Never resumed from here: this path uses sendSteer, never sendWake.
const noticedReviews = new Set<string>();
const reviewCooldowns = new Map<string, number>();

export function isModelInCooldown(modelKey: string, now = Date.now()): boolean {
  const expiresAt = reviewCooldowns.get(modelKey.toLowerCase());
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    reviewCooldowns.delete(modelKey.toLowerCase());
    return false;
  }
  return true;
}

export function recordModelCooldown(modelKey: string, durationMs = 900000, now = Date.now()): void {
  reviewCooldowns.set(modelKey.toLowerCase(), now + durationMs);
}

export function clearReviewCooldowns(): void {
  reviewCooldowns.clear();
}

export function getReviewCooldowns(): ReadonlyMap<string, number> {
  return reviewCooldowns;
}

export function reviewRunningNotice(qid: string): string {
  return `Review running for quest ${qid} — end your turn; the verdict arrives as a new turn.`;
}

export function shouldNoticeReview(qid: string, target: string): boolean {
  const key = `${qid}:${target}`;
  if (noticedReviews.has(key)) return false;
  noticedReviews.add(key);
  return true;
}

// HIGH_LEVEL: #independent review contexts — stale session bookkeeping must
// not suppress a notice at the start of a fresh session.
export function resetNoticedReviews(): void {
  noticedReviews.clear();
}

export function implementationFingerprint(state: QuestState): string {
  const stable = {
    qid: state.qid,
    objective: state.objective,
    refinements: state.refinements,
    amendments: state.amendments,
    setbacks: state.setbacks,
    children: state.children.map((c) => `${c.qid}:${c.status}`),
    exactNextAction: state.exactNextAction,
    // HIGH_LEVEL: #plan revision — a staged or adopted revision must stale any prior PASS.
    approvedPlanHash: state.draft?.approvedPlanHash ?? null,
    draftHash: state.draft?.contentHash ?? null,
  };
  return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}

export async function runIsolatedReview(args: FlowArgs): Promise<FlowOutcome> {
  const { pi, ctx, qid, target } = args;
  const runnerTool = args.runnerTool ?? "subagent";
  if (!isReviewerAvailable(pi, runnerTool)) return { status: "no-runner" };
  // Ordered candidates: the resolved target first (it may carry a thinking
  // suffix the child registry never registered), then the suffix-stripped
  // variant, then configured role fallbacks, then router default, session model, and inherit.
  const targetModel = args.model ?? resolveDefaultReviewModel(ctx);
  const sessionModel = args.sessionModel;
  const thinking = args.thinking ?? resolveReviewThinking();
  const appendInherit = args.appendInherit ?? (args.routerDefault !== undefined || args.sessionModel !== undefined);
  const candidates = reviewModelCandidates(targetModel, args.fallbackModels ?? [], {
    routerDefault: args.routerDefault,
    sessionModel,
    appendInherit,
  });
  const controller = new AbortController();
  trackReview(qid, target, () => controller.abort());
  if (shouldNoticeReview(qid, target)) sendSteer(pi, reviewRunningNotice(qid));

  const cooldownMs = args.cooldownMs ?? 900000;
  const now = Date.now();

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    // A superseding boot owns the quest now; stop instead of launching stale.
    if (i > 0 && !isCurrentReview(qid, target)) return { status: "aborted" };

    // If candidate or its provider is on active rate-limit/auth cooldown, skip it
    // unless this is the final safety candidate.
    if (candidate.model) {
      const modelKey = candidate.model.toLowerCase();
      const prov = extractProvider(candidate.model);
      const isCooling = isModelInCooldown(modelKey, now) || (prov !== "" && isModelInCooldown(`provider:${prov}`, now));
      if (isCooling && i + 1 < candidates.length) {
        continue;
      }
    }

    const runner = createRunner({
      pi,
      ctx,
      ownerRunId: qid,
      toolName: runnerTool,
      ...(candidate.model ? { model: candidate.model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(args.maxDurationMs !== undefined ? { maxDurationMs: args.maxDurationMs } : {}),
      ...(args.inactivityLimitMs !== undefined ? { inactivityLimitMs: args.inactivityLimitMs } : {}),
    });
    if (runner === null) return { status: "no-runner" };
    try {
      const launched = await runner.launch(args.prompt, controller.signal);
      const review = parseReviewText(launched.text);
      updateState((s) => recordReviewResult(s, review.verdict, target, review.findings, review.text));
      return { status: "verdict", review, settled: settleReview(qid, target) };
    } catch (err) {
      if (controller.signal.aborted) return { status: "aborted" };
      const detail = err instanceof Error ? err.message : String(err);

      // On rate limit or quota exhaustion, record cooldown for this model, its base variant, and its provider
      if (isRateLimitOrQuotaError(detail)) {
        if (candidate.model) {
          const modelKey = candidate.model.toLowerCase();
          recordModelCooldown(modelKey, cooldownMs, now);
          const stripped = stripThinkingSuffix(candidate.model).toLowerCase();
          if (stripped !== modelKey) {
            recordModelCooldown(stripped, cooldownMs, now);
          }
          const prov = extractProvider(candidate.model);
          if (prov !== "") {
            recordModelCooldown(`provider:${prov}`, cooldownMs, now);
          }
        }
      }

      // On provider-wide auth failure, cooldown provider prefix
      if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|oauth_not_allowed/i.test(detail)) {
        const prov = extractProvider(candidate.model);
        if (prov !== "") {
          recordModelCooldown(`provider:${prov}`, cooldownMs, now);
        }
      }

      const retryable = isModelResolutionOrProviderError(detail) && i + 1 < candidates.length;
      if (!retryable) {
        if (isCurrentReview(qid, target)) cancelReview(qid);
        return { status: "failed", detail };
      }
    }
  }
  if (isCurrentReview(qid, target)) cancelReview(qid);
  return { status: "failed", detail: "all reviewer model candidates exhausted" };
}
