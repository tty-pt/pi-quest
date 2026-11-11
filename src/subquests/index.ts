// HIGH_LEVEL: #working together
// HIGH_LEVEL: #sub-quests — stack, links, returns, completion gating.
// SPEC: B1.10.
import { existsSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { getState, updateState } from "../app/store";
import { emitNow, sendSteer } from "../app/interpreter";
import { recordAmendment, recordRefinement, type QuestState } from "../domain/quest";
import { demoteToDrafting, demoteToImplementing } from "../domain/transitions";
import { draftPath } from "../domain/paths";
import { draftFilePath } from "../files";
import { isHeading } from "../domain/sections";
import { dedupeDocBullets, normalizeDirective } from "../domain/dedupe";
import { hashContent } from "../drafting/plan-text";
import { appendAmendmentToDoc, appendRequirementToDoc, appendSubQuestBacklogItem } from "../domain/quest-doc";
import { setDocStatus } from "../quest-doc";
import type { Qid } from "../domain/qid";
import { onUserMessage, type Pi, type PiCtx } from "../hooks/events";
import { readQuestConfig } from "../config";
import { interpretUserTurn } from "../judge/intent-classifier";
import { cancelReview } from "../review/tracker";
import { createChildQuest } from "../surface/tools/subquest";
import { triageInQuestRequest } from "./scope";
import { writeHandoff } from "../durability/handoff-io";

let followUpQueue: Promise<void> = Promise.resolve();

export async function appendSubQuestToDraft(ctx: PiCtx, qid: Qid, goal: string): Promise<void> {
  followUpQueue = followUpQueue.then(async () => {
    try {
      const filePath = draftFilePath(ctx.cwd, qid);
      if (!existsSync(filePath)) return;
      const content = await readFile(filePath, "utf8");
      const updated = appendSubQuestBacklogItem(content, goal);
      if (updated === content) return;

      const dir = dirname(filePath);
      const tmpPath = join(dir, `.${basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`);
      await writeFile(tmpPath, updated, "utf8");
      await rename(tmpPath, filePath);

      const hash = hashContent(updated);
      updateState((s) => s.draft === null ? s : {
        ...s,
        draft: { ...s.draft, contentHash: hash },
        snapshotPending: true,
      });
    } catch {
      // Best-effort append
    }
  });
  await followUpQueue;
}

export async function appendRequirementAndAmendmentToDraft(
  ctx: PiCtx,
  qid: Qid,
  requirementText: string,
  reason: string,
): Promise<void> {
  followUpQueue = followUpQueue.then(async () => {
    try {
      const filePath = draftFilePath(ctx.cwd, qid);
      if (!existsSync(filePath)) return;
      const content = await readFile(filePath, "utf8");
      let updated = appendRequirementToDoc(content, requirementText);
      updated = dedupeDocBullets(appendAmendmentToDoc(updated, requirementText, reason)).text;
      if (updated === content) return;

      const dir = dirname(filePath);
      const tmpPath = join(dir, `.${basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`);
      await writeFile(tmpPath, updated, "utf8");
      await rename(tmpPath, filePath);

      const hash = hashContent(updated);
      updateState((s) => s.draft === null ? s : {
        ...s,
        draft: { ...s.draft, contentHash: hash },
        snapshotPending: true,
      });
    } catch {
      // Best-effort append
    }
  });
  await followUpQueue;
}

export async function appendFollowUpToDraft(ctx: PiCtx, qid: Qid, followUpText: string): Promise<void> {
  followUpQueue = followUpQueue.then(async () => {
    try {
      const filePath = draftFilePath(ctx.cwd, qid);
      if (!existsSync(filePath)) return;
      const content = await readFile(filePath, "utf8");
      
      const lines0 = content.split("\n");
      let updated: string;
      const bullet = `- ${followUpText}`;
      if (lines0.some((l) => normalizeDirective(l) === normalizeDirective(bullet))) return;
      if (lines0.some((l) => isHeading(l, "followups"))) {
        const lines = content.split("\n");
        const idx = lines.findIndex((l) => isHeading(l, "followups"));
        lines.splice(idx + 1, 0, bullet);
        updated = lines.join("\n");
      } else {
        const base = content.endsWith("\n") ? content : `${content}\n`;
        updated = `${base}\n## Follow-up Requests\n\n${bullet}\n`;
      }
      updated = dedupeDocBullets(updated).text;
      
      const dir = dirname(filePath);
      const tmpPath = join(dir, `.${basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`);
      await writeFile(tmpPath, updated, "utf8");
      await rename(tmpPath, filePath);
      
      const hash = hashContent(updated);
      updateState((s) => s.draft === null ? s : {
        ...s,
        draft: { ...s.draft, contentHash: hash },
        snapshotPending: true,
      });
    } catch {
      // Best-effort append
    }
  });
  await followUpQueue;
}

// The operator asked for a handoff: write the deterministic baseline now (so
// something exists even if the agent fails), then steer the agent to enrich
// it with what only it knows. Nothing is recorded as requirement/amendment.
async function serveHandoffRequest(pi: Pi, ctx: PiCtx, steer: string, request: string): Promise<void> {
  let where = "";
  try {
    const done = await writeHandoff(pi, ctx, getState(), "operator-request");
    where = ` A baseline handoff was written to ${done.relPath}.`;
  } catch {
    // Baseline is best-effort; the tool call below still produces one.
  }
  sendSteer(pi, `${steer}${where} Now call quest_handoff with \`notes\` holding everything you know that the quest state cannot: ` +
    `root causes found, approaches that failed and why, open hypotheses, gotchas, exact commands and file:line locations. ` +
    `Then present the returned handoff to the operator in full. Operator's words: "${request}"`);
}

function handleAmendRequirement(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState & { qid: Qid },
  cleanText: string,
  isConstraint: boolean,
  defaultSteer: string,
): void {
  const demoteToDraft = isConstraint && (state.phase === "implementing" || state.phase === "validating");
  const demoteFromValidating = state.phase === "validating" && !demoteToDraft;
  if (demoteToDraft || demoteFromValidating) cancelReview(state.qid);
  updateState((s) => {
    let next = recordAmendment(recordRefinement(s, cleanText), cleanText, "User mid-quest directive");
    if (s.phase === "implementing") {
      next = { ...next, pendingDirectiveRevision: true, pendingDirectiveText: cleanText, snapshotPending: true };
    }
    if (demoteToDraft && (next.phase === "implementing" || next.phase === "validating")) {
      const nextAction = next.kind === "analysis"
        ? `Revise ## Analysis in the draft file to incorporate amendment "${cleanText}", then save.`
        : `Revise ## Implementation Plan in the draft file to incorporate amendment "${cleanText}", then save.`;
      return demoteToDrafting(next, nextAction);
    }
    if (demoteFromValidating && next.phase === "validating") {
      return next.kind === "analysis"
        ? demoteToDrafting(next, `Revise ## Analysis in the draft file to address operator directive "${cleanText}", then save.`)
        : { ...demoteToImplementing(next), exactNextAction: `Address operator directive "${cleanText}", then claim completion again.` };
    }
    return next;
  });
  if (demoteToDraft) {
    void setDocStatus(ctx, state.qid, "drafting", false);
    emitNow(pi);
  } else if (demoteFromValidating) {
    void setDocStatus(ctx, state.qid, state.kind === "analysis" ? "drafting" : "implementing", false);
    emitNow(pi);
  }
  void appendRequirementAndAmendmentToDraft(ctx, state.qid, cleanText, "User mid-quest directive");
  const workPhase = state.kind === "analysis" ? "drafting" : "implementing";
  const steerMessage = demoteToDraft
    ? `Recorded amendment on quest ${state.qid}: "${cleanText}". Quest returned to draft mode — update the plan in the quest doc to reflect this amendment, then save to trigger review (or reply 'go' to proceed). Respond adequately to what the operator is asking or steering in your message.`
    : (demoteFromValidating
      ? `Recorded operator directive during validation on quest ${state.qid}: "${cleanText}". Validation cancelled and quest returned to ${workPhase}. Respond adequately to the operator, address their feedback, and re-validate when ready.`
      : (state.phase === "implementing"
        ? `Recorded operator directive on quest ${state.qid}: "${cleanText}". Respond adequately to what the operator is asking or steering in your message. Plan revision required before modifying further code files: call quest_update_state { planRevision: '...', note: '...' } to stage the revision for peer review (or reply 'go' / 'APPROVE' to bypass).`
        : defaultSteer));
  sendSteer(pi, steerMessage);
}

function handleRefinementDirective(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState & { qid: Qid },
  cleanText: string,
  defaultSteer: string,
): void {
  const demoteFromValidating = state.phase === "validating";
  if (demoteFromValidating) cancelReview(state.qid);
  updateState((s) => {
    const next = recordRefinement(s, cleanText);
    if (s.phase === "implementing") {
      return { ...next, pendingDirectiveRevision: true, pendingDirectiveText: cleanText, snapshotPending: true };
    }
    if (demoteFromValidating && next.phase === "validating") {
      return next.kind === "analysis"
        ? demoteToDrafting(next, `Revise ## Analysis in the draft file to address operator feedback "${cleanText}", then save.`)
        : { ...demoteToImplementing(next), exactNextAction: `Address operator feedback "${cleanText}", then claim completion again.` };
    }
    return next;
  });
  if (demoteFromValidating) {
    void setDocStatus(ctx, state.qid, state.kind === "analysis" ? "drafting" : "implementing", false);
    emitNow(pi);
  }
  void appendFollowUpToDraft(ctx, state.qid, cleanText);
  const workPhase = state.kind === "analysis" ? "drafting" : "implementing";
  const steerMsg = demoteFromValidating
    ? `Recorded operator refinement during validation on quest ${state.qid}: "${cleanText}". Validation cancelled and quest returned to ${workPhase}. Respond adequately to the operator, address their feedback, and re-validate when ready.`
    : (state.phase === "implementing"
      ? `Recorded operator refinement on quest ${state.qid}: "${cleanText}". Respond adequately to what the operator is asking or steering in your message. If this alters your implementation approach, stage a plan revision via quest_update_state { planRevision: '...', note: '...' } before modifying files (or reply 'go' to proceed).`
      : defaultSteer);
  sendSteer(pi, steerMsg);
}

export function installSubQuests(pi: Pi): void {
  onUserMessage(pi, async (text, ctx) => {
    try {
      const state = getState();
      if (state.disabled === true || state.qid === null || state.phase === "idle" || state.phase === "archived") return;
      const trimmed = text.trim();
      if (trimmed.startsWith("/") || trimmed.length < 3) return;

      const config = await readQuestConfig(ctx.cwd);
      const parsed = await interpretUserTurn(trimmed, state.phase, config);
      const triaged = triageInQuestRequest(state.qid, parsed.kind, parsed.cleanText, config.midQuest);
      if (triaged === null) return;

      if (triaged.action === "handoff") {
        await serveHandoffRequest(pi, ctx, triaged.steer, trimmed);
        return;
      }
      if (triaged.action === "preempt_subquest") {
        updateState((s) => recordRefinement(s, parsed.cleanText));
        void createChildQuest(pi, ctx, parsed.cleanText, parsed.cleanText, true);
        return;
      }
      if (triaged.action === "queue_subquest") {
        updateState((s) => recordRefinement(s, parsed.cleanText));
        void appendSubQuestToDraft(ctx, state.qid, parsed.cleanText);
        sendSteer(pi, triaged.steer);
        return;
      }
      const activeState = state as QuestState & { qid: Qid };
      if (triaged.action === "amend_requirement") {
        handleAmendRequirement(pi, ctx, activeState, parsed.cleanText, parsed.kind === "constraint", triaged.steer);
        return;
      }
      handleRefinementDirective(pi, ctx, activeState, parsed.cleanText, triaged.steer);
    } catch {
      // Passive handler: never break the agent.
    }
  });
}
