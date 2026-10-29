// HIGH_LEVEL: #working together — choice normalization helpers.
// Generative Jev / System One choices have been deprecated in favor of pure embeddings.
// String cleaning and option matching helpers remain for general tool usage.
import type { QuestConfig } from "../config.ts";

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
 * Deprecated: Generative judge calls are removed in favor of embeddings (/v1/classify).
 * Always returns null to ensure deterministic fallback.
 */
export async function askJudgeChoice(
  cfg: QuestConfig,
  question: JudgeQuestion,
): Promise<string | null> {
  // Pure embeddings (/v1/classify) replace generative LLM choice calls.
  // When an explicit judgeUrl is provided pointing to a systemone endpoint,
  // execute the request cleanly.
  if (cfg.judgeMode === "off" || !cfg.judgeUrl) {
    return null;
  }
  const url = `${normalizeJevUrl(cfg.judgeUrl)}question`;
  try {
    const payload = {
      model: cfg.judgeModel,
      messages: [{ role: "user", content: question.instructions }],
      temperature: 0.0,
      max_tokens: 32,
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const answer = extractJevAnswer(data, question.id);
    if (typeof answer === "string") {
      return resolveChoice(answer, question.options);
    }
    return null;
  } catch {
    return null;
  }
}
