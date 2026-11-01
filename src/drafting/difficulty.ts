// HIGH_LEVEL: #drafting — pure embedding difficulty evaluation.
// Classifies requests into trivial, minor, standard, major, or complex using
// nearest-exemplar embeddings, falling back to deterministic default configuration.
import type { QuestDifficulty } from "../domain/quest.ts";
import { type QuestConfig } from "../config.ts";
import { gate, mergeExemplars, nearestExemplar } from "../judge/nearest.ts";
import { DIFFICULTY_EXEMPLARS, DIFFICULTY_KINDS } from "./difficulty-exemplars.ts";

export const COMPLEX_PATH_COUNT = 4;

export const DIFFICULTY_QUESTION = {
  id: "quest_difficulty",
  state: "",
  instructions: "Classify quest difficulty into trivial, minor, standard, major, or complex.",
  options: [
    { key: "trivial", description: "Trivial task (L1)" },
    { key: "minor", description: "Minor task (L2)" },
    { key: "standard", description: "Standard task (L3)" },
    { key: "major", description: "Major task (L4)" },
    { key: "complex", description: "Complex task (L5)" },
  ],
};

export interface QuestDifficultyResult {
  difficulty: QuestDifficulty;
  source: "embed" | "default" | "judge";
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
    actionable: new Set(["trivial", "minor", "major", "complex"]),
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

  // 2. Auto mode: embeddings decide when available (deterministic, ~15 ms).
  const embedded = await classifyDifficultyByEmbedding(prompt, cfg);
  if (embedded !== null) {
    return { difficulty: embedded, source: "embed", reason: "Nearest difficulty exemplar (embeddings)" };
  }

  // 3. Fallback: configured default (deterministic)
  return {
    difficulty: cfg.defaultDifficulty,
    source: "default",
    degraded: true,
    reason: "Embeddings unavailable; fell back to default difficulty",
  };
}
