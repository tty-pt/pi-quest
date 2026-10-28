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
import { cosine, embedBaseUrl, embedTexts } from "../judge/embed.ts";
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

interface ExemplarIndex {
  kinds: string[];
  vectors: number[][];
}

const exemplarIndexes = new Map<string, Promise<ExemplarIndex | null>>();

/** Shipped exemplars plus the operator's, de-duplicated, restricted to known kinds. */
export function mergedExemplars(cfg: QuestConfig): Array<{ kind: string; text: string }> {
  const out: Array<{ kind: string; text: string }> = [];
  const seen = new Set<string>();
  const add = (kind: string, texts: readonly string[]): void => {
    if (!EMBED_KINDS.has(kind)) return;
    for (const text of texts) {
      const key = `${kind}\u0000${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ kind, text });
      }
    }
  };
  for (const [kind, texts] of Object.entries(DEFAULT_INTENT_EXEMPLARS)) add(kind, texts);
  for (const [kind, texts] of Object.entries(cfg.intentExemplars)) add(kind, texts);
  return out;
}

export function clearExemplarIndexes(): void {
  exemplarIndexes.clear();
}

function exemplarIndex(cfg: QuestConfig, base: string): Promise<ExemplarIndex | null> {
  const examples = mergedExemplars(cfg);
  const key = [base, cfg.embedModel, examples.map((e) => `${e.kind}:${e.text}`).join("\u0001")].join("\u0000");
  let hit = exemplarIndexes.get(key);
  if (hit === undefined) {
    // First use embeds every exemplar in one batch; a slow cold start must not abort it.
    const timeoutMs = Math.max((cfg.judgeTimeoutMs || 2000) * 4, 8000);
    hit = embedTexts(cfg, examples.map((e) => e.text), { timeoutMs }).then((vectors) =>
      vectors === null ? null : { kinds: examples.map((e) => e.kind), vectors }
    );
    exemplarIndexes.set(key, hit);
    void hit.then((v) => { if (v === null) exemplarIndexes.delete(key); });
  }
  return hit;
}

/**
 * Nearest-exemplar verdict, or null when embeddings are unavailable. State-changing
 * kinds need `intentMinSimilarity` AND a margin of `intentMinMargin` over the best
 * other kind; everything weaker is a refinement.
 */
async function classifyByEmbedding(text: string, cfg: QuestConfig): Promise<UserIntentKind | null> {
  const base = embedBaseUrl(cfg);
  if (base === null) return null;
  const index = await exemplarIndex(cfg, base);
  if (index === null) return null;
  const vec = await embedTexts(cfg, [text]);
  const probe = vec?.[0];
  if (probe === undefined) return null;
  const best = new Map<string, number>();
  index.vectors.forEach((v, i) => {
    const kind = index.kinds[i] ?? "";
    const sim = cosine(probe, v);
    if (sim > (best.get(kind) ?? -Infinity)) best.set(kind, sim);
  });
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (top === undefined) return null;
  const margin = top[1] - (ranked[1]?.[1] ?? -1);
  if (top[1] < cfg.intentMinSimilarity) return "refinement";
  const kind = top[0] as UserIntentKind;
  if (ACTIONABLE.has(kind) && margin < cfg.intentMinMargin) return "refinement";
  return kind;
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
  const key = [phase, cfg.embedUrl ?? cfg.judgeUrl ?? "", cfg.embedMode, cfg.embedModel, cfg.steeringPhrases.join("|"), text].join("\u0000");
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
