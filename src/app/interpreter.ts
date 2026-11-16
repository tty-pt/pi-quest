// HIGH_LEVEL: #surviving — executes effects (A1). ONLY impure choke point besides adapters.
import type { Qid } from "../domain/qid";
import type { ApprovedBy, ArchivedOutcome, ReviewKind } from "../domain/quest";
import type { Effect } from "../domain/effects";
import { encodeSnapshot, SNAPSHOT_TYPE, type Snapshot } from "../durability/snapshots";
import type { Pi } from "../hooks/events";
import { getState, replaceState } from "./store";

export interface Ports {
  saveSnapshot(snapshot: Snapshot): void;
  sendSteer(text: string): void;
  sendWake?(text: string): void;
  notify(text: string, level?: "info" | "warning" | "error"): void;
  launchReview?(qid: Qid, target: string, reviewKind: ReviewKind): void;
  cancelReview?(qid: Qid): void;
  promote?(qid: Qid, approvedBy: ApprovedBy): void;
  demote?(qid: Qid): void;
  archive?(qid: Qid, outcome: ArchivedOutcome): void;
}

export function sendSteer(pi: Pi, text: string): void {
  try {
    pi.sendMessage({ customType: SNAPSHOT_TYPE, content: text }, { deliverAs: "steer" });
  } catch {
    // Notification is best-effort; quest state is already persisted.
  }
}

export function sendWake(pi: Pi, text: string): void {
  try {
    pi.sendMessage({ customType: SNAPSHOT_TYPE, content: text }, { deliverAs: "steer", triggerTurn: true });
  } catch {
    // Wake is best-effort; the verdict is already in history and snapshots.
  }
}

export function sendFollowUp(pi: Pi, text: string): void {
  try {
    pi.sendMessage({ customType: SNAPSHOT_TYPE, content: text }, { deliverAs: "followUp", triggerTurn: true });
  } catch {
    // FollowUp is best-effort; the message is already in history and snapshots.
  }
}

export function emitNow(pi: Pi): void {
  try {
    interpret([{ kind: "EmitSnapshot" }], {
      saveSnapshot: (snapshot) => {
        pi.appendEntry(SNAPSHOT_TYPE, snapshot);
      },
      sendSteer: () => {},
      notify: () => {},
    });
  } catch {
    // Emit is best-effort; the pending flag retries at the next turn.
  }
}

export function interpret(effects: readonly Effect[], ports: Ports): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case "EmitSnapshot": {
        ports.saveSnapshot(encodeSnapshot(getState()));
        const state = getState();
        replaceState({ ...state, snapshotPending: false });
        break;
      }
      case "Steer": {
        ports.sendSteer(effect.text);
        break;
      }
      case "Wake": {
        if (typeof ports.sendWake === "function") {
          ports.sendWake(effect.text);
        } else {
          ports.sendSteer(effect.text);
        }
        break;
      }
      case "NotifyUI": {
        ports.notify(effect.text, effect.level);
        break;
      }
      case "LaunchReview": {
        ports.launchReview?.(effect.qid, effect.target, effect.review);
        break;
      }
      case "CancelReview": {
        ports.cancelReview?.(effect.qid);
        break;
      }
      case "Promote": {
        ports.promote?.(effect.qid, effect.approvedBy);
        break;
      }
      case "Demote": {
        ports.demote?.(effect.qid);
        break;
      }
      case "Archive": {
        ports.archive?.(effect.qid, effect.outcome);
        break;
      }
      default:
        break;
    }
  }
}
