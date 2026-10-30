// HIGH_LEVEL: #working together — choice normalization helpers.
// System One decisions evaluate choices across declared options using fast reflexive inference.
// String cleaning and option matching helpers remain for general tool usage.
import type { QuestConfig } from "../config.ts";
import { nearestExemplar } from "./nearest.ts";

export interface JudgeOption {
  key: string;
  description: string;
}

export interface JudgeQuestion {
  id: string;
  state: string;
  instructions: string;
  options: JudgeOption[];
}

export function extractJevAnswer(data: unknown, questionId: string): unknown {
  if (typeof data !== "object" || data === null) return undefined;
  const answers = (data as { answers?: Record<string, unknown> }).answers;
  if (!answers || typeof answers !== "object") return undefined;
  const q = answers[questionId];
  if (!q || typeof q !== "object") return undefined;
  return (q as { choice?: unknown }).choice;
}

export function resolveChoice(raw: string, options: JudgeOption[]): string | null {
  const norm = raw.trim().toLowerCase();
  for (const opt of options) {
    if (opt.key.toLowerCase() === norm) return opt.key;
  }
  return null;
}

export function normalizeJevUrl(baseUrlOrUrl: string): string {
  const trimmed = baseUrlOrUrl.trim();
  if (trimmed.includes("/systemone")) {
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }
  return `${trimmed.replace(/\/+$/, "").replace(/\/api\/v1\/systemone$/, "").replace(/\/v1$/, "")}/api/v1/systemone/`;
}

/**
 * System One evaluates the question instructions across the declared choice options
 * using fast reflexive classification rather than slow generative sampling.
 */
export async function askJudgeChoice(
  cfg: QuestConfig,
  question: JudgeQuestion,
): Promise<string | null> {
  if (cfg.judgeMode === "off" || question.options.length === 0) {
    return null;
  }
  const decision = await nearestExemplar(
    cfg,
    question.options.map((o) => ({ kind: o.key, text: o.description || o.key })),
    question.instructions,
  );
  if (!decision) return null;
  return resolveChoice(decision.kind, question.options);
}
