import type { QuestConfig } from "../config";
import {
  clearNearestIndexes,
  type Exemplar,
  gate,
  mergeExemplars,
  nearestExemplar,
} from "./nearest";
import { DEFAULT_INTENT_EXEMPLARS } from "../domain/intent-exemplars";
import {
  FALLBACK_ADVANCE_WORD,
  isFallbackAdvance,
  normalizeSteeringText,
  parseExplicitSyntax,
  parseLeadingAdvance,
  type UserIntent,
  type UserIntentKind,
} from "../domain/intent";

const MAX_QUESTION_CHARS = 160;
const MAX_JUDGED_CHARS = 500;

const ACTIONABLE: ReadonlySet<string> = new Set([
  "advance",
  "abort",
  "constraint",
  "subquest_now",
  "subquest_later",
  "handoff",
]);

function fallbackIntent(text: string, cfg: QuestConfig): UserIntent {
  const trimmed = text.trim();
  const leading = parseLeadingAdvance(trimmed, cfg.steeringPhrases);
  if (leading.isAdvance) return { kind: "advance", cleanText: leading.remainder, source: "fallback" };
  if (trimmed.endsWith("?") && trimmed.length < MAX_QUESTION_CHARS) return { kind: "question", cleanText: trimmed, source: "fallback" };
  return { kind: "refinement", cleanText: trimmed, source: "fallback" };
}

const MEMO_TTL_MS = 15_000;
const MEMO_MAX = 32;
const memo = new Map<string, { at: number; value: Promise<UserIntent> }>();

export function clearIntentMemo(): void {
  memo.clear();
}

const EMBED_KINDS: ReadonlySet<string> = new Set<UserIntentKind>([
  "advance", "abort", "constraint", "subquest_now", "subquest_later", "question", "ack", "handoff", "refinement",
]);

/** Shipped exemplars plus the operator's, de-duplicated, restricted to known kinds. */
export function mergedExemplars(cfg: QuestConfig): Exemplar[] {
  return mergeExemplars(DEFAULT_INTENT_EXEMPLARS, cfg.intentExemplars, EMBED_KINDS);
}

export function clearExemplarIndexes(): void {
  clearNearestIndexes();
}

/**
 * Nearest-exemplar verdict, or null when embeddings are unavailable. State-changing
 * kinds need `intentMinSimilarity` AND a margin of `intentMinMargin` over the best
 * other kind; everything weaker is a refinement.
 */
async function classifyByEmbedding(text: string, cfg: QuestConfig): Promise<UserIntentKind | null> {
  const verdict = await nearestExemplar(cfg, mergedExemplars(cfg), text);
  if (verdict === null) return null;
  return gate(verdict, {
    minSimilarity: cfg.intentMinSimilarity,
    minMargin: cfg.intentMinMargin,
    harmless: "refinement",
    actionable: ACTIONABLE,
  }) as UserIntentKind;
}

async function interpret(text: string, phase: string, cfg: QuestConfig): Promise<UserIntent> {
  const trimmed = text.trim();
  const explicit = parseExplicitSyntax(trimmed);
  if (explicit !== null) return explicit;
  const leading = parseLeadingAdvance(trimmed, cfg.steeringPhrases);
  if (leading.isAdvance) return { kind: "advance", cleanText: leading.remainder, source: "fallback" };
  if (trimmed.length <= MAX_JUDGED_CHARS) {
    const embedded = await classifyByEmbedding(trimmed, cfg);
    if (embedded !== null) return { kind: embedded, cleanText: trimmed, source: "embed" };
  }
  return fallbackIntent(trimmed, cfg);
}

/**
 * Interpret one operator message. Memoized per (phase, text) so the several
 * independent message handlers share one classification.
 */
export function interpretUserTurn(text: string, phase: string, cfg: QuestConfig): Promise<UserIntent> {
  const key = [phase, cfg.embedUrl ?? "", cfg.embedMode, cfg.embedModel, cfg.steeringPhrases.join("|"), text].join("\u0000");
  const now = Date.now();
  const hit = memo.get(key);
  if (hit !== undefined && now - hit.at < MEMO_TTL_MS) return hit.value;
  if (memo.size >= MEMO_MAX) {
    for (const [k, v] of memo) {
      if (now - v.at >= MEMO_TTL_MS || memo.size >= MEMO_MAX) memo.delete(k);
      if (memo.size < MEMO_MAX) break;
    }
  }
  const value = interpret(text, phase, cfg);
  memo.set(key, { at: now, value });
  return value;
}
