// HIGH_LEVEL: #working together — a new request during an active quest is
// interpreted in context (refinement, amendment trigger, sub-quest seed) unless
// it constitutes a separate quest. Borderline cases stay in context.
export type MessageKind =
  | "confirmation"
  | "ack"
  | "question"
  | "refinement"
  | "subquest_preempt"
  | "subquest_queue"
  | "directive_constraint"
  | "chat_bypass";

const CONFIRM_PHRASES = [
  "yes", "yep", "yeah", "sure", "go ahead", "proceed", "approved", "approve",
  "do it", "confirm", "confirmed", "lgtm", "looks good", "sounds good",
  "start", "implement", "implement it", "continue", "fine by me", "go for it",
  "go", "please proceed", "please implement", "all good",
];

// Exact-match only (no mid-sentence matching): "we should go on and also handle X"
// is a directive, while a bare "go on" is steering.
const CONFIRM_EXACT = new Set([
  "go on", "carry on", "keep going", "ship it", "let's go", "lets go",
  "please continue", "please go on", "go on please",
]);

const ACK_WORDS = new Set([
  "hi", "hello", "hey", "thanks", "thank", "you", "thx", "ok", "okay", "k",
  "got", "it", "cool", "nice", "great", "good", "fine", "done", "bye",
]);

const QUESTION_OPENERS =
  /^(what|where|who|how|why|is there|are there|can you explain|explain|tell me|show me|which|status|how does|what is|what are)\b/i;

const ACTIONABLE_QUESTION =
  /^(can\s+we|could\s+you|would\s+you|can\s+you)\s+(also\s+)?(add|fix|update|implement|change|support|ensure|make|create|handle)\b/i;

const NATURAL_SUBQUEST_PHRASES =
  /\b(in\s+a\s+sub-?quest|in\s+a\s+sub-?task|spin\s+up\s+a\s+sub-?quest|spin\s+up\s+a\s+sub-?task|split\s+(\w+\s+)?into\s+a\s+sub-?task|split\s+(\w+\s+)?into\s+a\s+sub-?quest|as\s+a\s+sub-?task|as\s+a\s+sub-?quest|open\s+a\s+sub-?quest|open\s+a\s+sub-?task|handle\s+(\w+\s+)?in\s+a\s+sub-?quest)\b/i;

const NATURAL_CONSTRAINT_PHRASES =
  /\b(make\s+sure(\s+(you|to))?\b|ensure(\s+that)?\b|don't\s+touch\b|do\s+not\s+touch\b|must\s+(be|use|not|have)\b|never\s+(modify|touch)\b|keep\s+in\s+mind)\b/i;

export interface ParsedDirective {
  kind: MessageKind;
  cleanText: string;
}

export function parseUserDirective(text: string): ParsedDirective {
  const trimmed = text.trim();

  // Optional prefix fast-paths (power users & automated scripts)
  if (/^!(sq|subquest)\s+/i.test(trimmed)) {
    return { kind: "subquest_preempt", cleanText: trimmed.replace(/^!(sq|subquest)\s+/i, "").trim() };
  }
  if (/^subquest:\s*/i.test(trimmed)) {
    return { kind: "subquest_preempt", cleanText: trimmed.replace(/^subquest:\s*/i, "").trim() };
  }
  if (/^!(later|backlog)\s+/i.test(trimmed)) {
    return { kind: "subquest_queue", cleanText: trimmed.replace(/^!(later|backlog)\s+/i, "").trim() };
  }
  if (/^backlog:\s*/i.test(trimmed)) {
    return { kind: "subquest_queue", cleanText: trimmed.replace(/^backlog:\s*/i, "").trim() };
  }
  if (/^!(rule|req|constraint)\s+/i.test(trimmed)) {
    return { kind: "directive_constraint", cleanText: trimmed.replace(/^!(rule|req|constraint)\s+/i, "").trim() };
  }
  if (/^(must|rule):\s*/i.test(trimmed)) {
    return { kind: "directive_constraint", cleanText: trimmed.replace(/^(must|rule):\s*/i, "").trim() };
  }
  if (/^!(chat|talk|ask)\s+/i.test(trimmed) || /^chat:\s*/i.test(trimmed)) {
    return { kind: "chat_bypass", cleanText: trimmed.replace(/^!(chat|talk|ask)\s+/i, "").replace(/^chat:\s*/i, "").trim() };
  }
  if (trimmed.startsWith("? ")) {
    return { kind: "chat_bypass", cleanText: trimmed.slice(2).trim() };
  }

  // Natural sub-quest intent without prefixes
  if (NATURAL_SUBQUEST_PHRASES.test(trimmed)) {
    const isUrgent = /\b(now|immediately|right\s+now|first|blocking)\b/i.test(trimmed);
    return { kind: isUrgent ? "subquest_preempt" : "subquest_queue", cleanText: trimmed };
  }

  // Natural constraint phrasing without prefixes
  if (NATURAL_CONSTRAINT_PHRASES.test(trimmed)) {
    return { kind: "directive_constraint", cleanText: trimmed };
  }

  // Base confirmations & acks
  const clean = trimmed.toLowerCase().replace(/[!?.]+$/g, "");
  if (CONFIRM_EXACT.has(clean)) {
    return { kind: "confirmation", cleanText: trimmed };
  }
  if (CONFIRM_PHRASES.some((phrase) => clean === phrase || (clean.length < 120 && clean.includes(` ${phrase} `)))) {
    return { kind: "confirmation", cleanText: trimmed };
  }
  const words = clean.split(/\s+/).filter((w) => w.length > 0);
  if (words.length > 0 && words.every((w) => ACK_WORDS.has(w))) {
    return { kind: "ack", cleanText: trimmed };
  }

  // Pure questions vs Actionable questions
  const isQuestion = QUESTION_OPENERS.test(trimmed) || trimmed.endsWith("?");
  const isActionable = ACTIONABLE_QUESTION.test(trimmed);

  if (isQuestion && !isActionable) {
    if (trimmed.length < 250) {
      return { kind: "question", cleanText: trimmed };
    }
  }

  return { kind: "refinement", cleanText: trimmed };
}

export function classifyUserMessage(text: string): MessageKind {
  return parseUserDirective(text).kind;
}
