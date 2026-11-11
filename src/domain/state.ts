import type {
  ArchivedOutcome,
  Phase,
  QuestDifficulty,
  QuestKind,
  QuestState,
} from "./types";
import { isQid, type Qid } from "./qid";

export const IDLE_STATE: QuestState = {
  phase: "idle",
  kind: "standard",
  difficulty: "standard",
  qid: null,
  parentQid: null,
  depth: 0,
  name: "",
  objective: "",
  pendingRootRequest: null,
  refinements: [],
  humanAnswers: [],
  draft: null,
  activeReview: null,
  lastReview: null,
  reviewDialogue: [],
  exactNextAction: "",
  setbacks: [],
  amendments: [],
  children: [],
  contract: undefined,
  rtm: undefined,
  questStack: [],
  handbackReceipts: [],
  lastTestReceipt: undefined,
  baseCommit: undefined,
  touchedFiles: [],
  worktreePath: undefined,
  worktreeBranch: undefined,
  milestoneCommits: [],
  archivedOutcome: null,
  snapshotPending: false,
  consecutiveTestFailures: 0,
  circuitBreakerActive: false,
  pendingDirectiveRevision: false,
  pendingDirectiveText: undefined,
  disabled: false,
};

export function requirePhase(state: QuestState, ...allowed: Phase[]): void {
  if (!allowed.includes(state.phase)) {
    throw new Error(
      `invalid transition from phase ${state.phase} (allowed: ${allowed.join(", ")})`,
    );
  }
}

export function markChanged(state: QuestState, patch: Partial<QuestState>): QuestState {
  return { ...state, ...patch, snapshotPending: true };
}

export function createQuest(
  request: string,
  qid: string,
  parentQid: Qid | null = null,
  difficulty: QuestDifficulty = "standard",
  kind: QuestKind = "standard",
  baseCommit?: string,
): QuestState {
  if (!isQid(qid)) throw new Error(`invalid qid: ${qid}`);
  return markChanged(IDLE_STATE, {
    phase: "provisional",
    qid,
    parentQid,
    difficulty,
    kind,
    objective: request,
    pendingRootRequest: request,
    baseCommit,
    touchedFiles: [],
    exactNextAction: "Establish quest identity: investigate, then record findings.",
  });
}
