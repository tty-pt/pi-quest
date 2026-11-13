import type { Qid } from "./qid";
import type { HandbackReceipt, RtmItem, SubQuestContract } from "./contract";
import type { QuestDifficulty } from "./difficulty";

export type { QuestDifficulty };

export type Phase =
  | "idle"
  | "provisional"
  | "drafting"
  | "implementing"
  | "validating"
  | "archived";

export type ArchivedOutcome = "COMPLETED" | "FAILED" | "ABANDONED";

export type QuestKind = "standard" | "analysis" | "bugfix" | "feature" | "refactor" | "docs";

export type ReviewKind = "draft" | "validation";

export type ApprovedBy = "review" | "user";

export type ReviewVerdict = "PASS" | "FAIL";

export interface ActiveReview {
  kind: ReviewKind;
  target: string;
}

export interface DraftInfo {
  name: string;
  planAuthored: boolean;
  approvedBy: ApprovedBy | null;
  outstandingFindings: boolean;
  contentHash: string | null;
  lastReviewedPlan?: string | null;
  stagedPlan?: string | null;
  approvedPlanHash: string | null;
  planRevisions: PlanRevision[];
  timeoutAwaitingValidation?: boolean;
}

export interface PlanRevision {
  hash: string | null;
  at: number;
  note: string;
  plan: string;
}

export interface LastReview {
  verdict: ReviewVerdict;
  target: string;
  findings: string;
  reviewText?: string;
}

export interface DialogueRound {
  round: number;
  timestamp: number;
  reviewerFindings: string;
  implementerRebuttal: string;
  verdictBefore: ReviewVerdict;
  verdictAfter?: ReviewVerdict;
}

export interface Setback {
  reason: string;
  evidence: string[];
}

export interface VerificationReceipt {
  command: string;
  exitCode: number;
  tailOutput: string;
  executedAt?: number;
}

export interface Amendment {
  change: string;
  reasons: string;
}

export type ChildStatus = "running" | "returned" | "failed";

export interface ChildLink {
  qid: Qid;
  brief: string;
  status: ChildStatus;
  findings: string | null;
  acknowledged: boolean;
}

export interface HumanAnswer {
  question: string;
  answer: string;
  late: boolean;
}

export interface StackFrame {
  qid: Qid;
  role: "coordinator" | "worker";
  contract?: SubQuestContract;
  savedPhase: Phase;
  savedState: QuestState;
}

export interface QuestState {
  phase: Phase;
  kind: QuestKind;
  difficulty: QuestDifficulty;
  qid: Qid | null;
  parentQid: Qid | null;
  depth: number;
  name: string;
  objective: string;
  pendingRootRequest: string | null;
  refinements: string[];
  humanAnswers: HumanAnswer[];
  draft: DraftInfo | null;
  activeReview: ActiveReview | null;
  lastReview: LastReview | null;
  reviewDialogue: DialogueRound[];
  exactNextAction: string;
  setbacks: Setback[];
  amendments: Amendment[];
  children: ChildLink[];
  contract?: SubQuestContract;
  rtm?: RtmItem[];
  questStack: StackFrame[];
  handbackReceipts: HandbackReceipt[];
  lastTestReceipt?: VerificationReceipt;
  lastPassingTestReceipt?: VerificationReceipt;
  lastFileModifiedAt?: number;
  baseCommit?: string;
  touchedFiles?: string[];
  worktreePath?: string;
  worktreeBranch?: string;
  milestoneCommits?: Array<{ hash: string; label: string; timestamp: string }>;
  archivedOutcome: ArchivedOutcome | null;
  snapshotPending: boolean;
  consecutiveTestFailures?: number;
  circuitBreakerActive?: boolean;
  pendingDirectiveRevision?: boolean;
  pendingDirectiveText?: string;
  disabled?: boolean;
}
