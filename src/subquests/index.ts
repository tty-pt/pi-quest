// HIGH_LEVEL: #working together
// HIGH_LEVEL: #sub-quests — stack, links, returns, completion gating.
// SPEC: B1.10.
import { existsSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { getState, updateState } from "../app/store";
import { sendSteer } from "../app/interpreter";
import { recordAmendment, recordRefinement } from "../domain/quest";
import { demoteToDrafting } from "../domain/transitions";
import { draftPath } from "../domain/paths";
import { draftFilePath } from "../files";
import { isHeading } from "../domain/sections";
import { dedupeDocBullets, normalizeDirective } from "../domain/dedupe";
import { hashContent } from "../drafting/plan-text";
import { appendAmendmentToDoc, appendRequirementToDoc, appendSubQuestBacklogItem } from "../domain/quest-doc";
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

export function installSubQuests(pi: Pi): void {
  onUserMessage(pi, async (text, ctx) => {
    try {
      const state = getState();
      if (state.disabled === true || state.qid === null || state.phase === "idle" || state.phase === "archived") return;
      const trimmed = text.trim();
      if (trimmed.startsWith("/") || trimmed.length < 3) return;

      const config = await readQuestConfig(ctx.cwd);
      // One shared interpretation (judge-first). Pure steering (advance/abort) belongs
      // to the phase handlers; it is never a requirement or refinement.
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

      if (triaged.action === "amend_requirement") {
        // Only an explicit constraint (!rule / must: / natural constraint phrasing)
        // sends active work back to drafting; casual refinements are recorded as
        // amendments but never revoke an approved plan.
        const demote = parsed.kind === "constraint" &&
          (state.phase === "implementing" || state.phase === "validating");
        if (demote) cancelReview(state.qid);
        updateState((s) => {
          let next = recordAmendment(recordRefinement(s, parsed.cleanText), parsed.cleanText, "User mid-quest directive");
          if (s.phase === "implementing") {
            next = { ...next, pendingDirectiveRevision: true, pendingDirectiveText: parsed.cleanText, snapshotPending: true };
          }
          if (!demote || (next.phase !== "implementing" && next.phase !== "validating")) return next;
          const nextAction = next.kind === "analysis"
            ? `Revise ## Analysis in the draft file to incorporate amendment "${parsed.cleanText}", then save.`
            : `Revise ## Implementation Plan in the draft file to incorporate amendment "${parsed.cleanText}", then save.`;
          return demoteToDrafting(next, nextAction);
        });
        void appendRequirementAndAmendmentToDraft(ctx, state.qid, parsed.cleanText, "User mid-quest directive");
        const steerMessage = demote
          ? `Recorded amendment on quest ${state.qid}: "${parsed.cleanText}". Quest returned to draft mode — update the plan in the quest doc to reflect this amendment, then save to trigger review (or reply 'go' to proceed). Respond adequately to what the operator is asking or steering in your message.`
          : (state.phase === "implementing"
            ? `Recorded operator directive on quest ${state.qid}: "${parsed.cleanText}". Respond adequately to what the operator is asking or steering in your message. Plan revision required before modifying further code files: call quest_update_state { planRevision: '...', note: '...' } to stage the revision for peer review (or reply 'go' / 'APPROVE' to bypass).`
            : triaged.steer);
        sendSteer(pi, steerMessage);
        return;
      }

      // Default refinement
      updateState((s) => {
        const next = recordRefinement(s, parsed.cleanText);
        if (s.phase === "implementing") {
          return { ...next, pendingDirectiveRevision: true, pendingDirectiveText: parsed.cleanText, snapshotPending: true };
        }
        return next;
      });
      void appendFollowUpToDraft(ctx, state.qid, parsed.cleanText);
      const steerMsg = state.phase === "implementing"
        ? `Recorded operator refinement on quest ${state.qid}: "${parsed.cleanText}". Respond adequately to what the operator is asking or steering in your message. If this alters your implementation approach, stage a plan revision via quest_update_state { planRevision: '...', note: '...' } before modifying files (or reply 'go' to proceed).`
        : triaged.steer;
      sendSteer(pi, steerMsg);
    } catch {
      // Passive handler: never break the agent.
    }
  });
}
