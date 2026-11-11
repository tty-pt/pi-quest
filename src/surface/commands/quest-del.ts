// HIGH_LEVEL: #commands — delete/abandon the current quest, a named quest, or batch-prune drafts.
import { getState, replaceState, setQuestDisabled } from "../../app/store";
import { readQuestConfig } from "../../config";
import { DEFAULT_STALE_DAYS } from "../../domain/garden";
import { isQid } from "../../domain/qid";
import { IDLE_STATE } from "../../domain/quest";
import { openDetectedQuest } from "../../drafting/detect";
import { extractPriorConversationObjective } from "../../durability/transcript";
import type { Pi, PiCtx } from "../../hooks/events";
import {
  confirmAndSquashWorktree,
  findPrimaryRepoRoot,
  readSlotLease,
  releaseWarmSlot,
  retainSlotLease,
  syncHarnessCwd,
  synthesizeSquashCommitMessage,
} from "../../utils/git";
import { archiveActiveQuest } from "../tools/archive";
import { gardenRows, pruneDraftQuests } from "./continuity";
import { listDraftQids, readDraftHeading, summarizeActive } from "./quest";

export interface QuestDelArgs {
  targetQid?: string;
  targets: string[];
  action?: "integrate" | "keep" | "keep-slot" | "discard";
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
  let action: "integrate" | "keep" | "keep-slot" | "discard" | undefined;
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
    } else if (part === "--keep-slot" || part === "--slot" || part === "-s") {
      action = "keep-slot";
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

function detectSlotFromContext(cwd: string): { worktreePath?: string; worktreeBranch?: string } {
  const curr = getState();
  if (curr.worktreePath) {
    return { worktreePath: curr.worktreePath, worktreeBranch: curr.worktreeBranch };
  }
  const cand = process.env.PI_WORKTREE_PATH || cwd;
  const match = /^(.+\/\.pi\/scratch\/slot-\d+)(?:\/|$)/.exec(cand.replace(/\\/g, "/"));
  if (!match) return {};
  const slotDir = match[1];
  const lease = readSlotLease(slotDir);
  return {
    worktreePath: slotDir,
    worktreeBranch: lease?.branch ?? (curr.qid ? `quest/${curr.qid}` : undefined),
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

  if (active.qid === null) {
    if (active.worktreePath && parsed.action === "discard") {
      const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
      await releaseWarmSlot(primaryRoot, active.worktreePath, "", pi, undefined, { deleteBranch: true });
      replaceState(IDLE_STATE);
      syncHarnessCwd(null, pi);
      return `Released retained slot ${active.worktreePath}. ${summarizeActive()}`;
    }
    return "No active quest to delete.";
  }
  try {
    if (parsed.action === "keep-slot" && !active.worktreePath) {
      const det = detectSlotFromContext(ctx.cwd);
      if (det.worktreePath) {
        replaceState({ ...active, worktreePath: det.worktreePath, worktreeBranch: det.worktreeBranch || `quest/${active.qid}` });
      }
    }
    const done = await archiveActiveQuest(pi, ctx, "ABANDONED", "Killed via /quest del.", {
      confirmDiscard: true,
      action: parsed.action,
    });
    const after = getState();
    const slotNote = after.worktreePath
      ? ` Retained slot: ${after.worktreePath}${after.worktreeBranch ? ` (${after.worktreeBranch})` : ""}.`
      : "";
    return `Quest ${done.archivedQid} deleted (abandoned).${slotNote} ${summarizeActive()}`;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `Delete failed: ${detail}`;
  }
}

export async function startNewQuestInSlot(pi: Pi, ctx: PiCtx, rawObjective: string): Promise<string> {
  const prev = getState();
  const det = detectSlotFromContext(ctx.cwd);
  let retiredNote = "";

  if (prev.qid !== null) {
    if (det.worktreePath && !prev.worktreePath) {
      replaceState({ ...prev, worktreePath: det.worktreePath, worktreeBranch: det.worktreeBranch || `quest/${prev.qid}` });
    }
    const done = await archiveActiveQuest(pi, ctx, "ABANDONED", "Retired via /quest new (keeping slot).", {
      confirmDiscard: true,
      action: "keep-slot",
    });
    retiredNote = `Retired quest ${done.archivedQid}. `;
  } else if (det.worktreePath) {
    retainSlotLease(det.worktreePath, det.worktreeBranch ?? null, null);
    replaceState({ ...IDLE_STATE, worktreePath: det.worktreePath, worktreeBranch: det.worktreeBranch, disabled: false });
    syncHarnessCwd(det.worktreePath, pi);
  }

  setQuestDisabled(false);
  const objective = extractPriorConversationObjective(ctx, rawObjective.trim()) || rawObjective.trim();
  if (objective !== "") {
    const cfg = await readQuestConfig(ctx.cwd);
    await openDetectedQuest(pi, ctx, objective, cfg, "/quest new");
    const next = getState();
    const slotInfo = next.worktreePath ? ` in slot ${next.worktreePath}${next.worktreeBranch ? ` (${next.worktreeBranch})` : ""}` : "";
    return `${retiredNote}Started new quest ${next.qid}${slotInfo}: ${summarizeActive()}`;
  }

  const curr = getState();
  const slotInfo = curr.worktreePath ? ` in retained slot ${curr.worktreePath}${curr.worktreeBranch ? ` (${curr.worktreeBranch})` : ""}` : "";
  return `${retiredNote}Ready for a new quest${slotInfo}. Describe your next task to begin.`;
}

export async function finishQuestOrSlot(pi: Pi, ctx: PiCtx, rawArg: string): Promise<string> {
  const parsed = parseQuestDelArgs(rawArg);
  const active = getState();
  const det = detectSlotFromContext(ctx.cwd);

  if (active.qid !== null) {
    try {
      const done = await archiveActiveQuest(pi, ctx, "COMPLETED", "Finished via /quest finish.", {
        action: parsed.action,
      });
      const after = getState();
      const slotNote = after.worktreePath
        ? ` Retained slot: ${after.worktreePath}${after.worktreeBranch ? ` (${after.worktreeBranch})` : ""}.`
        : "";
      return `Quest ${done.archivedQid} completed and archived.${slotNote} ${summarizeActive()}`;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return `Finish failed: ${detail}`;
    }
  }

  const wtPath = active.worktreePath ?? det.worktreePath;
  const wtBranch = active.worktreeBranch ?? det.worktreeBranch;
  if (!wtPath || !wtBranch) {
    return "No active quest or retained scratch slot to finish.";
  }

  const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
  const squashMsg = synthesizeSquashCommitMessage({
    qid: wtBranch.replace(/^quest\//, ""),
    objective: `Integrate retained worktree branch ${wtBranch}`,
  });
  const res = await confirmAndSquashWorktree(pi, ctx, primaryRoot, wtBranch, "HEAD", squashMsg, [], wtPath);
  if (!res.ok) {
    return `Integration failed (${res.mode}): ${res.error ?? "aborted"}`;
  }
  const keepSlot = parsed.action === "keep-slot" || res.mode === "keep-slot" || res.mode === "squash-keep-slot";
  const keepBranch = keepSlot || res.mode === "keep";
  if (keepSlot) {
    retainSlotLease(wtPath, wtBranch, null);
    replaceState({ ...IDLE_STATE, worktreePath: wtPath, worktreeBranch: wtBranch });
    syncHarnessCwd(wtPath, pi);
    return `Retained slot ${wtPath} (${wtBranch}) (${res.mode}). ${summarizeActive()}`;
  }
  await releaseWarmSlot(primaryRoot, wtPath, "", pi, undefined, { deleteBranch: !keepBranch });
  replaceState(IDLE_STATE);
  syncHarnessCwd(null, pi);
  return `Integrated ${wtBranch} (${res.mode}) and released slot ${wtPath}. ${summarizeActive()}`;
}

