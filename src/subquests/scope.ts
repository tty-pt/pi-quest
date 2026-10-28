// HIGH_LEVEL: #working together — a new request during an active quest is
// interpreted in context. Borderline cases stay in context: recording is
// deterministic, routing stays agent judgment via the quest tools.
// SPEC: B1.2 scope rules (bias to keep).
import type { UserIntentKind } from "../domain/intent";
import type { MidQuestConfig } from "../config";

export type TriageAction =
  | "amend_requirement"
  | "queue_subquest"
  | "preempt_subquest"
  | "refinement"
  | "pass_through";

export interface Triage {
  record: boolean;
  action: TriageAction;
  steer: string;
  directiveText?: string;
}

export function triageInQuestRequest(
  qid: string,
  kind: UserIntentKind,
  cleanText?: string,
  config?: MidQuestConfig,
): Triage | null {
  if (config && config.mode === "off") return null;
  if (kind === "question" || kind === "ack" || kind === "chat" || kind === "advance" || kind === "abort") {
    return null;
  }

  const text = cleanText ?? "";

  if (kind === "subquest_now") {
    return {
      record: true,
      action: "preempt_subquest",
      steer: `Spawning immediate sub-quest on quest ${qid}: "${text}". Pausing parent and switching context.`,
      directiveText: text,
    };
  }

  if (kind === "subquest_later") {
    return {
      record: true,
      action: "queue_subquest",
      steer: `Queued sub-quest on quest ${qid} in plan backlog: "${text}". Autonomous Foreman will sequence and execute this upon completion.`,
      directiveText: text,
    };
  }

  if (kind === "constraint") {
    return {
      record: true,
      action: "amend_requirement",
      steer: `Recorded user constraint on quest ${qid}: "${text}". ` +
        `Added as requirement to plan; validation re-binds to verify this constraint. ` +
        `If this changes the implementation plan, record an amendment via quest_update_state.`,
      directiveText: text,
    };
  }

  // General "refinement"
  const action: TriageAction = (config?.autoAmendRequirements !== false)
    ? "amend_requirement"
    : "refinement";

  return {
    record: true,
    action,
    steer: `Recorded operator directive on quest ${qid}: "${text}". ` +
      `If this describes a separable sub-task or follow-up, invoke quest_subquest to handle it; ` +
      `if it is a constraint or refinement on your current task, incorporate it into your work and record an amendment via quest_update_state; ` +
      `if it is a separate quest instead, finish or archive this one first, then restate it.`,
    directiveText: text,
  };
}
