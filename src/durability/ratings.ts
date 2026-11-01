// HIGH_LEVEL: #storage — post-quest telemetry and Bayesian Beta-Binomial accuracy tracking.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { QuestDifficulty, QuestKind, QuestState } from "../domain/quest.ts";
import { readQuestConfig, type QuestConfig } from "../config.ts";
import { gate, mergeExemplars, nearestExemplar, type ExemplarTable } from "../judge/nearest.ts";

export interface ModelBetaRating {
  alpha: number;
  beta: number;
  mean: number;
  episodes: number;
}

export interface ModelRatingProfile {
  overall: ModelBetaRating;
  byTier?: Partial<Record<QuestDifficulty, ModelBetaRating>>;
  byKind?: Partial<Record<QuestKind, ModelBetaRating>>;
  lastUpdated: string;
}

export interface RatingsStore {
  version: 1;
  models: Record<string, ModelRatingProfile>;
}

export const RATINGS_RELATIVE_PATH = join(".pi", "quest", "model-ratings.json");
export const DISCOUNT_FACTOR = 0.98; // Half-life ~35 episodes

export function calculateEpisodeScore(
  state: QuestState,
  outcome: "COMPLETED" | "FAILED" | "ABANDONED",
  explicitRating?: number, // 1..5
): number {
  if (outcome === "ABANDONED") return 0.10;
  if (outcome === "FAILED") return 0.20;

  const setbacks = state.setbacks.length;
  const revisions = state.draft?.planRevisions.length ?? 0;
  // Verification score: clean = 1.0, minus 0.15 per setback
  const sVerify = Math.max(0.1, 1.0 - (setbacks * 0.15));
  // Execution score: minus 0.1 per plan revision
  const sExec = Math.max(0.2, 1.0 - (revisions * 0.1));

  let explicitScore: number | undefined;
  if (typeof explicitRating === "number" && !isNaN(explicitRating)) {
    // 1 -> 0.0, 5 -> 1.0
    explicitScore = Math.max(0.0, Math.min(1.0, (explicitRating - 1) / 4));
  }

  if (explicitScore !== undefined) {
    return Math.round((0.35 * sVerify + 0.35 * sExec + 0.30 * explicitScore) * 100) / 100;
  }
  return Math.round((0.50 * sVerify + 0.50 * sExec) * 100) / 100;
}

export function updateBetaDistribution(
  prior: ModelBetaRating,
  score: number,
  discount = DISCOUNT_FACTOR,
): ModelBetaRating {
  const alpha = Math.round((discount * prior.alpha + score) * 100) / 100;
  const beta = Math.round((discount * prior.beta + (1.0 - score)) * 100) / 100;
  const episodes = prior.episodes + 1;
  const mean = Math.round((alpha / (alpha + beta)) * 1000) / 1000;
  return { alpha, beta, mean, episodes };
}

export async function readRatingsStore(cwd: string): Promise<RatingsStore> {
  const path = join(cwd, RATINGS_RELATIVE_PATH);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.version === 1 && typeof parsed.models === "object") {
      return parsed as RatingsStore;
    }
  } catch {
    // Not found, empty, or corrupted
  }
  return { version: 1, models: {} };
}

export async function writeRatingsStore(cwd: string, store: RatingsStore): Promise<void> {
  const path = join(cwd, RATINGS_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), "utf8");
}

export async function recordQuestRating(
  cwd: string,
  modelName: string,
  state: QuestState,
  outcome: "COMPLETED" | "FAILED" | "ABANDONED",
  explicitRating?: number,
): Promise<ModelRatingProfile> {
  if (!modelName || modelName.trim() === "") {
    return {
      overall: { alpha: 20, beta: 5, mean: 0.8, episodes: 0 },
      lastUpdated: new Date().toISOString(),
    };
  }

  const cleanModel = modelName.trim();
  const store = await readRatingsStore(cwd);
  const existing = store.models[cleanModel] ?? {
    overall: { alpha: 16, beta: 4, mean: 0.8, episodes: 0 }, // Prior: mean = 0.8, kappa = 20
    byTier: {},
    byKind: {},
    lastUpdated: new Date().toISOString(),
  };

  const score = calculateEpisodeScore(state, outcome, explicitRating);
  const updatedOverall = updateBetaDistribution(existing.overall, score);

  const tier = state.difficulty;
  const existingTier = existing.byTier?.[tier] ?? { alpha: 16, beta: 4, mean: 0.8, episodes: 0 };
  const updatedTier = updateBetaDistribution(existingTier, score);

  const kind = state.kind;
  const existingKind = existing.byKind?.[kind] ?? { alpha: 16, beta: 4, mean: 0.8, episodes: 0 };
  const updatedKind = updateBetaDistribution(existingKind, score);

  const profile: ModelRatingProfile = {
    overall: updatedOverall,
    byTier: { ...existing.byTier, [tier]: updatedTier },
    byKind: { ...existing.byKind, [kind]: updatedKind },
    lastUpdated: new Date().toISOString(),
  };

  store.models[cleanModel] = profile;
  await writeRatingsStore(cwd, store);
  return profile;
}

export interface QuestHandoffReceipt {
  qid: string;
  model: string;
  timestamp: string;
  commitHashes: string[];
  filesModified: string[];
  observedTurnsRemaining: number;
}

export const HANDOFF_RELATIVE_PATH = join(".pi", "quest", "recent-handoff.json");

export async function readHandoffReceipt(cwd: string): Promise<QuestHandoffReceipt | null> {
  const path = join(cwd, HANDOFF_RELATIVE_PATH);
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.qid === "string") {
      return parsed as QuestHandoffReceipt;
    }
  } catch {
    // Missing, empty, or invalid
  }
  return null;
}

export async function writeHandoffReceipt(cwd: string, receipt: QuestHandoffReceipt): Promise<void> {
  const path = join(cwd, HANDOFF_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(receipt, null, 2), "utf8");
}

export async function clearHandoffReceipt(cwd: string): Promise<void> {
  const path = join(cwd, HANDOFF_RELATIVE_PATH);
  try {
    await writeFile(path, "{}", "utf8");
  } catch {
    // ignore
  }
}

export async function applyModelPenalty(
  cwd: string,
  modelName: string,
  penaltyScore: number,
  tier?: QuestDifficulty,
  kind?: QuestKind,
): Promise<ModelRatingProfile> {
  const cleanModel = modelName.trim();
  const store = await readRatingsStore(cwd);
  const existing = store.models[cleanModel] ?? {
    overall: { alpha: 16, beta: 4, mean: 0.8, episodes: 0 },
    byTier: {},
    byKind: {},
    lastUpdated: new Date().toISOString(),
  };

  const updatedOverall = updateBetaDistribution(existing.overall, penaltyScore);

  let updatedByTier = existing.byTier;
  if (tier) {
    const existingTier = existing.byTier?.[tier] ?? { alpha: 16, beta: 4, mean: 0.8, episodes: 0 };
    updatedByTier = { ...existing.byTier, [tier]: updateBetaDistribution(existingTier, penaltyScore) };
  }

  let updatedByKind = existing.byKind;
  if (kind) {
    const existingKind = existing.byKind?.[kind] ?? { alpha: 16, beta: 4, mean: 0.8, episodes: 0 };
    updatedByKind = { ...existing.byKind, [kind]: updateBetaDistribution(existingKind, penaltyScore) };
  }

  const profile: ModelRatingProfile = {
    overall: updatedOverall,
    byTier: updatedByTier,
    byKind: updatedByKind,
    lastUpdated: new Date().toISOString(),
  };

  store.models[cleanModel] = profile;
  await writeRatingsStore(cwd, store);
  return profile;
}

export async function checkPostQuestReversions(
  cwd: string,
  execGit: (args: string[]) => Promise<{ code?: number; exitCode?: number; stdout?: string; output?: string } | undefined>,
): Promise<{ reverted: boolean; reason?: string }> {
  const receipt = await readHandoffReceipt(cwd);
  if (!receipt || receipt.observedTurnsRemaining <= 0 || receipt.commitHashes.length === 0) {
    return { reverted: false };
  }

  // Decrement observation turns
  receipt.observedTurnsRemaining -= 1;
  await writeHandoffReceipt(cwd, receipt);

  for (const hash of receipt.commitHashes) {
    try {
      const res = await execGit(["merge-base", "--is-ancestor", hash, "HEAD"]);
      const code = res?.code ?? res?.exitCode ?? 1;
      if (code !== 0) {
        await applyModelPenalty(cwd, receipt.model, 0.0);
        await clearHandoffReceipt(cwd);
        return { reverted: true, reason: `Commit ${hash.slice(0, 8)} from quest ${receipt.qid} was reset or reverted.` };
      }
    } catch {
      // ignore
    }
  }

  return { reverted: false };
}

export const CORRECTION_EXEMPLARS: ExemplarTable = {
  correction: [
    "Wait, that broke the build",
    "You broke the login handler",
    "Undo that change immediately",
    "Revert the last commit",
    "That doesn't work at all",
    "Tests are failing now",
    "You implemented the wrong file",
    "That change introduced a regression",
    "Isso estragou o build",
    "Não funciona, desfaz isso",
    "Os testes estão a falhar",
  ],
  advance: [
    "Thanks, looks good!",
    "Now let's implement the next feature",
    "Can you explain how this works?",
    "Great work, moving on",
    "Let's start the next task",
    "Commit my work",
    "Show me git status",
    "Obrigado, ficou ótimo",
    "Agora vamos fazer a próxima funcionalidade",
  ],
};

export async function isCorrectionByJudge(
  text: string,
  cfg: QuestConfig,
): Promise<boolean> {
  if (cfg.embedMode === "off" || cfg.judgeMode === "off") {
    return false;
  }

  const examples = mergeExemplars(CORRECTION_EXEMPLARS, {});
  const verdict = await nearestExemplar(cfg, examples, text);
  if (verdict === null) return false;

  const gated = gate(verdict, {
    minSimilarity: cfg.intentMinSimilarity,
    minMargin: 0.05,
    harmless: "advance",
    actionable: new Set(["correction"]),
  });

  return gated === "correction";
}

export async function checkPostQuestCorrection(
  cwd: string,
  text: string,
  config?: QuestConfig,
): Promise<{ corrected: boolean; reason?: string }> {
  const receipt = await readHandoffReceipt(cwd);
  if (!receipt || receipt.observedTurnsRemaining < 2) {
    return { corrected: false };
  }

  const cfg = config ?? await readQuestConfig(cwd);
  const isCorrection = await isCorrectionByJudge(text, cfg);

  if (isCorrection) {
    await applyModelPenalty(cwd, receipt.model, 0.25);
    await clearHandoffReceipt(cwd);
    return {
      corrected: true,
      reason: `Operator reported correction on model ${receipt.model} following quest ${receipt.qid}: "${text.trim().slice(0, 100)}"`,
    };
  }

  return { corrected: false };
}
