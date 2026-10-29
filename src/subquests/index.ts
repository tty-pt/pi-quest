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
import { isHeading } from "../domain/sections";
import { hashContent } from "../drafting/plan-text";
import { appendAmendmentToDoc, appendRequirementToDoc, appendSubQuestBacklogItem } from "../domain/quest-doc";
import type { Qid } from "../domain/qid";
import { onUserMessage, type Pi, type PiCtx } from "../hooks/events";
import { readQuestConfig } from "../config";
import { interpretUserTurn } from "../domain/intent";
import { cancelReview } from "../review/tracker";
import { createChildQuest } from "../surface/tools/subquest";
import { triageInQuestRequest } from "./scope";

let followUpQueue: Promise<void> = Promise.resolve();

export async function appendSubQuestToDraft(ctx: PiCtx, qid: Qid, goal: string): Promise<void> {
  followUpQueue = followUpQueue.then(async () => {
    try {
      const filePath = join(ctx.cwd, draftPath(qid));
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
      const filePath = join(ctx.cwd, draftPath(qid));
      if (!existsSync(filePath)) return;
      const content = await readFile(filePath, "utf8");
      let updated = appendRequirementToDoc(content, requirementText);
      updated = appendAmendmentToDoc(updated, requirementText, reason);
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
      const filePath = join(ctx.cwd, draftPath(qid));
      if (!existsSync(filePath)) return;
      const content = await readFile(filePath, "utf8");
      
      const lines0 = content.split("\n");
      let updated: string;
      const bullet = `- ${followUpText}`;
      if (lines0.some((l) => isHeading(l, "followups"))) {
        const lines = content.split("\n");
        const idx = lines.findIndex((l) => isHeading(l, "followups"));
        lines.splice(idx + 1, 0, bullet);
        updated = lines.join("\n");
      } else {
        const base = content.endsWith("\n") ? content : `${content}\n`;
        updated = `${base}\n## Follow-up Requests\n\n${bullet}\n`;
      }
      
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

export function installSubQuests(pi: Pi): void {
  onUserMessage(pi, async (text, ctx) => {
    try {
      const state = getState();
      if (state.qid === null || state.phase === "idle" || state.phase === "archived") return;
      const trimmed = text.trim();
      if (trimmed.startsWith("/") || trimmed.length < 3) return;

      const config = await readQuestConfig(ctx.cwd);
      // One shared interpretation (judge-first). Pure steering (advance/abort) belongs
      // to the phase handlers; it is never a requirement or refinement.
      const parsed = await interpretUserTurn(trimmed, state.phase, config);
      const triaged = triageInQuestRequest(state.qid, parsed.kind, parsed.cleanText, config.midQuest);
      if (triaged === null) return;

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
          const next = recordAmendment(recordRefinement(s, parsed.cleanText), parsed.cleanText, "User mid-quest directive");
          if (!demote || (next.phase !== "implementing" && next.phase !== "validating")) return next;
          const nextAction = next.kind === "analysis"
            ? `Revise ## Analysis in the draft file to incorporate amendment "${parsed.cleanText}", then save.`
            : `Revise ## Implementation Plan in the draft file to incorporate amendment "${parsed.cleanText}", then save.`;
          return demoteToDrafting(next, nextAction);
        });
        void appendRequirementAndAmendmentToDraft(ctx, state.qid, parsed.cleanText, "User mid-quest directive");
        const steerMessage = demote
          ? `Recorded amendment on quest ${state.qid}: "${parsed.cleanText}". Quest returned to draft mode — update the plan in the quest doc to reflect this amendment, then save to trigger review (or reply 'go' to proceed).`
          : triaged.steer;
        sendSteer(pi, steerMessage);
        return;
      }

      // Default refinement
      updateState((s) => recordRefinement(s, parsed.cleanText));
      void appendFollowUpToDraft(ctx, state.qid, parsed.cleanText);
      sendSteer(pi, triaged.steer);
    } catch {
      // Passive handler: never break the agent.
    }
  });
}
