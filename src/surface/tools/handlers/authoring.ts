import { readFile, writeFile } from "node:fs/promises";
import { getState, updateState } from "../../../app/store.ts";
import { difficultyLevel, type QuestState } from "../../../domain/quest.ts";
import { draftFilePath } from "../../../files.ts";
import type { Pi, PiCtx } from "../../../hooks/events.ts";
import { profileForSavedDoc } from "../draft-profile.ts";
import { checkPlanCitations } from "../claims.ts";
import {
  writeAnalysisToDraft,
  writePlanRevision,
  writePlanToDraft,
} from "../draft-writer.ts";
import { parseDraftSections } from "../../../drafting/plan-text.ts";
import { noteDraftUpdated } from "../../../durability/status.ts";
import { recalibrateQuestDifficulty } from "../../../drafting/difficulty.ts";

export async function applyPlanParam(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ state: QuestState; error?: string }> {
  const plan = params["plan"];
  const qid = state.qid;
  if (typeof plan !== "string" || plan.trim() === "" || qid === null) {
    return { state };
  }
  if (state.phase === "drafting") {
    try {
      let next = await writePlanToDraft(pi, ctx, state, plan.trim());
      applied.push("plan recorded in the draft file");
      const claims = await checkPlanCitations(ctx, plan.trim());
      if (claims !== "") applied.push(claims);

      const fileContent = await readFile(draftFilePath(ctx.cwd, qid), "utf8");
      const sections = parseDraftSections(fileContent);
      const recalibrated = recalibrateQuestDifficulty(next, sections, fileContent);
      if (difficultyLevel(recalibrated) > difficultyLevel(next.difficulty)) {
        next = updateState((s) => ({ ...s, difficulty: recalibrated, snapshotPending: true }));
        applied.push(`complexity discovered mid-quest: task elevated to ${recalibrated}`);
      }
      applied.push(await profileForSavedDoc(ctx, qid));
      return { state: next };
    } catch (err) {
      return { state, error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (state.phase === "implementing") {
    return {
      state,
      error: "plan is locked during implementation; pass {planRevision: '...', note: '...'} to stage a re-reviewable revision, or pass {amendment: {change: '...', reasons: '...'}} to record scope changes.",
    };
  }
  return { state, error: `cannot write plan during phase ${state.phase}` };
}

export async function applyAnalysisParam(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ state: QuestState; error?: string }> {
  const analysis = params["analysis"];
  const qid = state.qid;
  if (typeof analysis !== "string" || analysis.trim() === "" || qid === null) {
    return { state };
  }
  if (state.phase === "drafting") {
    try {
      let next = await writeAnalysisToDraft(pi, ctx, state, analysis.trim());
      applied.push("analysis recorded in the draft file");
      const claims = await checkPlanCitations(ctx, analysis.trim());
      if (claims !== "") applied.push(claims);

      const fileContent = await readFile(draftFilePath(ctx.cwd, qid), "utf8");
      const sections = parseDraftSections(fileContent);
      const recalibrated = recalibrateQuestDifficulty(next, sections, fileContent);
      if (difficultyLevel(recalibrated) > difficultyLevel(next.difficulty)) {
        next = updateState((s) => ({ ...s, difficulty: recalibrated, snapshotPending: true }));
        applied.push(`complexity discovered mid-quest: task elevated to ${recalibrated}`);
      }
      applied.push(await profileForSavedDoc(ctx, qid));
      return { state: next };
    } catch (err) {
      return { state, error: err instanceof Error ? err.message : String(err) };
    }
  }
  if (state.phase === "validating") {
    return { state, error: "validating is write-free: address findings or pass {continueWork: true} to resume drafting." };
  }
  return { state, error: `cannot write analysis during phase ${state.phase}` };
}

export async function applyPlanRevisionParam(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ state: QuestState; error?: string }> {
  const revision = params["planRevision"];
  const note = typeof params["note"] === "string" ? params["note"] : "";
  if (typeof revision !== "string" || revision.trim() === "") return { state };
  if (state.phase !== "implementing") {
    return { state, error: `planRevision is only valid in implementing (phase ${state.phase})` };
  }
  if (state.qid === null) return { state, error: "cannot revise plan without an active quest" };
  try {
    const next = await writePlanRevision(
      pi,
      ctx,
      state,
      revision.trim(),
      typeof note === "string" ? note.trim() : "",
      params["objective"],
    );
    applied.push("plan revision staged in the draft file; re-review booted");
    const claims = await checkPlanCitations(ctx, revision.trim());
    if (claims !== "") applied.push(claims);
    noteDraftUpdated(ctx);
    return { state: next };
  } catch (err) {
    return { state, error: err instanceof Error ? err.message : String(err) };
  }
}
