// HIGH_LEVEL: #drafting — subagent plan validation fired immediately before approval question.
// SPEC: All user requests must be captured in the plan file before requesting operator approval.
import { readFile } from "node:fs/promises";
import { getState, updateState } from "../app/store";
import { emitNow, sendWake } from "../app/interpreter";
import { readQuestConfig, resolveRoleFallbacks, resolveRoleModel } from "../config";
import { draftFilePath } from "../files";
import { draftPath } from "../domain/paths";
import type { QuestState } from "../domain/quest";
import type { Qid } from "../domain/qid";
import { hashContent, parseDraftSections } from "./plan-text";
import { buildPlanApprovalPrompt, type ReviewMaterial } from "../review/prompts";
import { runIsolatedReview } from "../review/flow";
import { isReviewerAvailable } from "../review/runner";
import { approveDraft } from "./reviews";
import { hasInFlight } from "../review/tracker";
import { isAffirmativeApproval, isApprovalQuestion } from "../absence/ask";
import type { Pi, PiCtx } from "../hooks/events";

export { isApprovalQuestion };

export interface PlanApprovalValidationResult {
  allowed: boolean;
  verdict?: "PASS" | "FAIL";
  findings?: string;
  error?: string;
}

const verifiedApprovalKeys = new Set<string>();

export function clearVerifiedApprovals(): void {
  verifiedApprovalKeys.clear();
}

/**
 * Fires the plan validation subagent.
 * Runs asynchronously so the approval question is presented to the user immediately.
 */
export async function firePlanValidationSubagent(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
): Promise<PlanApprovalValidationResult> {
  return await validatePlanBeforeApproval(pi, ctx, state);
}

async function readAndCheckDraftContent(
  pi: Pi,
  ctx: PiCtx,
  qid: Qid,
  kind: string,
): Promise<{ content: string; sections: ReturnType<typeof parseDraftSections> } | PlanApprovalValidationResult> {
  const fullPath = draftFilePath(ctx.cwd, qid);
  let content: string;
  try {
    content = await readFile(fullPath, "utf8");
  } catch {
    const findings = `Plan file (${draftPath(qid)}) does not exist on disk. A plan file must be written before requesting approval.`;
    updateState((s) => ({
      ...s,
      draft: s.draft ? { ...s.draft, outstandingFindings: true } : null,
      exactNextAction: `Create and write plan file: ${findings}`,
    }));
    emitNow(pi);
    sendWake(pi, `Plan validation FAIL before approval: ${findings}`);
    return { allowed: false, verdict: "FAIL", findings };
  }

  const sections = parseDraftSections(content);
  if (kind !== "analysis" && sections.plan.trim() === "") {
    const findings = `The implementation plan in (${draftPath(qid)}) is empty. A plan must be authored before requesting approval.`;
    updateState((s) => ({
      ...s,
      draft: s.draft ? { ...s.draft, outstandingFindings: true } : null,
      exactNextAction: `Author implementation plan: ${findings}`,
    }));
    emitNow(pi);
    sendWake(pi, `Plan validation FAIL before approval: ${findings}`);
    return { allowed: false, verdict: "FAIL", findings };
  }
  return { content, sections };
}

function handleApprovalVerdict(
  pi: Pi,
  qid: Qid,
  target: string,
  verifyKey: string,
  review: { verdict: "PASS" | "FAIL"; findings: string; text: string },
): PlanApprovalValidationResult {
  if (review.verdict === "FAIL") {
    updateState((s) => ({
      ...s,
      draft: s.draft ? { ...s.draft, outstandingFindings: true } : null,
      lastReview: {
        verdict: "FAIL",
        target,
        findings: review.findings,
        reviewText: review.text.trim(),
      },
      exactNextAction: `Address plan validation findings before implementation: ${review.findings.slice(0, 150)}`,
    }));
    emitNow(pi);
    sendWake(
      pi,
      `Plan validation FAIL before approval (target ${target.slice(0, 12)}): ${review.findings}\n` +
      `Revise the plan file (${draftPath(qid)}) to include all user requests before implementation.`,
    );
    return { allowed: false, verdict: "FAIL", findings: review.findings };
  }

  verifiedApprovalKeys.add(verifyKey);
  updateState((s) => ({
    ...s,
    lastReview: {
      verdict: "PASS",
      target,
      findings: review.findings,
      reviewText: review.text.trim(),
    },
  }));
  emitNow(pi);
  return { allowed: true, verdict: "PASS", findings: review.findings };
}

export async function validatePlanBeforeApproval(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
): Promise<PlanApprovalValidationResult> {
  if (state.qid === null || state.phase !== "drafting") return { allowed: true };
  if (!isReviewerAvailable(pi, "subagent") || hasInFlight(state.qid)) return { allowed: true };

  const qid = state.qid;
  const checked = await readAndCheckDraftContent(pi, ctx, qid, state.kind);
  if ("allowed" in checked) return checked;
  const { content, sections } = checked;

  const target = state.draft?.contentHash ?? hashContent(content);
  const verifyKey = `${qid}:${target}:${state.refinements.length}`;
  if (verifiedApprovalKeys.has(verifyKey)) return { allowed: true, verdict: "PASS" };
  if (state.lastReview?.verdict === "PASS" && state.lastReview?.target === target && !state.draft?.outstandingFindings) {
    verifiedApprovalKeys.add(verifyKey);
    return { allowed: true, verdict: "PASS", findings: state.lastReview.findings };
  }

  const material: ReviewMaterial = {
    objective: state.objective,
    plan: sections.plan || sections.analysis,
    kind: state.kind,
    difficulty: state.difficulty,
    requirements: sections.requirements,
    evidence: sections.evidence,
    refinements: state.refinements,
    amendments: state.amendments.map((a) => `${a.change} (${a.reasons})`),
  };

  const config = await readQuestConfig(ctx.cwd);
  const reviewerModel = resolveRoleModel(config, "reviewer");
  const outcome = await runIsolatedReview({
    pi,
    ctx,
    qid,
    target,
    prompt: buildPlanApprovalPrompt(qid, target, material),
    runnerTool: config.bindings.reviewRunner.tool,
    ...(reviewerModel ? { model: reviewerModel } : {}),
    fallbackModels: resolveRoleFallbacks(config, "reviewer"),
    routerDefault: config.router.default,
    cooldownMs: config.router.cooldownMs,
    maxDurationMs: Math.min(config.reviewMaxDurationMs, 60000),
    inactivityLimitMs: Math.min(config.reviewInactivityMs, 30000),
  });

  if (outcome.status === "no-runner") return { allowed: true };
  if (outcome.status === "verdict") return handleApprovalVerdict(pi, qid, target, verifyKey, outcome.review);
  if (outcome.status === "failed") {
    return { allowed: false, error: outcome.detail, findings: `Subagent validation failed to execute: ${outcome.detail}` };
  }
  return { allowed: true };
}
