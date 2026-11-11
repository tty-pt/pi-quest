// HIGH_LEVEL: #drafting — every content-changing save boots a fresh review.
// HIGH_LEVEL: #modes — PASS auto-promotes, FAIL returns findings, user "go" promotes.
// SPEC: B1.3 (supersede, thresholds, approval), B2 (go-override).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, updateState } from "../app/store";
import { emitNow, sendSteer, sendWake } from "../app/interpreter";
import { DEFAULT_CONFIG, getThresholdsForDifficulty, readQuestConfig, resolveRoleFallbacks, resolveRoleModel, type QuestConfig } from "../config";
import { childDeviated, difficultyLevel, researchRecorded, type ApprovedBy, type QuestKind, type QuestState } from "../domain/quest";
import { recalibrateQuestDifficulty } from "./difficulty";
import { noteDraftFindings } from "../domain/transitions";
import { promoteAfterPass } from "./promote";
import { bypassDraftReview, bypassesDraftReview } from "./bypass";
import { assessDraftQuality } from "./quality";
import { withEffectivePolicy } from "../policy/effective";
import { draftPath } from "../domain/paths";
import { draftFilePath } from "../files";
import type { Qid } from "../domain/qid";
import type { Pi, PiCtx, ToolResultEvent } from "../hooks/events";
import { onSessionStart, onToolResult, onTurnEnd, onUserMessage } from "../hooks/events";
import { buildReviewPrompt } from "../review/prompts";
import { runIsolatedReview } from "../review/flow";
import { cancelReview, hasInFlight, isCurrentReview, supersedeReviewThenBootFresh } from "../review/tracker";
import { noteDraftUpdated } from "../durability/status";
import {
  handleDraftEdit,
  onWriteResult as doOnWriteResult,
  onTurnEndCatchAll as doOnTurnEndCatchAll,
} from "./edits";
import {
  bumpReviewCount,
  deliverableBody,
  deliverableWord,
  draftProfileText,
  hasAuthoredText,
  hashContent,
  meetsReviewThresholds,
  parseDraftSections,
  reviewMaterial,
} from "./plan-text";
import { interpretUserTurn } from "../judge/intent-classifier";
import {
  handleDraftFailVerdict,
  handleDraftFastFail,
  handleDraftPassVerdict,
} from "./review-outcomes";

import {
  bumpReviewCountAndReboot as doBumpReviewCountAndReboot,
  clearDraftReviewRetry,
  draftReviewRetryCount,
  noteReviewLaunchFailed,
  setReviewRetryDispatcher,
  MAX_REVIEW_RETRIES,
  MAX_CONSECUTIVE_REVIEW_FAILS,
  REVIEW_RETRY_BASE_MS,
  clearReviewVerdictFails,
  noteReviewVerdictFailed,
  getReviewVerdictFails,
  type RetryDispatcher,
} from "./draft-retry";
export {
  clearDraftReviewRetry,
  clearReviewVerdictFails,
  draftReviewRetryCount,
  getReviewVerdictFails,
  setReviewRetryDispatcher,
  MAX_REVIEW_RETRIES,
  MAX_CONSECUTIVE_REVIEW_FAILS,
  REVIEW_RETRY_BASE_MS,
  type RetryDispatcher,
};

async function readDraftFile(ctx: PiCtx, state: QuestState): Promise<string | null> {
  if (state.qid === null) return null;
  try {
    return await readFile(draftFilePath(ctx.cwd, state.qid), "utf8");
  } catch {
    return null;
  }
}

const userPathSteered = new Set<string>();
const staleRecovered = new Set<string>();

// A verdict for a superseded target is normally harmless: the save that
// superseded it booted its own review. When nothing is in flight any more the
// draft would sit unreviewed with nothing to wake the agent, so re-boot once
// for the current file content, then wake the agent instead of looping.
async function recoverStaleVerdict(pi: Pi, ctx: PiCtx, qid: Qid, target: string): Promise<void> {
  const state = getState();
  if (state.phase !== "drafting" || state.qid !== qid || state.draft === null) return;
  if (hasInFlight(qid) || state.draft.approvedBy !== null) return;
  const key = `${qid}:${target}`;
  if (staleRecovered.has(key)) {
    sendWake(pi, `A draft review verdict for ${qid} arrived for a superseded revision and no review is running. Save the draft to boot a fresh review, or a live user may reply "go".`);
    return;
  }
  staleRecovered.add(key);
  await maybeBootDraftReview(pi, ctx);
}

async function executeDraftReview(
  pi: Pi,
  ctx: PiCtx,
  qid: Qid,
  target: string,
  material: ReturnType<typeof reviewMaterial>,
  thresholds: ReturnType<typeof getThresholdsForDifficulty>,
  belowBar: boolean,
  quality: { summary: string },
  config: QuestConfig,
) {
  const reviewerModel = resolveRoleModel(config, "reviewer");
  return runIsolatedReview({
    pi,
    ctx,
    qid,
    target,
    prompt: buildReviewPrompt("draft", qid, target, material, thresholds, belowBar) +
      (quality.summary !== "" ? `\n\nDeterministic quality findings (advisory): ${quality.summary}` : ""),
    runnerTool: config.bindings.reviewRunner.tool,
    ...(reviewerModel ? { model: reviewerModel } : {}),
    fallbackModels: resolveRoleFallbacks(config, "reviewer"),
    routerDefault: config.router.default,
    cooldownMs: config.router.cooldownMs,
    maxDurationMs: config.reviewMaxDurationMs,
    inactivityLimitMs: config.reviewInactivityMs,
  });
}

export async function bootDraftReview(
  pi: Pi,
  ctx: PiCtx,
  target: string,
  baseConfig: QuestConfig = DEFAULT_CONFIG,
): Promise<void> {
  const config = withEffectivePolicy(baseConfig, ctx);
  const state = getState();
  if (state.phase !== "drafting" || state.qid === null) return;
  const qid = state.qid;
  const kind = state.kind;
  const content = await readDraftFile(ctx, state);
  if (content === null) return;
  const sections = parseDraftSections(content);
  const recalibrated = recalibrateQuestDifficulty(state, sections, content);
  let effectiveState = state;
  if (difficultyLevel(recalibrated) > difficultyLevel(state.difficulty)) {
    effectiveState = updateState((s) => ({ ...s, difficulty: recalibrated, snapshotPending: true }));
    emitNow(pi);
  }
  const material = reviewMaterial(effectiveState, sections);
  const thresholds = getThresholdsForDifficulty(config, effectiveState.difficulty);
  const quality = await assessDraftQuality(ctx, config, sections, kind, effectiveState.difficulty);
  const belowBar = !meetsReviewThresholds(sections, thresholds, kind);
  updateState((s) => s.draft === null ? s : { ...s, draft: { ...s.draft, lastReviewedPlan: deliverableBody(sections, kind) } });

  // Policy-based bypass (reviewPolicy "off", or "balanced" based on model risk and difficulty).
  if (bypassesDraftReview(config, effectiveState, ctx)) {
    await bypassDraftReview(pi, ctx, config, { qid, state: effectiveState, sections, thresholds, belowBar: belowBar || quality.blocks, quality });
    return;
  }

  // Deterministic local fast-fail: when deterministic quality checks block or draft is below maturity bar,
  // reject immediately in 0ms without launching an expensive doomed subagent review.
  if (belowBar || quality.blocks) {
    handleDraftFastFail(pi, qid, sections, thresholds, kind, effectiveState.difficulty, quality, belowBar);
    return;
  }

  const outcome = await executeDraftReview(pi, ctx, qid, target, material, thresholds, belowBar, quality, config);
  if (outcome.status === "no-runner") {
    if (!userPathSteered.has(`${qid}:${target}`)) {
      userPathSteered.add(`${qid}:${target}`);
      // No reviewer subagent exists: only a live human "go" (real input) may
      // promote. A quest_ask_human default is absence, not approval — it must
      // never be treated as promotion authority.
      sendSteer(pi, `No reviewer available for ${qid}. ${deliverableWord(kind)} at ${draftPath(qid)}. Only a live user reply "go" promotes; a quest_ask_human default does not count. Keep revising to stay in drafting.`);
    }
    return;
  }
  if (outcome.status === "failed") {
    noteReviewLaunchFailed(pi, ctx, config, qid, target, outcome.detail, userPathSteered, bootDraftReview);
    return;
  }
  if (outcome.status !== "verdict") return;
  if (!outcome.settled) {
    await recoverStaleVerdict(pi, ctx, qid, target);
    return;
  }
  if (outcome.review.verdict === "PASS") {
    await handleDraftPassVerdict(pi, ctx, qid, target, outcome.review, kind, config, sections.evidence.length);
    return;
  }
  handleDraftFailVerdict(pi, qid, target, outcome.review, sections, thresholds, kind, state, belowBar);
}

// A failed run's retry: rewrite the quest doc with the incremented review
// count, then boot the fresh review through the standard pipeline. Only
// fires while the file still holds the failed target — a superseding agent
// save cancels it (that save boots its own review) instead of clobbering.
export async function bumpReviewCountAndReboot(
  pi: Pi,
  ctx: PiCtx,
  config: QuestConfig,
  attempt: number,
  retryTarget: string,
): Promise<void> {
  return doBumpReviewCountAndReboot(pi, ctx, config, attempt, retryTarget, bootDraftReview);
}

export async function maybeBootDraftReview(pi: Pi, ctx: PiCtx): Promise<void> {
  const state = getState();
  if (state.disabled === true || state.phase !== "drafting" || state.qid === null || state.draft === null) return;
  const content = await readDraftFile(ctx, state);
  if (content === null) return;
  const sections = parseDraftSections(content);
  if (hasAuthoredText(deliverableBody(sections, state.kind)) && !state.draft.planAuthored) {
    updateState((s) => s.draft === null ? s : {
      ...s,
      draft: { ...s.draft, planAuthored: true },
      snapshotPending: true,
    });
  }
  const config = await readQuestConfig(ctx.cwd);
  const target = hashContent(content);
  if (state.draft.approvedBy !== null && state.draft.contentHash === target) return;
  if (isCurrentReview(state.qid, target)) return;
  if (state.parentQid !== null && !childDeviated(getState()) && state.contract === undefined) {
    const message = await promoteAfterPass(pi, ctx, state.qid, "review");
    if (message !== null) {
      sendWake(pi, `${message} Sub-quest ${state.qid} auto-promoted to implementing based on parent brief.`);
    }
    return;
  }
  // Nothing to review until a plan is authored; booting here would fail and
  // leave an unretryable empty-plan review (bumpReviewCount is a no-op).
  if (!hasAuthoredText(deliverableBody(sections, state.kind))) return;
  supersedeReviewThenBootFresh(state.qid, target, () => {
    void bootDraftReview(pi, ctx, target, config);
  });
}

// Resumed on session start: a drafting quest whose current disk content was
// never reviewed boots a fresh review, so a quit mid-review loses nothing.
// Recorded verdicts (PASS or FAIL) are left alone; planless drafts have
// nothing to review yet. Delegates to the single save-path boot below.
export async function ensureDraftReview(pi: Pi, ctx: PiCtx): Promise<void> {
  const state = getState();
  if (state.disabled === true || state.phase !== "drafting" || state.qid === null || state.draft === null) return;
  const content = await readDraftFile(ctx, state);
  if (content === null) return;
  if (deliverableBody(parseDraftSections(content), state.kind) === "") return;
  if (state.lastReview?.target === hashContent(content)) return;
  await maybeBootDraftReview(pi, ctx);
}

export async function approveDraft(pi: Pi, ctx: PiCtx, qid: Qid, by: ApprovedBy): Promise<boolean> {
  const state = getState();
  if (state.phase !== "drafting" || state.qid !== qid) return false;
  if (state.draft === null || !state.draft.planAuthored) {
    if (by === "user") {
      try {
        ctx.ui?.notify("Cannot promote draft: Implementation plan has not been authored yet.", "warning");
      } catch {
        // Best effort
      }
    }
    return false;
  }
  cancelReview(qid);
  clearDraftReviewRetry(qid);
  clearReviewVerdictFails(qid);
  // Kind-aware routing in promoteAfterPass: standard → implementing, analysis
  // → full-on validating once its children are done (D3).
  const message = await promoteAfterPass(pi, ctx, qid, by);
  if (message === null) return false;
  sendSteer(pi, message);
  return true;
}

export async function handleGoInput(pi: Pi, ctx: PiCtx, text: string): Promise<boolean> {
  // Advance intent (judge-first; one fallback word) promotes a draft.
  // It is never served from a tool result — a quest_ask_human default is absence,
  // not approval, and so can never promote a draft.
  const state = getState();
  if (state.disabled === true || state.phase !== "drafting" || state.qid === null) return false;
  const config = await readQuestConfig(ctx.cwd);
  const intent = await interpretUserTurn(text, "drafting", config);
  if (intent.kind !== "advance") return false;
  if (getState().phase !== "drafting") return false;
  const approved = await approveDraft(pi, ctx, state.qid, "user");
  if (approved && intent.cleanText && intent.cleanText.trim() !== "") {
    sendSteer(
      pi,
      `[Attached Directive upon approval]: "${intent.cleanText.trim()}". Incorporate this into the implementation phase.`,
    );
  }
  return approved;
}

export function watchDraftEdits(pi: Pi): void {
  onToolResult(pi, (event, eventCtx) => {
    if (getState().disabled === true) return;
    void doOnWriteResult(pi, eventCtx, event, maybeBootDraftReview);
  });
}

// Catch-all for bypass edits (bash heredocs, sed, external tools): the gate
// polices tool calls, not the filesystem. One hash compare per turn-end
// while drafting; a mismatch boots a fresh review and blinks.
export async function onTurnEndCatchAll(pi: Pi, ctx: PiCtx): Promise<void> {
  if (getState().disabled === true) return;
  return doOnTurnEndCatchAll(pi, ctx, maybeBootDraftReview);
}

export function watchDraftFileCatchAll(pi: Pi): void {
  onTurnEnd(pi, (_event, eventCtx) => {
    void onTurnEndCatchAll(pi, eventCtx).catch(() => {});
  });
}

export function watchResume(pi: Pi): void {
  onSessionStart(pi, (_event, eventCtx) => {
    void ensureDraftReview(pi, eventCtx).catch(() => {});
  });
}

export function watchGoInput(pi: Pi): void {
  onUserMessage(pi, (text, eventCtx) => {
    void handleGoInput(pi, eventCtx, text).catch(() => {});
  });
}
