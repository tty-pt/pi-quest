// HIGH_LEVEL: #modes — kind-aware draft PASS routing: standard quests promote
// to implementing; analysis quests auto-claim straight to validating (D3),
// falling back to a work phase while sub-quests are still running.
import { emitNow } from "../app/interpreter";
import { dispatch, getState, replaceState, updateState } from "../app/store";
import type { ApprovedBy } from "../domain/quest";
import { difficultyLevel } from "../domain/quest";
import { promote, promoteToValidation } from "../domain/transitions";
import { unfinishedChildren } from "../domain/children";
import { nextQid, type Qid } from "../domain/qid";
import { launchValidation } from "../validation/flow";
import type { Pi, PiCtx } from "../hooks/events";
import { ensureChildDraftFile, listKnownQids, draftFilePath } from "../files";
import { advanceForeman } from "../subquests/foreman";
import { cancelReview } from "../review/tracker";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDraftSections, extractRtmFromRequirements } from "./plan-text";
import { recalibrateQuestDifficulty } from "./difficulty";
import type { RtmItem } from "../domain/contract";
import { readQuestConfig } from "../config";
import {
  findPrimaryRepoRoot,
  createWorktree,
  commitMilestone,
  acquireWarmSlot,
  retainSlotLease,
  syncHarnessCwd,
  type PoolProgressNotifier,
} from "../utils/git";

interface ProvisionWorktreeResult {
  ok: boolean;
  wtPath?: string;
  wtBranch?: string;
  notice?: string;
  error?: string;
}

async function maybeProvisionWorktree(
  pi: Pi,
  cwd: string,
  stateQid: Qid,
  leaseOwnerQid: Qid,
  objective: string,
  baseCommit?: string | null,
  notifier?: PoolProgressNotifier,
): Promise<ProvisionWorktreeResult> {
  const config = await readQuestConfig(cwd);
  const mode = config.gitWorkflow?.worktreeMode ?? "auto";
  if (mode === "off") {
    return { ok: true, notice: "" };
  }
  const primaryRoot = findPrimaryRepoRoot(cwd);

  // Pool mode or auto mode: lease an idle warm scratch workspace slot (< 100ms)
  const poolRes = await acquireWarmSlot(
    primaryRoot,
    leaseOwnerQid,
    baseCommit ?? null,
    config.gitWorkflow,
    pi,
    notifier,
  );

  if (!poolRes.ok || !poolRes.slotPath || !poolRes.slotBranch) {
    const err = poolRes.error ?? "No scratch slot available";
    notifier?.notify?.(`[Scratch Pool] Error: Warm slot acquire failed: ${err}`, "error");
    return { ok: false, error: err };
  }

  const wtPath = poolRes.slotPath;
  const wtBranch = poolRes.slotBranch;
  updateState((s) => ({
    ...s,
    worktreePath: wtPath,
    worktreeBranch: wtBranch,
    contract: s.contract ? { ...s.contract, worktreePath: s.contract.worktreePath ?? wtPath, worktreeBranch: s.contract.worktreeBranch ?? wtBranch } : s.contract,
    questStack: s.questStack?.map((f) => ({
      ...f,
      contract: f.contract ? { ...f.contract, worktreePath: f.contract.worktreePath ?? wtPath, worktreeBranch: f.contract.worktreeBranch ?? wtBranch } : f.contract,
      savedState: {
        ...f.savedState,
        worktreePath: f.savedState.worktreePath ?? wtPath,
        worktreeBranch: f.savedState.worktreeBranch ?? wtBranch,
      },
    })),
    snapshotPending: true,
  }));
  syncHarnessCwd(wtPath, pi);
  if (config.gitWorkflow?.milestoneCommits) {
    await commitMilestone(wtPath, { qid: stateQid, type: "start", label: objective }, pi, wtBranch);
  }
  return {
    ok: true,
    wtPath,
    wtBranch,
    notice: ` (worktree: ${wtPath}, branch: ${wtBranch})`,
  };
}

async function attachRetainedWorktree(
  pi: Pi,
  cwd: string,
  stateQid: Qid,
  leaseOwnerQid: Qid,
  objective: string,
  wtPath: string,
  wtBranch?: string,
): Promise<string> {
  const branch = wtBranch || `quest/${leaseOwnerQid}`;
  retainSlotLease(wtPath, branch, leaseOwnerQid);
  syncHarnessCwd(wtPath, pi);
  const cfg = await readQuestConfig(cwd);
  if (cfg.gitWorkflow?.milestoneCommits) {
    await commitMilestone(wtPath, { qid: stateQid, type: "start", label: objective }, pi, branch);
  }
  return ` (worktree: ${wtPath}, branch: ${branch})`;
}

// Shared by the reviewer-PASS auto-promote path (drafting/reviews.ts) and the
// live-user "go" path. Returns the promotion message to steer/wake — the
// caller's medium differs — or null when the quest is no longer drafting.
export async function promoteAfterPass(
  pi: Pi,
  ctx: PiCtx,
  qid: Qid,
  by: ApprovedBy,
): Promise<string | null> {
  const state = getState();
  if (state.phase !== "drafting" || state.qid !== qid) return null;
  if (state.draft === null || !state.draft.planAuthored) return null;
  cancelReview(qid);
  const stateQid = state.qid;
  const how = by === "user" ? 'user "go"' : "reviewer PASS";

  let rtm: RtmItem[] | undefined;
  let draftDocText: string | undefined;
  try {
    draftDocText = await readFile(draftFilePath(ctx.cwd, stateQid), "utf8");
    const sections = parseDraftSections(draftDocText);
    const extracted = extractRtmFromRequirements(sections.requirements);
    if (extracted.length > 0) rtm = extracted;
    const recalibrated = recalibrateQuestDifficulty(state, sections, draftDocText);
    if (difficultyLevel(recalibrated) > difficultyLevel(state.difficulty)) {
      updateState((s) => ({ ...s, difficulty: recalibrated, snapshotPending: true }));
    }
  } catch { /* best-effort extraction */ }

  if (state.kind === "analysis") {
    const unfinished = unfinishedChildren(state);
    if (unfinished.length > 0) {
      updateState((s) => promote(s, by, rtm));
      emitNow(pi);
      return `Quest ${stateQid} promoted to implementing (${how}) — the analysis stays provisional while sub-quests run. Complete and acknowledge each child, then save to re-review; a live user "go" may also override.`;
    }
    dispatch({ type: "PlanPromoted", approvedBy: by, rtm });
    emitNow(pi);
    void launchValidation(pi, ctx, stateQid);
    return `Quest ${stateQid} reached the approved analysis milestone (${how}): on to validation. The doc stays live until the validator concludes.`;
  }
  const notifier: PoolProgressNotifier = {
    notify: (msg, lvl) => ctx.ui?.notify?.(msg, lvl),
    setStatus: (k, txt) => ctx.ui?.setStatus?.(k, txt),
  };

  const rootOwnerQid = ((state.questStack && state.questStack.length > 0 ? state.questStack[0].qid : undefined) ?? state.parentQid ?? stateQid) as Qid;
  let wtNotice = "";
  if (!state.worktreePath) {
    const provRes = await maybeProvisionWorktree(pi, ctx.cwd, stateQid, rootOwnerQid, state.objective, state.baseCommit, notifier);
    if (!provRes.ok) {
      const errMsg = `Cannot promote quest ${stateQid} to implementing: failed to acquire scratch worktree (${provRes.error}). Promotion aborted to protect primary workspace.`;
      notifier.notify?.(`[pi-quest] ${errMsg}`, "error");
      return errMsg;
    }
    wtNotice = provRes.notice ?? "";
  } else {
    wtNotice = await attachRetainedWorktree(pi, ctx.cwd, stateQid, rootOwnerQid, state.objective, state.worktreePath, state.worktreeBranch);
  }

  dispatch({ type: "PlanPromoted", approvedBy: by, rtm });
  const promoted = getState();

  if (promoted.difficulty === "complex") {
    const knownQids = await listKnownQids(ctx.cwd);
    const nextChildQid = nextQid(Date.now() / 1000, knownQids);
    const advanced = advanceForeman(promoted, nextChildQid, draftDocText);
    if (advanced) {
      await ensureChildDraftFile(ctx.cwd, nextChildQid, stateQid, advanced.contract, advanced.nextItem.goal);
      replaceState(advanced.nextMountedState);
      emitNow(pi);
      return `Quest ${stateQid} promoted to implementing (${how})${wtNotice}. Foreman: Automatically mounting ${advanced.nextItem.id}: "${advanced.nextItem.goal}". Allowed paths: ${advanced.nextItem.allowedPaths.join(", ") || "(all)"}. Proceeding with sub-quest implementation.`;
    }
  }
  emitNow(pi);
  return `Quest ${stateQid} promoted to implementing (${how})${wtNotice}. Proceed autonomously from the draft plan.`;
}