// HIGH_LEVEL: #validation — validator archives on PASS, demotes on FAIL.
// HIGH_LEVEL: #validator communication — plan, snapshot, amendments, evidence, criteria.
// SPEC: B1.5 (completion + slim archive).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, updateState } from "../app/store";
import { emitNow, sendSteer, sendWake } from "../app/interpreter";
import type { QuestState } from "../domain/quest";
import { recordReviewResult } from "../domain/quest";
import { demoteToDrafting, demoteToImplementing } from "../domain/transitions";
import type { Qid } from "../domain/qid";
import { draftPath } from "../domain/paths";
import type { Pi, PiCtx } from "../hooks/events";
import { buildReviewPrompt, type ReviewMaterial } from "../review/prompts";
import { isReviewerAvailable } from "../review/runner";
import { implementationFingerprint, runIsolatedReview } from "../review/flow";
import type { ParsedReview } from "../review/verdicts";
import { readQuestConfig, resolveRoleFallbacks, resolveRoleModel } from "../config";
import { withEffectivePolicy } from "../policy/effective";
import { cancelReview, hasInFlight } from "../review/tracker";
import { archiveActiveQuest } from "../surface/tools/archive";
import { setDocStatus } from "../quest-doc";
import { parseDraftSections } from "../drafting/plan-text";
import { extractQuestTranscript } from "../durability/transcript";
import { getLatestTestExecution } from "./evidence-gate";
import { interpretUserTurn } from "../domain/intent";


async function approvedPlan(ctx: PiCtx, state: QuestState): Promise<string> {
  if (state.qid === null) return "(none)";
  try {
    return await readFile(join(ctx.cwd, draftPath(state.qid)), "utf8");
  } catch {
    return "(draft file removed after promotion)";
  }
}

const announced = new Set<string>();

export const MAX_CONSECUTIVE_VALIDATION_FAILS = 2;
const consecutiveValidationFails = new Map<string, number>();

export function noteValidationVerdictFailed(qid: string): number {
  const next = (consecutiveValidationFails.get(qid) ?? 0) + 1;
  consecutiveValidationFails.set(qid, next);
  return next;
}

export function clearValidationVerdictFails(qid: string): void {
  consecutiveValidationFails.delete(qid);
}

export function getValidationVerdictFails(qid: string): number {
  return consecutiveValidationFails.get(qid) ?? 0;
}

// HIGH_LEVEL: #plan revision — the validator judges every plan move, so the
// brief carries the append-only revision record: note, superseded hash, and
// prior text truncated to a bounded window with the cut marked.
const REVISION_PLAN_CHARS = 500;

export function formatRevisionHistory(state: QuestState): string[] {
  return (state.draft?.planRevisions ?? []).map((r) => {
    const hash = r.hash === null || r.hash === "" ? "initial plan" : `superseded ${r.hash.slice(0, 12)}`;
    const when = new Date(r.at).toISOString().slice(0, 10);
    const prior = r.plan.length > REVISION_PLAN_CHARS
      ? `${r.plan.slice(0, REVISION_PLAN_CHARS)}… (truncated)`
      : r.plan;
    return `- ${r.note} (${hash}, ${when}): ${prior}`;
  });
}

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

// HIGH_LEVEL: #independent review contexts — fresh-session announcements, so
// a stale "no validator" notice can never suppress a retry's messaging.
export function resetAnnouncements(): void {
  announced.clear();
}

// A PASS verdict concludes the quest: the archive summary carries the
// verdict's counts and advisories so nothing the validator said is lost
// when nobody archives manually.
const CONCLUSION_ADVISORY_CHARS = 300;

export function buildConclusionSummary(state: QuestState, target: string, review: ParsedReview): string {
  const advisories = review.advisories.trim();
  const noted = advisories === ""
    ? "(no advisories)"
    : advisories.length > CONCLUSION_ADVISORY_CHARS
    ? `${advisories.slice(0, CONCLUSION_ADVISORY_CHARS)}… (truncated)`
    : advisories;
  return `Validation PASS (${target.slice(0, 12)}). ${state.amendments.length} amendment(s), ${state.setbacks.length} setback(s). Advisories: ${noted}`;
}

// The validator's brief differs by kind: standard quests validate against the
// full approved doc; analysis quests validate the ## Analysis deliverable
// against the bounded research transcript (D4).
const DELIVERED_ANALYSIS_CHARS = 900;

export async function validationBrief(ctx: PiCtx, state: QuestState): Promise<ReviewMaterial> {
  const plan = await approvedPlan(ctx, state);
  const sections = parseDraftSections(plan);
  const allRequirements = [
    ...sections.requirements,
    ...state.refinements.map((r) => r.startsWith("- ") ? r : `- ${r}`),
  ];

  if (state.kind === "analysis" && state.qid !== null) {
    return {
      objective: state.pendingRootRequest ?? state.objective,
      plan: sections.analysis,
      kind: "analysis",
      evidence: [
        ...state.setbacks.map((s) => `${s.reason} — ${s.evidence.join("; ")}`),
        ...state.children.map((c) => `child ${c.qid} (${c.status}): ${c.findings ?? "no findings yet"}`),
      ],
      requirements: allRequirements,
      amendments: state.amendments.map((a) => `${a.change} (${a.reasons})`),
      planRevisionHistory: formatRevisionHistory(state),
      implementationSummary: `${state.exactNextAction} Children: ${state.children.map((c) => `${c.qid}=${c.status}`).join(", ") || "none"}.`,
      transcriptExtract: await extractQuestTranscript(ctx, state.qid),
    };
  }
  const testReceipt = getLatestTestExecution();
  const testReceiptText = testReceipt
    ? `Command: ${testReceipt.command}\nExit Code: ${testReceipt.exitCode}\nOutput Tail:\n${testReceipt.tailOutput}`
    : "(no test execution recorded in this session)";

  const rtmText = state.rtm && state.rtm.length > 0
    ? state.rtm.map((r) => `- [${r.status === "satisfied" ? "x" : " "}] ${r.id}: ${r.description} (status: ${r.status})`).join("\n")
    : undefined;

  return {
    objective: state.pendingRootRequest ?? state.objective,
    plan,
    kind: state.kind,
    evidence: [
      ...state.setbacks.map((s) => `${s.reason} — ${s.evidence.join("; ")}`),
      ...state.children.map((c) => `child ${c.qid} (${c.status}): ${c.findings ?? "no findings yet"}`),
      ...(state.handbackReceipts ?? []).map((h) => `child ${h.childQid} (${h.status}): ${h.findings} [test: ${h.testCommand}, passed: ${h.testPassed}]`),
    ],
    requirements: allRequirements,
    amendments: state.amendments.map((a) => `${a.change} (${a.reasons})`),
    planRevisionHistory: formatRevisionHistory(state),
    implementationSummary: `${state.exactNextAction} Children: ${state.children.map((c) => `${c.qid}=${c.status}`).join(", ") || "none"}.`,
    testReceipt: testReceiptText,
    rtmChecklist: rtmText,
  };
}

// The conclusion wake for an analysis quest carries the delivered analysis so
// the moment is reviewable after archival removed the live draft. Computed
// against the pre-archive doc at the last possible moment.
export async function deliveredAnalysisExcerpt(ctx: PiCtx, state: QuestState): Promise<string> {
  if (state.kind !== "analysis" || state.qid === null) return "";
  const body = parseDraftSections(await approvedPlan(ctx, state)).analysis.trim();
  if (body === "") return "";
  return body.length > DELIVERED_ANALYSIS_CHARS ? `${body.slice(0, DELIVERED_ANALYSIS_CHARS)}… (truncated)` : body;
}

// A validating FAIL returns analysis quests to drafting (the analysis is a
// draft-like artifact; implementing, where the quest doc is locked, is the
// wrong repair state) and standard quests to implementing.
export function repairAfterFail(state: QuestState): QuestState {
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
): Promise<{ archived: boolean; zipPath: string | null }> {
  if (!autoArchive) return { archived: false, zipPath: null };
  // The manual path re-checks currency at archive time; conclude must too:
  // work that moved after the verdict needs a fresh validation, not an archive.
  if (implementationFingerprint(getState()) !== target) {
    sendSteer(pi, `Quest ${qid} changed during validation — conclusion skipped; a fresh validation will boot against the current work.`);
    return { archived: false, zipPath: null };
  }
  // The excerpt must be captured before archive: archiveActiveQuest removes the
  // live draft that carries the delivered analysis.
  const excerpt = await deliveredAnalysisExcerpt(ctx, getState());
  const isAnalysis = getState().kind === "analysis";
  const done = await archiveActiveQuest(pi, ctx, "COMPLETED", buildConclusionSummary(getState(), target, review));
  const delivered = excerpt === "" ? "" : `\n\nDELIVERED ANALYSIS:\n${excerpt}`;
  const handoffHint = isAnalysis
    ? `\n\nTo begin implementation of the approved analysis, run quest_update_state { objective: "Implement recommendations from analysis ${qid}..." }.`
    : "";
  wakeOnce(pi, `concluded:${qid}:${target}`, `Quest ${qid} concluded and archived as completed (${done.zipPath}).${delivered}${handoffHint}`);
  return { archived: true, zipPath: done.zipPath };
}

export async function ensureValidationFlow(pi: Pi, ctx: PiCtx): Promise<void> {
  const state = getState();
  if (state.phase !== "validating" || state.qid === null) return;
  const qid = state.qid;
  const target = implementationFingerprint(state);
  if (state.lastReview?.verdict === "PASS" && state.lastReview.target === target) {
    wakeOnce(pi, `accepted:${qid}:${target}`, `Validation PASS recorded for ${qid} — run quest_archive to complete the quest.`);
    return;
  }
  if (hasInFlight(qid)) return;
  const config = withEffectivePolicy(await readQuestConfig(ctx.cwd), ctx);

  // Policy-based bypass in validation:
  // 1. "off": skip subagent review entirely when tests pass (or analysis)
  // 2. "balanced": for non-complex tasks, skip subagent review when tests pass
  const testExecution = state.lastTestReceipt ?? getLatestTestExecution();
  const testsPassed = testExecution !== null ? testExecution.exitCode === 0 : state.kind === "analysis";
  const shouldBypassValidation =
    config.reviewPolicy === "off" ||
    (config.reviewPolicy === "balanced" && state.difficulty !== "complex" && state.difficulty !== "major" && testsPassed);

  if (shouldBypassValidation) {
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
    if (!concluded.archived) {
      wakeOnce(pi, `accepted:${qid}:${target}`, `Validation PASS for ${qid} (${reason}) — run quest_archive to complete the quest.`);
    }
    return;
  }

  const validatorModel = resolveRoleModel(config, "validator");
  const brief = await validationBrief(ctx, state);
  const outcome = await runIsolatedReview({
    pi,
    ctx,
    qid,
    target,
    runnerTool: config.bindings.reviewRunner.tool,
    ...(validatorModel ? { model: validatorModel } : {}),
    fallbackModels: resolveRoleFallbacks(config, "validator"),
    routerDefault: config.router.default,
    cooldownMs: config.router.cooldownMs,
    prompt: buildReviewPrompt("validation", qid, target, brief),
  });
  if (outcome.status === "no-runner") {
    // continueWork returns analysis quests to drafting, implementation quests to
    // implementing — name the right phase so the guidance stays accurate.
    const workPhase = state.kind === "analysis" ? "drafting" : "implementing";
    announceOnce(pi, `userpath:${qid}:${target}`, `No validator available. Only the user can accept completion by replying CONFIRM — your own CONFIRM text does nothing. Otherwise keep working (continueWork:true returns to ${workPhase}).`);
    return;
  }
  if (outcome.status === "failed") {
    wakeOnce(pi, `failed:${qid}:${target}`, `Validation failed to run (${outcome.detail}). Claim completion again to retry, keep working (continueWork:true), or hold for the user to reply CONFIRM.`);
    return;
  }
  if (outcome.status !== "verdict" || !outcome.settled) return;
  if (outcome.review.verdict === "PASS") {
    clearValidationVerdictFails(qid);
    const concluded = await concludeValidationPass(pi, ctx, qid, target, outcome.review, config.autoArchive);
    if (!concluded.archived) {
      const advisories = outcome.review.advisories.trim();
      wakeOnce(pi, `accepted:${qid}:${target}`, `Validation PASS for ${qid} — run quest_archive to complete the quest.${advisories === "" ? "" : ` Non-blocking advisories: ${advisories} Record adopted ones via amendment as you work.`}`);
    }
    return;
  }
  const consecutive = noteValidationVerdictFailed(qid);
  if (state.kind === "analysis") {
    updateState((s) => repairAfterFail(s));
    await setDocStatus(ctx, qid, "drafting", false);
    emitNow(pi);
    if (consecutive >= MAX_CONSECUTIVE_VALIDATION_FAILS) {
      sendWake(
        pi,
        `Validation rejected ${consecutive} consecutive times for ${qid}. Automated validation loop paused.\n` +
        `Validator findings: ${outcome.review.findings}\n\n` +
        `Consult the human operator for guidance. The operator may reply "ship it" / "confirm" to accept completion as-is, or provide technical instructions.`,
      );
      return;
    }
    sendWake(pi, `Validation FAIL (target ${target.slice(0, 12)}): ${outcome.review.findings} Address the findings in the analysis, then submit the revised analysis for review again.`);
    return;
  }
  updateState((s) => repairAfterFail(s));
  await setDocStatus(ctx, qid, "implementing", false);
  emitNow(pi);
  if (consecutive >= MAX_CONSECUTIVE_VALIDATION_FAILS) {
    sendWake(
      pi,
      `Validation rejected ${consecutive} consecutive times for ${qid}. Automated validation loop paused.\n` +
      `Validator findings: ${outcome.review.findings}\n\n` +
      `Consult the human operator for guidance. The operator may reply "ship it" / "confirm" to accept completion as-is, or provide technical instructions.`,
    );
    return;
  }
  sendWake(pi, `Validation FAIL (target ${target.slice(0, 12)}): ${outcome.review.findings} Address the findings, then claim completion again.`);
}

export async function handleConfirmInput(pi: Pi, ctx: PiCtx, text: string): Promise<boolean> {
  const state = getState();
  if (state.phase !== "validating" || state.qid === null) return false;
  const config = await readQuestConfig(ctx.cwd);
  const intent = await interpretUserTurn(text, "validating", config);
  if (intent.kind !== "advance") return false;
  if (getState().phase !== "validating") return false;
  if (hasInFlight(state.qid)) {
    cancelReview(state.qid);
  }
  const target = implementationFingerprint(state);
  if (state.lastReview?.verdict === "PASS" && state.lastReview.target === target) return false;
  // User acceptance stands in for or overrides the validator verdict: record it
  // as the current PASS so the COMPLETED archive gate sees honest state.
  updateState((s) => recordReviewResult(s, "PASS", target, "Accepted on user confirmation."));
  clearValidationVerdictFails(state.qid);
  emitNow(pi);
  await archiveActiveQuest(pi, ctx, "COMPLETED", "Accepted on user confirmation.");
  return true;
}
