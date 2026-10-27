// HIGH_LEVEL: #commands — list all quests with their states and the active marker.
import { getState } from "../../app/store.ts";
import { decodeSnapshot } from "../../durability/snapshots.ts";
import type { PiCtx } from "../../hooks/events.ts";
import type { QuestState } from "../../domain/quest.ts";
import { listArchivedQids, listDraftQids } from "../../files.ts";

export async function questRows(ctx: PiCtx): Promise<string[]> {
  const active = getState();
  const rows: string[] = [];
  const seen = new Set<string>();
  const entries = ctx.sessionManager.getEntries();
  const branch: QuestState[] = [];
  for (const entry of entries) {
    if (entry.customType !== "quest_journal") continue;
    const state = decodeSnapshot(entry.data);
    if (state?.qid && !seen.has(state.qid)) {
      seen.add(state.qid);
      branch.push(state);
    }
  }
  const futures = await listDraftQids(ctx.cwd);
  const archives = await listArchivedQids(ctx.cwd);
  const mark = (qid: string) => active.qid === qid ? "  ◀ active" : "";
  for (const state of branch) {
    if (state.qid) rows.push(`  ${state.qid} — ${state.phase}${mark(state.qid)}`);
  }
  for (const qid of futures) {
    if (!seen.has(qid)) {
      rows.push(
        `  ${qid} — ${
          active.qid === qid
            ? (active.phase === "implementing" || active.phase === "validating"
              ? active.phase
              : "drafting")
            : "drafting"
        }${mark(qid)}`,
      );
    }
  }
  for (const qid of archives) {
    rows.push(`  ${qid} — archived`);
  }
  return rows.length > 0 ? rows : ["  (none)"];
}

export async function listQuests(ctx: PiCtx): Promise<string[]> {
  const active = getState();
  return [
    `Active: ${active.qid ? `${active.qid} — ${active.phase}` : "(none)"}`,
    "",
    "Quests:",
    ...await questRows(ctx),
  ];
}
