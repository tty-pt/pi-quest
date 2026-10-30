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

export interface PolicyRule {
  pattern: string;
  policy: ReviewPolicy;
}

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
export function evaluateModelRisk(modelName?: string): number {
  if (!modelName) return 1.5;
  const m = modelName.toLowerCase();
  if (/(?:claude-3-5-sonnet|claude-3\.5-sonnet|claude-sonnet-5|gpt-4o$|gemini-2\.5-pro|gemini-pro|o1|o3)/i.test(m)) {
    return 1.0;
  }
  if (/(?:gemini-.*flash|gpt-4o-mini|claude-.*haiku|qwen.*32b|codestral|mistral-large)/i.test(m)) {
    return 1.5;
  }
  if (/(?:0\.5b|1b|3b|7b|8b|14b|qwen.*0\.5b|qwen.*7b|llama.*8b|olmoe)/i.test(m)) {
    return 2.5;
  }
  return 1.5;
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
): number {
  const d = difficultyLevel(difficulty);
  const risk = evaluateModelRisk(modelName);
  return (d * risk) + (setbackCount * 1.5);
}

function asPolicy(value: unknown): ReviewPolicy | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  return POLICIES.has(v) ? (v as ReviewPolicy) : undefined;
}

// Accepts the settings object form ({ "glob": "policy" }) and the env-var
// string form ("glob=policy,glob=policy"). Order is preserved; invalid entries
// are dropped here and reported by collectConfigWarnings.
export function parsePolicyRules(raw: unknown): PolicyRule[] {
  let entries: Array<[string, unknown]> = [];
  if (typeof raw === "string") {
    entries = raw.split(",").map((part): [string, unknown] => {
      const eq = part.lastIndexOf("=");
      return eq < 0 ? ["", ""] : [part.slice(0, eq), part.slice(eq + 1)];
    });
  } else if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    entries = Object.entries(raw as Record<string, unknown>);
  }
  const rules: PolicyRule[] = [];
  for (const [pattern, value] of entries) {
    const policy = asPolicy(value);
    if (pattern.trim() === "" || policy === undefined) continue;
    rules.push({ pattern: pattern.trim(), policy });
  }
  return rules;
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
