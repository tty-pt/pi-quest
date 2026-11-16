// HIGH_LEVEL: #working together — pure user intent types and syntax parsing.
// Evaluated by src/judge/intent-classifier.ts.
export type UserIntentKind =
  | "advance"
  | "abort"
  | "constraint"
  | "subquest_now"
  | "subquest_later"
  | "question"
  | "chat"
  | "ack"
  | "handoff"
  | "refinement";

export interface UserIntent {
  kind: UserIntentKind;
  /** Message with any explicit sigil removed. */
  cleanText: string;
  source: "sigil" | "embed" | "fallback";
}

/** The single built-in word recognized without a judge (case/punctuation-insensitive, exact message). */
export const FALLBACK_ADVANCE_WORD = "go";

export function parseLeadingAdvance(
  text: string,
  extraPhrases: readonly string[] = [],
): { isAdvance: boolean; remainder: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { isAdvance: false, remainder: "" };

  if (/^(?:don'?t\s+go|do\s+not\s+go)\b/i.test(trimmed)) {
    return { isAdvance: false, remainder: trimmed };
  }

  if (isFallbackAdvance(trimmed, extraPhrases)) {
    return { isAdvance: true, remainder: "" };
  }

  const candidateWords = [FALLBACK_ADVANCE_WORD, ...extraPhrases];
  for (const word of candidateWords) {
    if (!word || word.trim() === "") continue;
    const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`^${escaped}[!.,;:]+\\s*(.*)$`, "i").exec(trimmed);
    if (m && m[1].trim() !== "") {
      const remainder = m[1].trim().replace(/^(?:and|e|then|depois|also|também|tambem)\s+/i, "").trim();
      return { isAdvance: true, remainder };
    }
  }

  return { isAdvance: false, remainder: trimmed };
}

export function normalizeSteeringText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[!?.,;:\s]+$/g, "")
    .trim();
}

const SIGILS: Array<{ re: RegExp; kind: UserIntentKind }> = [
  { re: /^!abort\b\s*/i, kind: "abort" },
  { re: /^abort:\s*/i, kind: "abort" },
  { re: /^!sq\b\s*/i, kind: "subquest_now" },
  { re: /^sq:\s*/i, kind: "subquest_now" },
  { re: /^!later\b\s*/i, kind: "subquest_later" },
  { re: /^later:\s*/i, kind: "subquest_later" },
  { re: /^!backlog\b\s*/i, kind: "subquest_later" },
  { re: /^backlog:\s*/i, kind: "subquest_later" },
  { re: /^!(rule|req|constraint)\s+/i, kind: "constraint" },
  { re: /^(must|rule):\s*/i, kind: "constraint" },
  { re: /^!handoff\b\s*/i, kind: "handoff" },
  { re: /^handoff:\s*/i, kind: "handoff" },
  { re: /^!(chat|ask)\s+/i, kind: "chat" },
  { re: /^chat:\s*/i, kind: "chat" },
];

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
