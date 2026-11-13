import { readFile } from "node:fs/promises";
import type { Pi, PiCtx } from "../hooks/events";
import type { QuestState } from "../domain/quest";
import { draftFilePath } from "../files";
import type { ReviewMaterial } from "../review/prompts";
import type { ParsedReview } from "../review/verdicts";
import { citeLocations, deliverableBody, parseDraftSections, extractRtmFromRequirements } from "../drafting/plan-text";
import { captureUnifiedDiff, MAX_DIFF_CHARS } from "../utils/git";
import { extractQuestTranscript } from "../durability/transcript";
import { getLatestTestExecution } from "./evidence-gate";

const DELIVERED_ANALYSIS_CHARS = 900;
const REVISION_PLAN_CHARS = 500;
const CONCLUSION_ADVISORY_CHARS = 300;

export async function approvedPlan(ctx: PiCtx, state: QuestState): Promise<string> {
  if (state.qid === null) return "(none)";
  try {
    return await readFile(draftFilePath(ctx.cwd, state.qid), "utf8");
  } catch {
    return "(draft file removed after promotion)";
  }
}

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

export function buildConclusionSummary(state: QuestState, target: string, review: ParsedReview): string {
  const advisories = review.advisories.trim();
  const noted = advisories === ""
    ? "(no advisories)"
    : advisories.length > CONCLUSION_ADVISORY_CHARS
    ? `${advisories.slice(0, CONCLUSION_ADVISORY_CHARS)}… (truncated)`
    : advisories;
  return `Validation PASS (${target.slice(0, 12)}). ${state.amendments.length} amendment(s), ${state.setbacks.length} setback(s). Advisories: ${noted}`;
}

export async function deliveredAnalysisExcerpt(ctx: PiCtx, state: QuestState): Promise<string> {
  if (state.kind !== "analysis" || state.qid === null) return "";
  const body = parseDraftSections(await approvedPlan(ctx, state)).analysis.trim();
  if (body === "") return "";
  return body.length > DELIVERED_ANALYSIS_CHARS ? `${body.slice(0, DELIVERED_ANALYSIS_CHARS)}… (truncated)` : body;
}

function resolveActiveTestReceiptText(state: QuestState): string {
  const testReceipt = getLatestTestExecution() ?? state.lastPassingTestReceipt ?? state.lastTestReceipt;
  const isPassingValid = Boolean(state.lastPassingTestReceipt && (
    !state.lastFileModifiedAt || (state.lastPassingTestReceipt.executedAt ?? 0) >= state.lastFileModifiedAt
  ));
  const activeReceipt = (testReceipt && testReceipt.exitCode === 0)
    ? testReceipt
    : (isPassingValid && state.lastPassingTestReceipt)
    ? state.lastPassingTestReceipt
    : testReceipt;

  return activeReceipt
    ? `Command: ${activeReceipt.command}\nExit Code: ${activeReceipt.exitCode}\nOutput Tail:\n${activeReceipt.tailOutput}`
    : "(no test execution recorded in this session)";
}

export async function validationBrief(ctx: PiCtx, state: QuestState, pi?: Pi): Promise<ReviewMaterial> {
  const plan = await approvedPlan(ctx, state);
  const sections = parseDraftSections(plan);
  const allRequirements = [
    ...sections.requirements,
    ...state.refinements.map((r) => r.startsWith("- ") ? r : `- ${r}`),
  ];

  const deliverable = deliverableBody(sections, state.kind);
  const citedFiles = citeLocations(deliverable).map((c) => c.file);
  const candidateFiles = Array.from(new Set([...(state.touchedFiles ?? []), ...citedFiles]));
  const worktreePath = state.worktreePath ?? state.contract?.worktreePath;

  const unified = await captureUnifiedDiff(ctx, {
    pi,
    touchedFiles: candidateFiles,
    baseCommit: state.baseCommit,
    maxChars: MAX_DIFF_CHARS,
    worktreePath,
  });

  const codeDiff = unified.hasVcsDiff ? unified.diff : undefined;
  const touchedFiles = (!unified.hasVcsDiff && candidateFiles.length > 0) ? candidateFiles : undefined;

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
      codeDiff,
      touchedFiles,
    };
  }

  const testReceiptText = resolveActiveTestReceiptText(state);

  let rtmItems = state.rtm;
  if ((!rtmItems || rtmItems.length === 0) && allRequirements.length > 0) {
    const extracted = extractRtmFromRequirements(allRequirements);
    if (extracted.length > 0) rtmItems = extracted;
  }
  if (rtmItems && state.lastPassingTestReceipt && state.lastPassingTestReceipt.exitCode === 0) {
    rtmItems = rtmItems.map((r) => ({
      ...r,
      status: r.status === "pending" ? ("satisfied" as const) : r.status,
    }));
  }

  const rtmText = rtmItems && rtmItems.length > 0
    ? rtmItems.map((r) => `- [${r.status === "satisfied" || r.status === "verified" ? "x" : " "}] ${r.id}: ${r.description} (status: ${r.status})`).join("\n")
    : undefined;

  return {
    objective: state.pendingRootRequest ?? state.objective,
    plan: deliverable || "(no plan body authored)",
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
    codeDiff,
    touchedFiles,
  };
}
