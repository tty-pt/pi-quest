// HIGH_LEVEL: #surviving
// HIGH_LEVEL: #drafting
// HIGH_LEVEL: #modes
// HIGH_LEVEL: #validation
// HIGH_LEVEL: #working together
// HIGH_LEVEL: #storage
// SPEC: closed effect set, REBUILD_PLAN §5 — a tenth effect is a design review.
import type { Qid } from "./qid";
import type {
  ApprovedBy,
  ArchivedOutcome,
  QuestDifficulty,
  QuestKind,
  QuestState,
  ReviewKind,
  ReviewVerdict,
  VerificationReceipt,
} from "./quest";
import type { RtmItem } from "./contract";

export type Effect =
  | { kind: "EmitSnapshot" }
  | { kind: "Steer"; text: string }
  | { kind: "Wake"; text: string }
  | { kind: "NotifyUI"; text: string; level?: "info" | "warning" | "error" }
  | { kind: "LaunchReview"; qid: Qid; review: ReviewKind; target: string }
  | { kind: "CancelReview"; qid: Qid }
  | { kind: "Promote"; qid: Qid; approvedBy: ApprovedBy }
  | { kind: "Demote"; qid: Qid }
  | { kind: "Archive"; qid: Qid; outcome: ArchivedOutcome }
  | { kind: "Render"; qid: Qid };

export type QuestEvent =
  | { type: "SessionStarted" }
  | { type: "TurnStarted" }
  | { type: "TurnEnded" }
  | { type: "StateMutated" }
  | {
      type: "QuestCreated";
      qid: Qid;
      objective: string;
      parentQid?: Qid | null;
      difficulty?: QuestDifficulty;
      kind?: QuestKind;
      baseCommit?: string;
    }
  | { type: "DraftCreated"; draftName: string; kind?: QuestKind }
  | { type: "DraftContentChanged"; contentHash: string; planAuthored?: boolean }
  | { type: "PlanPromoted"; approvedBy: ApprovedBy; rtm?: RtmItem[] }
  | {
      type: "PlanRevisionStaged";
      previousHash: string | null;
      nextHash: string;
      note: string;
      previousPlan: string;
      stagedPlan?: string;
      now?: number;
    }
  | { type: "SetbackRecorded"; reason: string; evidence: string[]; isTest?: boolean }
  | { type: "TestRunRecorded"; receipt: VerificationReceipt }
  | { type: "FileModified"; path: string }
  | { type: "ReviewStarted"; target: string; reviewKind: ReviewKind }
  | {
      type: "ReviewVerdictReceived";
      target: string;
      verdict: ReviewVerdict;
      findings: string;
      rawText?: string;
    }
  | { type: "ReviewCancelled"; qid: Qid }
  | { type: "CompletionClaimed" }
  | { type: "QuestDemoted"; to: "drafting" | "implementing"; exactNextAction?: string }
  | { type: "QuestArchived"; outcome: ArchivedOutcome };

export interface Reduced {
  state: QuestState;
  effects: Effect[];
}

export { reduce } from "./reduce";
