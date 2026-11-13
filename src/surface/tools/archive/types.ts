import type {
  Amendment,
  ArchivedOutcome,
  QuestDifficulty,
  QuestKind,
  Setback,
  VerificationReceipt,
} from "../../../domain/quest";

export interface ArchivedQuestResult {
  archivedQid: string;
  zipPath: string;
  returnedToParent: string | null;
  objective: string;
  kind: QuestKind;
  difficulty: QuestDifficulty;
  modifiedFiles: string[];
  lastTestReceipt?: VerificationReceipt;
  setbacks: Setback[];
  findings: string[];
  amendments: Amendment[];
  summary: string | null;
}

export type ArchiveOutcomeParam = "completed" | "failed";

export function toOutcome(param: ArchiveOutcomeParam): ArchivedOutcome {
  if (param === "completed") return "COMPLETED";
  return "FAILED";
}
