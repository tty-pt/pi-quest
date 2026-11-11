// HIGH_LEVEL: #surviving — compaction never silently drops the quest.
// Before pi summarizes the transcript, a full handoff is written to disk;
// after the compaction lands, the next agent turn receives a one-shot
// pointer to it (path, requirements not yet verified, exact next action).
import { getState } from "../app/store";
import type { Pi, PiCtx } from "../hooks/events";
import { writeHandoff } from "./handoff-io";
import { getLastLoadedConfig } from "../config/loader";
import { DEFAULT_SUBQUEST_COMPACTION_CONFIG } from "../config/defaults";
import { sendFollowUp } from "../app/interpreter";
import { getInFlightTarget, hasInFlight } from "../review/tracker";

export interface CompactionPointer {
  qid: string;
  relPath: string;
  open: string[];
  nextAction: string;
  objective?: string;
  phase?: string;
  touchedFiles?: string[];
  activeRequirement?: string;
  lastTestReceipt?: string;
  inFlightReview?: { kind: string; target: string };
}

export interface SubquestHandbackInfo {
  parentQid: string;
  targetQid?: string;
  childQid: string;
  outcome: string;
  summary: string;
  modifiedFiles: string[];
  testCommand: string;
  testPassed: boolean;
  assignedRequirements: string[];
  openRequirements: string[];
  exactNextAction: string;
  turnCount?: number;
}

let pending: CompactionPointer | null = null;
let armed: CompactionPointer | null = null;
let stagedSubquestCompaction: SubquestHandbackInfo | null = null;
let armedSubquestResumption: SubquestHandbackInfo | null = null;
let postCompactionFollowUpPending: SubquestHandbackInfo | null = null;

export function stagePostSubquestCompaction(info: SubquestHandbackInfo): void {
  stagedSubquestCompaction = info;
}

export function getStagedPostSubquestCompaction(): SubquestHandbackInfo | null {
  return stagedSubquestCompaction;
}

export function takePostSubquestCompaction(): SubquestHandbackInfo | null {
  const staged = stagedSubquestCompaction;
  stagedSubquestCompaction = null;
  return staged;
}

export function armSubquestResumption(info: SubquestHandbackInfo): void {
  armedSubquestResumption = info;
}

export function takeSubquestResumption(qid: string | null): SubquestHandbackInfo | null {
  const hit = armedSubquestResumption;
  if (hit !== null && (hit.parentQid === qid || hit.targetQid === qid)) {
    armedSubquestResumption = null;
    return hit;
  }
  return null;
}

export function buildSubquestCompactionPrompt(info: SubquestHandbackInfo): string {
  const files = info.modifiedFiles.length > 0 ? info.modifiedFiles.join(", ") : "none";
  const reqs = info.openRequirements.length > 0 ? info.openRequirements.join(", ") : "none";
  return [
    `A child sub-quest (${info.childQid}) has finished (${info.outcome}) and returned to parent quest ${info.parentQid}.`,
    `Aggressively compact the session transcript:`,
    `1. Omit all temporary bash command traces, compiler outputs, intermediate file edits, and review deliberations from sub-quest ${info.childQid}.`,
    `2. Retain the core user objective and architecture for parent quest ${info.parentQid}.`,
    `3. Record that sub-quest ${info.childQid} completed (${info.outcome}):`,
    `   - Summary: ${info.summary}`,
    `   - Files modified: ${files}`,
    `   - Test verified: ${info.testCommand} (${info.testPassed ? "PASS" : "FAIL"})`,
    `4. Retain all remaining unfulfilled parent requirements (${reqs}) and the next step: "${info.exactNextAction}".`,
  ].join("\n");
}

export function renderSubquestResumption(info: SubquestHandbackInfo): string {
  const files = info.modifiedFiles.length > 0 ? info.modifiedFiles.join(", ") : "none";
  const openReqs = info.openRequirements.length > 0
    ? `\n  • Pending parent requirements: ${info.openRequirements.join(", ")}`
    : "";
  return [
    `\n[Sub-Quest Handback & Context Resumption]:`,
    `Sub-quest ${info.childQid} completed (${info.outcome}) and session context was compacted for clean continuation.`,
    `  • Child Summary: ${info.summary}`,
    `  • Files Modified: ${files}`,
    `  • Verified Test Receipt: \`${info.testCommand}\` (${info.testPassed ? "PASS" : "FAIL"})${openReqs}`,
    `  • Resuming Parent: ${info.parentQid} — Next Action: ${info.exactNextAction}`,
  ].join("\n");
}

/** Write the pre-compaction handoff for the active quest. Never throws. */
export async function handoffBeforeCompaction(pi: Pi, ctx: PiCtx): Promise<void> {
  const state = getState();
  if (state.qid === null || state.phase === "idle" || state.phase === "archived") return;
  try {
    const done = await writeHandoff(pi, ctx, state, "compaction");
    const latestReceipt = state.lastPassingTestReceipt ?? state.lastTestReceipt;
    const receiptSummary = latestReceipt
      ? `\`${latestReceipt.command}\` (${latestReceipt.exitCode === 0 ? "PASS" : `FAIL exit ${latestReceipt.exitCode}`})`
      : undefined;
    const activeReq = state.rtm?.find((r) => r.status === "pending")?.id ?? done.open[0];
    const inFlightTarget = getInFlightTarget(state.qid);
    const inFlightReview = state.activeReview !== null
      ? { kind: state.activeReview.kind, target: state.activeReview.target }
      : (inFlightTarget !== null && !state.draft?.outstandingFindings
        ? { kind: state.phase === "validating" ? "validation" : "draft", target: inFlightTarget }
        : undefined);
    const nextAction = inFlightReview !== undefined
      ? `Review (${inFlightReview.kind}) is running for quest ${done.qid} — end your turn and await the review verdict.`
      : state.exactNextAction;
    pending = {
      qid: done.qid,
      relPath: done.relPath,
      open: done.open,
      nextAction,
      objective: state.objective,
      phase: state.phase,
      touchedFiles: state.touchedFiles,
      activeRequirement: activeReq,
      lastTestReceipt: receiptSummary,
      ...(inFlightReview ? { inFlightReview } : {}),
    };
  } catch {
    // Compaction proceeds; the snapshot still preserves state.
  }
}

/** Called on session_compact: the pointer becomes injectable. */
export function armCompactionPointer(): void {
  if (pending !== null) armed = pending;
  pending = null;
  if (stagedSubquestCompaction !== null) {
    armedSubquestResumption = stagedSubquestCompaction;
    stagedSubquestCompaction = null;
  }
}

/** One-shot: the armed pointer for `qid`, then disarmed. */
export function takeCompactionPointer(qid: string | null): CompactionPointer | null {
  const hit = armed;
  armed = null;
  return hit !== null && hit.qid === qid ? hit : null;
}

export function renderCompactionPointer(p: CompactionPointer): string {
  const open = p.open.length ? ` Requirements not yet verified: ${p.open.join(", ")}.` : "";
  const files = p.touchedFiles && p.touchedFiles.length > 0 ? `\n  • Modified files: ${p.touchedFiles.join(", ")}` : "";
  const objective = p.objective && p.objective.trim()
    ? `\n  • Objective: "${p.objective.trim().length > 200 ? p.objective.trim().slice(0, 200) + '…' : p.objective.trim()}"`
    : "";
  const activeReq = p.activeRequirement ? `\n  • Active Requirement: ${p.activeRequirement}` : "";
  const testReceipt = p.lastTestReceipt ? `\n  • Last Test Receipt: ${p.lastTestReceipt}` : "";
  const reviewLine = p.inFlightReview && hasInFlight(p.qid)
    ? `\n  • Active Review: ${p.inFlightReview.kind} review in flight (target ${p.inFlightReview.target.slice(0, 12)}) — do NOT re-edit or re-submit; yield and await the verdict.`
    : "";
  return `\n[Post-Compaction Handoff]: Context was just compacted. The active quest is intact.${objective}\n  • Quest: ${p.qid} (Phase: ${p.phase ?? "active"})${activeReq}${files}${testReceipt}${reviewLine}\n  • State & Verification: If the user's current message is a direct question or conversational remark, answer the user directly first before continuing quest work. Otherwise, read ${p.relPath} in full before continuing — it holds the verbatim operator request, every directive, and the asked-vs-accomplished table.${open} Next action: ${p.nextAction}`;
}

export function maybeTriggerPostSubquestCompaction(
  piOrCtx: Pi | PiCtx,
  maybeCtx?: PiCtx,
): boolean {
  const pi = maybeCtx ? (piOrCtx as Pi) : undefined;
  const ctx = maybeCtx ?? (piOrCtx as PiCtx);
  const staged = getStagedPostSubquestCompaction();
  if (!staged) return false;

  if (typeof ctx.compact !== "function") {
    takePostSubquestCompaction();
    return false;
  }

  const cfg = getLastLoadedConfig();
  const subquestCfg = cfg.subquestCompaction ?? DEFAULT_SUBQUEST_COMPACTION_CONFIG;

  if (subquestCfg.mode === "never") {
    takePostSubquestCompaction();
    return false;
  }

  if (subquestCfg.mode === "auto") {
    const turns = staged.turnCount ?? 0;
    const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
    const tokens = usage?.tokens ?? usage?.totalTokens ?? 0;

    const meetsTurns = turns >= subquestCfg.minTurnsToCompact;
    const meetsTokens = tokens > 0 && tokens >= subquestCfg.minTokensToCompact;

    if (!meetsTurns && !meetsTokens && tokens > 0) {
      takePostSubquestCompaction();
      return false;
    }
  }

  const info = takePostSubquestCompaction();
  if (!info) return false;

  const customInstructions = buildSubquestCompactionPrompt(info);
  armSubquestResumption(info);
  postCompactionFollowUpPending = info;

  try {
    ctx.compact({
      customInstructions,
      onComplete: () => {
        if (pi) notifyCompactionCompleted(pi);
      },
      onError: () => {
        postCompactionFollowUpPending = null;
      },
    });
    return true;
  } catch {
    postCompactionFollowUpPending = null;
    return false;
  }
}

export function notifyCompactionCompleted(pi: Pi): void {
  if (postCompactionFollowUpPending !== null) {
    const info = postCompactionFollowUpPending;
    postCompactionFollowUpPending = null;
    sendFollowUp(
      pi,
      `Sub-quest ${info.childQid} concluded and transcript compacted. Resuming parent quest ${info.parentQid}: ${info.exactNextAction}`,
    );
  }
}

export function resetCompactionHandoff(): void {
  pending = null;
  armed = null;
  stagedSubquestCompaction = null;
  armedSubquestResumption = null;
  postCompactionFollowUpPending = null;
}
