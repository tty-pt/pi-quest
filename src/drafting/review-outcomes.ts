import type { Pi, PiCtx } from "../hooks/events";
import { getState, updateState } from "../app/store";
import { emitNow, sendSteer, sendWake } from "../app/interpreter";
import type { Qid } from "../domain/qid";
import { noteDraftFindings } from "../domain/transitions";
import { researchRecorded, type QuestDifficulty, type QuestKind, type QuestState } from "../domain/quest";
import type { DraftThresholds, QuestConfig } from "../config";
import type { ParsedReview } from "../review/verdicts";
import type { DraftSections } from "./plan-text";
import { deliverableWord, draftProfileText } from "./plan-text";
import {
  clearDraftReviewRetry,
  clearReviewVerdictFails,
  MAX_CONSECUTIVE_REVIEW_FAILS,
  noteReviewVerdictFailed,
} from "./draft-retry";
import { promoteAfterPass } from "./promote";
import type { QualityResult } from "./quality";
import { cancelReview } from "../review/tracker";

function hasSubagentRunner(pi: Pi): boolean {
  try {
    const tools = (pi as unknown as { getAllTools?: () => Array<{ name: string }>; toolNames?: string[] }).getAllTools?.();
    if (Array.isArray(tools) && tools.some((t) => t.name === "subagent")) return true;
    const names = (pi as unknown as { toolNames?: string[] }).toolNames;
    return Array.isArray(names) && names.includes("subagent");
  } catch {
    return false;
  }
}

export function handleDraftFastFail(
  pi: Pi,
  qid: Qid,
  target: string,
  sections: DraftSections,
  thresholds: DraftThresholds,
  kind: QuestKind,
  difficulty: QuestDifficulty,
  quality: QualityResult,
  belowBar: boolean,
): void {
  if (getState().phase !== "drafting") return;
  if (hasSubagentRunner(pi)) {
    cancelReview(qid);
  }
  const reasons: string[] = [];
  if (belowBar) {
    const req = sections.requirements.length;
    const ev = sections.evidence.length;
    reasons.push(`below maturity bar (${req}/${thresholds.requirements} requirements, ${ev}/${thresholds.evidence} evidence)`);
  }
  if (quality.blocks && quality.summary !== "") {
    reasons.push(quality.summary);
  }
  const findingText = reasons.join("; ");
  updateState((s) =>
    s.phase === "drafting"
      ? {
          ...noteDraftFindings(s),
          activeReview: null,
          lastReview: {
            verdict: "FAIL",
            target,
            findings: findingText,
          },
          snapshotPending: true,
        }
      : s
  );
  clearDraftReviewRetry(qid);
  emitNow(pi);
  const consecutive = noteReviewVerdictFailed(qid);
  const profile = `\n\nDraft profile:\n${draftProfileText(sections, thresholds, "", kind, difficulty)}`;

  if (consecutive >= MAX_CONSECUTIVE_REVIEW_FAILS) {
    sendWake(
      pi,
      `Draft review fast-failed ${consecutive} consecutive times for ${qid}. Deterministic criteria not met:\n${findingText}${profile}\n\n` +
      `Consult the human operator for guidance, or the operator may reply "go" / "proceed" to bypass review and start coding immediately.`,
    );
    return;
  }

  sendWake(pi, `Draft review FAIL (fast-fail, 0ms): ${findingText}. Revise the ${deliverableWord(kind).toLowerCase()} and save; saving boots a fresh review.${profile}`);
}

export async function handleDraftPassVerdict(
  pi: Pi,
  ctx: PiCtx,
  qid: Qid,
  target: string,
  review: ParsedReview,
  kind: QuestKind,
  config: QuestConfig,
  evidenceCount: number,
): Promise<void> {
  clearDraftReviewRetry(qid);
  clearReviewVerdictFails(qid);
  if (!researchRecorded(getState(), evidenceCount)) {
    sendSteer(pi, `Reviewer PASS recorded for ${qid}, but promotion needs recorded research: no evidence, refinements, or setback evidence on file. Record research via quest_update_state, or a live user may reply "go".`);
    return;
  }
  updateState((s) => ({
    ...s,
    lastReview: {
      verdict: "PASS",
      target,
      findings: review.findings,
      reviewText: review.text.trim(),
    },
    reviewDialogue: s.reviewDialogue.map((d, idx) =>
      idx === s.reviewDialogue.length - 1 && d.verdictAfter === undefined
        ? { ...d, verdictAfter: "PASS" as const }
        : d
    ),
  }));

  const currentDraft = getState().draft;
  if (kind !== "analysis" && config.approvalGate && currentDraft?.approvedBy !== "user") {
    updateState((s) => ({
      ...s,
      exactNextAction: "Draft validated (PASS). Write your quest analysis in your chat message to the operator, then call quest_ask_human with a short approval question.",
    }));
    emitNow(pi);
    sendWake(
      pi,
      `Reviewer PASS recorded for ${qid} (target ${target.slice(0, 12)}). Draft is validated!\n` +
      `Next:\n` +
      `1. In your assistant message text, write a thorough analysis of the problem, root cause, and architectural approach to the operator in the chat session.\n` +
      `2. Call quest_ask_human with a concise approval question and non-confirming default (e.g. question: "Do you approve the implementation plan?", default: "hold"). Do NOT put the plan in the question parameter.\n` +
      `3. Verify all user requests and directives are in the plan file.`,
    );
    return;
  }

  const message = await promoteAfterPass(pi, ctx, qid, currentDraft?.approvedBy === "user" ? "user" : "review");
  if (message === null) {
    sendSteer(pi, `Reviewer PASS recorded for ${qid}, but the quest did not promote (it is no longer an unapproved draft). Check its phase; a live user "go" promotes a draft.`);
    return;
  }
  const advisories = review.advisories.trim();
  sendWake(pi, `${message}${advisories === "" ? "" : ` Non-blocking advisories: ${advisories} Record adopted ones via amendment as you work.`}`);
}

export function handleDraftFailVerdict(
  pi: Pi,
  qid: Qid,
  target: string,
  review: ParsedReview,
  sections: DraftSections,
  thresholds: DraftThresholds,
  kind: QuestKind,
  state: QuestState,
  belowBar: boolean,
): void {
  updateState((s) => noteDraftFindings(s));
  clearDraftReviewRetry(qid);
  emitNow(pi);
  const consecutive = noteReviewVerdictFailed(qid);
  const verbatim = review.text.trim();
  const reviewExcerpt = verbatim === "" ? "" : `\n\nReview text (verbatim, budget-bounded):\n${verbatim}`;
  const profile = belowBar ? `\n\nDraft profile:\n${draftProfileText(sections, thresholds, "", kind, state.difficulty)}` : "";

  if (consecutive >= MAX_CONSECUTIVE_REVIEW_FAILS) {
    sendWake(
      pi,
      `Draft review rejected ${consecutive} consecutive times for ${qid}. Automated review loop paused to prevent thrashing.\n` +
      `Reviewer findings: ${review.findings}${reviewExcerpt}\n\n` +
      `Consult the human operator for guidance, or the operator may reply "go" / "proceed" to bypass review and start coding immediately.`,
    );
    return;
  }

  sendWake(
    pi,
    `Draft review FAIL (target ${target.slice(0, 12)}): ${review.findings} Revise the ${deliverableWord(kind).toLowerCase()} (or reply with evidence via quest_rebut {rebuttal: "..."}) and save; saving boots a fresh review.${reviewExcerpt}${profile}`,
  );
}
