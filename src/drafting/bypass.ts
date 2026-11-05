// HIGH_LEVEL: #modes — reviewPolicy bypass of the draft review. Under "off",
// and under "balanced" for non-complex quests, no reviewer subagent runs: the
// maturity bar alone gates promotion. A draft below the bar must never stall
// silently — nothing else would ever wake the agent, and the tool gate stays
// locked — so the agent is told exactly what is missing.
import { emitNow, sendWake } from "../app/interpreter";
import { getState, updateState } from "../app/store";
import type { QuestConfig, DraftThresholds } from "../config";
import { difficultyLevel, type QuestState } from "../domain/quest";
import { calculateReviewNeed, resolveActiveModel } from "../policy/effective";
import { draftPath } from "../domain/paths";
import type { Qid } from "../domain/qid";
import type { Pi, PiCtx } from "../hooks/events";
import { cancelReview } from "../review/tracker";
import { clearDraftReviewRetry, clearReviewVerdictFails } from "./draft-retry";
import { promoteAfterPass } from "./promote";
import type { QualityResult } from "./quality";
import { deliverableBody, deliverableWord, draftProfileText, hasAuthoredText, type DraftSections } from "./plan-text";

export function bypassesDraftReview(config: QuestConfig, state: QuestState, ctx?: PiCtx): boolean {
  if (config.reviewPolicy === "off") return true;
  if (config.reviewPolicy === "balanced") {
    const activeModel = resolveActiveModel(ctx, config);
    const need = calculateReviewNeed(state.difficulty, activeModel, state.setbacks.length, config.modelAccuracy);
    return need <= 4.5 && difficultyLevel(state.difficulty) < 5;
  }
  return false;
}

export interface BypassArgs {
  qid: Qid;
  state: QuestState;
  sections: DraftSections;
  thresholds: DraftThresholds;
  belowBar: boolean;
  quality: QualityResult;
}

export async function bypassDraftReview(pi: Pi, ctx: PiCtx, config: QuestConfig, args: BypassArgs): Promise<void> {
  const { qid, state, sections, thresholds, belowBar, quality } = args;
  cancelReview(qid);
  const base = config.reviewPolicy === "off" ? "policy 'off'" : `policy 'balanced' (${state.difficulty} task)`;
  const reason = config.policyNote !== undefined ? `${base} — ${config.policyNote}` : base;
  if (belowBar || state.draft === null || !state.draft.planAuthored) {
    const kind = state.kind;
    const profile = draftProfileText(sections, thresholds, "", kind, state.difficulty);
    const nested = hasAuthoredText(deliverableBody(sections, kind))
      ? ""
      : ` Keep every "## " heading out of the ${deliverableWord(kind)} body (use "###"): a nested "## " heading ends the section.`;
    const depth = quality.summary !== "" ? `\n${quality.summary}` : "";
    sendWake(
      pi,
      `Draft review bypassed under ${reason}, but ${qid} cannot promote yet — the maturity bar still applies.\n${profile}${depth}${nested}\n` +
        `Revise ${draftPath(qid)} and save; saving re-checks promotion. A live user "go" also promotes.`,
    );
    return;
  }
  clearDraftReviewRetry(qid);
  clearReviewVerdictFails(qid);
  updateState((s) => ({
    ...s,
    lastReview: {
      verdict: "PASS",
      target: s.draft?.contentHash ?? "",
      findings: "Maturity bar satisfied under " + base,
    },
  }));
  const advisory = quality.gaps.length > 0 ? ` Draft quality advisory (mode ${config.draftQuality.mode}): ${quality.gaps.join("; ")}.` : "";
  const currentDraft = getState().draft;
  if (config.reviewPolicy !== "off" && state.kind !== "analysis" && config.approvalGate && !currentDraft?.timeoutAwaitingValidation && currentDraft?.approvedBy !== "user") {
    updateState((s) => ({
      ...s,
      exactNextAction: "Draft validated under policy bypass. Present analysis summary to operator and call quest_ask_human to request implementation approval.",
    }));
    emitNow(pi);
    sendWake(
      pi,
      `Draft validated under ${reason}. Next: (1) Present the deep analysis summary to the operator in your response, and (2) Call quest_ask_human to request approval for implementation.${advisory}`,
    );
    return;
  }
  const message = await promoteAfterPass(pi, ctx, qid, currentDraft?.approvedBy === "user" ? "user" : "review");
  if (message !== null) sendWake(pi, `${message} Draft review bypassed under ${reason}.${advisory}`);
}
