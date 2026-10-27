// HIGH_LEVEL: #modes — policyByModel. The review policy follows the model that
// is actually doing the work: ordered glob rules map "provider/id" to
// strict|balanced|off; no match keeps the configured reviewPolicy. The model
// comes from the live ctx.model (so /model switches count), resolving the
// quest/auto virtual model to the physical model it last routed to, and falls
// back to the launcher env.
import type { QuestConfig, ReviewPolicy } from "../config";
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
