// HIGH_LEVEL: #drafting — pure embedding classification
// for determining whether incoming user input constitutes genuine quest material.
import type { PiCtx } from "../hooks/events.ts";
import { type QuestConfig } from "../config.ts";
import { gate, mergeExemplars, nearestExemplar } from "../judge/nearest.ts";
import { QUEST_EXEMPLARS, QUEST_INTENT_KINDS } from "./quest-exemplars.ts";
import { KIND_EXEMPLARS, QUEST_KINDS } from "./kind-exemplars.ts";
import type { QuestKind } from "../domain/quest.ts";

export interface QuestIntentResult {
  isQuest: boolean;
  source: "embed" | "skip" | "llm";
  degraded?: boolean;
  reason?: string;
}

const IMPERATIVE_ACTION_VERBS =
  /\b(?:implement|refactor|update|fix|add|remove|create|test|build|wire|audit|ensure|integrate|migrate|optimize|rewrite)\b/i;
const CODE_FILE_PATTERN =
  /\b[\w\-./]+\.(?:c|h|ts|js|jsx|tsx|py|rs|go|sh|json|md|yaml|yml|toml|sql)\b|\b(?:Makefile|Dockerfile|package\.json)\b/i;
const CODE_SYMBOL_OR_SNIPPET =
  /`[^`]+`|\b[a-zA-Z_]\w*\(\)|\b(?:git diff|pull request|PR|function|class|method|struct|endpoint|API|CLI)\b/i;
const TECHNICAL_ERROR_PATTERN =
  /\b(?:bug|error|exception|stack\s*trace|segfault|null\s*pointer|compiler|failed\s+test|syntax\s*error|regression)\b/i;

/**
 * High-confidence software task heuristic for offline / degraded embedding fallback.
 * Checks for imperative coding action verbs combined with codebase paths, symbols, or error traces.
 */
export function detectTaskHeuristic(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 30) return false;

  const hasVerb = IMPERATIVE_ACTION_VERBS.test(trimmed);
  const hasFile = CODE_FILE_PATTERN.test(trimmed);
  const hasSymbol = CODE_SYMBOL_OR_SNIPPET.test(trimmed);
  const hasError = TECHNICAL_ERROR_PATTERN.test(trimmed);

  if (hasVerb && (hasFile || hasSymbol || hasError)) {
    return true;
  }
  if (hasFile && hasError) {
    return true;
  }
  return false;
}


export const QUEST_INTENT_QUESTION = {
  id: "quest_intent",
  state: "",
  instructions:
    "Determine whether the user message is an instruction or directive to start a new software engineering quest/task.",
  options: [
    { key: "quest", description: "Direct instruction or request to perform a task" },
    { key: "conversation", description: "Casual conversation, greeting, or question" },
  ],
};

export async function checkJudgeHealth(cfg: QuestConfig): Promise<{
  ok: boolean;
  endpoint: string;
  latencyMs?: number;
  models?: string[];
  error?: string;
}> {
  const endpoint = (cfg.embedUrl ?? cfg.judgeUrl ?? "http://127.0.0.1:4242").replace(/\/+$/, "");
  const t0 = performance.now();
  try {
    const res = await fetch(`${endpoint}/v1/models`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { ok: false, endpoint, error: `HTTP ${res.status}` };
    const data = await res.json() as { data?: Array<{ id?: string }> };
    const latencyMs = Math.round(performance.now() - t0);
    const models = (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
    return { ok: true, endpoint, latencyMs, models };
  } catch (err) {
    return { ok: false, endpoint, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Embedding verdict for the request's intent, or null when embeddings are unavailable.
 * `quest` needs `intentMinSimilarity` AND `questMinMargin` over conversation; anything
 * weaker is conversation, so a doubtful request never opens an accidental quest
 * (held-out: 0 false quests in 96 messages where the generative judge opened 21).
 */
export async function classifyQuestByEmbedding(prompt: string, cfg: QuestConfig): Promise<"quest" | "conversation" | null> {
  if (cfg.embedMode === "off") return null;
  const examples = mergeExemplars(QUEST_EXEMPLARS, cfg.questExemplars, QUEST_INTENT_KINDS);
  const verdict = await nearestExemplar(cfg, examples, prompt);
  if (verdict === null) return null;
  return gate(verdict, {
    minSimilarity: cfg.intentMinSimilarity,
    minMargin: cfg.questMinMargin,
    harmless: "conversation",
    actionable: new Set(["quest"]),
  }) as "quest" | "conversation";
}

export async function evaluateQuestIntent(
  prompt: string,
  cfg: QuestConfig,
  _ctx?: PiCtx,
): Promise<QuestIntentResult> {
  // 1. Off mode
  if (cfg.judgeMode === "off") {
    return { isQuest: false, source: "skip", reason: "Judge mode is off" };
  }

  // 2. Embeddings decide when available: deterministic, ~15 ms, and 0 false quests on held-out corpora.
  const embedded = await classifyQuestByEmbedding(prompt, cfg);
  if (embedded !== null) {
    return {
      isQuest: embedded === "quest",
      source: "embed",
      reason: embedded === "quest" ? "Nearest quest exemplar (embeddings)" : "Nearest conversation exemplar or below the quest gate (embeddings)",
    };
  }

  // 3. Offline fallback (triggers or /quest required)
  return {
    isQuest: false,
    source: "skip",
    degraded: true,
    reason: "Embeddings unavailable; fallback=skip (triggers or /quest required)",
  };
}

/**
 * Fine-grained quest kind classification via POST /v1/classify.
 * Classifies an incoming quest objective into:
 * "feature", "bugfix", "refactor", "docs", "analysis", or "standard".
 */
export async function classifyQuestKindByEmbedding(
  objective: string,
  cfg: QuestConfig,
): Promise<QuestKind | null> {
  if (cfg.embedMode === "off") return null;
  const verdict = await nearestExemplar(
    cfg,
    mergeExemplars(KIND_EXEMPLARS, {}, QUEST_KINDS),
    objective,
  );
  if (verdict === null) return null;
  return gate(verdict, {
    minSimilarity: cfg.intentMinSimilarity,
    minMargin: 0.05,
    harmless: "standard",
    actionable: QUEST_KINDS,
  }) as QuestKind;
}

export async function evaluateQuestKind(
  objective: string,
  cfg: QuestConfig,
): Promise<QuestKind> {
  if (cfg.judgeMode === "off") return "standard";
  const embedded = await classifyQuestKindByEmbedding(objective, cfg);
  return embedded ?? "standard";
}
