// HIGH_LEVEL: #drafting — pure embedding difficulty evaluation.
// Classifies requests into trivial, standard, or complex using
// nearest-exemplar embeddings, falling back to deterministic structural rules.
import type { QuestDifficulty } from "../domain/quest.ts";
import { type QuestConfig } from "../config.ts";
import { gate, mergeExemplars, nearestExemplar } from "../judge/nearest.ts";
import { DIFFICULTY_EXEMPLARS, DIFFICULTY_KINDS } from "./difficulty-exemplars.ts";

export const COMPLEX_PATH_COUNT = 4;

export const DIFFICULTY_QUESTION = {
  id: "quest_difficulty",
  state: "",
  instructions: "Classify quest difficulty into trivial, standard, or complex.",
  options: [
    { key: "trivial", description: "Trivial task" },
    { key: "standard", description: "Standard task" },
    { key: "complex", description: "Complex task" },
  ],
};

/**
 * Structural heuristic: >= 4 distinct file paths => complex; otherwise standard.
 * Free-form wording is never guessed without embeddings.
 */
export function evaluateQuestDifficultyHeuristic(prompt: string): QuestDifficulty {
  const pathMatches = prompt.trim().match(/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+/g) ?? [];
  return new Set(pathMatches).size >= COMPLEX_PATH_COUNT ? "complex" : "standard";
}

export interface QuestDifficultyResult {
  difficulty: QuestDifficulty;
  source: "embed" | "heuristic" | "default" | "judge";
  degraded?: boolean;
  reason?: string;
}

/**
 * Embedding verdict for the request's difficulty, or null when embeddings are unavailable.
 * `trivial` and `complex` need `intentMinSimilarity` AND `difficultyMinMargin` over the
 * runner-up level; anything weaker is `standard`, so a doubtful request never loses plan
 * review (held-out: 0 wrong-trivial in 135 requests where the generative judge made 52).
 */
export async function classifyDifficultyByEmbedding(prompt: string, cfg: QuestConfig): Promise<QuestDifficulty | null> {
  if (cfg.embedMode === "off") return null;
  const examples = mergeExemplars(DIFFICULTY_EXEMPLARS, cfg.difficultyExemplars, DIFFICULTY_KINDS);
  const verdict = await nearestExemplar(cfg, examples, prompt);
  if (verdict === null) return null;
  return gate(verdict, {
    minSimilarity: cfg.intentMinSimilarity,
    minMargin: cfg.difficultyMinMargin,
    harmless: "standard",
    actionable: new Set(["trivial", "complex"]),
  }) as QuestDifficulty;
}

export async function evaluateQuestDifficulty(
  prompt: string,
  cfg: QuestConfig,
): Promise<QuestDifficultyResult> {
  // 1. Off mode: always return configured default
  if (cfg.difficultyMode === "off") {
    return {
      difficulty: cfg.defaultDifficulty,
      source: "default",
      reason: "Difficulty analysis mode is off",
    };
  }

  // 2. Pure heuristic mode (no network)
  if (cfg.difficultyMode === "heuristic") {
    const diff = evaluateQuestDifficultyHeuristic(prompt);
    return {
      difficulty: diff,
      source: "heuristic",
      reason: "Evaluated via local heuristic rules",
    };
  }

  // 3. Auto mode: embeddings decide when available (deterministic, ~15 ms).
  const embedded = await classifyDifficultyByEmbedding(prompt, cfg);
  if (embedded !== null) {
    return { difficulty: embedded, source: "embed", reason: "Nearest difficulty exemplar (embeddings)" };
  }

  // 4. Deterministic offline fallback
  const diff = evaluateQuestDifficultyHeuristic(prompt);
  return {
    difficulty: diff,
    source: "heuristic",
    degraded: true,
    reason: "Embeddings unavailable; fell back to local heuristic",
  };
}
