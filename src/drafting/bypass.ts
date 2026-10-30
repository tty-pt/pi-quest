// HIGH_LEVEL: #modes — reviewPolicy bypass of the draft review. Under "off",
// and under "balanced" for non-complex quests, no reviewer subagent runs: the
// maturity bar alone gates promotion. A draft below the bar must never stall
// silently — nothing else would ever wake the agent, and the tool gate stays
// locked — so the agent is told exactly what is missing.
import { sendWake } from "../app/interpreter";
import type { QuestConfig, DraftThresholds } from "../config";
import type { QuestState } from "../domain/quest";
import { draftPath } from "../domain/paths";
import type { Qid } from "../domain/qid";
import type { Pi, PiCtx } from "../hooks/events";
import { cancelReview } from "../review/tracker";
import { clearDraftReviewRetry, clearReviewVerdictFails } from "./draft-retry";
import { promoteAfterPass } from "./promote";
import type { QualityResult } from "./quality";
import { deliverableBody, deliverableWord, draftProfileText, hasAuthoredText, type DraftSections } from "./plan-text";

export function bypassesDraftReview(config: QuestConfig, state: QuestState): boolean {
  return config.reviewPolicy === "off" || (config.reviewPolicy === "balanced" && state.difficulty !== "complex" && state.difficulty !== "major");
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
  const message = await promoteAfterPass(pi, ctx, qid, "review");
  const advisory = quality.gaps.length > 0 ? ` Draft quality advisory (mode ${config.draftQuality.mode}): ${quality.gaps.join("; ")}.` : "";
  if (message !== null) sendWake(pi, `${message} Draft review bypassed under ${reason}.${advisory}`);
}
