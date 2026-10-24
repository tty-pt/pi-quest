// HIGH_LEVEL: #working together
// HIGH_LEVEL: #sub-quests — stack, links, returns, completion gating.
// SPEC: B1.10.
import { existsSync } from "node:fs";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { getState, updateState } from "../app/store";
import { sendSteer } from "../app/interpreter";
import { recordRefinement } from "../domain/quest";
import { draftPath } from "../domain/paths";
import { hashContent } from "../drafting/plan-text";
import type { Qid } from "../domain/qid";
import { onUserMessage, type Pi, type PiCtx } from "../hooks/events";
import { triageInQuestRequest } from "./scope";
import { classifyUserMessage } from "./triage";

let followUpQueue: Promise<void> = Promise.resolve();

export async function appendFollowUpToDraft(ctx: PiCtx, qid: Qid, followUpText: string): Promise<void> {
  followUpQueue = followUpQueue.then(async () => {
    try {
      const filePath = join(ctx.cwd, draftPath(qid));
      if (!existsSync(filePath)) return;
      const content = await readFile(filePath, "utf8");
      
      const headerRegex = /^##\s+follow-up\s+requests\b/im;
      let updated: string;
      const bullet = `- ${followUpText}`;
      if (headerRegex.test(content)) {
        const lines = content.split("\n");
        const idx = lines.findIndex((l) => /^##\s+follow-up\s+requests\b/i.test(l));
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
  onUserMessage(pi, (text, ctx) => {
    try {
      const state = getState();
      if (state.qid === null || state.phase === "idle" || state.phase === "archived") return;
      const trimmed = text.trim();
      if (trimmed.startsWith("/") || trimmed.length < 20) return;
      const triaged = triageInQuestRequest(state.qid, classifyUserMessage(trimmed));
      if (triaged === null) return;
      updateState((s) => recordRefinement(s, trimmed));
      void appendFollowUpToDraft(ctx, state.qid, trimmed);
      sendSteer(pi, triaged.steer);
    } catch {
      // Passive handler: never break the agent.
    }
  });
}
