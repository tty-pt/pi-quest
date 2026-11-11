// HIGH_LEVEL: #commands — resume a quest or drafting phase, or show the active quest and command reference.
import { pathToFileURL } from "node:url";
import { getState, replaceState, setQuestDisabled, updateState } from "../../app/store.ts";
import { emitNow } from "../../app/interpreter.ts";
import { createQuest, type QuestState } from "../../domain/quest.ts";
import { createDraft } from "../../domain/transitions.ts";
import { isQid } from "../../domain/qid.ts";
import { draftPath } from "../../domain/paths.ts";
import { newestSnapshot, newestSnapshotFor, newestSnapshotPerQid } from "../../durability/snapshots.ts";
import { questStatus } from "../../durability/status.ts";
import type { Pi, PiCtx } from "../../hooks/events.ts";
import { draftFilePath, listDraftQids } from "../../files.ts";
import { readQuestConfig } from "../../config.ts";
import { ensureQuestWorktreeAttached, findPrimaryRepoRoot } from "../../utils/git/index.ts";
import { cancelReview, hasInFlight } from "../../review/tracker.ts";
import { clearPlanRevisionRetries } from "../../implementing/plan-revision.ts";
import { clearDraftReviewRetry } from "../../drafting/reviews.ts";
import { readDraftHeading, readDraftObjective } from "../../durability/quest-doc-io.ts";

export { listDraftQids, readDraftHeading, readDraftObjective };

export const QUEST_COMMAND_HELP: ReadonlyArray<{ cmd: string; desc: string }> = [
  { cmd: "/quest edit", desc: "Open active quest plan in $EDITOR" },
  { cmd: "/quest list", desc: "List active & draft quests with triage info" },
  { cmd: "/quest <name|qid>", desc: "Switch to or resume a quest (/quest pick to choose)" },
  { cmd: "/quest new [goal]", desc: "Start a new quest while keeping the current scratch slot" },
  { cmd: "/quest pause | on", desc: "Pause or resume pi-quest for this session (Alt+Q to toggle)" },
  { cmd: "/quest cancel", desc: "Cancel in-flight review and unblock tools" },
  { cmd: "/quest del [qid|flags]", desc: "Delete quest (--keep-slot|-s) or prune drafts (--all|--stale|...)" },
  { cmd: "/quest handoff [qid]", desc: "Write & display a handoff document" },
  { cmd: "/quest slots", desc: "Inspect scratch worktree slots" },
  { cmd: "/quest doctor", desc: "Check judge, router, policy & ratings" },
];

export function linkQuestPath(displayText: string, absolutePath: string): string {
  const url = pathToFileURL(absolutePath).href;
  return `\x1b]8;;${url}\x1b\\${displayText}\x1b]8;;\x1b\\`;
}

export function summarizeActive(): string {
  const state = getState();
  if (state.disabled === true) {
    if (state.qid === null) return "pi-quest is disabled for this session (/quest on to re-enable).";
    return `pi-quest is disabled (Quest ${state.qid} paused in phase ${state.phase}; run /quest on to resume).`;
  }
  if (state.qid === null) return "No active quest.";
  const kids = state.children.length > 0
    ? ` Children: ${state.children.map((c) => `${c.qid}=${c.status}`).join(", ")}.`
    : "";
  const review = state.activeReview ? ` Review ${state.activeReview.kind} running.` : "";
  const title = state.name && state.name !== state.qid ? `${state.name} (${state.qid})` : state.qid;
  return `Quest ${title} — phase ${state.phase}.${review}${kids} ${state.exactNextAction}`;
}

export function formatQuestCard(cwd: string = process.cwd()): string {
  const state = getState();
  const lines: string[] = [];
  if (state.qid === null) {
    const statusLine = state.disabled ? "⏸️ off (paused for this session)" : "💤 idle (no active quest)";
    lines.push(`── Quest Status: ${statusLine} ──────────────────────`);
    if (state.worktreePath) {
      lines.push(`  Slot   : ${state.worktreePath}${state.worktreeBranch ? ` (${state.worktreeBranch})` : ""} (retained)`);
    }
    lines.push("  Describe a task to start a quest, or resume one with /quest <name|qid>.");
  } else {
    const title = state.name && state.name !== state.qid ? `${state.name} (${state.qid})` : state.qid;
    const relPlan = draftPath(state.qid);
    const fullPlan = draftFilePath(cwd, state.qid);
    lines.push(`── Quest: ${title} ──────────────────────`);
    lines.push(`  Status : ${questStatus(state, "icon")} (${state.phase})`);
    lines.push(`  Plan   : ${linkQuestPath(relPlan, fullPlan)}`);
    if (state.exactNextAction) {
      lines.push(`  Next   : ${state.exactNextAction}`);
    }
  }
  lines.push("");
  for (const h of QUEST_COMMAND_HELP) {
    lines.push(`  ${h.cmd.padEnd(22)} ${h.desc}`);
  }
  return lines.join("\n");
}

export async function reattachWorktreeIfNeeded(pi: Pi, ctx: PiCtx, state: QuestState): Promise<void> {
  if (!state.qid || state.disabled === true) return;
  if (state.phase !== "implementing" && state.phase !== "validating") return;
  try {
    const cfg = await readQuestConfig(ctx.cwd);
    if ((cfg.gitWorkflow?.worktreeMode ?? "auto") === "off") return;
    const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
    const res = await ensureQuestWorktreeAttached(
      primaryRoot,
      state.qid,
      state.baseCommit ?? null,
      state.worktreePath,
      state.worktreeBranch,
      cfg.gitWorkflow,
      pi,
    );
    if (res.ok && res.slotPath && res.slotBranch) {
      updateState((s) => ({
        ...s,
        worktreePath: res.slotPath,
        worktreeBranch: res.slotBranch,
        snapshotPending: true,
      }));
    }
  } catch { /* best-effort reattach */ }
}

export async function toggleQuestDisabled(pi: Pi, ctx: PiCtx, disabled: boolean): Promise<string> {
  const prev = getState();
  if (disabled && prev.qid && hasInFlight(prev.qid)) {
    cancelReview(prev.qid);
    clearPlanRevisionRetries(prev.qid);
    clearDraftReviewRetry(prev.qid);
  }
  const next = setQuestDisabled(disabled);
  if (!disabled && next.qid) {
    await reattachWorktreeIfNeeded(pi, ctx, getState());
  }
  emitNow(pi);
  if (disabled) {
    return next.qid
      ? `pi-quest disabled for this session. Quest ${next.qid} (${next.phase}) is paused; you can now work freely in the primary workspace. Run /quest on to resume.`
      : "pi-quest disabled for this session. Automatic quest creation and gates are off. Run /quest on to re-enable.";
  }
  return next.qid
    ? `pi-quest enabled. Resumed quest ${next.qid} (${next.phase}).`
    : "pi-quest enabled for this session.";
}

async function adoptDraftFile(pi: Pi, ctx: PiCtx, qid: string): Promise<string> {
  const objective = await readDraftObjective(ctx.cwd, qid);
  if (objective === null) return `No quest ${qid}: no snapshot and no draft file.`;
  const heading = await readDraftHeading(ctx.cwd, qid);
  const draftName = heading ?? qid;
  replaceState({ ...createDraft(createQuest(objective, qid), draftName), disabled: false });
  emitNow(pi);
  return `Resumed draft ${qid}: ${summarizeActive()}`;
}

export async function resumeQuest(pi: Pi, ctx: PiCtx, rawArg: string): Promise<string> {
  const arg = rawArg.trim();
  if (arg === "") return formatQuestCard(ctx.cwd);
  const lower = arg.toLowerCase();
  if (lower === "disable" || lower === "off" || lower === "pause") {
    return await toggleQuestDisabled(pi, ctx, true);
  }
  if (lower === "enable" || lower === "on") {
    return await toggleQuestDisabled(pi, ctx, false);
  }
  if (lower === "toggle") {
    return await toggleQuestDisabled(pi, ctx, !getState().disabled);
  }
  const entries = ctx.sessionManager.getEntries();
  if (isQid(arg)) {
    const hit = newestSnapshotFor(entries, arg);
    if (hit) {
      replaceState({ ...hit, disabled: false });
      await reattachWorktreeIfNeeded(pi, ctx, getState());
      emitNow(pi);
      return `Resumed quest ${arg}: ${summarizeActive()}`;
    }
    return adoptDraftFile(pi, ctx, arg);
  }
  const active = getState();
  if (active.qid !== null && (active.name === arg || active.qid === arg)) {
    if (active.disabled) {
      await toggleQuestDisabled(pi, ctx, false);
    } else {
      await reattachWorktreeIfNeeded(pi, ctx, active);
    }
    return summarizeActive();
  }
  for (const [qid, snap] of newestSnapshotPerQid(entries)) {
    if (snap.name === arg || snap.draft?.name === arg) {
      replaceState({ ...snap, disabled: false });
      await reattachWorktreeIfNeeded(pi, ctx, getState());
      emitNow(pi);
      return `Resumed quest ${qid}: ${summarizeActive()}`;
    }
  }
  const drafts = await listDraftQids(ctx.cwd);
  const exactQid = drafts.find((qid) => qid === arg);
  if (exactQid !== undefined) return adoptDraftFile(pi, ctx, exactQid);
  for (const qid of drafts) {
    const heading = await readDraftHeading(ctx.cwd, qid);
    if (heading !== null && heading.toLowerCase() === lower) {
      return adoptDraftFile(pi, ctx, qid);
    }
  }
  const newest = newestSnapshot(entries);
  if (newest?.name === arg && newest.qid) {
    replaceState({ ...newest, disabled: false });
    await reattachWorktreeIfNeeded(pi, ctx, getState());
    emitNow(pi);
    return `Resumed quest ${newest.qid}: ${summarizeActive()}`;
  }
  return `No quest matching "${arg}".`;
}
