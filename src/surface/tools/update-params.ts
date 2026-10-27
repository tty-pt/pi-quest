// HIGH_LEVEL: #tools (main agent) — quest_update_state parameter processing and provisioning.
// Separated from update-state.ts to maintain safe complexity margins (<350 LOC).
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getState, replaceState, updateState } from "../../app/store.ts";
import { emitNow, sendSteer } from "../../app/interpreter.ts";
import {
  createQuest,
  markChanged,
  recordAmendment,
  type Amendment,
  type QuestDifficulty,
  type QuestKind,
  type QuestState,
} from "../../domain/quest.ts";
import {
  claimComplete,
  createDraft,
  demoteToDrafting,
  demoteToImplementing,
} from "../../domain/transitions.ts";
import { unfinishedChildren } from "../../domain/children.ts";
import { nextQid, type Qid } from "../../domain/qid.ts";
import { draftPath } from "../../domain/paths.ts";
import type { Pi, PiCtx } from "../../hooks/events.ts";
import { ensureValidationFlow } from "../../validation/flow.ts";
import {
  assertCompletionEligibility,
  getLatestTestExecution,
} from "../../validation/evidence-gate.ts";
import { profileForSavedDoc } from "./draft-profile.ts";
import { checkPlanCitations } from "./claims.ts";
import {
  carryRefinementsToDraft,
  writeAnalysisToDraft,
  writePlanRevision,
  writePlanToDraft,
} from "./draft-writer.ts";
import { hashContent, spliceAmendmentsSection } from "../../drafting/plan-text.ts";
import { extractRecentConversationContext } from "../../durability/transcript.ts";
import { setDocStatus } from "../../durability/quest-doc-io.ts";
import { noteDraftUpdated } from "../../durability/status.ts";
import { ensureDraftFile, listKnownQids } from "../../files.ts";

export async function syncAmendmentsToDraft(
  ctx: PiCtx,
  qid: Qid,
  amendments: Amendment[],
): Promise<void> {
  const filePath = join(ctx.cwd, draftPath(qid));
  if (!existsSync(filePath)) return;
  try {
    const content = await readFile(filePath, "utf8");
    const formatted = amendments.map((a) => `${a.change} (${a.reasons})`);
    const updated = spliceAmendmentsSection(content, formatted);
    if (updated !== content) {
      await writeFile(filePath, updated, "utf8");
      const hash = hashContent(updated);
      updateState((s) =>
        s.draft === null
          ? s
          : { ...s, draft: { ...s.draft, contentHash: hash }, snapshotPending: true }
      );
    }
  } catch {
    // Best-effort sync to draft doc
  }
}

export async function provisionRootQuest(
  ctx: PiCtx,
  objective: string,
  kind: QuestKind = "standard",
  difficulty: QuestDifficulty = "standard",
): Promise<Qid> {
  const qid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));
  const base = createQuest(objective, qid, null, difficulty);
  replaceState(markChanged(base, { kind, difficulty }));
  const context = extractRecentConversationContext(ctx);
  await ensureDraftFile(ctx, qid, qid, objective, context, difficulty);
  return qid;
}

export async function claimForValidation(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
): Promise<QuestState> {
  if (state.phase !== "implementing") {
    throw new Error(`cannot claim completion from phase ${state.phase}`);
  }
  const qid = state.qid;
  if (qid === null) {
    throw new Error("cannot claim completion without an active quest");
  }
  const unfinished = unfinishedChildren(state);
  if (unfinished.length > 0) {
    throw new Error(
      `complete blocked: unfinished children ${unfinished.map((c) => c.qid).join(", ")}`,
    );
  }

  const hasGit = existsSync(join(ctx.cwd, ".git"));

  if (hasGit) {
    const runGitDiff = async (...args: string[]) => {
      for (const ref of ["HEAD", "HEAD~1"]) {
        try {
          const res = (await pi.exec("git", ["diff", ...args, ref], { cwd: ctx.cwd })) as
            | { code?: number; exitCode?: number; stdout?: string; output?: string }
            | undefined;
          const out = res?.stdout ?? res?.output ?? "";
          if ((res?.code ?? res?.exitCode) === 0 && out.trim().length > 0) return out;
        } catch { /* continue */ }
      }
      return "";
    };
    await assertCompletionEligibility(state, {
      getDiffStat: () => runGitDiff("--stat"),
      getDiffPatch: () => runGitDiff(),
      getLatestTest: () => state.lastTestReceipt ?? getLatestTestExecution(),
    });
  }

  const claimed = updateState((s) => claimComplete(s));
  await setDocStatus(ctx, qid, "validating", false);
  emitNow(pi);
  sendSteer(
    pi,
    `Quest ${claimed.qid} claimed complete. Validator booting against the approved plan.`,
  );
  void ensureValidationFlow(pi, ctx);
  return getState();
}

export async function provisionDraft(
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<QuestState> {
  const draftName = params["draftName"];
  if (
    typeof draftName !== "string" || draftName.trim() === "" ||
    state.phase !== "provisional" || state.qid === null
  ) {
    return state;
  }
  const qid = state.qid;
  const name = draftName.trim();
  const plan = params["plan"];
  const kind = params["kind"] === "analysis" ? "analysis" : "standard";
  const analysis = kind === "analysis";
  const thin = state.refinements.length === 0 &&
    ((typeof plan !== "string" || plan.trim() === "") && !analysis);
  state = createDraft(state, name, kind);
  replaceState(state);
  await ensureDraftFile(ctx, qid, name, state.objective, undefined, state.difficulty);
  state = await carryRefinementsToDraft(ctx, getState());
  applied.push(`draft ${name} created at ${draftPath(qid)} — edit ONLY this file`);
  if (thin) {
    applied.push(
      "draft created thin — no findings recorded yet; file them via refinement or author the plan via {plan:}. A draft becomes reviewable at the maturity bar: 2 requirements, or 1 requirement + 7 evidence, with an actionable plan. Use {checkPlan: \"<plan body>\"} to preview the profile without booting a review.",
    );
  }
  if (analysis) {
    applied.push(
      "analysis quest — author the deliverable via {analysis: \"<body>\"} or by editing the ## Analysis section, and use {checkAnalysis: \"<body>\"} to preview the profile without booting a review.",
    );
  }
  noteDraftUpdated(ctx);
  return state;
}

export async function applyPlanParam(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ state: QuestState; error?: string }> {
  const plan = params["plan"];
  const planQid = state.qid;
  if (typeof plan !== "string" || plan.trim() === "" || planQid === null) {
    return { state };
  }
  try {
    const next = await writePlanToDraft(pi, ctx, state, plan.trim());
    applied.push("plan recorded in the draft file");
    const claims = await checkPlanCitations(ctx, plan.trim());
    if (claims !== "") applied.push(claims);
    const docAfter = await readFile(join(ctx.cwd, draftPath(planQid)), "utf8");
    applied.push(await profileForSavedDoc(ctx, docAfter, state.kind));
    return { state: next };
  } catch (err) {
    return { state, error: err instanceof Error ? err.message : String(err) };
  }
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
  try {
    const next = await writeAnalysisToDraft(pi, ctx, state, analysis.trim());
    applied.push("analysis recorded in the draft file");
    const claims = await checkPlanCitations(ctx, analysis.trim());
    if (claims !== "") applied.push(claims);
    const docAfter = await readFile(join(ctx.cwd, draftPath(qid)), "utf8");
    applied.push(await profileForSavedDoc(ctx, docAfter, state.kind));
    return { state: next };
  } catch (err) {
    return { state, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyPlanRevisionParam(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ state: QuestState; error?: string }> {
  const revision = params["planRevision"];
  if (typeof revision !== "string" || revision.trim() === "" || !state.qid) {
    return { state };
  }
  try {
    const note = params["note"];
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
    return { state: next };
  } catch (err) {
    return { state, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function applyContinueWorkParam(
  pi: Pi,
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ state: QuestState; error?: string }> {
  if (params["continueWork"] !== true || !state.qid) return { state };
  try {
    const qid = state.qid;
    const isAnalysis = state.kind === "analysis";
    const next = updateState((s) =>
      isAnalysis ? demoteToDrafting(s) : demoteToImplementing(s)
    );
    await setDocStatus(ctx, qid, isAnalysis ? "drafting" : "implementing", false);
    applied.push(
      isAnalysis
        ? "returned to drafting to revise the delivered analysis"
        : "returned to implementing to continue the work",
    );
    return { state: next };
  } catch (err) {
    return { state, error: err instanceof Error ? err.message : String(err) };
  }
}
