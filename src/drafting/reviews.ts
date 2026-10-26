// HIGH_LEVEL: #drafting — every content-changing save boots a fresh review.
// HIGH_LEVEL: #modes — PASS auto-promotes, FAIL returns findings, user "go" promotes.
// SPEC: B1.3 (supersede, thresholds, approval), B2 (go-override).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, updateState } from "../app/store";
import { emitNow, sendSteer, sendWake } from "../app/interpreter";
import { DEFAULT_CONFIG, getThresholdsForDifficulty, readQuestConfig, resolveRoleFallbacks, resolveRoleModel, type QuestConfig } from "../config";
import { childDeviated, researchRecorded, type ApprovedBy, type QuestKind, type QuestState } from "../domain/quest";
import { noteDraftFindings } from "../domain/transitions";
import { promoteAfterPass } from "./promote";
import { bypassDraftReview, bypassesDraftReview } from "./bypass";
import { draftPath } from "../domain/paths";
import type { Qid } from "../domain/qid";
import type { Pi, PiCtx, ToolResultEvent } from "../hooks/events";
import { onSessionStart, onToolResult, onTurnEnd, onUserMessage } from "../hooks/events";
import { buildReviewPrompt } from "../review/prompts";
import { runIsolatedReview } from "../review/flow";
import { cancelReview, isCurrentReview, supersedeReviewThenBootFresh } from "../review/tracker";
import { noteDraftUpdated } from "../durability/status";
import { handleDraftEdit } from "./edits";
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
import { evaluateSteeringIntent } from "../domain/steering";
export const GO_PATTERN = /^\s*(go|approve(?:d)?|lgtm|ship it)\s*[.!]*\s*$/i;

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
    return await readFile(join(ctx.cwd, draftPath(state.qid)), "utf8");
  } catch {
    return null;
  }
}

const userPathSteered = new Set<string>();

export async function bootDraftReview(
  pi: Pi,
  ctx: PiCtx,
  target: string,
  config: QuestConfig = DEFAULT_CONFIG,
): Promise<void> {
  const state = getState();
  if (state.phase !== "drafting" || state.qid === null) return;
  const qid = state.qid;
  const kind = state.kind;
  const content = await readDraftFile(ctx, state);
  if (content === null) return;
  const sections = parseDraftSections(content);
  const material = reviewMaterial(getState(), sections);
  const thresholds = getThresholdsForDifficulty(config, state.difficulty);
  const belowBar = !meetsReviewThresholds(sections, thresholds, kind);
  updateState((s) => s.draft === null ? s : { ...s, draft: { ...s.draft, lastReviewedPlan: deliverableBody(sections, kind) } });

  // Policy-based bypass (reviewPolicy "off", or "balanced" for non-complex).
  if (bypassesDraftReview(config, state)) {
    await bypassDraftReview(pi, ctx, config, { qid, state, sections, thresholds, belowBar });
    return;
  }

  const reviewerModel = resolveRoleModel(config, "reviewer");
  const outcome = await runIsolatedReview({
    pi,
    ctx,
    qid,
    target,
    prompt: buildReviewPrompt("draft", qid, target, material, thresholds, belowBar),
    runnerTool: config.bindings.reviewRunner.tool,
    ...(reviewerModel ? { model: reviewerModel } : {}),
    fallbackModels: resolveRoleFallbacks(config, "reviewer"),
    maxDurationMs: config.reviewMaxDurationMs,
    inactivityLimitMs: config.reviewInactivityMs,
  });
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
  if (outcome.status !== "verdict" || !outcome.settled) return;
  if (outcome.review.verdict === "PASS") {
    clearDraftReviewRetry(qid);
    clearReviewVerdictFails(qid);
    if (!researchRecorded(getState(), sections.evidence.length)) {
      sendSteer(pi, `Reviewer PASS recorded for ${qid}, but promotion needs recorded research: no evidence, refinements, or setback evidence on file. Record research via quest_update_state, or a live user may reply "go".`);
      return;
    }
    // Route by kind: standard quests promote to implementing; analysis quests
    // auto-claim straight to validating (D3) unless sub-quests still run.
    const message = await promoteAfterPass(pi, ctx, qid, "review");
    if (message === null) return;
    const advisories = outcome.review.advisories.trim();
    sendWake(pi, `${message}${advisories === "" ? "" : ` Non-blocking advisories: ${advisories} Record adopted ones via amendment as you work.`}`);
    return;
  }
  updateState((s) => noteDraftFindings(s));
  clearDraftReviewRetry(qid);
  emitNow(pi);
  const consecutive = noteReviewVerdictFailed(qid);
  const verbatim = outcome.review.text.trim();
  const reviewExcerpt = verbatim === ""
    ? ""
    : `\n\nReview text (verbatim, budget-bounded):\n${verbatim}`;
  const profile = belowBar
    ? `\n\nDraft profile:\n${draftProfileText(sections, thresholds, "", kind, state.difficulty)}`
    : "";

  if (consecutive >= MAX_CONSECUTIVE_REVIEW_FAILS) {
    sendWake(
      pi,
      `Draft review rejected ${consecutive} consecutive times for ${qid}. Automated review loop paused to prevent thrashing.\n` +
      `Reviewer findings: ${outcome.review.findings}${reviewExcerpt}\n\n` +
      `Consult the human operator for guidance, or the operator may reply "go" / "proceed" to bypass review and start coding immediately.`,
    );
    return;
  }

  sendWake(pi, `Draft review FAIL (target ${target.slice(0, 12)}): ${outcome.review.findings} Revise the ${deliverableWord(kind).toLowerCase()} and save; saving boots a fresh review.${reviewExcerpt}${profile}`);
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
  if (state.phase !== "drafting" || state.qid === null || state.draft === null) return;
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
  if (state.contract !== undefined || (state.parentQid !== null && !childDeviated(getState()))) {
    const message = await promoteAfterPass(pi, ctx, state.qid, "review");
    if (message !== null) {
      sendWake(pi, `${message} Sub-quest ${state.qid} auto-promoted to implementing based on contract/parent brief.`);
    }
    return;
  }
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
  if (state.phase !== "drafting" || state.qid === null || state.draft === null) return;
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
  // Natural language steering: advance intent (or GO_PATTERN) promotes a draft.
  // It is never served from a tool result — a quest_ask_human default is absence,
  // not approval, and so can never promote a draft.
  const config = await readQuestConfig(ctx.cwd);
  const steering = await evaluateSteeringIntent(text, "drafting", config);
  if (steering.action !== "advance" && !GO_PATTERN.test(text)) return false;
  const state = getState();
  if (state.phase !== "drafting" || state.qid === null) return false;
  return await approveDraft(pi, ctx, state.qid, "user");
}

async function onWriteResult(pi: Pi, ctx: PiCtx, event: ToolResultEvent): Promise<void> {
  if (event.isError) return;
  if (event.toolName !== "edit" && event.toolName !== "write") return;
  const rawPath = event.input["path"];
  if (typeof rawPath !== "string") return;
  const state = getState();
  if (state.phase !== "drafting" || state.qid === null) return;
  const expected = draftPath(state.qid);
  if (!rawPath.endsWith(expected)) return;
  const diskPath = rawPath.startsWith("/") ? rawPath : join(ctx.cwd, rawPath);
  let content: string;
  try {
    content = await readFile(diskPath, "utf8");
  } catch {
    return;
  }
  if (!handleDraftEdit(expected, hashContent(content))) return;
  noteDraftUpdated(ctx);
  void maybeBootDraftReview(pi, ctx);
}

export function watchDraftEdits(pi: Pi): void {
  onToolResult(pi, (event, eventCtx) => {
    void onWriteResult(pi, eventCtx, event);
  });
}

// Catch-all for bypass edits (bash heredocs, sed, external tools): the gate
// polices tool calls, not the filesystem. One hash compare per turn-end
// while drafting; a mismatch boots a fresh review and blinks.
export async function onTurnEndCatchAll(pi: Pi, ctx: PiCtx): Promise<void> {
  try {
    const state = getState();
    if (state.phase !== "drafting" || state.qid === null || state.draft === null) return;
    const expected = draftPath(state.qid);
    let content: string;
    try {
      content = await readFile(join(ctx.cwd, expected), "utf8");
    } catch {
      return;
    }
    const hash = hashContent(content);
    if (hash === state.draft.contentHash) return;
    if (state.draft.contentHash === null) {
      const sections = parseDraftSections(content);
      const deliverable = deliverableBody(sections, state.kind).trim();
      if (deliverable.length === 0) {
        // Scaffold absorption: record the baseline silently; creation blinked.
        updateState((s) => s.draft === null ? s : { ...s, draft: { ...s.draft, contentHash: hash } });
        return;
      }
      // Plan authored on turn 1: record hash, mark authored, and boot review immediately
      updateState((s) => s.draft === null ? s : { ...s, draft: { ...s.draft, contentHash: hash, planAuthored: true } });
      noteDraftUpdated(ctx);
      void maybeBootDraftReview(pi, ctx);
      return;
    }
    if (!handleDraftEdit(expected, hash)) return;
    noteDraftUpdated(ctx);
    void maybeBootDraftReview(pi, ctx);
  } catch {
    // Passive path: never break the agent.
  }
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
