// HIGH_LEVEL: #storage — scratch workspace pool inspection and status telemetry.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Pi } from "../../hooks/events";
import { runGit } from "./exec";
import { isPidAlive, readSlotLease, type SlotLease } from "./pool";
import { readDraftObjective } from "../../durability/quest-doc-io";
import { getState } from "../../app/store";

export interface ScratchCommitInfo {
  hash: string;
  subject: string;
  relativeDate: string;
  author: string;
}

export interface ScratchDirtyInfo {
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface ScratchSlotDetails {
  slotId: string;
  num: number;
  slotPath: string;
  status: "idle" | "leased";
  lease: SlotLease | null;
  isPidAlive: boolean;
  leaseDuration: string | null;
  branch: string | null;
  assignedQid: string | null;
  objective: string | null;
  phase: string | null;
  isSessionActive: boolean;
  activeReview: string | null;
  exactNextAction: string | null;
  dirty: ScratchDirtyInfo;
  latestCommit: ScratchCommitInfo | null;
}

export function formatDuration(ms: number): string {
  if (ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSec}s`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours}h ${remMin}m`;
}

export function parsePorcelainStatus(stdout: string): ScratchDirtyInfo {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (!line || line.length < 2) continue;
    if (line.startsWith("??")) {
      untracked++;
      continue;
    }
    const x = line[0];
    const y = line[1];
    if (x !== " " && x !== "?") staged++;
    if (y !== " " && y !== "?") unstaged++;
  }
  return { staged, unstaged, untracked };
}

export function parseGitLog(stdout: string): ScratchCommitInfo | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("|");
  if (parts.length < 3) return null;
  return {
    hash: parts[0] || "",
    subject: parts[1] || "",
    relativeDate: parts[2] || "",
    author: parts[3] || "",
  };
}

async function collectSlotGitDetails(
  slotDir: string,
  leaseBranch: string | null,
  pi?: Pi,
): Promise<{ branch: string | null; dirty: ScratchDirtyInfo; latestCommit: ScratchCommitInfo | null }> {
  const statusRes = await runGit(["status", "--porcelain"], slotDir, pi);
  const dirty = statusRes.exitCode === 0
    ? parsePorcelainStatus(statusRes.stdout)
    : { staged: 0, unstaged: 0, untracked: 0 };

  const branchRes = await runGit(["symbolic-ref", "--short", "HEAD"], slotDir, pi);
  const branch = branchRes.exitCode === 0 ? branchRes.stdout.trim() : leaseBranch;

  const logRes = await runGit(["log", "-1", "--format=%h|%s|%cr|%an"], slotDir, pi);
  const latestCommit = logRes.exitCode === 0 ? parseGitLog(logRes.stdout) : null;

  return { branch, dirty, latestCommit };
}

export async function inspectScratchSlots(
  primaryRoot: string,
  poolDirName: string = ".pi/scratch",
  pi?: Pi,
): Promise<ScratchSlotDetails[]> {
  const fullPoolDir = resolve(primaryRoot, poolDirName);
  if (!existsSync(fullPoolDir)) return [];

  const entries = readdirSync(fullPoolDir);
  const matched: Array<{ name: string; num: number; dir: string }> = [];
  for (const entry of entries) {
    const m = /^slot-(\d+)$/.exec(entry);
    if (m) matched.push({ name: entry, num: parseInt(m[1], 10), dir: join(fullPoolDir, entry) });
  }
  matched.sort((a, b) => a.num - b.num);

  const activeState = getState();
  const results: ScratchSlotDetails[] = [];

  for (const item of matched) {
    const lease = readSlotLease(item.dir);
    const status = lease?.status === "leased" ? "leased" : "idle";
    const isAlive = lease ? isPidAlive(lease.pid) : false;
    const leaseDuration = lease?.leasedAt ? formatDuration(Date.now() - lease.leasedAt) : null;
    const assignedQid = lease?.leasedToQid ?? null;
    const isSessionActive = Boolean(
      assignedQid && (
        activeState.qid === assignedQid ||
        activeState.parentQid === assignedQid ||
        (activeState.questStack ?? []).some((f) => f.qid === assignedQid)
      ),
    );

    const phase = isSessionActive ? activeState.phase : null;
    const activeReview = isSessionActive && activeState.activeReview ? activeState.activeReview.kind : null;
    const exactNextAction = isSessionActive ? activeState.exactNextAction : null;
    const objective = assignedQid ? await readDraftObjective(primaryRoot, assignedQid) : null;

    const gitDetails = await collectSlotGitDetails(item.dir, lease?.branch ?? null, pi);

    results.push({
      slotId: item.name,
      num: item.num,
      slotPath: item.dir,
      status,
      lease,
      isPidAlive: isAlive,
      leaseDuration,
      branch: gitDetails.branch,
      assignedQid,
      objective,
      phase,
      isSessionActive,
      activeReview,
      exactNextAction,
      dirty: gitDetails.dirty,
      latestCommit: gitDetails.latestCommit,
    });
  }

  return results;
}

export function formatSlotSummary(slots: ScratchSlotDetails[]): string[] {
  if (slots.length === 0) {
    return ["No scratch workspace slots found (.pi/scratch is empty)."];
  }

  const lines: string[] = ["Scratch Workspace Slots:"];
  for (const s of slots) {
    const statusBadge = s.status === "leased" ? "[LEASED]" : "[IDLE]";
    lines.push("");
    lines.push(`• ${s.slotId} ${statusBadge}`);

    if (s.status === "leased" && s.assignedQid) {
      const activeTag = s.isSessionActive ? " (active in this session)" : "";
      const phaseTag = s.phase ? ` (${s.phase})` : "";
      lines.push(`  Quest: ${s.assignedQid}${phaseTag}${activeTag}`);
      if (s.objective) {
        const truncatedObj = s.objective.length > 80 ? `${s.objective.slice(0, 77)}...` : s.objective;
        lines.push(`  Objective: ${truncatedObj}`);
      }
      lines.push(`  Branch: ${s.branch || `quest/${s.assignedQid}`}`);
      if (s.lease?.pid) {
        const aliveTag = s.isPidAlive ? "alive" : "dead/orphaned";
        const durTag = s.leaseDuration ? `, leased ${s.leaseDuration} ago` : "";
        lines.push(`  Worker PID: ${s.lease.pid} (${aliveTag}${durTag})`);
      }
      if (s.activeReview) {
        lines.push(`  Active Review: ${s.activeReview} in flight`);
      }
      if (s.exactNextAction) {
        lines.push(`  Next Action: ${s.exactNextAction}`);
      }
    } else {
      lines.push(`  Branch: ${s.branch || "detached"}`);
    }

    const dirtyParts: string[] = [];
    if (s.dirty.staged > 0) dirtyParts.push(`${s.dirty.staged} staged`);
    if (s.dirty.unstaged > 0) dirtyParts.push(`${s.dirty.unstaged} unstaged`);
    if (s.dirty.untracked > 0) dirtyParts.push(`${s.dirty.untracked} untracked`);
    lines.push(`  Working Tree: ${dirtyParts.length > 0 ? dirtyParts.join(", ") : "clean"}`);

    if (s.latestCommit) {
      lines.push(`  Latest Commit: ${s.latestCommit.hash} "${s.latestCommit.subject}" (${s.latestCommit.relativeDate})`);
    }
  }

  return lines;
}
