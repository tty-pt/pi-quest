// HIGH_LEVEL: #surviving — in-memory current state; reconstruct populates.
import { IDLE_STATE, type QuestState } from "../domain/quest";
import { reduce, type QuestEvent, type Reduced } from "../domain/effects";

let current: QuestState = IDLE_STATE;

export function getState(): QuestState {
  return current;
}

export function isQuestDisabled(): boolean {
  return current.disabled === true;
}

export function setQuestDisabled(disabled: boolean): QuestState {
  current = { ...current, disabled, snapshotPending: true };
  return current;
}

export function replaceState(next: QuestState): void {
  const preserveDisabled = current.disabled === true && next.disabled === undefined;
  current = preserveDisabled ? { ...next, disabled: true } : next;
}

export function updateState(fn: (state: QuestState) => QuestState): QuestState {
  current = fn(current);
  return current;
}

export function dispatch(event: QuestEvent): Reduced {
  const reduced = reduce(current, event);
  current = reduced.state;
  return reduced;
}
