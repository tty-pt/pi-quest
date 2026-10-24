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
import { classifyUserMessage } from "../subquests/triage";
import { readQuestConfig, type QuestConfig, DEFAULT_TRIGGER_PREFIXES } from "../config";
import { evaluateQuestIntent } from "./judge";

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

// Deprecated legacy heuristic check - kept for explicit opt-in compatibility
const QUEST_HEADER_PATTERNS = [
  /^#+\s*Quest\b/i,
  /\b(?:Objective|Deliverables|Scope change|Problem statement)\s*[:]/i,
];

const TASK_DIRECTIVE_PATTERN =
  /^(?:please\s+)?(?:rebuild|fix|implement|add|create|refactor|update|build|test|investigate|debug|diagnose|audit|reconcile|reproduce|port|remove|delete|clean|wire|hook|check|verify|migrate|configure|enhance|optimize|overhaul|resolve|make|author)\b/i;

const CASUAL_OR_NARRATIVE_PATTERN =
  /^(?:I\s+(?:spoke|talked|went|met|saw|found|felt|prefer|like|hate|dislike|think|told|visited|remember|recalled|was|am)|My\s+(?:grandfather|grandpa|grandmother|grandma|friend|cat|dog|dad|mom|father|mother|family)|Do\s+you\s+(?:remember|recall|know|think))\b/i;

export function isQuestLikeRequest(text: string): boolean {
  const trimmed = text.trim();
  if (CASUAL_OR_NARRATIVE_PATTERN.test(trimmed)) return false;
  if (QUEST_HEADER_PATTERNS.some((pat) => pat.test(trimmed))) return true;
  if (TASK_DIRECTIVE_PATTERN.test(trimmed)) return true;
  return false;
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
    const qid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));
    replaceState(createQuest(objective, qid));
    const context = extractRecentConversationContext(ctx);
    await ensureDraftFile(ctx, qid, qid, objective, context);
    emitNow(pi);
    sendSteer(
      pi,
      `New quest ${qid} opened via trigger '${trigger.prefix}': "${objective.slice(0, 200)}". Flow: (1) investigate, record findings via quest_update_state; ` +
        `(2) create the draft via quest_update_state {draftName} — the scaffold is already at .pi/quest/future/${qid}.md, no need to create directories; ` +
        `(3) author that file's ## Implementation Plan via quest_update_state {plan: ...} (preferred) or by editing it directly. During drafting the quest doc is the only writable file; during implementing and validating it is locked — revise the plan via quest_update_state {planRevision: ...} (peer-reviewed) and claim completion via quest_update_state {claimComplete: true}.`,
    );
    return true;
  }

  const kind = classifyUserMessage(trimmed);
  // Fast filter: explicit acks, confirmations, and short questions are never new quests
  if (kind === "ack" || kind === "confirmation") return false;
  if (kind === "question" && trimmed.length < 250) return false;

  // 2. Intelligent judge intent classification
  const decision = await evaluateQuestIntent(trimmed, cfg, ctx);
  if (!decision.isQuest) return false;

  const qid = nextQid(Date.now() / 1000, await listKnownQids(ctx.cwd));
  replaceState(createQuest(trimmed, qid));
  const context = extractRecentConversationContext(ctx);
  await ensureDraftFile(ctx, qid, qid, trimmed, context);
  emitNow(pi);
  sendSteer(
    pi,
    `New quest ${qid} opened as provisional: "${trimmed.slice(0, 200)}". Flow: (1) investigate, record findings via quest_update_state; ` +
      `(2) create the draft via quest_update_state {draftName} — the scaffold is already at .pi/quest/future/${qid}.md, no need to create directories; ` +
      `(3) author that file's ## Implementation Plan via quest_update_state {plan: ...} (preferred) or by editing it directly. During drafting the quest doc is the only writable file; during implementing and validating it is locked — revise the plan via quest_update_state {planRevision: ...} (peer-reviewed) and claim completion via quest_update_state {claimComplete: true}.`,
  );
  return true;
}

export function watchNewRequests(pi: Pi): void {
  onUserMessage(pi, (text, ctx) => {
    void detectSubstantiveRequest(pi, ctx, text);
  });
}
