// HIGH_LEVEL: #commands — list all quests with rich triage info and active marker.
import { getState } from "../../app/store.ts";
import { DEFAULT_STALE_DAYS, renderGarden } from "../../domain/garden.ts";
import { decodeSnapshot } from "../../durability/snapshots.ts";
import type { PiCtx } from "../../hooks/events.ts";
import type { QuestState } from "../../domain/quest.ts";
import { dedupeAll, gardenRows } from "./continuity.ts";

function formatQuestTitle(qid: string, name?: string | null): string {
  const clean = name?.trim();
  return clean && clean !== qid ? `${clean} (${qid})` : qid;
}

export async function questRows(ctx: PiCtx, staleDays = DEFAULT_STALE_DAYS): Promise<string[]> {
  await dedupeAll(ctx.cwd);
  const active = getState();
  const gRows = await gardenRows(ctx.cwd, staleDays);
  const seen = new Set<string>(gRows.map((r) => r.qid));

  const entries = ctx.sessionManager.getEntries();
  const branchOnly: QuestState[] = [];
  for (const entry of entries) {
    if (entry.customType !== "quest_journal") continue;
    const state = decodeSnapshot(entry.data);
    if (state?.qid && !seen.has(state.qid)) {
      seen.add(state.qid);
      branchOnly.push(state);
    }
  }

  const lines: string[] = [];
  const mark = (qid: string) => active.qid === qid ? "  ◀ active" : "";
  for (const state of branchOnly) {
    if (state.qid) {
      const title = formatQuestTitle(state.qid, state.name || state.draft?.name);
      lines.push(`  ${title} — ${state.phase}${mark(state.qid)}`);
    }
  }

  if (gRows.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(...renderGarden(gRows, staleDays));
  } else if (lines.length === 0) {
    lines.push("  (none)");
  }
  return lines;
}

export async function listQuests(ctx: PiCtx): Promise<string[]> {
  const active = getState();
  const activeLabel = active.qid
    ? `${formatQuestTitle(active.qid, active.name || active.draft?.name)} — ${active.phase}`
    : "(none)";
  const wtLine = active.worktreePath
    ? [`Worktree: ${active.worktreePath}${active.worktreeBranch ? ` (${active.worktreeBranch})` : ""}`]
    : [];
  return [
    `Active: ${activeLabel}`,
    ...wtLine,
    "",
    ...await questRows(ctx),
  ];
}
