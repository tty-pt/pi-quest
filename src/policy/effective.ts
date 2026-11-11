// HIGH_LEVEL: #modes — policyByModel. The review policy follows the model that
// is actually doing the work: ordered glob rules map "provider/id" to
// strict|balanced|off; no match keeps the configured reviewPolicy. The model
// comes from the live ctx.model (so /model switches count), resolving the
// quest/auto virtual model to the physical model it last routed to, and falls
// back to the launcher env.
import type { QuestConfig, ReviewPolicy } from "../config";
import { difficultyLevel, type QuestDifficulty } from "../domain/quest";
import type { PiCtx } from "../hooks/events";
import { lastRoutedModel } from "../router/last-route";

export { parsePolicyRules, type PolicyRule } from "../config";

export interface EffectivePolicy {
  policy: ReviewPolicy;
  model: string;
  rule?: string;
}

const POLICIES: ReadonlySet<string> = new Set(["strict", "balanced", "off"]);
const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/i;

/**
 * Model Capability & Risk Rating:
 * - Tier 1 (High capability / low hallucination risk): 1.0
 *   e.g. Claude 3.5 Sonnet, GPT-4o, Gemini 2.5 Pro, O1, O3
 * - Tier 2 (Moderate capability / fast): 1.5
 *   e.g. Gemini 3.8 Flash, GPT-4o-mini, Qwen 2.5 Coder 32B
 * - Tier 3 (Small / lightweight / local): 2.5
 *   e.g. 7B, 8B, 14B, 0.5B, or unknown/unspecified models
 */
export const DEFAULT_MODEL_ACCURACY: Record<string, number> = {
  "*claude-3-5-sonnet*": 1.0,
  "*claude-3.5-sonnet*": 1.0,
  "*claude-sonnet-5*": 1.0,
  "*gpt-4o": 1.0,
  "*gemini-4-argon*": 1.0,
  "*gemini-3.1-pro*": 0.95,
  "*gemini-2.5-pro*": 1.0,
  "*gemini-pro*": 1.0,
  "*o1*": 1.0,
  "*o3*": 1.0,
  "*gemini*flash*": 0.67,
  "*gpt-4o-mini*": 0.67,
  "*claude*haiku*": 0.67,
  "*qwen*32b*": 0.67,
  "*codestral*": 0.67,
  "*mistral-large*": 0.67,
  "*0.5b*": 0.40,
  "*1b*": 0.40,
  "*3b*": 0.40,
  "*7b*": 0.40,
  "*8b*": 0.40,
  "*14b*": 0.40,
  "*llama*8b*": 0.40,
  "*olmoe*": 0.40,
  "*": 0.67,
};

export function resolveModelAccuracy(
  modelName?: string,
  accuracyMap?: Record<string, number>,
): number | undefined {
  if (!modelName || !accuracyMap) return undefined;
  const model = modelName.trim().replace(THINKING_SUFFIX, "");
  if (model === "") return undefined;

  for (const [pattern, score] of Object.entries(accuracyMap)) {
    if (globMatches(pattern, model)) {
      return score;
    }
  }
  return undefined;
}

export function evaluateModelRisk(
  modelName?: string,
  accuracyMap?: Record<string, number>,
): number {
  if (!modelName) return 1.5;
  if (accuracyMap && Object.keys(accuracyMap).length > 0) {
    const customAccuracy = resolveModelAccuracy(modelName, accuracyMap);
    if (customAccuracy !== undefined && customAccuracy > 0) {
      return Math.round((1.0 / customAccuracy) * 10) / 10;
    }
  }
  const defaultAccuracy = resolveModelAccuracy(modelName, DEFAULT_MODEL_ACCURACY);
  if (defaultAccuracy !== undefined && defaultAccuracy > 0) {
    return Math.round((1.0 / defaultAccuracy) * 10) / 10;
  }
  return 1.5;
}

export type AutonomyLevel = 1 | 2 | 3;

/**
 * Maps ReviewNeed N to Autonomy Level:
 * - Level 3 (Full Autonomy): N <= 2.2 (high trust, zero subagent overhead)
 * - Level 2 (Balanced Autonomy): 2.2 < N <= 4.5 (plan self-approved, test receipt gates archive)
 * - Level 1 (Supervised Audit): N > 4.5 (mandatory independent reviewer and validator subagents)
 */
export function resolveAutonomyLevel(need: number): AutonomyLevel {
  if (need <= 2.2) return 3;
  if (need <= 4.5) return 2;
  return 1;
}

/**
 * Calculate dynamic review need based on numeric difficulty (1..5), model capability risk,
 * and recent quest setbacks / verification failures.
 * ReviewNeed = (Difficulty * ModelRisk) + (Setbacks * 1.5)
 */
export function calculateReviewNeed(
  difficulty: QuestDifficulty | number,
  modelName?: string,
  setbackCount = 0,
  accuracyMap?: Record<string, number>,
): number {
  const d = difficultyLevel(difficulty);
  const risk = evaluateModelRisk(modelName, accuracyMap);
  return Math.round(((d * risk) + (setbackCount * 1.5)) * 10) / 10;
}





// '*' matches any run of characters; everything else is literal; anchored and
// case-insensitive.
export function globMatches(pattern: string, text: string): boolean {
  const body = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}$`, "i").test(text);
}

function readEnv(name: string): string | undefined {
  const proc = (globalThis as Record<string, unknown>)["process"] as { env?: Record<string, unknown> } | undefined;
  const value = proc?.env?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function modelKeyOf(model: unknown): string {
  if (typeof model === "string") return model;
  if (typeof model !== "object" || model === null) return "";
  const m = model as { provider?: unknown; id?: unknown };
  if (typeof m.provider === "string" && typeof m.id === "string") return `${m.provider}/${m.id}`;
  return typeof m.id === "string" ? m.id : "";
}

export function resolveActiveModel(ctx: PiCtx | undefined, config: QuestConfig): string {
  let key = modelKeyOf((ctx as { model?: unknown } | undefined)?.model);
  const virtual = `${config.router.provider}/${config.router.id}`;
  if (key.toLowerCase() === virtual.toLowerCase()) {
    const fallback = config.router.default;
    key = lastRoutedModel() ?? (Array.isArray(fallback) ? fallback[0] ?? "" : fallback);
  }
  if (key === "") {
    const provider = readEnv("PI_PROVIDER");
    const model = readEnv("PI_MODEL");
    key = provider !== undefined && model !== undefined ? `${provider}/${model}` : model ?? "";
  }
  return key.trim().replace(THINKING_SUFFIX, "");
}

export function effectivePolicy(config: QuestConfig, ctx: PiCtx | undefined): EffectivePolicy {
  if (config.policyByModel.length === 0) return { policy: config.reviewPolicy, model: "" };
  const model = resolveActiveModel(ctx, config);
  if (model !== "") {
    for (const rule of config.policyByModel) {
      if (globMatches(rule.pattern, model)) return { policy: rule.policy, model, rule: rule.pattern };
    }
  }
  return { policy: config.reviewPolicy, model };
}

// The config every review site should read: reviewPolicy replaced by the
// model-resolved policy, with a human note for wake messages. Identity when no
// rules exist, so the common case costs nothing.
export function withEffectivePolicy(config: QuestConfig, ctx: PiCtx | undefined): QuestConfig {
  if (config.policyByModel.length === 0) return config;
  const eff = effectivePolicy(config, ctx);
  const note = eff.rule !== undefined
    ? `${eff.model} matched policyByModel "${eff.rule}"`
    : `${eff.model || "unknown model"} matched no policyByModel rule`;
  return { ...config, reviewPolicy: eff.policy, policyNote: note };
}
