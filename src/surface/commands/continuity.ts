// HIGH_LEVEL: #commands — continuity handles: /quest handoff and draft triage helpers.
import { readdir, readFile, rename, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getState } from "../../app/store";
import { dedupeDocBullets } from "../../domain/dedupe";
import { assessQuest, DEFAULT_STALE_DAYS, selectForPrune, type GardenRow, type PruneFilter } from "../../domain/garden";
import { FUTURE_DIR } from "../../domain/paths";
import { isQid, type Qid } from "../../domain/qid";
import { docOnlyState } from "../../durability/handoff-io";
import { newestSnapshotFor } from "../../durability/snapshots";
import { refreshStatus } from "../../durability/status";
import { canonicalWorkspaceRoot } from "../../files";
import type { Pi, PiCtx } from "../../hooks/events";
import { archiveQuestFiles } from "../../views/quest-view";
import { produceHandoff } from "../tools/handoff";

export interface PruneArgs {
  staleDays: number;
  filter: PruneFilter;
  all: boolean;
  dryRun: boolean;
}

export function protectedQids(): Set<string> {
  const s = getState();
  const out = new Set<string>();
  if (s.qid) out.add(s.qid);
  if (s.parentQid) out.add(s.parentQid);
  for (const f of s.questStack ?? []) out.add(f.qid);
  return out;
}

async function futureDocs(cwd: string): Promise<Array<{ qid: Qid; path: string; text: string; mtimeMs: number }>> {
  const dir = join(canonicalWorkspaceRoot(cwd), FUTURE_DIR);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const qid = name.slice(0, -3);
    if (!isQid(qid)) continue;
    const path = join(dir, name);
    try {
      out.push({ qid, path, text: await readFile(path, "utf8"), mtimeMs: (await stat(path)).mtimeMs });
    } catch {
      // Unreadable doc: skip, never crash the command.
    }
  }
  return out;
}

export async function gardenRows(cwd: string, staleDays = DEFAULT_STALE_DAYS, now = Date.now()): Promise<GardenRow[]> {
  const docs = await futureDocs(cwd);
  const liveQids = new Set<string>(docs.map((d) => d.qid));
  const guard = protectedQids();
  return docs.map((d) => assessQuest({ qid: d.qid, docText: d.text, mtimeMs: d.mtimeMs, now, protectedQids: guard, liveQids, staleDays }));
}

export async function dedupeAll(cwd: string): Promise<string[]> {
  const lines: string[] = [];
  for (const doc of await futureDocs(cwd)) {
    const { text, removed } = dedupeDocBullets(doc.text);
    if (removed === 0) continue;
    const tmp = `${doc.path}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, doc.path);
    const when = new Date(doc.mtimeMs);
    await utimes(doc.path, when, when);
    lines.push(`  ${doc.qid}: removed ${removed} duplicate bullet(s)`);
  }
  return lines.length ? ["Deduplicated quest docs:", ...lines] : ["No duplicate bullets found."];
}

export async function pruneDraftQuests(pi: Pi, ctx: PiCtx, args: PruneArgs): Promise<string[]> {
  const f = args.filter;
  if (!args.all && !f.stale && !f.empty && !f.orphans && f.qids.length === 0) {
    return ["Nothing selected. Use --stale, --empty, --orphans, --all, and/or explicit qids. The active quest is never pruned."];
  }
  const allRows = await gardenRows(ctx.cwd, args.staleDays);
  const rows = selectForPrune(allRows, { ...f, all: args.all });
  if (rows.length === 0) return ["No quests match the delete selection."];
  if (args.dryRun) {
    return [
      `Would delete ${rows.length} quest(s):`,
      ...rows.map((r) => `  ${r.qid} (${r.verdict}) — ${r.title}`),
    ];
  }
  if (ctx.hasUI && (rows.length > 1 || f.stale || f.empty || f.orphans || args.all)) {
    const ok = await ctx.ui.confirm(
      "Delete quests",
      `Delete ${rows.length} quest(s) as ABANDONED?\n${rows.map((r) => `${r.qid} ${r.title}`).join("\n")}`,
    );
    if (!ok) return ["Delete cancelled."];
  }
  const entries = ctx.sessionManager.getEntries();
  const out: string[] = [];
  let deleted = 0;
  for (const row of rows) {
    const qid = row.qid as Qid;
    try {
      const docPath = join(canonicalWorkspaceRoot(ctx.cwd), FUTURE_DIR, `${qid}.md`);
      const state = newestSnapshotFor(entries, qid) ?? docOnlyState(qid, await readFile(docPath, "utf8").catch(() => null));
      await archiveQuestFiles(pi, ctx.cwd, { ...state, qid }, "ABANDONED", `Deleted via /quest del (${row.verdict}).`);
      deleted += 1;
      out.push(`  deleted ${qid} (${row.verdict}) — ${row.title}`);
    } catch (err) {
      out.push(`  FAILED ${qid}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return [`Deleted ${deleted}/${rows.length}:`, ...out];
}

export async function runHandoffCommand(pi: Pi, ctx: PiCtx, raw: string): Promise<string> {
  const qid = raw.trim() || undefined;
  try {
    const done = await produceHandoff(pi, ctx, qid, "manual");
    if (done === null) return `No quest found${qid ? ` for ${qid}` : " (none active)"}.`;
    return `Handoff written to ${done.relPath}\n\n${done.content}`;
  } catch (err) {
    return `Handoff failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function say(ctx: PiCtx, text: string): void {
  try {
    ctx.ui.notify(text, "info");
  } catch {
    // Notification is best-effort.
  }
}

/** `/quest handoff …`; true when handled. */
export async function runContinuitySubcommand(pi: Pi, ctx: PiCtx, args: string): Promise<boolean> {
  const [head, ...rest] = args.trim().split(/\s+/);
  if (head !== "handoff") return false;
  say(ctx, await runHandoffCommand(pi, ctx, rest.join(" ")));
  refreshStatus(ctx);
  return true;
}

export function installContinuityCommands(_pi: Pi): void {
  // Continuity commands are unified under /quest handoff.
}
