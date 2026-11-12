// HIGH_LEVEL: #tools (main agent) — quest_update_state.
// HIGH_LEVEL: #plan revision — planRevision stages a re-reviewable revision. The agent's write path: findings, drafts, amendments, claims.
import { getState, updateState } from "../../app/store.ts";
import { emitNow } from "../../app/interpreter.ts";
import {
  disengageCircuitBreaker,
  recordAmendment,
  recordRefinement,
  type QuestDifficulty,
  type QuestKind,
  type QuestState,
} from "../../domain/quest.ts";
import { acknowledgeChild, settleChild } from "../../domain/children.ts";
import { type Qid } from "../../domain/qid.ts";
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events.ts";
import { checkAnalysisParam, checkPlanParam } from "./draft-profile.ts";
import { textResult } from "./reply.ts";
import { readQuestConfig } from "../../config.ts";
import { evaluateQuestDifficulty } from "../../drafting/difficulty.ts";
import { commitMilestone, findPrimaryRepoRoot } from "../../utils/git";
import {
  applyAnalysisParam,
  applyContinueWorkParam,
  applyPlanParam,
  applyPlanRevisionParam,
  claimForValidation,
  provisionDraft,
  provisionRootQuest,
  syncAmendmentsToDraft,
} from "./update-params.ts";

async function findDraftProfileProbe(ctx: PiCtx, params: Record<string, unknown>) {
  const probes = await Promise.all([
    checkPlanParam(ctx, params),
    checkAnalysisParam(ctx, params),
  ]);
  return probes.find((p) => p.applied.length > 0 || p.error !== undefined);
}

function parseDifficulty(raw: unknown): QuestDifficulty | null {
  if (raw === "trivial" || raw === "minor" || raw === "standard" || raw === "major" || raw === "complex") {
    return raw;
  }
  return null;
}

async function handleCreation(
  ctx: PiCtx,
  params: Record<string, unknown>,
  kind: unknown,
  applied: string[],
): Promise<{ error?: string }> {
  const objective = params["objective"] ?? params["userPrompt"];
  if (typeof objective !== "string" || objective.trim() === "") {
    return { error: "no active quest; pass objective to create one" };
  }
  const rawDiff = params["difficulty"];
  let difficulty: QuestDifficulty;
  if (rawDiff !== undefined) {
    const parsed = parseDifficulty(rawDiff);
    if (!parsed) return { error: `unknown difficulty ${JSON.stringify(rawDiff)} — expected "trivial", "minor", "standard", "major", or "complex"` };
    difficulty = parsed;
  } else {
    const cfg = await readQuestConfig(ctx.cwd);
    const evalDiff = await evaluateQuestDifficulty((objective as string).trim(), cfg);
    difficulty = evalDiff.difficulty;
  }
  const qid = await provisionRootQuest(ctx, (objective as string).trim(), (kind as QuestKind) ?? "standard", difficulty);
  applied.push(`created quest ${qid}`);
  return {};
}

async function handleDirectives(
  ctx: PiCtx,
  params: Record<string, unknown>,
  applied: string[],
): Promise<void> {
  const refinement = params["refinement"];
  if (typeof refinement === "string" && refinement.trim() !== "" && getState().qid) {
    updateState((s) => recordRefinement(s, refinement.trim()));
    applied.push("refinement recorded");
  }
  const a = params["amendment"] as { change?: unknown; reasons?: unknown } | string | undefined;
  const change = typeof a === "string" ? a : typeof a?.change === "string" ? a.change : undefined;
  const reasons = (typeof a === "object" && typeof a?.reasons === "string" ? a.reasons : "") ?? "";
  const current = getState();
  if (typeof change === "string" && change.trim() !== "" && current.qid) {
    try {
      const qid = current.qid;
      updateState((s) => recordAmendment(s, change.trim(), reasons));
      applied.push("amendment recorded");
      await syncAmendmentsToDraft(ctx, qid, getState().amendments);
    } catch { /* best-effort sync */ }
  }
  const exactNextAction = params["exactNextAction"];
  if (typeof exactNextAction === "string" && exactNextAction.trim() !== "" && getState().qid) {
    updateState((s) => ({ ...s, exactNextAction: exactNextAction.trim(), snapshotPending: true }));
    applied.push("exactNextAction updated");
  }

  const ms = params["milestone"] as { label?: unknown; reqId?: unknown; details?: unknown } | string | undefined;
  const msLabel = typeof ms === "string" ? ms : typeof ms?.label === "string" ? ms.label : undefined;
  if (typeof msLabel === "string" && msLabel.trim() !== "" && current.qid) {
    const qid = current.qid;
    const wtPath = current.worktreePath ?? current.contract?.worktreePath ?? findPrimaryRepoRoot(ctx.cwd);
    const msResult = await commitMilestone(wtPath, {
      qid,
      type: "requirement",
      label: msLabel.trim(),
      reqId: typeof ms === "object" && typeof ms?.reqId === "string" ? ms.reqId.trim() : undefined,
      details: typeof ms === "object" && typeof ms?.details === "string" ? ms.details.trim() : undefined,
    });
    const msReqId = typeof ms === "object" && typeof ms?.reqId === "string" ? ms.reqId.trim() : undefined;
    if (msResult.ok && msResult.commitHash) {
      updateState((s) => ({
        ...s,
        milestoneCommits: [
          ...(s.milestoneCommits ?? []),
          { hash: msResult.commitHash!, label: msLabel.trim(), timestamp: new Date().toISOString() },
        ],
        rtm: msReqId && s.rtm
          ? s.rtm.map((r) => r.id.toLowerCase() === msReqId.toLowerCase() ? { ...r, status: "satisfied" as const } : r)
          : s.rtm,
        snapshotPending: true,
      }));
      applied.push(`milestone commit ${msResult.commitHash.slice(0, 7)} recorded`);
    } else if (msResult.skipped) {
      applied.push("milestone noted (no file changes to commit)");
    }
  }

  const satisfiedReqs = params["satisfiedRequirements"];
  if (Array.isArray(satisfiedReqs) && current.rtm) {
    const set = new Set(satisfiedReqs.map((s) => String(s).toLowerCase().trim()));
    updateState((s) => ({
      ...s,
      rtm: s.rtm ? s.rtm.map((r) => set.has(r.id.toLowerCase()) ? { ...r, status: "satisfied" as const } : r) : s.rtm,
      snapshotPending: true,
    }));
    applied.push(`marked requirements satisfied: ${satisfiedReqs.join(", ")}`);
  }
}

async function handleAuthoring(
  pi: Pi,
  ctx: PiCtx,
  params: Record<string, unknown>,
  applied: string[],
): Promise<{ error?: string }> {
  let state = getState();
  const planParam = await applyPlanParam(pi, ctx, state, params, applied);
  if (planParam.error !== undefined) return { error: planParam.error };
  state = planParam.state;

  const analysisParam = await applyAnalysisParam(pi, ctx, state, params, applied);
  if (analysisParam.error !== undefined) return { error: analysisParam.error };
  state = analysisParam.state;

  const revisionParam = await applyPlanRevisionParam(pi, ctx, state, params, applied);
  if (revisionParam.error !== undefined) return { error: revisionParam.error };
  state = revisionParam.state;

  const continueParam = await applyContinueWorkParam(pi, ctx, state, params, applied);
  state = continueParam.state;

  const continuePast = params["continuePast"];
  if (typeof continuePast === "string" && continuePast.trim() !== "") {
    const targetQid = continuePast.trim() as Qid;
    try {
      state = updateState((s) => settleChild(acknowledgeChild(s, targetQid), targetQid, "returned", null));
      applied.push(`continued past returned child ${targetQid}`);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (params["claimComplete"] === true && state.phase === "implementing") {
    try {
      state = await claimForValidation(pi, ctx, state);
      applied.push("completion claimed; validator booting");
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return {};
}

export async function applyUpdate(
  pi: Pi,
  ctx: PiCtx,
  params: Record<string, unknown>,
): Promise<{ applied: string[]; error?: string }> {
  const applied: string[] = [];
  if (getState().disabled === true) {
    return {
      applied,
      error: "pi-quest is paused for this session (/quest pause). Do not call quest_update_state; work directly in the normal workflow.",
    };
  }
  const kind = params["kind"];
  if (kind !== undefined && kind !== "standard" && kind !== "analysis") {
    return { applied, error: `unknown quest kind ${JSON.stringify(kind)} — expected "standard" or "analysis"` };
  }

  const probe = await findDraftProfileProbe(ctx, params);
  if (probe !== undefined) return { applied: probe.applied, error: probe.error };

  if (getState().qid === null) {
    const creation = await handleCreation(ctx, params, kind, applied);
    if (creation.error) return { applied, error: creation.error };
  }

  const rawDiff = params["difficulty"];
  if (rawDiff !== undefined && getState().qid) {
    const parsed = parseDifficulty(rawDiff);
    if (!parsed) return { applied, error: `unknown difficulty ${JSON.stringify(rawDiff)} — expected "trivial", "minor", "standard", "major", or "complex"` };
    updateState((s) => ({ ...s, difficulty: parsed, snapshotPending: true }));
    applied.push(`difficulty updated to ${parsed}`);
  }

  const draftRes = await provisionDraft(ctx, getState(), params, applied);
  await handleDirectives(ctx, params, applied);
  const authoring = await handleAuthoring(pi, ctx, params, applied);
  if (authoring.error) return { applied, error: authoring.error };

  if (applied.length > 0) {
    updateState((s) => disengageCircuitBreaker(s));
    emitNow(pi);
  }
  return { applied };
}

function formatResultLines(result: { content?: Array<{ type: string; text?: string }>; details?: unknown }, theme?: unknown): string[] {
  const applied = ((result.details as Record<string, unknown> | undefined)?.["applied"] as string[]) ?? [];
  const err = (result.details as Record<string, unknown> | undefined)?.["error"] as string | undefined;
  const th = (theme && typeof (theme as { fg: (k: string, s: string) => string }).fg === "function") ? (theme as { fg: (k: string, s: string) => string }) : null;
  const lines: string[] = [];
  for (const item of applied) {
    lines.push(th ? th.fg("success", `✓ ${item}`) : `✓ ${item}`);
  }
  if (err) {
    lines.push(th ? th.fg("error", `✗ ${err}`) : `✗ ${err}`);
  }
  return lines.length > 0 ? lines : [result.content?.[0]?.text ?? ""];
}

export function formatProgressCard(state: QuestState): string {
  if (state.qid === null) return "";
  const rtmInfo = state.rtm && state.rtm.length > 0
    ? `RTM: ${state.rtm.filter((r) => r.status === "satisfied" || r.status === "verified").length}/${state.rtm.length}`
    : "RTM: none";
  const touchedInfo = state.touchedFiles && state.touchedFiles.length > 0
    ? `Files: ${state.touchedFiles.length}`
    : "Files: 0";
  const testInfo = state.lastPassingTestReceipt && state.lastPassingTestReceipt.exitCode === 0
    ? "Tests: PASS ✓"
    : "Tests: pending";

  return `\n[Quest ${state.qid} | ${state.phase} | ${state.difficulty}]\n  • ${rtmInfo}  • ${touchedInfo}  • ${testInfo}`;
}

export function updateStateTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_update_state",
    label: "Update Quest State",
    description:
      "Record findings, drafts, amendments, and state. The agent's write path to the quest: pass objective to create, kind with \"analysis\" to mark a purely-analytical quest (deliverable is the ## Analysis; no implementation phase), draftName to draft, refinement/amendment/exactNextAction to record, plan to author the draft Implementation Plan section directly (drafting only, standard quests), analysis to author the draft Analysis section directly (drafting only, analysis quests), planRevision with an optional note to revise the approved plan mid-implementation (boots a re-review), checkPlan to preview the maturity profile of a would-be plan WITHOUT writing or booting a review (drafting only), checkAnalysis likewise for a would-be analysis, claimComplete to finish, continueWork to return a validating quest to a work phase.",
    renderResult: (result, _options, theme) => ({
      render: (_width: number) => formatResultLines(result, theme),
      invalidate: () => {},
    }),
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        kind: { type: "string", description: "Quest kind on creation: \"standard\" (default) or \"analysis\"." },
        difficulty: { type: "string", description: "Quest difficulty tier: \"trivial\", \"minor\", \"standard\", \"major\", or \"complex\"." },
        draftName: { type: "string" },
        refinement: { type: "string" },
        amendment: { type: "object", properties: { change: { type: "string" }, reasons: { type: "string" } } },
        exactNextAction: { type: "string" },
        satisfiedRequirements: { type: "array", items: { type: "string" }, description: "Requirement IDs (e.g. ['R1', 'R2']) to mark satisfied." },
        milestone: {
          type: "object",
          description: "Record and commit an achievement milestone to the feature branch.",
          properties: {
            label: { type: "string", description: "Milestone achievement summary." },
            reqId: { type: "string", description: "Requirement ID (e.g. 'R1', 'R2')." },
            details: { type: "string", description: "Optional detailed commit notes." },
          },
        },
        plan: { type: "string", description: "Implementation Plan body, spliced into the draft file (drafting only, standard quests)." },
        analysis: { type: "string", description: "Analysis body, spliced into the draft file (drafting only, analysis quests)." },
        planRevision: { type: "string", description: "Revised Implementation Plan body, staged from implementing (boots a re-review; objective unchanged)." },
        note: { type: "string", description: "Why the plan revision was needed; kept in the append-only history." },
        claimComplete: { type: "boolean" },
        continueWork: { type: "boolean", description: "Return a validating quest to implementing to continue the work." },
        continuePast: { type: "string", description: "Returned child qid to explicitly continue past." },
        checkPlan: { type: "string", description: "Preview the draft profile (requirements/evidence counts, maturity-bar verdict, citation resolution) for a would-be plan body — read-only, no save, no review boot (drafting only)." },
        checkAnalysis: { type: "string", description: "Preview the draft profile for a would-be analysis body — read-only, no save, no review boot (drafting only, analysis quests)." },
      },
      additionalProperties: false,
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const res = await applyUpdate(pi, ctx, params);
      const activeState = getState();
      const card = formatProgressCard(activeState);
      const baseMessage = res.applied.length > 0 ? `Updated: ${res.applied.join("; ")}.` : "No state updates applied.";
      const message = `${baseMessage}${card}`;
      if (res.error) {
        return textResult(res.applied.length > 0 ? `${message} Error: ${res.error}` : `Error: ${res.error}`, { applied: res.applied, error: res.error });
      }
      return textResult(message, { applied: res.applied });
    },
  };
}
