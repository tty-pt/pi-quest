// HIGH_LEVEL: #working together — ONE interpretation of each operator message.
// Every handler that reacts to user input (draft approval, plan-revision
// adoption, validation confirmation, late ask answers, mid-quest triage) asks
// `interpretUserTurn` instead of keeping its own word list. Meaning comes from
// embedding similarity to labelled exemplars — deterministic, ~15 ms, free of the
// option-position bias that makes small generative judges unusable for this. The
// generative judge is deliberately NOT consulted for steering. When embeddings are
// unavailable the fallback contains no natural language beyond ONE configurable
// word ("go") and the operator's own `steeringPhrases`. State-changing verdicts
// must clear a similarity floor and a margin over the runner-up kind; anything
// weaker degrades to a recorded refinement, which can never advance, abort or
// archive a quest.
import { type QuestConfig } from "../config.ts";
import { clearNearestIndexes, type Exemplar, gate, mergeExemplars, nearestExemplar } from "../judge/nearest.ts";
import { DEFAULT_INTENT_EXEMPLARS } from "./intent-exemplars.ts";

export type UserIntentKind =
  | "advance"
  | "abort"
  | "constraint"
  | "subquest_now"
  | "subquest_later"
  | "question"
  | "chat"
  | "ack"
  | "refinement";

export interface UserIntent {
  kind: UserIntentKind;
  /** Message with any explicit sigil removed. */
  cleanText: string;
  source: "sigil" | "embed" | "fallback";
}

/** The single built-in word recognized without a judge (case/punctuation-insensitive, exact message). */
export const FALLBACK_ADVANCE_WORD = "go";

/** Messages longer than this are directives, never one-word steering: skip classification. */
export const MAX_JUDGED_CHARS = 600;
/** A trailing "?" only means "question" for short messages. */
export const MAX_QUESTION_CHARS = 250;

// Verdicts that change quest state. They must clear the margin gate.
const ACTIONABLE: ReadonlySet<UserIntentKind> = new Set<UserIntentKind>([
  "advance",
  "abort",
  "constraint",
  "subquest_now",
  "subquest_later",
]);

const SIGILS: Array<{ re: RegExp; kind: UserIntentKind }> = [
  { re: /^!(sq|subquest)\s+/i, kind: "subquest_now" },
  { re: /^subquest:\s*/i, kind: "subquest_now" },
  { re: /^!(later|backlog)\s+/i, kind: "subquest_later" },
  { re: /^backlog:\s*/i, kind: "subquest_later" },
  { re: /^!(rule|req|constraint)\s+/i, kind: "constraint" },
  { re: /^(must|rule):\s*/i, kind: "constraint" },
  { re: /^!(chat|talk|ask)\s+/i, kind: "chat" },
  { re: /^chat:\s*/i, kind: "chat" },
];

export function normalizeSteeringText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.,;:\s]+$/g, "")
    .trim();
}

/** Explicit-syntax parse only (sigils and "? "); no natural language. */
export function parseExplicitSyntax(text: string): UserIntent | null {
  const trimmed = text.trim();
  for (const { re, kind } of SIGILS) {
    if (re.test(trimmed)) return { kind, cleanText: trimmed.replace(re, "").trim(), source: "sigil" };
  }
  if (trimmed.startsWith("? ")) return { kind: "chat", cleanText: trimmed.slice(2).trim(), source: "sigil" };
  return null;
}

/** Judge-less fallback: the one built-in word plus the operator's own exact phrases. */
export function isFallbackAdvance(text: string, extraPhrases: readonly string[] = []): boolean {
  const clean = normalizeSteeringText(text);
  if (clean === "") return false;
  if (clean === FALLBACK_ADVANCE_WORD) return true;
  return extraPhrases.some((p) => normalizeSteeringText(p) === clean);
}

function fallbackIntent(text: string, cfg: QuestConfig): UserIntent {
  const trimmed = text.trim();
  if (isFallbackAdvance(trimmed, cfg.steeringPhrases)) return { kind: "advance", cleanText: trimmed, source: "fallback" };
  if (trimmed.endsWith("?") && trimmed.length < MAX_QUESTION_CHARS) return { kind: "question", cleanText: trimmed, source: "fallback" };
  return { kind: "refinement", cleanText: trimmed, source: "fallback" };
}

const MEMO_TTL_MS = 15_000;
const MEMO_MAX = 32;
const memo = new Map<string, { at: number; value: Promise<UserIntent> }>();

export function clearIntentMemo(): void {
  memo.clear();
}

// ---- embedding classification ----------------------------------------------------------

const EMBED_KINDS: ReadonlySet<string> = new Set<UserIntentKind>([
  "advance", "abort", "constraint", "subquest_now", "subquest_later", "question", "ack", "refinement",
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
  // The operator's own exact phrases are authoritative and free (no latency).
  if (isFallbackAdvance(trimmed, cfg.steeringPhrases)) return { kind: "advance", cleanText: trimmed, source: "fallback" };
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
