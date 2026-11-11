// HIGH_LEVEL: #tools (main agent) — quest_archive.
// HIGH_LEVEL: #surface — slim archive: quest view, session reference, manifest.
import { getState } from "../../app/store";
import type { ArchivedOutcome } from "../../domain/quest";
import type { Pi, PiToolSpec } from "../../hooks/events";
import { textResult } from "./reply";
import {
  type ArchivedQuestResult,
  type ArchiveOutcomeParam,
  toOutcome,
} from "./archive/types";
import { hasValidationPass } from "./archive/eligibility";
import { archiveActiveQuest } from "./archive/core";

export {
  hasValidationPass,
  archiveActiveQuest,
  type ArchivedQuestResult,
  type ArchiveOutcomeParam,
};

function formatArchiveSummary(
  archived: ArchivedQuestResult,
  outcome: ArchivedOutcome,
  qid: string,
): string {
  const summaryLine = archived.summary ? ` Summary: ${archived.summary}` : "";
  const zipSuffix = archived.zipPath ? ` (${archived.zipPath})` : "";
  const base = outcome === "COMPLETED"
    ? `Quest ${qid} archived: COMPLETED${zipSuffix}.${summaryLine}`
    : `Quest ${qid} archived: ${outcome}${zipSuffix}.${summaryLine}`;

  if (archived.returnedToParent !== null) {
    return `${base} Returned to parent quest ${archived.returnedToParent}.`;
  }
  if (archived.kind === "analysis" && outcome === "COMPLETED") {
    return `${base}\n\nTo proceed with implementing the approved findings, call quest_update_state { objective: "Implement recommendations from analysis ${qid}..." } or ask the operator to confirm implementation.`;
  }
  return base;
}

export function archiveTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_archive",
    label: "Archive Quest",
    description:
      "Finish the active quest as completed or failed: renders the quest view, writes the run manifest, stores a session-range reference. COMPLETED requires a current validation PASS (claim via quest_update_state {claimComplete:true} first; usually automatic on validation PASS). FAILED requires a validation FAIL on the current work. Abandoning a quest is user-only via /quest del.",
    parameters: {
      type: "object",
      properties: {
        outcome: {
          type: "string",
          enum: ["completed", "failed"],
        },
        summary: {
          type: "string",
          description: "Findings summary, returned to the parent for sub-quests.",
        },
      },
      required: ["outcome"],
      additionalProperties: false,
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const qid = getState().qid;
      if (qid === null) return textResult("No active quest to archive.", { error: "no_active_quest" });

      const outcomeParam = params["outcome"] as ArchiveOutcomeParam | undefined;
      if (outcomeParam !== "completed" && outcomeParam !== "failed") {
        return textResult(
          "quest_archive needs outcome completed|failed. Abandoning a quest is user-only via /quest del.",
          { error: "bad_outcome" },
        );
      }
      const outcome = toOutcome(outcomeParam);
      const summary = typeof params["summary"] === "string" ? params["summary"] : null;
      try {
        const archived = await archiveActiveQuest(pi, ctx, outcome, summary);
        return textResult(formatArchiveSummary(archived, outcome, qid), {
          archived: archived.archivedQid,
          outcome,
          ...archived,
        });
      } catch (err) {
        return textResult(`archive rejected: ${err instanceof Error ? err.message : String(err)}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
