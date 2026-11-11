import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { getState, replaceState, updateState } from "../../../app/store.ts";
import {
  createQuest,
  markChanged,
  type Amendment,
  type QuestDifficulty,
  type QuestKind,
  type QuestState,
} from "../../../domain/quest.ts";
import { createDraft } from "../../../domain/transitions.ts";
import { nextQid, type Qid } from "../../../domain/qid.ts";
import { draftPath } from "../../../domain/paths.ts";
import { draftFilePath } from "../../../files.ts";
import type { PiCtx } from "../../../hooks/events.ts";
import { dedupeDocBullets } from "../../../domain/dedupe.ts";
import { hashContent, spliceAmendmentsSection } from "../../../drafting/plan-text.ts";
import { extractRecentConversationContext } from "../../../durability/transcript.ts";
import { noteDraftUpdated } from "../../../durability/status.ts";
import { ensureDraftFile, listKnownQids } from "../../../files.ts";
import { fetchActiveInvariants, formatInvariantsComment } from "../../invariants.ts";
import { carryRefinementsToDraft } from "../draft-writer.ts";

export async function syncAmendmentsToDraft(
  ctx: PiCtx,
  qid: Qid,
  amendments: Amendment[],
): Promise<void> {
  const filePath = draftFilePath(ctx.cwd, qid);
  if (!existsSync(filePath)) return;
  try {
    const content = await readFile(filePath, "utf8");
    const formatted = amendments.map((a) => `${a.change} (${a.reasons})`);
    const updated = dedupeDocBullets(spliceAmendmentsSection(content, formatted)).text;
    if (updated !== content) {
      await writeFile(filePath, updated, "utf8");
      const hash = hashContent(updated);
      updateState((s) =>
        s.draft === null ? s : { ...s, draft: { ...s.draft, contentHash: hash }, snapshotPending: true }
      );
    }
  } catch { /* best-effort sync */ }
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
  const invariants = await fetchActiveInvariants(ctx.cwd);
  const invBlock = formatInvariantsComment(invariants);
  await ensureDraftFile(ctx, qid, qid, objective, context, difficulty, invBlock);
  return qid;
}

export async function provisionDraft(
  ctx: PiCtx,
  state: QuestState,
  params: Record<string, unknown>,
  applied: string[],
): Promise<QuestState> {
  const plan = params["plan"];
  const analysisParam = params["analysis"];
  const explicitDraftName = params["draftName"];
  const draftName =
    typeof explicitDraftName === "string" && explicitDraftName.trim() !== ""
      ? explicitDraftName.trim()
      : ((typeof plan === "string" && plan.trim() !== "") || (typeof analysisParam === "string" && analysisParam.trim() !== "")
        ? (state.name || state.qid || "draft")
        : undefined);

  if (
    draftName === undefined ||
    state.phase !== "provisional" || state.qid === null
  ) {
    return state;
  }
  const qid = state.qid;
  const name = draftName;
  const kind = params["kind"] === "analysis" ? "analysis" : "standard";
  const analysis = kind === "analysis";
  const thin = state.refinements.length === 0 &&
    ((typeof plan !== "string" || plan.trim() === "") && !analysis);

  let next = createDraft(state, name, kind);
  replaceState(next);
  const invariants = await fetchActiveInvariants(ctx.cwd);
  const invBlock = formatInvariantsComment(invariants);
  await ensureDraftFile(ctx, qid, name, next.objective, undefined, next.difficulty, invBlock);
  next = await carryRefinementsToDraft(ctx, getState());

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
  return next;
}
