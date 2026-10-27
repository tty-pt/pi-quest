// HIGH_LEVEL: #modes — draftQuality settings: types, defaults and parsing.
// Dependency-free so config.ts can load it without pulling in the assessor.
import type { QuestDifficulty } from "../domain/quest";

export type DraftQualityMode = "enforce" | "warn" | "off";

export interface DraftQualityTier {
  /** Minimum citations (file:line) that resolve in the working tree. */
  citations: number;
  /** Minimum discrete plan steps (list items). Standard quests only. */
  steps: number;
  /** Plan must name a test/verify action. Standard quests only. */
  requireVerification: boolean;
}

export interface DraftQualityConfig {
  mode: DraftQualityMode;
  tiers: Record<QuestDifficulty, DraftQualityTier>;
}

export const DEFAULT_DRAFT_QUALITY: DraftQualityConfig = {
  mode: "enforce",
  tiers: {
    trivial: { citations: 0, steps: 1, requireVerification: false },
    standard: { citations: 2, steps: 3, requireVerification: true },
    complex: { citations: 4, steps: 5, requireVerification: true },
  },
};

const TIERS: QuestDifficulty[] = ["trivial", "standard", "complex"];

function nonNegInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function parseDraftQuality(raw: unknown): DraftQualityConfig {
  const rec = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const mode: DraftQualityMode = rec["mode"] === "enforce" || rec["mode"] === "warn" || rec["mode"] === "off"
    ? rec["mode"]
    : DEFAULT_DRAFT_QUALITY.mode;
  const rawTiers = typeof rec["tiers"] === "object" && rec["tiers"] !== null ? (rec["tiers"] as Record<string, unknown>) : {};
  const tiers = {} as Record<QuestDifficulty, DraftQualityTier>;
  for (const tier of TIERS) {
    const base = DEFAULT_DRAFT_QUALITY.tiers[tier];
    const obj = typeof rawTiers[tier] === "object" && rawTiers[tier] !== null ? (rawTiers[tier] as Record<string, unknown>) : {};
    tiers[tier] = {
      citations: nonNegInt(obj["citations"], base.citations),
      steps: nonNegInt(obj["steps"], base.steps),
      requireVerification: typeof obj["requireVerification"] === "boolean" ? obj["requireVerification"] : base.requireVerification,
    };
  }
  return { mode, tiers };
}

