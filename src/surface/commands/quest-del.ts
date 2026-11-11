// HIGH_LEVEL: #commands — delete/abandon the current quest, a named quest, or batch-prune drafts.
import { getState } from "../../app/store";
import { DEFAULT_STALE_DAYS } from "../../domain/garden";
import { isQid } from "../../domain/qid";
import type { Pi, PiCtx } from "../../hooks/events";
import { archiveActiveQuest } from "../tools/archive";
import { gardenRows, pruneDraftQuests } from "./continuity";
import { listDraftQids, readDraftHeading, summarizeActive } from "./quest";

export interface QuestDelArgs {
  targetQid?: string;
  targets: string[];
  action?: "integrate" | "keep" | "discard";
  prune: boolean;
  stale: boolean;
  empty: boolean;
  orphans: boolean;
  all: boolean;
  dryRun: boolean;
  staleDays: number;
}

export function parseQuestDelArgs(rawArg: string): QuestDelArgs {
  const parts = rawArg.trim().split(/\s+/).filter(Boolean);
  let action: "integrate" | "keep" | "discard" | undefined;
  const targets: string[] = [];
  let prune = false;
  let stale = false;
  let empty = false;
  let orphans = false;
  let all = false;
  let dryRun = false;
  let staleDays = DEFAULT_STALE_DAYS;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === "prune") {
      prune = true;
      continue;
    }
    if (part === "--integrate" || part === "-i" || part === "--merge" || part === "-m") {
      action = "integrate";
    } else if (part === "--keep" || part === "-k") {
      action = "keep";
    } else if (part === "--discard" || part === "-d") {
      action = "discard";
    } else if (part === "--stale") {
      stale = true;
    } else if (part === "--empty") {
      empty = true;
    } else if (part === "--orphans") {
      orphans = true;
    } else if (part === "--all") {
      all = true;
    } else if (part === "--dry-run" || part === "-n") {
      dryRun = true;
    } else if (part === "--days" && Number(parts[i + 1]) > 0) {
      staleDays = Number(parts[++i]);
    } else if (!part.startsWith("-")) {
      targets.push(part);
    }
  }

  return {
    targetQid: targets[0],
    targets,
    action,
    prune,
    stale,
    empty,
    orphans,
    all,
    dryRun,
    staleDays,
  };
}

async function resolveDraftTargets(cwd: string, targets: readonly string[]): Promise<string[]> {
  const resolved: string[] = [];
  const drafts = await listDraftQids(cwd);
  for (const t of targets) {
    if (isQid(t) && drafts.includes(t)) {
      resolved.push(t);
      continue;
    }
    const lower = t.toLowerCase();
    for (const qid of drafts) {
      const heading = await readDraftHeading(cwd, qid);
      if (heading !== null && heading.toLowerCase() === lower) {
        resolved.push(qid);
        break;
      }
    }
  }
  return [...new Set(resolved)];
}

export async function killQuest(pi: Pi, ctx: PiCtx, rawArg: string): Promise<string> {
  const parsed = parseQuestDelArgs(rawArg);
  const active = getState();
  const hasPruneFlags = parsed.prune || parsed.stale || parsed.empty || parsed.orphans || parsed.all || parsed.dryRun;

  const onlyTargetsActive = !hasPruneFlags && parsed.targets.length === 1 &&
    active.qid !== null && (active.qid === parsed.targets[0] || active.name === parsed.targets[0]);

  if (hasPruneFlags || (parsed.targets.length > 0 && !onlyTargetsActive)) {
    const resolvedQids = await resolveDraftTargets(ctx.cwd, parsed.targets);
    if (!hasPruneFlags && resolvedQids.length === 0) {
      const rows = await gardenRows(ctx.cwd, parsed.staleDays);
      if (parsed.targets.some((t) => rows.some((r) => r.qid === t && r.verdict === "active"))) {
        // Explicit active quest passed when active state matched via gardenRows
      } else {
        return `No quest matching "${parsed.targets.join(", ")}".`;
      }
    } else {
      const lines = await pruneDraftQuests(pi, ctx, {
        staleDays: parsed.staleDays,
        filter: { stale: parsed.stale, empty: parsed.empty, orphans: parsed.orphans, qids: resolvedQids },
        all: parsed.all,
        dryRun: parsed.dryRun,
      });
      return lines.join("\n");
    }
  }

  if (active.qid === null) return "No active quest to delete.";
  try {
    const done = await archiveActiveQuest(pi, ctx, "ABANDONED", "Killed via /quest del.", {
      confirmDiscard: true,
      action: parsed.action,
    });
    return `Quest ${done.archivedQid} deleted (abandoned). ${summarizeActive()}`;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Delete failed: ${detail}`;
  }
}
