// HIGH_LEVEL: #tools (main agent) — quest_update_state.
// HIGH_LEVEL: #plan revision — planRevision stages a re-reviewable revision. The agent's write path: findings, drafts, amendments, claims.
import { getState, updateState } from "../../app/store.ts";
import { emitNow } from "../../app/interpreter.ts";
import {
  recordAmendment,
  recordRefinement,
  type QuestDifficulty,
  type QuestKind,
} from "../../domain/quest.ts";
import { acknowledgeChild } from "../../domain/children.ts";
import { type Qid } from "../../domain/qid.ts";
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events.ts";
import { checkAnalysisParam, checkPlanParam } from "./draft-profile.ts";
import { textResult } from "./reply.ts";
import { readQuestConfig } from "../../config.ts";
import { evaluateQuestDifficulty } from "../../drafting/difficulty.ts";
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

export async function applyUpdate(
  pi: Pi,
  ctx: PiCtx,
  params: Record<string, unknown>,
): Promise<{ applied: string[]; error?: string }> {
  const applied: string[] = [];
  let state = getState();
  const kind = params["kind"];
  if (kind !== undefined && kind !== "standard" && kind !== "analysis") {
    return {
      applied,
      error: `unknown quest kind ${JSON.stringify(kind)} — expected "standard" or "analysis"`,
    };
  }
  // checkPlan/checkAnalysis: pure read-only probes (see draft-profile.ts) —
  // before any create path so they never side-create.
  const probe = await findDraftProfileProbe(ctx, params);
  if (probe !== undefined) return { applied: probe.applied, error: probe.error };
  if (state.qid === null) {
    const objective = params["objective"] ?? params["userPrompt"];
    if (typeof objective !== "string" || objective.trim() === "") {
      return { applied, error: "no active quest; pass objective to create one" };
    }
    const rawDiff = params["difficulty"];
    let difficulty: QuestDifficulty;
    if (rawDiff === "trivial" || rawDiff === "standard" || rawDiff === "complex") {
      difficulty = rawDiff;
    } else if (rawDiff !== undefined) {
      return {
        applied,
        error: `unknown difficulty ${JSON.stringify(rawDiff)} — expected "trivial", "standard", or "complex"`,
      };
    } else {
      const cfg = await readQuestConfig(ctx.cwd);
      const evalDiff = await evaluateQuestDifficulty((objective as string).trim(), cfg);
      difficulty = evalDiff.difficulty;
    }
    const qid = await provisionRootQuest(
      ctx,
      (objective as string).trim(),
      (kind as QuestKind) ?? "standard",
      difficulty,
    );
    state = getState();
    applied.push(`created quest ${qid}`);
  }
  const rawDiff = params["difficulty"];
  if (rawDiff !== undefined && state.qid) {
    if (rawDiff === "trivial" || rawDiff === "standard" || rawDiff === "complex") {
      state = updateState((s) => ({ ...s, difficulty: rawDiff, snapshotPending: true }));
      applied.push(`difficulty updated to ${rawDiff}`);
    } else {
      return {
        applied,
        error: `unknown difficulty ${JSON.stringify(rawDiff)} — expected "trivial", "standard", or "complex"`,
      };
    }
  }
  state = await provisionDraft(ctx, state, params, applied);
  const refinement = params["refinement"];
  if (typeof refinement === "string" && refinement.trim() !== "" && state.qid) {
    state = updateState((s) => recordRefinement(s, refinement.trim()));
    applied.push("refinement recorded");
  }
  const a = params["amendment"] as { change?: unknown; reasons?: unknown } | string | undefined;
  const change = typeof a === "string" ? a : typeof a?.change === "string" ? a.change : undefined;
  const reasons = (typeof a === "object" && typeof a?.reasons === "string" ? a.reasons : "") ?? "";
  if (typeof change === "string" && change.trim() !== "" && state.qid) {
    try {
      const qid = state.qid;
      state = updateState((s) => recordAmendment(s, change.trim(), reasons));
      applied.push("amendment recorded");
      await syncAmendmentsToDraft(ctx, qid, state.amendments);
    } catch (err) {
      return { applied, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const next = params["exactNextAction"];
  if (typeof next === "string" && next.trim() !== "" && state.qid) {
    state = updateState((s) => ({
      ...s,
      exactNextAction: (next as string).trim(),
      snapshotPending: true,
    }));
    applied.push("next action updated");
  }
  const planParam = await applyPlanParam(pi, ctx, state, params, applied);
  if (planParam.error !== undefined) return { applied, error: planParam.error };
  state = planParam.state;
  const analysisParam = await applyAnalysisParam(pi, ctx, state, params, applied);
  if (analysisParam.error !== undefined) return { applied, error: analysisParam.error };
  state = analysisParam.state;
  const revised = await applyPlanRevisionParam(pi, ctx, state, params, applied);
  if (revised.error !== undefined) return { applied, error: revised.error };
  state = revised.state;
  const continuePast = typeof params["continuePast"] === "string"
    ? params["continuePast"].trim()
    : "";
  if (continuePast && state.qid) {
    try {
      state = updateState((s) => acknowledgeChild(s, continuePast as Qid));
      applied.push(`continued past child ${continuePast}`);
    } catch (err) {
      return { applied, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const continued = await applyContinueWorkParam(pi, ctx, state, params, applied);
  if (continued.error !== undefined) return { applied, error: continued.error };
  state = continued.state;
  if (params["claimComplete"] === true && state.qid) {
    try {
      state = await claimForValidation(pi, ctx, state);
      applied.push("completion claimed; validator booting");
    } catch (err) {
      return { applied, error: err instanceof Error ? err.message : String(err) };
    }
    return { applied };
  }
  if (applied.length > 0) emitNow(pi);
  return { applied };
}

export function updateStateTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_update_state",
    label: "Update Quest State",
    description:
      "Record findings, drafts, amendments, and state. The agent's write path to the quest: pass objective to create, kind with \"analysis\" to mark a purely-analytical quest (deliverable is the ## Analysis; no implementation phase), draftName to draft, refinement/amendment/exactNextAction to record, plan to author the draft Implementation Plan section directly (drafting only, standard quests), analysis to author the draft Analysis section directly (drafting only, analysis quests), planRevision with an optional note to revise the approved plan mid-implementation (boots a re-review), checkPlan to preview the maturity profile of a would-be plan WITHOUT writing or booting a review (drafting only), checkAnalysis likewise for a would-be analysis, claimComplete to finish, continueWork to return a validating quest to a work phase.",
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string" },
        kind: {
          type: "string",
          description: "Quest kind on creation: \"standard\" (default) or \"analysis\".",
        },
        difficulty: {
          type: "string",
          description: "Quest difficulty tier: \"trivial\", \"standard\", or \"complex\".",
        },
        draftName: { type: "string" },
        refinement: { type: "string" },
        amendment: {
          type: "object",
          properties: {
            change: { type: "string" },
            reasons: { type: "string" },
          },
        },
        exactNextAction: { type: "string" },
        plan: {
          type: "string",
          description:
            "Implementation Plan body, spliced into the draft file (drafting only, standard quests).",
        },
        analysis: {
          type: "string",
          description:
            "Analysis body, spliced into the draft file (drafting only, analysis quests).",
        },
        planRevision: {
          type: "string",
          description:
            "Revised Implementation Plan body, staged from implementing (boots a re-review; objective unchanged).",
        },
        note: {
          type: "string",
          description: "Why the plan revision was needed; kept in the append-only history.",
        },
        claimComplete: { type: "boolean" },
        continueWork: {
          type: "boolean",
          description: "Return a validating quest to implementing to continue the work.",
        },
        continuePast: {
          type: "string",
          description: "Returned child qid to explicitly continue past.",
        },
        checkPlan: {
          type: "string",
          description:
            "Preview the draft profile (requirements/evidence counts, maturity-bar verdict, citation resolution) for a would-be plan body — read-only, no save, no review boot (drafting only).",
        },
        checkAnalysis: {
          type: "string",
          description:
            "Preview the draft profile for a would-be analysis body — read-only, no save, no review boot (drafting only, analysis quests).",
        },
      },
      additionalProperties: false,
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const res = await applyUpdate(pi, ctx, params);
      const message = res.applied.length > 0
        ? `Updated: ${res.applied.join("; ")}.`
        : "No state updates applied.";
      if (res.error) {
        return textResult(
          res.applied.length > 0 ? `${message} Error: ${res.error}` : `Error: ${res.error}`,
          {
            applied: res.applied,
            error: res.error,
          },
        );
      }
      return textResult(message, { applied: res.applied });
    },
  };
}
