// HIGH_LEVEL: #drafting — multi-tiered quest difficulty analysis
// Determines quest complexity: trivial, standard, or complex.
// Operates via remote Jev System One judge when available, with a fast,
// zero-network heuristic analyser fallback, or explicit overrides.
import type { QuestConfig } from "../config.ts";
import type { QuestDifficulty } from "../domain/quest.ts";
import { askJudgeChoice, extractJevAnswer, resolveChoice, type JudgeQuestion } from "../judge/choice.ts";
import { gate, mergeExemplars, nearestExemplar } from "../judge/nearest.ts";
import { DIFFICULTY_EXEMPLARS, DIFFICULTY_KINDS } from "./difficulty-exemplars.ts";

export const DIFFICULTY_QUESTION: JudgeQuestion = {
  id: "quest_difficulty",
  state: "",
  instructions: "Determine the complexity level of the requested software engineering task (trivial, standard, or complex).",
  options: [
    { key: "trivial", description: "Small isolated patch, typo, doc fix, version bump, comment, or minimal one-file targeted change" },
    { key: "standard", description: "Normal feature, standard bugfix, component implementation, multi-file code change" },
    { key: "complex", description: "Architectural overhaul, major refactor, system redesign, protocol or data migration, high blast radius" },
  ],
};

// Judge-less fallback: language-neutral structural signals only (no keywords).
// Referencing many distinct files is the one reliable "big change" proxy; anything
// else is "standard" — the operator can override with the tool's difficulty field.
const COMPLEX_PATH_COUNT = 4;

export function evaluateQuestDifficultyHeuristic(prompt: string): QuestDifficulty {
  const pathMatches = prompt.trim().match(/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+/g) ?? [];
  return new Set(pathMatches).size >= COMPLEX_PATH_COUNT ? "complex" : "standard";
}

export function parseJevDifficultyChoice(data: unknown): QuestDifficulty {
  if (typeof data !== "object" || data === null) {
    throw new Error("Jev response must be an object");
  }
  const raw = extractJevAnswer(data, DIFFICULTY_QUESTION.id);
  if (typeof raw !== "string") {
    throw new Error(`Jev response missing difficulty choice answer: ${JSON.stringify(data).slice(0, 100)}`);
  }
  const choice = resolveChoice(raw, DIFFICULTY_QUESTION.options);
  if (choice === "trivial" || choice === "standard" || choice === "complex") return choice;
  throw new Error(`Invalid Jev quest difficulty answer: '${raw}'`);
}

export async function callJevDifficultyJudge(prompt: string, cfg: QuestConfig): Promise<QuestDifficulty> {
  if (!cfg.judgeUrl) {
    throw new Error("Jev judge URL not configured");
  }
  const choice = await askJudgeChoice(cfg, { ...DIFFICULTY_QUESTION, state: `User: ${prompt}` });
  if (choice === "trivial" || choice === "standard" || choice === "complex") return choice;
  throw new Error("Jev service unavailable or returned an unknown choice");
}

export interface QuestDifficultyResult {
  difficulty: QuestDifficulty;
  source: "embed" | "judge" | "heuristic" | "default" | "override";
  degraded?: boolean;
  reason?: string;
}

/**
 * Embedding verdict for the request's difficulty, or null when embeddings are unavailable.
 * `trivial` and `complex` need `intentMinSimilarity` AND `difficultyMinMargin` over the
 * runner-up level; anything weaker is `standard`, so a doubtful request never loses plan
 * review (held-out: 0 wrong-trivial in 135 requests where the judge made 52).
 */
export async function classifyDifficultyByEmbedding(prompt: string, cfg: QuestConfig): Promise<QuestDifficulty | null> {
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

  // 3. Auto mode: embeddings decide when available (deterministic, ~20 ms); an explicit
  // `judge` mode skips them. The judge and the structural heuristic remain the fallbacks.
  if (cfg.difficultyMode === "auto") {
    const embedded = await classifyDifficultyByEmbedding(prompt, cfg);
    if (embedded !== null) {
      return { difficulty: embedded, source: "embed", reason: "Nearest difficulty exemplar (embeddings)" };
    }
  }

  // 4. Auto / Judge mode without configured URL
  if (!cfg.judgeUrl || cfg.judgeUrl.trim() === "") {
    if (cfg.difficultyMode === "judge" && cfg.judgeFallback === "skip") {
      return {
        difficulty: cfg.defaultDifficulty,
        source: "default",
        degraded: true,
        reason: "Judge unconfigured and fallback=skip",
      };
    }
    const diff = evaluateQuestDifficultyHeuristic(prompt);
    return {
      difficulty: diff,
      source: "heuristic",
      degraded: true,
      reason: "Judge unconfigured; fell back to local heuristic",
    };
  }

  // 5. Try remote Jev judge
  try {
    const choice = await callJevDifficultyJudge(prompt, cfg);
    return {
      difficulty: choice,
      source: "judge",
      reason: "Classified by Jev System One judge",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cfg.difficultyMode === "judge" && cfg.judgeFallback === "skip") {
      return {
        difficulty: cfg.defaultDifficulty,
        source: "default",
        degraded: true,
        reason: `Judge failed (${msg}); fallback=skip`,
      };
    }
    const diff = evaluateQuestDifficultyHeuristic(prompt);
    return {
      difficulty: diff,
      source: "heuristic",
      degraded: true,
      reason: `Judge failed (${msg}); fell back to local heuristic`,
    };
  }
}
