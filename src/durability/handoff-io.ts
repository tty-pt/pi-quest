// HIGH_LEVEL: #surviving — handoff documents on disk. The pure renderer is
// domain/handoff.ts; this adapter gathers its inputs (state, quest doc, git
// diff stat) and writes `.pi/quest/handoffs/<qid>-<stamp>.md` atomically.
// Best-effort everywhere except the final write: a missing doc or a failed
// git call degrades the document, never the agent.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getState } from "../app/store";
import { askedRows, buildHandoff, docSections, type HandoffReason } from "../domain/handoff";
import { draftPath, handoffPath } from "../domain/paths";
import { parseDocStatus } from "../domain/quest-doc";
import { IDLE_STATE, type Phase, type QuestState } from "../domain/quest";
import { isQid, type Qid } from "../domain/qid";
import { canonicalWorkspaceRoot, draftFilePath } from "../files";
import type { Pi, PiCtx } from "../hooks/events";
import { findRepoRoot, runGit } from "../utils/git";
import { newestSnapshotFor } from "./snapshots";

const STAT_MAX_LINES = 80;
const KNOWN_PHASES: readonly Phase[] = ["provisional", "drafting", "implementing", "validating", "archived"];

export interface WrittenHandoff {
  qid: string;
  path: string;
  relPath: string;
  content: string;
  /** Requirement ids not yet VERIFIED. */
  open: string[];
}

async function readDoc(cwd: string, qid: Qid): Promise<string | null> {
  try {
    return await readFile(draftFilePath(cwd, qid), "utf8");
  } catch {
    return null;
  }
}

/** Minimal state for a quest that only exists as a doc on disk. */
export function docOnlyState(qid: Qid, docText: string | null): QuestState {
  const status = docText === null ? null : parseDocStatus(docText).phase?.toLowerCase() ?? null;
  const phase = KNOWN_PHASES.find((p) => p === status) ?? "drafting";
  return { ...IDLE_STATE, qid, phase, snapshotPending: false };
}

/**
 * State to render for `qid` (default: the active quest): the live state, else
 * the newest transcript snapshot, else a doc-only reconstruction. Null when
 * the quest is unknown everywhere.
 */
export async function resolveHandoffState(ctx: PiCtx, qid?: string): Promise<QuestState | null> {
  const active = getState();
  const want = qid?.trim() || active.qid;
  if (!want) return null;
  if (active.qid === want && active.phase !== "idle") return active;
  if (!isQid(want)) return null;
  const snap = newestSnapshotFor(ctx.sessionManager.getEntries(), want);
  if (snap !== null) return snap;
  const doc = await readDoc(ctx.cwd, want);
  return doc === null ? null : docOnlyState(want, doc);
}

function capLines(text: string): string {
  const lines = text.trimEnd().split("\n");
  if (lines.length <= STAT_MAX_LINES) return lines.join("\n");
  return [...lines.slice(0, STAT_MAX_LINES - 1), `… ${lines.length - STAT_MAX_LINES + 1} more lines`, lines[lines.length - 1]].join("\n");
}

/** `git diff --stat <base>` scoped to touched files when possible; "" on any failure. */
export async function diffStat(pi: Pi, cwd: string, state: QuestState): Promise<string> {
  if (!state.baseCommit) return "";
  const root = findRepoRoot(cwd);
  if (!root) return "";
  const touched = state.touchedFiles ?? [];
  const attempts = touched.length > 0 ? [["--", ...touched], []] : [[]];
  for (const scope of attempts) {
    const res = await runGit(["diff", "--stat=120", state.baseCommit, ...scope], root, pi, 1);
    if (res.exitCode === 0) return capLines(res.stdout);
  }
  return "";
}

/** Render and write a handoff for `state`. Throws only when the file cannot be written. */
export async function writeHandoff(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  reason: HandoffReason,
  notes?: string,
  now: Date = new Date(),
): Promise<WrittenHandoff> {
  if (state.qid === null) throw new Error("no quest to hand off");
  const docText = await readDoc(ctx.cwd, state.qid);
  const stat = await diffStat(pi, ctx.cwd, state).catch(() => "");
  const content = buildHandoff({
    state,
    docText,
    docPath: draftPath(state.qid),
    diffStat: stat,
    now,
    reason,
    notes: notes?.trim() || undefined,
  });
  const relPath = handoffPath(state.qid, now);
  const path = join(canonicalWorkspaceRoot(ctx.cwd), relPath);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
  const open = askedRows(state, docSections(docText)).filter((r) => r.status !== "VERIFIED").map((r) => r.id);
  return { qid: state.qid, path, relPath, content, open };
}
