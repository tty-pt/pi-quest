// HIGH_LEVEL: #quest creation — created automatically when the user requests
// and no quest is active. The request becomes the initial objective and scope.
import { getState, replaceState } from "../app/store";
import { emitNow, sendSteer } from "../app/interpreter";
import { createQuest } from "../domain/quest";
import { nextQid } from "../domain/qid";
import { ensureDraftFile, listKnownQids } from "../files";
import { extractRecentConversationContext } from "../durability/transcript";
import type { Pi, PiCtx } from "../hooks/events";
import { onUserMessage } from "../hooks/events";
import { parseExplicitSyntax } from "../domain/intent";
import { readQuestConfig, type QuestConfig, DEFAULT_TRIGGER_PREFIXES } from "../config";
import { evaluateQuestIntent, evaluateQuestKind } from "./judge";
import { evaluateQuestDifficulty } from "./difficulty";

export function matchTriggerPrefix(
  text: string,
  prefixes: string[] = DEFAULT_TRIGGER_PREFIXES,
): { matched: boolean; prefix?: string; objective: string } {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  for (const p of prefixes) {
    const pLower = p.toLowerCase();
    if (lower.startsWith(pLower)) {
      let rest = trimmed.slice(p.length).trim();
      // Handle optional leading colon, dash, or whitespace: e.g. "quest: foo", "quest:foo", "@quest foo"
      rest = rest.replace(/^[:\-\s]+/, "").trim();
      return { matched: true, prefix: p, objective: rest || trimmed };
    }
  }

  return { matched: false, objective: trimmed };
}

// Judge-less structural check: only an explicitly pasted quest document counts.
// Free-form wording is never guessed at; without a judge, use a trigger prefix
// or /quest.
const QUEST_HEADER_PATTERN = /^#+\s*Quest\b/i;

export function isQuestLikeRequest(text: string): boolean {
  return QUEST_HEADER_PATTERN.test(text.trim());
}

export async function detectSubstantiveRequest(
  pi: Pi,
  ctx: PiCtx,
  text: string,
  config?: QuestConfig,
): Promise<boolean> {
  if (getState().qid !== null) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith("/")) return false;

  const cfg = config ?? await readQuestConfig(ctx.cwd);

  // 1. Explicit deterministic trigger word families (fast & unambiguous)
  const trigger = matchTriggerPrefix(trimmed, cfg.triggerPrefixes);
  if (trigger.matched) {
    const objective = trigger.objective;
    const [diff, kind] = await Promise.all([
      evaluateQuestDifficulty(objective, cfg),
      evaluateQuestKind(objective, cfg),
    ]);
    const qid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));
    replaceState(createQuest(objective, qid, null, diff.difficulty, kind));
    const context = extractRecentConversationContext(ctx);
    await ensureDraftFile(ctx, qid, qid, objective, context, diff.difficulty);
    emitNow(pi);
    const complexHint = diff.difficulty === "complex"
      ? " For complex tasks, decompose work into bounded sub-quests in ## Sub-Quests (e.g. - [ ] SQ1: Phase goal [paths: ...] [tests: ...])."
      : "";
    sendSteer(
      pi,
      `New quest ${qid} (kind: ${kind}, difficulty: ${diff.difficulty}) opened via trigger '${trigger.prefix}': "${objective.slice(0, 200)}". Flow: (1) investigate, record findings via quest_update_state; ` +
        `(2) create the draft via quest_update_state {draftName} — the scaffold is already at .pi/quest/future/${qid}.md, no need to create directories; ` +
        `(3) author that file's ## Implementation Plan via quest_update_state {plan: ...} (preferred) or by editing it directly.${complexHint} During drafting the quest doc is the only writable file; during implementing and validating it is locked — revise the plan via quest_update_state {planRevision: ...} (peer-reviewed) and claim completion via quest_update_state {claimComplete: true}. (Hint: the operator can reply "go" or "proceed" at any point to skip plan review and start coding immediately).`,
    );
    return true;
  }

  // Explicit chat sigils ("? ", !chat) are never new quests.
  const explicit = parseExplicitSyntax(trimmed);
  if (explicit !== null && explicit.kind === "chat") return false;

  // The judge decides (any language); structural header check is the judge-less fallback.
  let isQuest = isQuestLikeRequest(trimmed);
  if (!isQuest) {
    const decision = await evaluateQuestIntent(trimmed, cfg, ctx);
    isQuest = decision.isQuest;
  }

  if (!isQuest) return false;

  const [diff, kind] = await Promise.all([
    evaluateQuestDifficulty(trimmed, cfg),
    evaluateQuestKind(trimmed, cfg),
  ]);
  const qid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));
  replaceState(createQuest(trimmed, qid, null, diff.difficulty, kind));
  const context = extractRecentConversationContext(ctx);
  await ensureDraftFile(ctx, qid, qid, trimmed, context, diff.difficulty);
  emitNow(pi);
  const complexHint = diff.difficulty === "complex"
    ? " For complex tasks, decompose work into bounded sub-quests in ## Sub-Quests (e.g. - [ ] SQ1: Phase goal [paths: ...] [tests: ...])."
    : "";
  sendSteer(
    pi,
    `New quest ${qid} (kind: ${kind}, difficulty: ${diff.difficulty}) opened as provisional: "${trimmed.slice(0, 200)}". Flow: (1) investigate, record findings via quest_update_state; ` +
      `(2) create the draft via quest_update_state {draftName} — the scaffold is already at .pi/quest/future/${qid}.md, no need to create directories; ` +
      `(3) author that file's ## Implementation Plan via quest_update_state {plan: ...} (preferred) or by editing it directly.${complexHint} During drafting the quest doc is the only writable file; during implementing and validating it is locked — revise the plan via quest_update_state {planRevision: ...} (peer-reviewed) and claim completion via quest_update_state {claimComplete: true}. (Hint: the operator can reply "go" or "proceed" at any point to skip plan review and start coding immediately).`,
  );
  return true;
}

export function watchNewRequests(pi: Pi): void {
  onUserMessage(pi, (text, ctx) => {
    void detectSubstantiveRequest(pi, ctx, text);
  });
}
