// HIGH_LEVEL: #drafting — multi-tiered quest difficulty analysis
// Determines quest complexity: trivial, standard, or complex.
// Operates via remote Jev System One judge when available, with a fast,
// zero-network heuristic analyser fallback, or explicit overrides.
import type { QuestConfig } from "../config.ts";
import type { QuestDifficulty } from "../domain/quest.ts";
import { normalizeJevUrl } from "./judge.ts";

const TRIVIAL_PATTERNS = [
  /\b(?:typo|spelling|spelled|rename|renaming|one-liner|one\s+line|trivial|minor\s+fix|small\s+fix|quick\s+fix|bump(?:ed|ing)?\s+version|version\s+bump|comment|docstring|readme|docs?|formatting|cleanup|lint(?:ing)?)\b/i,
  /\b(?:fix\s+(?:a\s+)?(?:broken\s+)?link|update\s+(?:the\s+)?license|add\s+(?:a\s+)?badge)\b/i,
];

const COMPLEX_PATTERNS = [
  /\b(?:overhaul|architectur(?:e|al)|migration|migrating|migrate|rewrite|rewriting|redesign|redesigning|cross-module|breaking\s+changes?|concurrency|distributed|protocol\s+change|security\s+audit|subsystems?\s+overhaul)\b/i,
  /\b(?:full\s+refactor|ground-up|end-to-end\s+redesign|data\s+migration)\b/i,
];

export function evaluateQuestDifficultyHeuristic(prompt: string): QuestDifficulty {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();

  // 1. Check for complex patterns first
  for (const pat of COMPLEX_PATTERNS) {
    if (pat.test(lower)) {
      return "complex";
    }
  }

  // Count distinct file paths or directory references (e.g., path/to/file or mod/submod)
  const pathMatches = trimmed.match(/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]+/g) ?? [];
  const uniquePaths = new Set(pathMatches);
  if (uniquePaths.size >= 4) {
    return "complex";
  }

  // 2. Check for trivial patterns
  // Trivial tasks are typically concise and contain explicit trivial keyword families
  for (const pat of TRIVIAL_PATTERNS) {
    if (pat.test(lower)) {
      // If it mentions trivial keywords and isn't a massive multi-page prompt
      if (trimmed.length < 500 && uniquePaths.size <= 2) {
        return "trivial";
      }
    }
  }

  // If very short directive targeting a single isolated fix
  if (trimmed.length < 80 && /^(?:fix|patch|tweak|clean|bump)\s+[a-zA-Z0-9_.\-]+$/i.test(trimmed)) {
    return "trivial";
  }

  // 3. Default to standard
  return "standard";
}

export function parseJevDifficultyChoice(data: unknown): QuestDifficulty {
  if (typeof data !== "object" || data === null) {
    throw new Error("Jev response must be an object");
  }
  const rec = data as Record<string, unknown>;
  let answerVal: unknown;

  // 1. Keyed answers.quest_difficulty.choice format
  if (typeof rec.answers === "object" && rec.answers !== null && !Array.isArray(rec.answers)) {
    const ansObj = rec.answers as Record<string, unknown>;
    const diffAction = ansObj["quest_difficulty"] ?? ansObj["difficulty"] ?? Object.values(ansObj)[0];
    if (typeof diffAction === "object" && diffAction !== null) {
      const objVal = diffAction as Record<string, unknown>;
      answerVal = objVal["choice"] ?? objVal["answer"] ?? objVal["value"];
    } else {
      answerVal = diffAction;
    }
  }

  // 2. Defensive fallback: array answers
  if (answerVal === undefined && Array.isArray(rec.answers)) {
    const list = rec.answers;
    if (list.length === 0) {
      throw new Error("Jev response contains empty answers list");
    }
    const matched = list.find(
      (a: unknown) =>
        typeof a === "object" && a !== null &&
        ((a as Record<string, unknown>).id === "quest_difficulty" || (a as Record<string, unknown>).question_id === "quest_difficulty"),
    );
    if (matched && typeof matched === "object") {
      const matchRec = matched as Record<string, unknown>;
      answerVal = matchRec.choice ?? matchRec.answer ?? matchRec.value;
    } else if (typeof list[0] === "string") {
      answerVal = list[0];
    } else if (typeof list[0] === "object" && list[0] !== null) {
      const firstRec = list[0] as Record<string, unknown>;
      answerVal = firstRec.choice ?? firstRec.answer ?? firstRec.value;
    }
  }

  if (typeof answerVal !== "string") {
    throw new Error(`Jev response missing difficulty choice answer: ${JSON.stringify(data).slice(0, 100)}`);
  }

  const normalized = answerVal.trim().toLowerCase();
  if (normalized.includes("trivial") || normalized.includes("minor") || normalized.includes("patch")) {
    return "trivial";
  }
  if (normalized.includes("complex") || normalized.includes("major") || normalized.includes("epic") || normalized.includes("architectural")) {
    return "complex";
  }
  if (normalized.includes("standard") || normalized.includes("normal") || normalized.includes("medium")) {
    return "standard";
  }

  throw new Error(`Invalid Jev quest difficulty answer: '${answerVal}'`);
}

export async function callJevDifficultyJudge(prompt: string, cfg: QuestConfig): Promise<QuestDifficulty> {
  if (!cfg.judgeUrl) {
    throw new Error("Jev judge URL not configured");
  }
  const endpoint = normalizeJevUrl(cfg.judgeUrl);
  const controller = new AbortController();
  const timeoutMs = cfg.judgeTimeoutMs || 2000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    model: cfg.judgeModel || "qwen",
    state: `User: ${prompt}`,
    questions: {
      quest_difficulty: {
        type: "choice",
        instructions:
          "Determine the complexity level of the requested software engineering task (trivial, standard, or complex).",
        criteria: {
          trivial: "Small isolated patch, typo, doc fix, version bump, comment, or minimal one-file targeted change",
          standard: "Normal feature, standard bugfix, component implementation, multi-file code change",
          complex: "Architectural overhaul, major refactor, system redesign, protocol or data migration, high blast radius",
        },
      },
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.judgeKey && cfg.judgeKey.trim() !== "") {
    headers["Authorization"] = `Bearer ${cfg.judgeKey.trim()}`;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Jev service HTTP error ${res.status}: ${res.statusText}${errText ? ` - ${errText.slice(0, 100)}` : ""}`);
    }

    const data = await res.json();
    return parseJevDifficultyChoice(data);
  } finally {
    clearTimeout(timer);
  }
}

export interface QuestDifficultyResult {
  difficulty: QuestDifficulty;
  source: "judge" | "heuristic" | "default" | "override";
  degraded?: boolean;
  reason?: string;
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

  // 3. Auto / Judge mode without configured URL
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

  // 4. Try remote Jev judge
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
