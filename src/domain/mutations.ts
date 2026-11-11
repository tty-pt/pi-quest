import type {
  Amendment,
  HumanAnswer,
  LastReview,
  QuestDifficulty,
  QuestKind,
  QuestState,
  ReviewVerdict,
} from "./types";
import { markChanged, requirePhase } from "./state";
import { hasDirective } from "./dedupe";

export function recordTouchedFile(state: QuestState, filePath: string): QuestState {
  const current = state.touchedFiles ?? [];
  if (current.includes(filePath)) return state;
  return markChanged(state, { touchedFiles: [...current, filePath] });
}

export function setQuestDifficulty(state: QuestState, difficulty: QuestDifficulty): QuestState {
  return markChanged(state, { difficulty });
}

export function setQuestKind(state: QuestState, kind: QuestKind): QuestState {
  return markChanged(state, { kind });
}

export function recordRefinement(state: QuestState, text: string): QuestState {
  if (text.trim() === "") throw new Error("refinement needs text");
  if (hasDirective(state.refinements, text)) return state;
  return markChanged(state, { refinements: [...state.refinements, text] });
}

export function recordAmendment(state: QuestState, change: string, reasons: string): QuestState {
  requirePhase(state, "drafting", "implementing", "validating");
  if (change.trim() === "") throw new Error("amendment needs a change");
  if (hasDirective(state.amendments.map((a) => a.change), change)) return state;
  return markChanged(state, {
    amendments: [...state.amendments, { change, reasons }],
  });
}

export function recordHumanAnswer(
  state: QuestState,
  question: string,
  answer: string,
  late = false,
): QuestState {
  return markChanged(state, {
    humanAnswers: [...state.humanAnswers, { question, answer, late }],
  });
}

export function recordAdvisoryNote(state: QuestState, reason: string, evidence: string[], isTest = false): QuestState {
  if (reason.trim() === "") throw new Error("setback needs a reason");
  const consecutiveTestFailures = isTest ? (state.consecutiveTestFailures ?? 0) + 1 : (state.consecutiveTestFailures ?? 0);
  const circuitBreakerActive = isTest ? consecutiveTestFailures >= 2 : Boolean(state.circuitBreakerActive);
  return markChanged(state, {
    setbacks: [...state.setbacks, { reason, evidence }],
    exactNextAction: state.exactNextAction,
    consecutiveTestFailures,
    circuitBreakerActive,
  });
}

export function resetTestFailures(state: QuestState): QuestState {
  if ((state.consecutiveTestFailures ?? 0) === 0 && !state.circuitBreakerActive) return state;
  return markChanged(state, {
    consecutiveTestFailures: 0,
    circuitBreakerActive: false,
  });
}

export function disengageCircuitBreaker(state: QuestState): QuestState {
  if (!state.circuitBreakerActive) return state;
  return markChanged(state, {
    circuitBreakerActive: false,
  });
}

export function recordReviewResult(
  state: QuestState,
  verdict: ReviewVerdict,
  target: string,
  findings: string,
  reviewText?: string,
): QuestState {
  const lastReview: LastReview = reviewText === undefined || reviewText === ""
    ? { verdict, target, findings }
    : { verdict, target, findings, reviewText };
  return markChanged(state, {
    lastReview,
    exactNextAction: verdict === "PASS"
      ? state.exactNextAction
      : "Address the review findings, then continue.",
  });
}

export function recordRebuttal(
  state: QuestState,
  rebuttal: string,
  verdictBefore: ReviewVerdict,
  reviewerFindings: string,
  now: number = Date.now(),
): { state: QuestState; round: number } {
  if (rebuttal.trim().length < 10) throw new Error("rebuttal needs substantive evidence");
  const round = state.reviewDialogue.length + 1;
  const next: QuestState = markChanged(state, {
    reviewDialogue: [
      ...state.reviewDialogue,
      { round, timestamp: now, reviewerFindings, implementerRebuttal: rebuttal, verdictBefore },
    ],
  });
  return { state: next, round };
}

export function resolveDialogueRound(
  state: QuestState,
  round: number,
  verdictAfter: ReviewVerdict,
): QuestState {
  return markChanged(state, {
    reviewDialogue: state.reviewDialogue.map((d) =>
      d.round === round ? { ...d, verdictAfter } : d
    ),
  });
}

// A child deviates from its brief when it recorded anything beyond the
// brief itself: amendments, setbacks, refinements, or review dialogue.
// Clean children skip the draft reviewer; the validator still judges them.
export function childDeviated(state: QuestState): boolean {
  return state.amendments.length > 0 ||
    state.setbacks.length > 0 ||
    state.refinements.length > 0 ||
    state.reviewDialogue.length > 0;
}

export function researchRecorded(state: QuestState, draftEvidenceCount = 0): boolean {
  if (draftEvidenceCount > 0) return true;
  if (state.refinements.length > 0) return true;
  return state.setbacks.some((s) => s.evidence.length > 0);
}
