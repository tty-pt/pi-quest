// HIGH_LEVEL: #surviving — snapshot store + reconstruct.
// SPEC: B1.6, snapshot contract §4.1.
import { reduce } from "../domain/effects";
import { getState, replaceState } from "../app/store";
import { interpret, sendSteer as deliverSteer, type Ports } from "../app/interpreter";
import {
  onAfterCompact,
  onBeforeCompact,
  onSessionStart,
  onTurnEnd,
  onTurnStart,
  type Pi,
  type PiCtx,
  type TranscriptEntry,
} from "../hooks/events";
import { readQuestConfig } from "../config";
import { injectQuestContext } from "./injection";
import { refreshStatus, refreshStyle } from "./status";
import { IDLE_STATE, type QuestState } from "../domain/quest";
import { SNAPSHOT_TYPE, newestSnapshot, reconstruct } from "./snapshots";
import {
  armCompactionPointer,
  handoffBeforeCompaction,
  maybeTriggerPostSubquestCompaction,
  notifyCompactionCompleted,
} from "./compaction-handoff";

export { noteDraftUpdated, questStatus, refreshStatus, stopBlink } from "./status";

import { hasInFlight } from "../review/tracker";
import { ensureDraftReview } from "../drafting/reviews";
import { maybeBootPlanRevisionReview } from "../implementing/plan-revision";
import { ensureValidationFlow } from "../validation/flow";

let bootstrapped = false;
let booting = false;

export function sanitizeLoadedReviewState(state: QuestState): QuestState {
  if (state.qid === null || hasInFlight(state.qid)) return state;
  const staleNotice = state.exactNextAction.startsWith("Review running for quest");
  if (state.activeReview === null && !staleNotice) return state;
  const fallbackNextAction = state.phase === "implementing"
    ? "Implement the approved plan; claim completion via quest_update_state {claimComplete: true} when done."
    : state.phase === "drafting"
      ? `Author the plan in .pi/quests/${state.qid}.md and save to trigger review.`
      : state.exactNextAction;
  return {
    ...state,
    activeReview: null,
    ...(staleNotice ? { exactNextAction: fallbackNextAction } : {}),
  };
}

export function resumePendingReviewForState(pi: Pi, ctx: PiCtx): void {
  const state = getState();
  if (state.disabled === true || state.qid === null) return;
  if (state.phase === "drafting") {
    void ensureDraftReview(pi, ctx).catch(() => {});
  } else if (state.phase === "implementing") {
    void maybeBootPlanRevisionReview(pi, ctx, "staged revision resumed").catch(() => {});
  } else if (state.phase === "validating") {
    void ensureValidationFlow(pi, ctx).catch(() => {});
  }
}

function ports(pi: Pi, ctx: PiCtx): Ports {
  return {
    saveSnapshot: (snapshot) => {
      pi.appendEntry(SNAPSHOT_TYPE, snapshot);
    },
    sendSteer: (text) => {
      deliverSteer(pi, text);
    },
    notify: (text) => {
      try {
        ctx.ui.notify(text, "info");
      } catch {
        // Notification is best-effort.
      }
    },
  };
}

export async function loadQuestState(
  entries: readonly TranscriptEntry[],
  _sessionsDir?: string,
  cwd?: string,
): Promise<QuestState> {
  // Fresh sessions start idle: no auto-adopt. The user starts a new quest,
  // asks inference to recover one, or picks via /quest.
  const snap = newestSnapshot(entries);
  if (snap !== null) return sanitizeLoadedReviewState(snap);
  if (cwd !== undefined) {
    try {
      const cfg = await readQuestConfig(cwd);
      return { ...IDLE_STATE, disabled: !cfg.enabled };
    } catch {
      return { ...IDLE_STATE, disabled: true };
    }
  }
  return sanitizeLoadedReviewState(reconstruct(entries));
}

async function bootFromTranscript(pi: Pi, ctx: PiCtx): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    const entries = ctx.sessionManager.getEntries();
    replaceState(await loadQuestState(entries, undefined, ctx.cwd));
    bootstrapped = true;
    refreshStatus(ctx);
    resumePendingReviewForState(pi, ctx);
  } catch {
    // Stay on current state; turn_start retries, injection stays IDLE-safe.
  } finally {
    booting = false;
  }
}

function loadFromTranscript(pi: Pi, ctx: PiCtx): void {
  void bootFromTranscript(pi, ctx);
}

export function installDurability(pi: Pi): void {
  onSessionStart(pi, (_event, ctx) => {
    loadFromTranscript(pi, ctx);
    void refreshStyle(ctx.cwd);
    refreshStatus(ctx);
  });
  onTurnStart(pi, (_event, ctx) => {
    if (!bootstrapped) loadFromTranscript(pi, ctx);
    void refreshStyle(ctx.cwd);
  });
  onTurnEnd(pi, (_event, ctx) => {
    try {
      const reduced = reduce(getState(), { type: "TurnEnded" });
      replaceState(reduced.state);
      interpret(reduced.effects, ports(pi, ctx));
      refreshStatus(ctx);
    } catch {
      // Emit is best-effort; the pending flag keeps the data for next turn.
    }
    try {
      maybeTriggerPostSubquestCompaction(pi, ctx);
    } catch {
      // Post-subquest compaction trigger is best-effort.
    }
  });
  onBeforeCompact(pi, async (_event, ctx) => {
    try {
      interpret([{ kind: "EmitSnapshot" }], ports(pi, ctx));
    } catch {
      // Compaction proceeds; the snapshot is retried next turn.
    }
    await handoffBeforeCompaction(pi, ctx);
  });
  onAfterCompact(pi, () => {
    armCompactionPointer();
    notifyCompactionCompleted(pi);
  });
  injectQuestContext(pi);
}
