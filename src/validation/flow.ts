// HIGH_LEVEL: #validation — acceptance review of the completed quest.
// HIGH_LEVEL: #independent review contexts — fresh context per run.
// SPEC: B1.5 (validation flow), B1.7 (conclude), B2.2 (confirm fallback).
import type { Pi, PiCtx } from "../hooks/events";
import { dispatch, getState, updateState } from "../app/store";
import { emitNow, sendSteer, sendWake } from "../app/interpreter";
import type { Qid } from "../domain/qid";
import {
  demoteToDrafting,
  demoteToImplementing,
} from "../domain/transitions";
import type { QuestState, VerificationReceipt } from "../domain/quest";
import { recordReviewResult } from "../domain/quest";
import { draftFilePath } from "../files";
import { buildReviewPrompt } from "../review/prompts";
import { implementationFingerprint, runIsolatedReview } from "../review/flow";
import type { ParsedReview } from "../review/verdicts";
import { readQuestConfig, resolveRoleFallbacks, resolveRoleModel, type QuestConfig } from "../config";
import { withEffectivePolicy, resolveActiveModel, calculateReviewNeed, resolveAutonomyLevel } from "../policy/effective";
import { hasInFlight, cancelReview, isCurrentReview, supersedeReviewThenBootFresh } from "../review/tracker";
import { interpretUserTurn } from "../judge/intent-classifier";
import { archiveActiveQuest } from "../surface/tools/archive";
import { setDocStatus } from "../quest-doc";
import { captureUnifiedDiff, MAX_DIFF_CHARS, findPrimaryRepoRoot, runTestInPrimaryWorkspace, execTestShell } from "../utils/git";
import { getLatestTestExecution, recordTestExecution } from "./evidence-gate";
import {
  approvedPlan,
  buildConclusionSummary,
  deliveredAnalysisExcerpt,
  formatRevisionHistory,
  validationBrief,
} from "./brief";

export {
  MAX_DIFF_CHARS,
  approvedPlan,
  buildConclusionSummary,
  deliveredAnalysisExcerpt,
  formatRevisionHistory,
  validationBrief,
};

export async function captureGitDiff(
  ctx: PiCtx,
  pi?: Pi,
  touchedFiles?: string[],
  baseCommit?: string,
): Promise<string> {
  const res = await captureUnifiedDiff(ctx, { pi, touchedFiles, baseCommit, maxChars: MAX_DIFF_CHARS });
  return res.diff;
}

export {
  clearValidationRetries, clearValidationVerdictFails, getValidationVerdictFails,
  MAX_CONSECUTIVE_VALIDATION_FAILS, MAX_VALIDATION_RETRIES, noteValidationVerdictFailed,
  setValidationRetryDispatcher, VALIDATION_RETRY_BASE_MS, validationRetryCount,
} from "./retry";
import {
  clearValidationRetries, clearValidationVerdictFails, MAX_CONSECUTIVE_VALIDATION_FAILS,
  noteValidationVerdictFailed, scheduleValidationRetry, validationRetryCount,
} from "./retry";

const announced = new Set<string>();

function announceOnce(pi: Pi, key: string, text: string): void {
  if (announced.has(key)) return;
  announced.add(key);
  sendSteer(pi, text);
}

function wakeOnce(pi: Pi, key: string, text: string): void {
  if (announced.has(key)) return;
  announced.add(key);
  sendWake(pi, text);
}

export function resetAnnouncements(): void {
  announced.clear();
}

export function repairAfterFail(state: QuestState): QuestState {
  if (state.phase !== "validating") return state;
  return state.kind === "analysis" ? demoteToDrafting(state) : demoteToImplementing(state);
}

export async function launchValidation(pi: Pi, ctx: PiCtx, qid: Qid): Promise<void> {
  await setDocStatus(ctx, qid, "validating", false);
  await ensureValidationFlow(pi, ctx);
}

export async function concludeValidationPass(
  pi: Pi,
  ctx: PiCtx,
  qid: string,
  target: string,
  review: ParsedReview,
  autoArchive: boolean,
): Promise<{ archived: boolean; zipPath: string | null; error?: string }> {
  if (!autoArchive) return { archived: false, zipPath: null };
  if (implementationFingerprint(getState()) !== target) {
    sendSteer(pi, `Quest ${qid} changed during validation — conclusion skipped; a fresh validation will boot against the current work.`);
    return { archived: false, zipPath: null };
  }
  const excerpt = await deliveredAnalysisExcerpt(ctx, getState());
  const isAnalysis = getState().kind === "analysis";
  let done;
  try {
    done = await archiveActiveQuest(pi, ctx, "COMPLETED", buildConclusionSummary(getState(), target, review));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { archived: false, zipPath: null, error: detail };
  }
  if (isAnalysis) {
    const delivered = excerpt === "" ? "" : `\n\nDELIVERED ANALYSIS:\n${excerpt}`;
    const handoffHint = `\n\nTo begin implementation of the approved analysis, run quest_update_state { objective: "Implement recommendations from analysis ${qid}..." }.`;
    const zipSuffix = done.zipPath ? ` (${done.zipPath})` : "";
    wakeOnce(pi, `concluded:${qid}:${target}`, `Quest ${qid} concluded and archived as completed${zipSuffix}.${delivered}${handoffHint}`);
  }
  return { archived: true, zipPath: done.zipPath };
}

async function handleBypassIfEligible(
  pi: Pi,
  ctx: PiCtx,
  qid: string,
  target: string,
  config: ReturnType<typeof withEffectivePolicy>,
): Promise<boolean> {
  const state = getState();
  const testExecution = state.lastTestReceipt ?? getLatestTestExecution();
  const testsPassed = testExecution !== null
    ? testExecution.exitCode === 0
    : (state.kind === "analysis" || state.difficulty === "trivial");

  const shouldBypass = !config.strictMode && (
    config.reviewPolicy === "off" ||
    (config.reviewPolicy === "balanced" && state.difficulty === "trivial" && testsPassed)
  );
  if (!shouldBypass) return false;

  clearValidationVerdictFails(qid);
  const reason = config.reviewPolicy === "off"
    ? "Accepted under reviewPolicy 'off'."
    : `Accepted under reviewPolicy 'balanced' (${state.difficulty} task, tests passed).`;
  const syntheticReview: ParsedReview = {
    verdict: "PASS",
    severity: "none",
    findings: reason,
    advisories: "",
    text: reason,
  };
  updateState((s) => recordReviewResult(s, "PASS", target, reason));
  emitNow(pi);
  const concluded = await concludeValidationPass(pi, ctx, qid, target, syntheticReview, config.autoArchive);
  if (!concluded.archived && getState().phase === "validating") {
    const errNote = concluded.error ? ` (auto-archive halted: ${concluded.error})` : "";
    wakeOnce(pi, `accepted:${qid}:${target}`, `Validation PASS for ${qid} (${reason})${errNote} — run quest_archive to complete the quest.`);
  }
  return true;
}

async function handleValidationFailVerdict(
  pi: Pi,
  ctx: PiCtx,
  qid: string,
  target: string,
  review: ParsedReview,
): Promise<void> {
  const state = getState();
  const consecutive = noteValidationVerdictFailed(qid);
  if (state.kind === "analysis") {
    updateState((s) => repairAfterFail(s));
    await setDocStatus(ctx, qid as Qid, "drafting", false);
    emitNow(pi);
    if (consecutive >= MAX_CONSECUTIVE_VALIDATION_FAILS) {
      sendWake(
        pi,
        `Validation rejected ${consecutive} consecutive times for ${qid}. Automated validation loop paused.\n` +
        `Validator findings: ${review.findings}\n\n` +
        `Consult the human operator for guidance. The operator may reply "ship it" / "confirm" to accept completion as-is, or provide technical instructions.`,
      );
      return;
    }
    sendWake(pi, `Validation FAIL (target ${target.slice(0, 12)}): ${review.findings} Address the findings in the analysis, then submit the revised analysis for review again.`);
    return;
  }

  updateState((s) => repairAfterFail(s));
  await setDocStatus(ctx, qid as Qid, "implementing", false);
  emitNow(pi);
  if (consecutive >= MAX_CONSECUTIVE_VALIDATION_FAILS) {
    sendWake(
      pi,
      `Validation rejected ${consecutive} consecutive times for ${qid}. Automated validation loop paused.\n` +
      `Validator findings: ${review.findings}\n\n` +
      `Consult the human operator for guidance. The operator may reply "ship it" / "confirm" to accept completion as-is, or provide technical instructions.`,
    );
    return;
  }
  sendWake(pi, `Validation FAIL (target ${target.slice(0, 12)}): ${review.findings} Resume implementation to fix the issues, then run quest_update_state {claimComplete:true} to validate again.`);
}

async function executePendingValidationTest(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  config: QuestConfig,
  qid: string,
): Promise<void> {
  const worktreePath = state.worktreePath ?? state.contract?.worktreePath;
  const worktreeBranch = state.worktreeBranch ?? state.contract?.worktreeBranch;
  const testCmd = state.contract?.requiredTestCommands?.[0] ?? config.testCommands?.[0];
  const latestTest = state.lastTestReceipt ?? getLatestTestExecution();
  const needsRun = !latestTest || Boolean(state.lastFileModifiedAt && (latestTest.executedAt ?? 0) < state.lastFileModifiedAt);
  if (!testCmd || !needsRun) return;

  try {
    let receipt: VerificationReceipt;
    if (config.gitWorkflow?.testInPrimaryWorkspace === true && worktreePath && worktreeBranch) {
      const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
      receipt = await runTestInPrimaryWorkspace({
        primaryRoot,
        command: testCmd,
        qid,
        worktreePath,
        worktreeBranch,
        pi,
      });
    } else {
      const execTarget = worktreePath ?? ctx.cwd;
      const res = await execTestShell(testCmd, execTarget, pi);
      receipt = {
        command: testCmd,
        exitCode: res.exitCode,
        tailOutput: (res.stdout + (res.stderr ? `\n${res.stderr}` : "")).slice(-2000),
        executedAt: Date.now(),
      };
    }
    recordTestExecution(receipt);
    dispatch({ type: "TestRunRecorded", receipt });
  } catch { /* proceed to validation */ }
}

export async function ensureValidationFlow(pi: Pi, ctx: PiCtx): Promise<void> {
  const state = getState();
  if (state.disabled === true || state.phase !== "validating" || state.qid === null) return;
  const qid = state.qid;
  const target = implementationFingerprint(state);
  if (state.lastReview?.verdict === "PASS" && state.lastReview.target === target) {
    wakeOnce(pi, `accepted:${qid}:${target}`, `Validation PASS recorded for ${qid} — run quest_archive to complete the quest.`);
    return;
  }
  if (hasInFlight(qid)) return;
  let signal!: AbortSignal;
  supersedeReviewThenBootFresh(qid, target, (s) => {
    signal = s;
    updateState((c) => (c.qid === qid ? { ...c, activeReview: { kind: "validation", target }, snapshotPending: true } : c));
  });
  const config = withEffectivePolicy(await readQuestConfig(ctx.cwd), ctx);
  if (signal.aborted || !isCurrentReview(qid, target)) return;
  await executePendingValidationTest(pi, ctx, state, config, qid);
  if (signal.aborted || !isCurrentReview(qid, target)) return;
  if (await handleBypassIfEligible(pi, ctx, qid, target, config)) {
    if (isCurrentReview(qid, target)) cancelReview(qid);
    return;
  }
  if (signal.aborted || !isCurrentReview(qid, target)) return;
  const validatorModel = resolveRoleModel(config, "validator");
  const brief = await validationBrief(ctx, state, pi);
  if (signal.aborted || !isCurrentReview(qid, target)) return;
  const outcome = await runIsolatedReview({
    pi,
    ctx,
    qid,
    target,
    signal,
    reviewKind: "validation",
    runnerTool: config.bindings.reviewRunner.tool,
    ...(validatorModel ? { model: validatorModel } : {}),
    fallbackModels: resolveRoleFallbacks(config, "validator"),
    routerDefault: config.router.default,
    cooldownMs: config.router.cooldownMs,
    maxDurationMs: config.reviewMaxDurationMs,
    inactivityLimitMs: config.reviewInactivityMs,
    prompt: buildReviewPrompt("validation", qid, target, brief),
  });

  if (outcome.status === "no-runner") {
    const workPhase = state.kind === "analysis" ? "drafting" : "implementing";
    announceOnce(pi, `userpath:${qid}:${target}`, `No validator available. Only the user can accept completion by replying CONFIRM — your own CONFIRM text does nothing. Otherwise keep working (continueWork:true returns to ${workPhase}).`);
    return;
  }
  if (outcome.status === "failed") {
    const scheduled = scheduleValidationRetry(qid, (attempt) => {
      const s = getState();
      if (s.disabled === true || s.phase !== "validating" || s.qid !== qid) return;
      if (validationRetryCount(qid) !== attempt || hasInFlight(qid)) return;
      void ensureValidationFlow(pi, ctx);
    });
    if (!scheduled) {
      wakeOnce(pi, `failed:${qid}:${target}`, `Validation failed to run (${outcome.detail}). Claim completion again to retry, keep working (continueWork:true), or hold for the user to reply CONFIRM.`);
    }
    return;
  }
  if (outcome.status !== "verdict" || !outcome.settled) return;
  if (getState().disabled === true) return;
  clearValidationRetries(qid);

  if (outcome.review.verdict === "PASS") {
    clearValidationVerdictFails(qid);
    const concluded = await concludeValidationPass(pi, ctx, qid, target, outcome.review, config.autoArchive);
    if (!concluded.archived && getState().phase === "validating") {
      const errNote = concluded.error ? ` (auto-archive halted: ${concluded.error})` : "";
      const advisories = outcome.review.advisories.trim();
      wakeOnce(pi, `accepted:${qid}:${target}`, `Validation PASS for ${qid}${errNote} — run quest_archive to complete the quest.${advisories === "" ? "" : ` Non-blocking advisories: ${advisories} Record adopted ones via amendment as you work.`}`);
    }
    return;
  }

  await handleValidationFailVerdict(pi, ctx, qid, target, outcome.review);
}

export async function handleConfirmInput(pi: Pi, ctx: PiCtx, text: string): Promise<boolean> {
  const state = getState();
  if (state.disabled === true || state.phase !== "validating" || state.qid === null) return false;
  const config = await readQuestConfig(ctx.cwd);
  const intent = await interpretUserTurn(text, "validating", config);
  if (intent.kind !== "advance") return false;
  if (getState().phase !== "validating") return false;
  if (hasInFlight(state.qid)) {
    cancelReview(state.qid);
  }
  const target = implementationFingerprint(state);
  if (state.lastReview?.verdict === "PASS" && state.lastReview.target === target) return false;
  updateState((s) => recordReviewResult(s, "PASS", target, "Accepted on user confirmation."));
  clearValidationVerdictFails(state.qid);
  emitNow(pi);
  await archiveActiveQuest(pi, ctx, "COMPLETED", "Accepted on user confirmation.");
  return true;
}
