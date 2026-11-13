// HIGH_LEVEL: #review and validation communication.
// HIGH_LEVEL: #review request — brief identifies qid, type, target, plan, evidence, criteria.
// HIGH_LEVEL: #review result — exactly one verdict, recorded in history.
// HIGH_LEVEL: #stale results — only the current target can change state.
// HIGH_LEVEL: #independent review contexts — fresh context per run.
// HIGH_LEVEL: #no direct mutation — the flow records evidence, transitions stay in domain.
import { createHash } from "node:crypto";
import { updateState } from "../app/store";
import { emitNow, sendSteer } from "../app/interpreter";
import type { Pi, PiCtx } from "../hooks/events";
import type { Qid } from "../domain/qid";
import type { QuestState, ReviewKind } from "../domain/quest";
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
import { lastRoutedModel } from "../router/last-route";

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
  reviewKind?: ReviewKind;
  signal?: AbortSignal;
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

function resolveCandidateModelForRun(candidateModel: string | undefined, routerDefault: string | string[] | undefined): string | undefined {
  const model = candidateModel ?? (routerDefault ? (Array.isArray(routerDefault) ? routerDefault[0] : routerDefault) : undefined);
  if (model && model.toLowerCase().startsWith("quest/")) {
    const physicalRouted = lastRoutedModel();
    if (physicalRouted && !physicalRouted.toLowerCase().startsWith("quest/")) return physicalRouted;
    if (routerDefault) {
      const def = Array.isArray(routerDefault) ? routerDefault[0] : routerDefault;
      if (def && !def.toLowerCase().startsWith("quest/")) return def;
    }
    return undefined;
  }
  if (!model) {
    const physicalRouted = lastRoutedModel();
    if (physicalRouted && !physicalRouted.toLowerCase().startsWith("quest/")) return physicalRouted;
  }
  return model;
}

function handleRateLimitError(detail: string, model: string | undefined, cooldownMs: number, now: number): void {
  if (!isRateLimitOrQuotaError(detail) || !model) return;
  const modelKey = model.toLowerCase();
  recordModelCooldown(modelKey, cooldownMs, now);
  const stripped = stripThinkingSuffix(model).toLowerCase();
  if (stripped !== modelKey) {
    recordModelCooldown(stripped, cooldownMs, now);
  }
  const prov = extractProvider(model);
  if (prov !== "" && !/quota\s+reached|model\s+quota/i.test(detail)) {
    recordModelCooldown(`provider:${prov}`, cooldownMs, now);
  }
}

function isCandidateInCooldown(model: string | undefined, now: number): boolean {
  if (!model) return false;
  const modelKey = model.toLowerCase();
  const prov = extractProvider(model);
  return isModelInCooldown(modelKey, now) || (prov !== "" && isModelInCooldown(`provider:${prov}`, now));
}

function handleCandidateError(detail: string, model: string | undefined, cooldownMs: number, now: number): void {
  handleRateLimitError(detail, model, cooldownMs, now);
  if (/\b(?:401|403)\b|unauthori[sz]ed|forbidden|oauth_not_allowed/i.test(detail) && model) {
    const prov = extractProvider(model);
    if (prov !== "") recordModelCooldown(`provider:${prov}`, cooldownMs, now);
  }
}

function clearActiveReviewIfMatching(qid: Qid, target: string): void {
  updateState((s) =>
    s.qid === qid && s.activeReview?.target === target
      ? {
          ...s,
          activeReview: null,
          ...(s.exactNextAction === reviewRunningNotice(qid) && s.phase === "implementing"
            ? { exactNextAction: "Implement the approved plan; claim completion via quest_update_state {claimComplete: true} when done." }
            : {}),
          snapshotPending: true,
        }
      : s
  );
}

function markActiveReview(qid: Qid, target: string, reviewKind: ReviewKind): void {
  updateState((s) =>
    s.qid === qid
      ? {
          ...s,
          activeReview: { kind: reviewKind, target },
          // Keep exactNextAction stable during validation so implementationFingerprint
          // does not drift between target computation and concludeValidationPass.
          ...(s.phase !== "validating" ? { exactNextAction: reviewRunningNotice(qid) } : {}),
          snapshotPending: true,
        }
      : s
  );
}

function bindReviewAbortController(qid: Qid, target: string, signal?: AbortSignal): AbortController | null {
  const controller = new AbortController();
  if (signal !== undefined) {
    if (signal.aborted || !isCurrentReview(qid, target)) {
      clearActiveReviewIfMatching(qid, target);
      return null;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
    return controller;
  }
  trackReview(qid, target, () => controller.abort());
  return controller;
}

export async function runIsolatedReview(args: FlowArgs): Promise<FlowOutcome> {
  const { pi, ctx, qid, target } = args;
  const reviewKind = args.reviewKind ?? "draft";
  const runnerTool = args.runnerTool ?? "subagent";
  if (!isReviewerAvailable(pi, runnerTool)) {
    if (isCurrentReview(qid, target)) cancelReview(qid);
    clearActiveReviewIfMatching(qid, target);
    return { status: "no-runner" };
  }
  const controller = bindReviewAbortController(qid, target, args.signal);
  if (controller === null) return { status: "aborted" };
  markActiveReview(qid, target, reviewKind);
  if (shouldNoticeReview(qid, target)) sendSteer(pi, reviewRunningNotice(qid));

  const targetModel = args.model ?? resolveDefaultReviewModel(ctx);
  const thinking = args.thinking ?? resolveReviewThinking();
  const appendInherit = args.appendInherit ?? (args.routerDefault !== undefined || args.sessionModel !== undefined);
  const candidates = reviewModelCandidates(targetModel, args.fallbackModels ?? [], {
    routerDefault: args.routerDefault,
    sessionModel: args.sessionModel,
    appendInherit,
  });
  const cooldownMs = args.cooldownMs ?? 900000;
  const now = Date.now();

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (i > 0 && !isCurrentReview(qid, target)) return { status: "aborted" };
    if (isCandidateInCooldown(candidate.model, now) && i + 1 < candidates.length) continue;

    const candidateModel = resolveCandidateModelForRun(candidate.model, args.routerDefault);
    const runner = createRunner({
      pi,
      ctx,
      ownerRunId: qid,
      toolName: runnerTool,
      ...(candidateModel ? { model: candidateModel } : {}),
      ...(args.routerDefault ? { routerDefault: Array.isArray(args.routerDefault) ? args.routerDefault[0] : args.routerDefault } : {}),
      ...(thinking ? { thinking } : {}),
      ...(args.maxDurationMs !== undefined ? { maxDurationMs: args.maxDurationMs } : {}),
      ...(args.inactivityLimitMs !== undefined ? { inactivityLimitMs: args.inactivityLimitMs } : {}),
    });
    if (runner === null) {
      if (isCurrentReview(qid, target)) cancelReview(qid);
      clearActiveReviewIfMatching(qid, target);
      return { status: "no-runner" };
    }
    try {
      const launched = await runner.launch(args.prompt, controller.signal);
      const review = parseReviewText(launched.text);
      const settled = settleReview(qid, target);
      if (settled) {
        updateState((s) => recordReviewResult(s, review.verdict, target, review.findings, review.text));
      } else {
        clearActiveReviewIfMatching(qid, target);
      }
      emitNow(pi);
      return { status: "verdict", review, settled };
    } catch (err) {
      if (controller.signal.aborted) {
        clearActiveReviewIfMatching(qid, target);
        return { status: "aborted" };
      }
      const detail = err instanceof Error ? err.message : String(err);
      handleCandidateError(detail, candidate.model, cooldownMs, now);
      if (!(isModelResolutionOrProviderError(detail) && i + 1 < candidates.length)) {
        if (isCurrentReview(qid, target)) cancelReview(qid);
        clearActiveReviewIfMatching(qid, target);
        emitNow(pi);
        return { status: "failed", detail };
      }
    }
  }
  if (isCurrentReview(qid, target)) cancelReview(qid);
  clearActiveReviewIfMatching(qid, target);
  emitNow(pi);
  return { status: "failed", detail: "all reviewer model candidates exhausted" };
}
