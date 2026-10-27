// HIGH_LEVEL: #commands — resume a quest or drafting phase, or show the active quest.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, replaceState } from "../../app/store.ts";
import { emitNow } from "../../app/interpreter.ts";
import { createQuest } from "../../domain/quest.ts";
import { createDraft } from "../../domain/transitions.ts";
import { isQid } from "../../domain/qid.ts";
import { FUTURE_DIR } from "../../domain/paths.ts";
import { newestSnapshot, newestSnapshotFor } from "../../durability/snapshots.ts";
import type { Pi, PiCtx } from "../../hooks/events.ts";
import { listDraftQids } from "../../files.ts";

export { listDraftQids };

export function summarizeActive(): string {
  const state = getState();
  if (state.qid === null) return "No active quest.";
  const kids = state.children.length > 0
    ? ` Children: ${state.children.map((c) => `${c.qid}=${c.status}`).join(", ")}.`
    : "";
  const review = state.activeReview ? ` Review ${state.activeReview.kind} running.` : "";
  return `Quest ${state.qid} — phase ${state.phase}.${review}${kids} ${state.exactNextAction}`;
}

export async function readDraftObjective(cwd: string, qid: string): Promise<string | null> {
  try {
    const text = await readFile(join(cwd, FUTURE_DIR, `${qid}.md`), "utf8");
    return text.match(/^##\s+Original request\s*\n+(.+?)(?:\n##\s|\n*$)/ims)?.[1]?.trim() ||
      text.split("\n")[0] ||
      qid;
  } catch {
    return null;
  }
}

async function adoptDraftFile(pi: Pi, ctx: PiCtx, qid: string): Promise<string> {
  const objective = await readDraftObjective(ctx.cwd, qid);
  if (objective === null) return `No quest ${qid}: no snapshot and no draft file.`;
  replaceState(createDraft(createQuest(objective, qid), qid));
  emitNow(pi);
  return `Resumed draft ${qid}: ${summarizeActive()}`;
}

export async function resumeQuest(pi: Pi, ctx: PiCtx, rawArg: string): Promise<string> {
  const arg = rawArg.trim();
  if (arg === "") return summarizeActive();
  const entries = ctx.sessionManager.getEntries();
  if (isQid(arg)) {
    const hit = newestSnapshotFor(entries, arg);
    if (hit) {
      replaceState(hit);
      return `Resumed quest ${arg}: ${summarizeActive()}`;
    }
    return adoptDraftFile(pi, ctx, arg);
  }
  const active = getState();
  if (active.qid !== null && (active.name === arg || active.qid === arg)) {
    return summarizeActive();
  }
  const drafts = await listDraftQids(ctx.cwd);
  const match = drafts.find((qid) => qid === arg);
  if (match !== undefined) return adoptDraftFile(pi, ctx, match);
  const newest = newestSnapshot(entries);
  if (newest?.name === arg && newest.qid) {
    replaceState(newest);
    return `Resumed quest ${newest.qid}: ${summarizeActive()}`;
  }
  return `No quest matching "${arg}".`;
}
