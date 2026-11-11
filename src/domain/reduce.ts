// HIGH_LEVEL: #surviving — pure state machine reducer (A1).
// HIGH_LEVEL: #modes — drafting / implementing / validating state transitions.
// Zero external dependencies; 100% pure deterministic execution.
import type { Effect, QuestEvent, Reduced } from "./effects";
import type { QuestState } from "./quest";
import {
  archive,
  claimComplete,
  createDraft,
  demoteToDrafting,
  demoteToImplementing,
  noteDraftFindings,
  promote,
  promoteToValidation,
} from "./transitions";
import {
  recordAdvisoryNote,
  recordReviewResult,
} from "./mutations";
import { recordPlanRevision } from "./plan-revision";
import { createQuest, markChanged } from "./state";

function reduceLifecycle(state: QuestState, event: QuestEvent): Reduced | null {
  switch (event.type) {
    case "QuestCreated": {
      const next = createQuest(
        event.objective,
        event.qid,
        event.parentQid ?? null,
        event.difficulty ?? "standard",
        event.kind ?? "standard",
        event.baseCommit,
      );
      return { state: next, effects: [{ kind: "EmitSnapshot" }] };
    }
    case "DraftCreated": {
      const next = createDraft(state, event.draftName, event.kind);
      return { state: next, effects: [{ kind: "EmitSnapshot" }] };
    }
    case "PlanPromoted": {
      const isAnalysis = state.kind === "analysis";
      const next = isAnalysis
        ? promoteToValidation(state, event.approvedBy, event.rtm)
        : promote(state, event.approvedBy, event.rtm);
      const effects: Effect[] = [{ kind: "EmitSnapshot" }];
      if (state.qid) {
        effects.push({ kind: "CancelReview", qid: state.qid });
        effects.push({ kind: "Promote", qid: state.qid, approvedBy: event.approvedBy });
      }
      return { state: next, effects };
    }
    case "CompletionClaimed": {
      const next = claimComplete(state);
      return { state: next, effects: [{ kind: "EmitSnapshot" }] };
    }
    case "QuestDemoted": {
      const next = event.to === "drafting"
        ? demoteToDrafting(state, event.exactNextAction)
        : demoteToImplementing(state);
      const effects: Effect[] = [{ kind: "EmitSnapshot" }];
      if (state.qid) effects.push({ kind: "Demote", qid: state.qid });
      return { state: next, effects };
    }
    case "QuestArchived": {
      const next = archive(state, event.outcome);
      const effects: Effect[] = [{ kind: "EmitSnapshot" }];
      if (state.qid) effects.push({ kind: "Archive", qid: state.qid, outcome: event.outcome });
      return { state: next, effects };
    }
    default:
      return null;
  }
}

function reduceReview(state: QuestState, event: QuestEvent): Reduced | null {
  switch (event.type) {
    case "ReviewStarted": {
      const next = markChanged(state, {
        activeReview: { target: event.target, kind: event.reviewKind },
      });
      const effects: Effect[] = [{ kind: "EmitSnapshot" }];
      if (state.qid) {
        effects.push({
          kind: "LaunchReview",
          qid: state.qid,
          review: event.reviewKind,
          target: event.target,
        });
      }
      return { state: next, effects };
    }
    case "ReviewVerdictReceived": {
      let next = recordReviewResult(
        state,
        event.verdict,
        event.target,
        event.findings,
        event.rawText,
      );
      if (event.verdict === "FAIL" && state.phase === "drafting") {
        next = noteDraftFindings(next);
      }
      const effects: Effect[] = [
        { kind: "EmitSnapshot" },
        { kind: "Wake", text: `Review verdict received for ${state.qid ?? "quest"}: ${event.verdict}` },
      ];
      return { state: next, effects };
    }
    case "ReviewCancelled": {
      const next = markChanged(state, { activeReview: null });
      const effects: Effect[] = [{ kind: "EmitSnapshot" }];
      if (state.qid) effects.push({ kind: "CancelReview", qid: state.qid });
      return { state: next, effects };
    }
    default:
      return null;
  }
}

function reduceWork(state: QuestState, event: QuestEvent): Reduced | null {
  switch (event.type) {
    case "SetbackRecorded": {
      const next = recordAdvisoryNote(state, event.reason, event.evidence, Boolean(event.isTest));
      const effects: Effect[] = [{ kind: "EmitSnapshot" }];
      if (next.circuitBreakerActive) {
        effects.push({
          kind: "Steer",
          text: `[SETBACK CIRCUIT BREAKER ACTIVATED] Repeated test/build failures (${next.consecutiveTestFailures ?? 2} in a row): ${event.reason}\n` +
            `Mutating file tools (edit, write, mutating-bash) are paused. Stop tinkering. Run a diagnostic audit:\n` +
            `1. Identify which assumption in your plan was falsified.\n` +
            `2. Observe system reality with read/search tools.\n` +
            `3. Re-evaluate your plan via quest_update_state {planRevision: '...'} or record diagnostic findings via quest_update_state {refinement: '...'} to unlock mutation.`,
        });
      } else {
        effects.push({
          kind: "Steer",
          text: `Setback recorded: ${event.reason} (hint: if failure persists, stop and audit your assumptions rather than hacking around the test).`,
        });
      }
      return { state: next, effects };
    }
    case "TestRunRecorded": {
      const exitCode = event.receipt.exitCode;
      let next: QuestState = {
        ...state,
        lastTestReceipt: event.receipt,
        ...(exitCode === 0 ? { lastPassingTestReceipt: event.receipt } : {}),
        snapshotPending: true,
      };
      if (exitCode === 0 && ((next.consecutiveTestFailures ?? 0) > 0 || next.circuitBreakerActive)) {
        next = { ...next, consecutiveTestFailures: 0, circuitBreakerActive: false };
      }
      return { state: next, effects: [{ kind: "EmitSnapshot" }] };
    }
    case "FileModified": {
      if (state.phase === "idle" || state.qid === null) return { state, effects: [] };
      const current = state.touchedFiles ?? [];
      const now = Date.now();
      const next = current.includes(event.path)
        ? { ...state, lastFileModifiedAt: now, snapshotPending: true }
        : { ...state, touchedFiles: [...current, event.path], lastFileModifiedAt: now, snapshotPending: true };
      return { state: next, effects: [{ kind: "EmitSnapshot" }] };
    }
    case "DraftContentChanged": {
      if (state.draft === null) return { state, effects: [] };
      const next: QuestState = {
        ...state,
        draft: {
          ...state.draft,
          contentHash: event.contentHash,
          ...(event.planAuthored !== undefined ? { planAuthored: event.planAuthored } : {}),
        },
        snapshotPending: true,
      };
      return { state: next, effects: [{ kind: "EmitSnapshot" }] };
    }
    case "PlanRevisionStaged": {
      const next = recordPlanRevision(
        state,
        event.previousHash,
        event.nextHash,
        event.note,
        event.previousPlan,
        event.now,
      );
      return { state: next, effects: [{ kind: "EmitSnapshot" }] };
    }
    default:
      return null;
  }
}

export function reduce(state: QuestState, event: QuestEvent): Reduced {
  switch (event.type) {
    case "SessionStarted":
    case "TurnStarted":
      return { state, effects: [] };
    case "TurnEnded":
    case "StateMutated":
      if (!state.snapshotPending) return { state, effects: [] };
      return { state, effects: [{ kind: "EmitSnapshot" }] };
    default: {
      const res = reduceLifecycle(state, event) ??
        reduceReview(state, event) ??
        reduceWork(state, event);
      if (res) return res;
      return { state, effects: [] };
    }
  }
}
