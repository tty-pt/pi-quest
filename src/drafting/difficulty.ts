// HIGH_LEVEL: #drafting — pure embedding difficulty evaluation.
// Classifies requests into trivial, minor, standard, major, or complex using
// nearest-exemplar embeddings, falling back to deterministic default configuration.
import { difficultyLevel, type QuestDifficulty, type QuestState } from "../domain/quest.ts";
import { type QuestConfig } from "../config.ts";
import { gate, mergeExemplars, nearestExemplar } from "../judge/nearest.ts";
import { DIFFICULTY_EXEMPLARS, DIFFICULTY_KINDS } from "./difficulty-exemplars.ts";
import { countSteps } from "./quality.ts";
import { parseSubQuestBacklog } from "../subquests/foreman.ts";
import type { DraftSections } from "./plan-text.ts";

export const COMPLEX_PATH_COUNT = 4;

export interface ComplexityEvidence {
  requirementsCount?: number;
  planStepsCount?: number;
  subquestsCount?: number;
  hasSubquestBacklog?: boolean;
  citedFilesCount?: number;
  touchedFilesCount?: number;
  setbacksCount?: number;
}

export function levelToDifficulty(level: number): QuestDifficulty {
  if (level <= 1) return "trivial";
  if (level === 2) return "minor";
  if (level === 3) return "standard";
  if (level === 4) return "major";
  return "complex";
}

/**
 * Dynamically infers task complexity from concrete evidence gathered as the quest progresses:
 * - Requirements count (e.g. 8+ requirements -> complex)
 * - Discrete plan steps (e.g. 12+ steps -> complex)
 * - Sub-quests declared in the plan backlog or spawned as children
 * - Multi-file breadth across repository
 * - Setbacks and architecture hurdles encountered
 */
export function inferDynamicDifficulty(evidence: ComplexityEvidence, baseline?: QuestDifficulty): QuestDifficulty {
  const reqs = evidence.requirementsCount ?? 0;
  const steps = evidence.planStepsCount ?? 0;
  const subquests = evidence.subquestsCount ?? 0;
  const hasBacklog = evidence.hasSubquestBacklog ?? false;
  const touchedFiles = evidence.touchedFilesCount ?? 0;
  const setbacks = evidence.setbacksCount ?? 0;

  let inferredLevel = 1;

  // Level 5 (complex) criteria:
  // - Sub-quest backlog explicitly authored in draft, or multiple child sub-quests spawned (subquests >= 2)
  // - Or truly massive architectural scale: 10+ requirements, 16+ steps, (7+ reqs AND 12+ steps), or 12+ touched files
  if (
    hasBacklog ||
    subquests >= 2 ||
    reqs >= 10 ||
    steps >= 16 ||
    (reqs >= 7 && steps >= 12) ||
    touchedFiles >= 12
  ) {
    inferredLevel = 5;
  }
  // Level 4 (major) criteria:
  // - Substantive architectural scale: 4+ requirements, 6+ steps, 4+ touched files, or 2+ setbacks
  else if (
    reqs >= 4 ||
    steps >= 6 ||
    touchedFiles >= 4 ||
    setbacks >= 2
  ) {
    inferredLevel = 4;
  }
  // Level 3 (standard) criteria:
  else if (
    reqs >= 2 ||
    steps >= 3 ||
    touchedFiles >= 2
  ) {
    inferredLevel = 3;
  }
  // Level 2 (minor) criteria:
  else if (
    reqs === 1 ||
    steps >= 2 ||
    touchedFiles === 1
  ) {
    inferredLevel = 2;
  }

  const baseLevel = baseline ? difficultyLevel(baseline) : 1;
  const finalLevel = Math.max(inferredLevel, baseLevel);
  return levelToDifficulty(finalLevel);
}

export function extractComplexityEvidence(
  state: QuestState,
  sections?: DraftSections,
  docText?: string,
): ComplexityEvidence {
  const reqs = sections?.requirements.length ?? 0;
  const body = sections ? (sections.plan || sections.analysis) : "";
  const steps = body ? countSteps(body) : 0;
  const backlog = docText ? parseSubQuestBacklog(docText) : (body ? parseSubQuestBacklog(body) : []);
  const subquestsFromSections = sections?.subquests ? parseSubQuestBacklog(sections.subquests).length : 0;
  const totalSubquests = Math.max(state.children.length, backlog.length, subquestsFromSections);
  const hasBacklog = backlog.length > 0 || subquestsFromSections > 0;

  const citedPaths = new Set<string>();
  if (sections) {
    for (const ev of sections.evidence) {
      const match = ev.match(/([a-zA-Z0-9_\-\./]+\.[a-zA-Z0-9]+)/);
      if (match) citedPaths.add(match[1]);
    }
  }

  const touchedCount = state.touchedFiles?.length ?? 0;
  const setbacksCount = state.setbacks?.length ?? 0;

  return {
    requirementsCount: reqs,
    planStepsCount: steps,
    subquestsCount: totalSubquests,
    hasSubquestBacklog: hasBacklog,
    citedFilesCount: citedPaths.size,
    touchedFilesCount: touchedCount,
    setbacksCount,
  };
}

export function recalibrateQuestDifficulty(
  state: QuestState,
  sections?: DraftSections,
  docText?: string,
): QuestDifficulty {
  const evidence = extractComplexityEvidence(state, sections, docText);
  return inferDynamicDifficulty(evidence, state.difficulty);
}

/**
 * Injects ## Sub-Quests template scaffold into document text if not already present.
 */
export function ensureSubquestsScaffold(docText: string): string {
  if (/^##\s+Sub-Quests\b/im.test(docText)) {
    return docText;
  }
  const scaffold = `## Sub-Quests

<!-- COMPLEX TASK DETECTED: Decompose this task into sequential, bounded sub-quests.
     Each sub-quest executes in a focused worker lane with explicit allowedPaths,
     required test commands, and assigned requirements: -->
- [ ] SQ1: Core architecture & contracts [paths: ...] [tests: npm test] [req: R1]
- [ ] SQ2: Feature implementation & integration [paths: ...] [tests: npm test] [req: R2]
- [ ] SQ3: End-to-end verification & regression tests [paths: tests/...] [tests: npm test] [req: R3]
`;
  const planIdx = docText.search(/^##\s+(?:Implementation Plan|Plan)\b/im);
  const analysisIdx = docText.search(/^##\s+Analysis\b/im);
  const insertIdx = planIdx !== -1 ? planIdx : (analysisIdx !== -1 ? analysisIdx : -1);

  if (insertIdx !== -1) {
    return `${docText.slice(0, insertIdx).trimEnd()}\n\n${scaffold}\n${docText.slice(insertIdx)}`;
  }
  return `${docText.trimEnd()}\n\n${scaffold}\n`;
}

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
