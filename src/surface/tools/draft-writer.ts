// HIGH_LEVEL: #tools (main agent) — the draft-file write path for plan and
// analysis deliverables: splice → hash → state → boot review. Kept out of
// update-state.ts so that file stays under the complexity budget.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, updateState } from "../../app/store";
import { emitNow } from "../../app/interpreter";
import type { QuestState } from "../../domain/quest";
import { recordPlanRevision } from "../../domain/plan-revision";
import { draftPath } from "../../domain/paths";
import { draftFilePath } from "../../files";
import { bootPlanRevisionReview, clearPlanRevisionRetries } from "../../implementing/plan-revision";
import { clearDraftReviewRetry, maybeBootDraftReview } from "../../drafting/reviews";
import { supersedeReviewThenBootFresh } from "../../review/tracker";
import { dedupeDocBullets } from "../../domain/dedupe";
import { assertNoSectionHeadings, hashContent, parseDraftSections, seedReviewCount, spliceAnalysisSection, splicePlanSection } from "../../drafting/plan-text";
import { noteDraftUpdated } from "../../durability/status";
import type { Pi, PiCtx } from "../../hooks/events";

export async function writePlanToDraft(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  planText: string,
): Promise<QuestState> {
  if (state.phase !== "drafting" || state.draft === null || state.qid === null) {
    throw new Error(`plan text needs an active draft (phase ${state.phase}); the plan is drafting-only — record post-approval deviations via amendment or refinement`);
  }
  if (state.kind !== "standard") {
    throw new Error("plan text is for standard quests — author the ## Analysis via {analysis: ...} instead");
  }
  const cleanPlan = assertNoSectionHeadings(planText, "plan");
  const path = draftFilePath(ctx.cwd, state.qid);
  const current = await readFile(path, "utf8");
  const updated = dedupeDocBullets(splicePlanSection(current, seedReviewCount(cleanPlan))).text;
  if (updated === current) throw new Error("plan text identical to the draft file");
  await writeFile(path, updated, "utf8");
  const hash = hashContent(updated);
  updateState((s) => s.draft === null ? s : {
    ...s,
    draft: { ...s.draft, planAuthored: true, contentHash: hash },
    snapshotPending: true,
  });
  emitNow(pi);
  noteDraftUpdated(ctx);
  clearDraftReviewRetry(state.qid);
  await maybeBootDraftReview(pi, ctx);
  return getState();
}

export async function writeAnalysisToDraft(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  analysisText: string,
): Promise<QuestState> {
  if (state.phase !== "drafting" || state.draft === null || state.qid === null) {
    throw new Error(`analysis text needs an active draft (phase ${state.phase}); the analysis is drafting-only`);
  }
  const cleanAnalysis = assertNoSectionHeadings(analysisText, "analysis");
  const path = draftFilePath(ctx.cwd, state.qid);
  const current = await readFile(path, "utf8");
  const updated = dedupeDocBullets(spliceAnalysisSection(current, seedReviewCount(cleanAnalysis))).text;
  if (updated === current) throw new Error("analysis text identical to the draft file");
  await writeFile(path, updated, "utf8");
  const hash = hashContent(updated);
  updateState((s) => s.draft === null ? s : {
    ...s,
    draft: { ...s.draft, planAuthored: true, contentHash: hash },
    snapshotPending: true,
  });
  emitNow(pi);
  noteDraftUpdated(ctx);
  clearDraftReviewRetry(state.qid);
  await maybeBootDraftReview(pi, ctx);
  return getState();
}

// Mid-implementation plan revision: the objective is immutable here — a new
// goal is a scope change and belongs in a new quest. The revision stages new
// content and boots a re-review; the approved binding moves only on PASS.
export async function writePlanRevision(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  planText: string,
  note: string,
  objective: unknown,
): Promise<QuestState> {
  if (state.phase !== "implementing" || state.draft === null || state.qid === null) {
    throw new Error(`plan revision needs an implementing quest (phase ${state.phase})`);
  }
  if (typeof objective === "string" && objective.trim() !== "") {
    const current = state.pendingRootRequest ?? state.objective;
    if (objective.trim() !== current) {
      throw new Error("plan revision keeps the quest objective — a new goal is a scope change, start a new quest");
    }
  }
  const cleanRevision = assertNoSectionHeadings(planText, "plan");
  const path = draftFilePath(ctx.cwd, state.qid);
  const current = await readFile(path, "utf8");
  const previousPlan = parseDraftSections(current).plan;
  const updated = dedupeDocBullets(splicePlanSection(current, seedReviewCount(cleanRevision))).text;
  if (updated === current) throw new Error("plan revision identical to the draft file");
  await writeFile(path, updated, "utf8");
  const hash = hashContent(updated);
  const stagedPlan = parseDraftSections(updated).plan;
  const previousHash = state.draft.contentHash;
  const qid = state.qid;
  const next = updateState((s) =>
    recordPlanRevision(s, previousHash, hash, note === "" ? "plan revision" : note, previousPlan, Date.now(), stagedPlan)
  );
  emitNow(pi);
  noteDraftUpdated(ctx);
  clearPlanRevisionRetries(qid);
  supersedeReviewThenBootFresh(qid, hash, (signal) => {
    updateState((s) =>
      s.qid === qid
        ? {
            ...s,
            activeReview: { kind: "draft", target: hash },
            exactNextAction: `Review running for quest ${qid} — end your turn; the verdict arrives as a new turn.`,
            snapshotPending: true,
          }
        : s
    );
    void bootPlanRevisionReview(pi, ctx, hash, undefined, signal);
  });
  return next;
}

export async function carryRefinementsToDraft(ctx: PiCtx, state: QuestState): Promise<QuestState> {
  if (state.phase !== "drafting" || state.draft === null || state.qid === null) return state;
  if (state.refinements.length === 0) return state;
  const path = draftFilePath(ctx.cwd, state.qid);
  const current = await readFile(path, "utf8");
  const items = state.refinements.map((refinement) => `- ${refinement}`).join("\n");
  const body = current.endsWith("\n") ? current : `${current}\n`;
  const updated = dedupeDocBullets(`${body}\n## Findings (pre-draft investigation)\n\n${items}\n`).text;
  await writeFile(path, updated, "utf8");
  const hash = hashContent(updated);
  return updateState((s) => s.draft === null ? s : {
    ...s,
    draft: { ...s.draft, contentHash: hash },
    snapshotPending: true,
  });
}