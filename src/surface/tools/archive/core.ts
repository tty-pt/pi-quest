import { getState, replaceState, updateState } from "../../../app/store";
import { emitNow, sendSteer, sendWake } from "../../../app/interpreter";
import { IDLE_STATE, type ArchivedOutcome, type QuestState } from "../../../domain/quest";
import { archive, demoteToDrafting, demoteToImplementing } from "../../../domain/transitions";
import type { Qid } from "../../../domain/qid";
import type { Pi, PiCtx } from "../../../hooks/events";
import { cancelReview } from "../../../review/tracker";
import { setDocStatus } from "../../../quest-doc";
import { archiveQuestFiles } from "../../../views/quest-view";
import { recordQuestRating, writeHandoffReceipt } from "../../../durability/ratings";
import { readQuestConfig } from "../../../config";
import { resolveActiveModel } from "../../../policy/effective";
import { assertArchiveAllowed, getModifiedFiles } from "./eligibility";
import { handleParentReturn } from "./hierarchy";
import type { ArchivedQuestResult } from "./types";
import {
  findPrimaryRepoRoot,
  removeWorktree,
  confirmAndSquashWorktree,
  synthesizeSquashCommitMessage,
  syncWorktreeSubmodulesToPrimary,
  squashSubmoduleCommits,
  releaseWarmSlot,
  syncHarnessCwd,
  runGit,
  commitMilestone,
  getBranchCommitSummaries,
  alignPrimarySubmoduleBranches,
} from "../../../utils/git";

async function recordRatingsAndHandoff(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  outcome: ArchivedOutcome,
  qid: Qid,
  modifiedFiles: string[],
): Promise<void> {
  try {
    const config = await readQuestConfig(ctx.cwd);
    const activeModel = resolveActiveModel(ctx, config);
    if (activeModel) {
      await recordQuestRating(ctx.cwd, activeModel, state, outcome);
      if (outcome === "COMPLETED") {
        const commitHashes: string[] = [];
        try {
          const logRes = (await pi.exec("git", ["log", "-n", "1", "--format=%H"], { cwd: ctx.cwd })) as
            | { code?: number; exitCode?: number; stdout?: string; output?: string }
            | undefined;
          const hash = (logRes?.stdout ?? logRes?.output ?? "").trim();
          if (hash.length >= 7) commitHashes.push(hash);
        } catch { /* ignore */ }

        await writeHandoffReceipt(ctx.cwd, {
          qid,
          model: activeModel,
          timestamp: new Date().toISOString(),
          commitHashes,
          filesModified: modifiedFiles,
          observedTurnsRemaining: 3,
        });
      }
    }
  } catch { /* best-effort ratings */ }
}

async function prepareWorktreeForArchive(
  pi: Pi,
  primaryRoot: string,
  state: QuestState,
  qid: Qid,
  outcome: ArchivedOutcome,
  findings: string[],
): Promise<void> {
  if (!state.worktreePath || !state.worktreeBranch) return;
  try {
    await commitMilestone(
      state.worktreePath,
      {
        qid,
        type: "manual",
        label: outcome === "COMPLETED" ? "final completion checkpoint" : "pre-archive checkpoint",
      },
      pi,
      state.worktreeBranch,
    );
  } catch { /* best-effort commit */ }

  try {
    const syncRes = await syncWorktreeSubmodulesToPrimary(
      primaryRoot,
      state.worktreePath,
      state.worktreeBranch,
      pi,
    );
    if (syncRes.synced.length > 0) {
      findings.push(
        `Submodule feature branch ${state.worktreeBranch} preserved for upstream PRs in: ${syncRes.synced.join(", ")}`,
      );
    }
  } catch { /* best-effort sync */ }
}

async function squashSubmodulesIfNeeded(
  pi: Pi,
  primaryRoot: string,
  state: QuestState,
  qid: Qid,
  findings: string[],
): Promise<void> {
  if (!state.worktreePath || !state.worktreeBranch) return;
  try {
    const subSquashMsg = `feat(quest): ${state.objective} (quest ${qid})`;
    const sqRes = await squashSubmoduleCommits(
      state.worktreePath,
      state.worktreeBranch,
      subSquashMsg,
      pi,
      state.baseCommit,
    );
    if (sqRes.squashed.length > 0) {
      findings.push(`Squashed submodule commits into single release commit in: ${sqRes.squashed.join(", ")}`);
      await commitMilestone(
        state.worktreePath,
        { qid, type: "manual", label: "submodule squash alignment" },
        pi,
        state.worktreeBranch,
      );
      await syncWorktreeSubmodulesToPrimary(primaryRoot, state.worktreePath, state.worktreeBranch, pi);
    }
  } catch { /* best-effort submodule squash */ }
}

export async function archiveActiveQuest(
  pi: Pi,
  ctx: PiCtx,
  outcome: ArchivedOutcome,
  summary: string | null = null,
  opts?: { confirmDiscard?: boolean; action?: "integrate" | "keep" | "discard" },
): Promise<ArchivedQuestResult> {
  const state = getState();
  const qid = state.qid;
  if (qid === null) throw new Error("no active quest to archive");
  assertArchiveAllowed(state, outcome, summary, opts);

  cancelReview(qid);
  const modifiedFiles = await getModifiedFiles(pi, ctx.cwd, state.baseCommit, state.touchedFiles);
  const meta = {
    objective: state.objective,
    kind: state.kind,
    difficulty: state.difficulty,
    modifiedFiles,
    lastTestReceipt: state.lastTestReceipt,
    setbacks: [...state.setbacks],
    findings: summary ? [summary] : [],
    amendments: [...state.amendments],
  };

  const parentQid = state.parentQid;
  if (parentQid !== null) {
    const zipPath = await archiveQuestFiles(pi, ctx.cwd, state, outcome, summary);
    await recordRatingsAndHandoff(pi, ctx, state, outcome, qid, modifiedFiles);
    return await handleParentReturn(pi, ctx, state, qid, parentQid, outcome, summary, zipPath, meta);
  }

  if (state.worktreePath && state.worktreeBranch) {
    const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
    await prepareWorktreeForArchive(pi, primaryRoot, state, qid, outcome, meta.findings);

    let keepBranch = false;
    const milestones = (state.milestoneCommits ?? []).map((m) => `${m.hash.slice(0, 7)} ${m.label}`);
    const squashMsg = synthesizeSquashCommitMessage({
      qid,
      objective: state.objective,
      requirements: state.rtm?.map((r) => `${r.id}: ${r.description}`),
      milestones,
      verification: state.lastTestReceipt ? `${state.lastTestReceipt.command} (exit ${state.lastTestReceipt.exitCode})` : undefined,
    });

    if (outcome === "COMPLETED") {
      const res = await confirmAndSquashWorktree(
        pi,
        ctx,
        primaryRoot,
        state.worktreeBranch,
        "HEAD",
        squashMsg,
        milestones,
        state.worktreePath,
        { beforeSquash: () => squashSubmodulesIfNeeded(pi, primaryRoot, state, qid, meta.findings), defaultConflictMode: "rebase" },
      );
      if (res.mode === "rebase") {
        updateState((s) => s.phase === "validating"
          ? { ...demoteToImplementing(s), exactNextAction: `Rebase ${state.worktreeBranch} onto primary HEAD in ${state.worktreePath}, resolve conflicts, re-run verification tests, and re-archive.` }
          : s
        );
        await setDocStatus(ctx, qid, "implementing", false);
        emitNow(pi);
        sendWake(
          pi,
          `Archive paused for conflict resolution: rebase ${state.worktreeBranch} onto the primary repository's HEAD inside worktree ${state.worktreePath}, resolve any conflicts, run verification tests, and then re-archive.`,
        );
        throw new Error(`Archive deferred to rebase ${state.worktreeBranch} in worktree (${res.error ?? "merge conflict"}).`);
      }
      if (res.mode === "cancel") {
        const isAnalysis = state.kind === "analysis";
        updateState((s) => s.phase === "validating"
          ? (isAnalysis
            ? demoteToDrafting(s, "Operator cancelled archive to remain in quest. Follow operator instructions, then re-validate when ready.")
            : { ...demoteToImplementing(s), exactNextAction: "Operator cancelled archive to remain in quest. Follow operator instructions, then claim completion again when ready." })
          : s
        );
        await setDocStatus(ctx, qid, isAnalysis ? "drafting" : "implementing", false);
        emitNow(pi);
        sendSteer(
          pi,
          `Archive cancelled by operator for quest ${qid}: returned to ${isAnalysis ? "drafting" : "implementing"} to stay in the quest. Wait for or follow the operator's instructions before claiming completion or archiving again.`,
        );
        throw new Error(`Archive cancelled by operator (${res.error ?? "staying in quest"}).`);
      }
      if (!res.ok) {
        throw new Error(`Cannot complete and archive quest ${qid}: squash-merge of branch ${state.worktreeBranch} into ${primaryRoot} failed: ${res.error}. Resolve git conflicts before archiving.`);
      }
      if (res.mode === "keep") {
        meta.findings.push(`Worktree feature branch ${state.worktreeBranch} preserved unmerged per operator request`);
        keepBranch = true;
      } else {
        try {
          await runGit(["submodule", "update", "--no-fetch"], primaryRoot, pi);
          await alignPrimarySubmoduleBranches(primaryRoot, pi);
        } catch { /* best-effort submodule alignment */ }
      }
    } else {
      const branchCommits = await getBranchCommitSummaries(primaryRoot, "HEAD", state.worktreeBranch, pi);
      let action: "integrate" | "keep" | "discard" | "cancel" | undefined = opts?.action;

      if (!action && branchCommits.length > 0 && ctx.hasUI && typeof ctx.ui?.select === "function") {
        try {
          const selected = await ctx.ui.select(
            `Quest ${qid} has ${branchCommits.length} commit(s) on ${state.worktreeBranch}. Integrate into current branch?`,
            [
              `Integrate (squash-merge) into current branch`,
              `Keep branch unmerged (${state.worktreeBranch})`,
              `Discard changes and reset scratch slot`,
              `Cancel archive (stay in quest)`,
            ],
          );
          if (selected === undefined || selected.startsWith("Cancel archive")) action = "cancel";
          else if (selected.startsWith("Integrate")) action = "integrate";
          else if (selected.startsWith("Keep")) action = "keep";
          else if (selected.startsWith("Discard")) action = "discard";
        } catch {
          action = "keep";
        }
      }

      if (action === "cancel") {
        throw new Error("Archive cancelled by operator (staying in quest).");
      }

      if (action === "integrate") {
        const res = await confirmAndSquashWorktree(
          pi,
          ctx,
          primaryRoot,
          state.worktreeBranch,
          "HEAD",
          squashMsg,
          milestones,
          state.worktreePath,
          { beforeSquash: () => squashSubmodulesIfNeeded(pi, primaryRoot, state, qid, meta.findings), defaultConflictMode: "keep" },
        );
        if (!res.ok || res.mode === "keep" || res.mode === "rebase" || res.mode === "cancel") {
          if (res.error) meta.findings.push(`Worktree squash/merge warning: ${res.error}`);
          meta.findings.push(`Worktree feature branch ${state.worktreeBranch} preserved unmerged`);
          keepBranch = true;
        } else {
          try {
            await runGit(["submodule", "update", "--no-fetch"], primaryRoot, pi);
            await alignPrimarySubmoduleBranches(primaryRoot, pi);
          } catch { /* best-effort submodule alignment */ }
        }
      } else if (action === "discard") {
        meta.findings.push(`Worktree feature branch ${state.worktreeBranch} discarded per operator request`);
        keepBranch = false;
      } else if (branchCommits.length > 0 || action === "keep") {
        meta.findings.push(`Worktree feature branch ${state.worktreeBranch} preserved unmerged`);
        keepBranch = true;
      }
    }

    syncHarnessCwd(null, pi);

    if (state.worktreePath.includes("/scratch/slot-")) {
      await releaseWarmSlot(primaryRoot, state.worktreePath, state.qid ?? "", pi, undefined, { deleteBranch: !keepBranch });
    } else {
      await removeWorktree(primaryRoot, state.worktreePath, keepBranch ? undefined : state.worktreeBranch, pi);
    }
  }

  const zipPath = await archiveQuestFiles(pi, ctx.cwd, state, outcome, summary);
  await recordRatingsAndHandoff(pi, ctx, state, outcome, qid, modifiedFiles);

  archive(state, outcome);
  replaceState(IDLE_STATE);
  syncHarnessCwd(null, pi);
  emitNow(pi);
  sendSteer(pi, `Quest ${qid} archived as ${outcome}.`);
  return { archivedQid: qid, zipPath, returnedToParent: null, ...meta, summary };
}
