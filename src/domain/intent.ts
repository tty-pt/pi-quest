// HIGH_LEVEL: #working together — ONE interpretation of each operator message.
// Every handler that reacts to user input (draft approval, plan-revision
// adoption, validation confirmation, late ask answers, mid-quest triage) asks
// `interpretUserTurn` instead of keeping its own word list. Meaning comes from
// the judge; when the judge is unavailable the fallback contains no natural
// language beyond ONE configurable word ("go") and the operator's own
// `steeringPhrases` — everything else degrades to a recorded refinement, which
// can never advance, abort or archive a quest.
import { type QuestConfig } from "../config.ts";
import { askJudgeChoice, type JudgeOption } from "../judge/choice.ts";

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
  source: "sigil" | "judge" | "fallback";
}

/** The single built-in word recognized without a judge (case/punctuation-insensitive, exact message). */
export const FALLBACK_ADVANCE_WORD = "go";

/** Messages longer than this are directives, never one-word steering: skip the judge. */
export const MAX_JUDGED_CHARS = 600;
/** A trailing "?" only means "question" for short messages. */
export const MAX_QUESTION_CHARS = 250;

// Safest label first: small local judges show strong first-option bias, and a
// biased "first option" must land on a harmless label, never on an action.
const INTENT_OPTIONS: readonly JudgeOption[] = [
  { key: "refinement", description: "Any other technical guidance, correction, opinion, proposal, or extra detail about the current task" },
  { key: "question", description: "The operator asks a question or requests information without asking for a change" },
  { key: "ack", description: "Greeting, thanks, or a bare acknowledgement with no instruction" },
  { key: "constraint", description: "The operator states a hard rule the work must satisfy (must / never / make sure / do not touch)" },
  { key: "subquest_now", description: "The operator asks for a separate sub-task to be done immediately, before continuing" },
  { key: "subquest_later", description: "The operator asks for a separate sub-task or follow-up to be queued for later" },
  { key: "abort", description: "ONLY a request to cancel, stop, abandon, or delete the whole quest" },
  { key: "advance", description: "ONLY a bare approval or go-ahead (approve, accept, confirm, proceed, continue, ship it) with no other instruction or topic" },
];

// Verdicts that change quest state. They are never trusted on a single judge
// answer: the question is asked again with the options in reverse order, and
// only an agreeing answer acts. A position-biased judge disagrees with itself
// and degrades to a harmless refinement.
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

async function askIntent(
  text: string,
  phase: string,
  cfg: QuestConfig,
  options: readonly JudgeOption[],
): Promise<UserIntentKind | null> {
  const timeoutMs = Math.min(Math.max((cfg.judgeTimeoutMs || 2000) * 2, 2000), 6000);
  const choice = await askJudgeChoice(cfg, {
    id: "user_intent",
    state: `Quest phase: ${phase}\nOperator message: ${text}`,
    instructions:
      "Classify what the operator wants done with the active quest. The message may be in any language. Choose exactly one.",
    options,
  }, { timeoutMs });
  return choice === null ? null : (choice as UserIntentKind);
}

async function interpret(text: string, phase: string, cfg: QuestConfig): Promise<UserIntent> {
  const trimmed = text.trim();
  const explicit = parseExplicitSyntax(trimmed);
  if (explicit !== null) return explicit;
  // The operator's own exact phrases are authoritative and free (no latency).
  if (isFallbackAdvance(trimmed, cfg.steeringPhrases)) return { kind: "advance", cleanText: trimmed, source: "fallback" };
  if (trimmed.length <= MAX_JUDGED_CHARS) {
    const first = await askIntent(trimmed, phase, cfg, INTENT_OPTIONS);
    if (first !== null) {
      if (!ACTIONABLE.has(first)) return { kind: first, cleanText: trimmed, source: "judge" };
      const second = await askIntent(trimmed, phase, cfg, [...INTENT_OPTIONS].reverse());
      if (second === first) return { kind: first, cleanText: trimmed, source: "judge" };
      // Inconsistent under reordering => the judge is guessing; never act on a guess.
      return { kind: "refinement", cleanText: trimmed, source: "judge" };
    }
  }
  return fallbackIntent(trimmed, cfg);
}

/**
 * Interpret one operator message. Memoized per (phase, text) so the several
 * independent message handlers share one judge call and one answer.
 */
export function interpretUserTurn(text: string, phase: string, cfg: QuestConfig): Promise<UserIntent> {
  const key = [phase, cfg.judgeMode, cfg.judgeUrl ?? "", cfg.steeringPhrases.join("|"), text].join("\u0000");
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
