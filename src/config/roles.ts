import type { DraftThresholds, QuestConfig, QuestDifficulty } from "./schema";
import { DEFAULT_CONFIG } from "./defaults";

export function getThresholdsForDifficulty(
  cfg: QuestConfig,
  difficulty: QuestDifficulty = "standard",
): DraftThresholds {
  return cfg.difficultyThresholds?.[difficulty] ?? cfg.draftThresholds ?? DEFAULT_CONFIG.draftThresholds;
}

export function resolveRoleFallbacks(cfg: QuestConfig, role: "reviewer" | "validator"): string[] {
  return (role === "reviewer" ? cfg.roles.reviewerChain : cfg.roles.validatorChain) ?? [];
}

export function resolveRoleModel(
  cfg: QuestConfig,
  role: "reviewer" | "validator" | "judge",
): string | undefined {
  if (role === "reviewer") return cfg.roles.reviewer ?? cfg.reviewerModel;
  if (role === "validator") return cfg.roles.validator ?? cfg.validatorModel;
  if (role === "judge") return cfg.roles.judge ?? cfg.judgeModel;
  return undefined;
}
