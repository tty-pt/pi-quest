import { replaceState, updateState } from "../../../app/store";
import { emitNow, sendSteer } from "../../../app/interpreter";
import type {
  Amendment,
  ArchivedOutcome,
  QuestDifficulty,
  QuestKind,
  QuestState,
  Setback,
  VerificationReceipt,
} from "../../../domain/quest";
import { popStackFrame } from "../../../domain/stack";
import { settleChild } from "../../../domain/children";
import type { HandbackReceipt } from "../../../domain/contract";
import { nextQid, type Qid } from "../../../domain/qid";
import { newestSnapshotFor } from "../../../durability/snapshots";
import type { Pi, PiCtx } from "../../../hooks/events";
import { reconcileParentDocOnReturn } from "../../../quest-doc";
import { advanceForeman } from "../../../subquests/foreman";
import { ensureChildDraftFile, listKnownQids } from "../../../files";
import {
  findPrimaryRepoRoot,
  removeWorktree,
  confirmAndSquashWorktree,
  synthesizeSquashCommitMessage,
  syncWorktreeSubmodulesToPrimary,
  releaseWarmSlot,
  retainSlotLease,
  syncHarnessCwd,
  runGit,
  commitMilestone,
} from "../../../utils/git";
import { stagePostSubquestCompaction } from "../../../durability/compaction-handoff";
import type { ArchivedQuestResult } from "./types";

async function squashAndAlignWorktree(
  pi: Pi,
  ctx: PiCtx,
  primaryRoot: string,
  state: QuestState,
  wtPath: string,
  wtBranch: string,
  metaFindings: string[],
): Promise<"keep" | "merged" | "failed"> {
  const milestones = (state.milestoneCommits ?? []).map((m) => `${m.hash.slice(0, 7)} ${m.label}`);
  const squashMsg = synthesizeSquashCommitMessage({
    qid: state.qid ?? "unknown",
    objective: state.objective,
    requirements: state.contract?.assignedRequirements,
    milestones,
    verification: state.lastTestReceipt ? `${state.lastTestReceipt.command} (exit ${state.lastTestReceipt.exitCode})` : undefined,
  });
  const res = await confirmAndSquashWorktree(pi, ctx, primaryRoot, wtBranch, "HEAD", squashMsg, milestones, wtPath);
  if (!res.ok) {
    metaFindings.push(`Worktree squash/merge warning: ${res.error}`);
    return "failed";
  }
  if (res.mode !== "keep") {
    try {
      await runGit(["submodule", "update", "--no-fetch"], primaryRoot, pi);
    } catch { /* best-effort submodule alignment */ }
    return "merged";
  }
  metaFindings.push(`Worktree feature branch ${wtBranch} preserved unmerged per operator request`);
  return "keep";
}

async function cleanupWorktree(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  outcome: ArchivedOutcome,
  metaFindings: string[],
): Promise<void> {
  const wtPath = state.worktreePath ?? state.contract?.worktreePath;
  const wtBranch = state.worktreeBranch ?? state.contract?.worktreeBranch;
  if (!wtPath) return;

  // If the worktree is shared with the parent quest, do not squash or remove it:
  if (state.parentQid !== null) {
    const parent = state.questStack && state.questStack.length > 0
      ? state.questStack[state.questStack.length - 1]
      : newestSnapshotFor(ctx.sessionManager.getEntries(), state.parentQid);
    const parentState = parent && "savedState" in parent ? parent.savedState : parent;
    const parentWtPath = parentState?.worktreePath ?? parentState?.contract?.worktreePath;
    if (parentWtPath && parentWtPath === wtPath) {
      // Inherited worktree: ensure lease remains bound to root/parent quest and leave intact
      const rootOwnerQid = (state.questStack && state.questStack.length > 0 ? state.questStack[0].qid : undefined) ?? state.parentQid;
      const parentWtBranch = parentState?.worktreeBranch ?? parentState?.contract?.worktreeBranch ?? wtBranch;
      retainSlotLease(wtPath, parentWtBranch ?? null, rootOwnerQid);
      return;
    }
  }

  const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
  if (wtBranch) {
    try {
      await commitMilestone(
        wtPath,
        {
          qid: state.qid ?? "subquest",
          type: "manual",
          label: outcome === "COMPLETED" ? "subquest completion checkpoint" : "subquest pre-archive checkpoint",
        },
        pi,
        wtBranch,
      );
    } catch { /* best-effort commit */ }
    try {
      const syncRes = await syncWorktreeSubmodulesToPrimary(primaryRoot, wtPath, wtBranch, pi);
      if (syncRes.synced.length > 0) {
        metaFindings.push(
          `Submodule feature branch ${wtBranch} preserved for upstream PRs in: ${syncRes.synced.join(", ")}`,
        );
      }
    } catch { /* best-effort sync */ }
  }

  let deleteBranch = false;
  if (outcome === "COMPLETED" && wtBranch) {
    const result = await squashAndAlignWorktree(pi, ctx, primaryRoot, state, wtPath, wtBranch, metaFindings);
    deleteBranch = result === "merged";
  }

  if (wtPath.includes("/scratch/slot-")) {
    await releaseWarmSlot(primaryRoot, wtPath, state.qid ?? "", pi, undefined, { deleteBranch });
  } else {
    await removeWorktree(primaryRoot, wtPath, deleteBranch ? wtBranch : undefined, pi);
  }
}

export async function handleParentReturn(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  qid: Qid,
  parentQid: Qid,
  outcome: ArchivedOutcome,
  summary: string | null,
  zipPath: string,
  meta: {
    objective: string;
    kind: QuestKind;
    difficulty: QuestDifficulty;
    modifiedFiles: string[];
    lastTestReceipt?: VerificationReceipt;
    setbacks: Setback[];
    findings: string[];
    amendments: Amendment[];
  },
): Promise<ArchivedQuestResult> {
  const findings = summary ?? `Child ${qid} archived as ${outcome}.`;
  const receipt: HandbackReceipt = {
    childQid: qid,
    status: outcome === "COMPLETED" ? "COMPLETED" : "FAILED",
    assignedRequirements: state.contract?.assignedRequirements ?? [],
    filesModified: meta.modifiedFiles,
    diffSummary: findings,
    testCommand: state.contract?.requiredTestCommands[0] ?? meta.lastTestReceipt?.command ?? "test",
    testPassed: outcome === "COMPLETED",
    findings,
  };

  await reconcileParentDocOnReturn(ctx.cwd, parentQid, receipt);
  await cleanupWorktree(pi, ctx, state, outcome, meta.findings);

  if (state.questStack && state.questStack.length > 0) {
    const restored = popStackFrame(state, receipt);
    const openReqs = (restored.rtm ?? [])
      .filter((r) => r.status !== "satisfied")
      .map((r) => r.id);

    if (outcome === "COMPLETED") {
      const nextChildQid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));
      const advanced = advanceForeman(restored, nextChildQid);
      if (advanced) {
        stagePostSubquestCompaction({
          parentQid,
          targetQid: nextChildQid,
          childQid: qid,
          outcome,
          summary: findings,
          modifiedFiles: meta.modifiedFiles,
          testCommand: receipt.testCommand,
          testPassed: receipt.testPassed,
          assignedRequirements: receipt.assignedRequirements,
          openRequirements: openReqs,
          exactNextAction: advanced.nextMountedState.exactNextAction,
        });
        await ensureChildDraftFile(ctx.cwd, nextChildQid, parentQid, advanced.contract, advanced.nextItem.goal);
        replaceState(advanced.nextMountedState);
        syncHarnessCwd(advanced.nextMountedState.worktreePath ?? advanced.nextMountedState.contract?.worktreePath ?? null, pi);
        emitNow(pi);
        sendSteer(
          pi,
          `Foreman: Sub-quest ${qid} completed. Automatically mounting ${advanced.nextItem.id}: ${advanced.nextItem.goal}. Proceeding with implementation.`,
        );
        return { archivedQid: qid, zipPath, returnedToParent: parentQid, ...meta, summary };
      }
    }

    if (outcome === "COMPLETED") {
      stagePostSubquestCompaction({
        parentQid,
        targetQid: parentQid,
        childQid: qid,
        outcome,
        summary: findings,
        modifiedFiles: meta.modifiedFiles,
        testCommand: receipt.testCommand,
        testPassed: receipt.testPassed,
        assignedRequirements: receipt.assignedRequirements,
        openRequirements: openReqs,
        exactNextAction: restored.exactNextAction,
      });
    }
    replaceState(restored);
    syncHarnessCwd(restored.worktreePath ?? restored.contract?.worktreePath ?? null, pi);
    emitNow(pi);
    const completedMsg = outcome === "COMPLETED"
      ? `Child quest ${qid} archived as ${outcome}. Returned to parent ${parentQid}. Foreman: All sub-quests in backlog completed. Proceed to final root integration validation.`
      : `Child quest ${qid} archived as ${outcome}. Returned to parent ${parentQid} with findings: ${findings}`;
    sendSteer(pi, completedMsg);
    return { archivedQid: qid, zipPath, returnedToParent: parentQid, ...meta, summary };
  }

  const parent = newestSnapshotFor(ctx.sessionManager.getEntries(), parentQid);
  if (parent === null) {
    replaceState({ ...state, phase: "archived", parentQid: null });
    syncHarnessCwd(null, pi);
    sendSteer(pi, `Quest ${qid} archived as ${outcome}. Parent ${parentQid} has no snapshot — staying on the archived quest.`);
    return { archivedQid: qid, zipPath, returnedToParent: null, ...meta, summary };
  }

  if (outcome === "COMPLETED") {
    stagePostSubquestCompaction({
      parentQid,
      targetQid: parentQid,
      childQid: qid,
      outcome,
      summary: findings,
      modifiedFiles: meta.modifiedFiles,
      testCommand: receipt.testCommand,
      testPassed: receipt.testPassed,
      assignedRequirements: receipt.assignedRequirements,
      openRequirements: [],
      exactNextAction: parent.exactNextAction,
    });
  }

  replaceState({ ...parent, snapshotPending: true });
  syncHarnessCwd(parent.worktreePath ?? parent.contract?.worktreePath ?? null, pi);
  updateState((s) => settleChild(s, qid, outcome === "COMPLETED" ? "returned" : "failed", findings));
  emitNow(pi);
  sendSteer(pi, `Child quest ${qid} archived as ${outcome}. Returned to parent ${parentQid} with findings: ${findings}`);
  return { archivedQid: qid, zipPath, returnedToParent: parentQid, ...meta, summary };
}
