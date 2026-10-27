// HIGH_LEVEL: #configurations — turns silently-dropped settings into readable
// warnings. loadConfig stays forgiving (bad values fall back to defaults);
// this tells the operator which values were ignored and why.
import { globMatches, parsePolicyRules } from "./effective";

const POLICIES = ["strict", "balanced", "off"];
const MODES = ["enforce", "warn", "off"];
const TIERS = ["trivial", "standard", "complex"];
const TIER_FIELDS = ["citations", "steps", "requireVerification"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function policyWarnings(raw: Record<string, unknown>, out: string[]): void {
  const rp = raw["reviewPolicy"];
  if (rp !== undefined && !POLICIES.includes(String(rp))) {
    out.push(`reviewPolicy "${String(rp)}" is not one of ${POLICIES.join("/")} — using "strict".`);
  }
  const rules = raw["policyByModel"];
  if (isRecord(rules)) {
    for (const [pattern, value] of Object.entries(rules)) {
      if (!POLICIES.includes(String(value).trim().toLowerCase())) {
        out.push(`policyByModel "${pattern}": "${String(value)}" is not one of ${POLICIES.join("/")} — rule ignored.`);
      }
    }
    const valid = parsePolicyRules(rules);
    valid.forEach((rule, i) => {
      const shadow = valid.slice(0, i).find((earlier) => globMatches(earlier.pattern, rule.pattern));
      if (shadow !== undefined) {
        out.push(`policyByModel "${rule.pattern}" can never match: earlier rule "${shadow.pattern}" already covers it (first match wins; put specific rules first).`);
      }
    });
  } else if (rules !== undefined && typeof rules !== "string") {
    out.push("policyByModel must be an object mapping glob patterns to a policy — ignored.");
  }
}

function qualityWarnings(raw: Record<string, unknown>, out: string[]): void {
  const dq = raw["draftQuality"];
  if (typeof dq === "string") {
    if (!MODES.includes(dq.trim().toLowerCase())) out.push(`draftQuality "${dq}" is not one of ${MODES.join("/")} — using "enforce".`);
    return;
  }
  if (!isRecord(dq)) return;
  if (dq["mode"] !== undefined && !MODES.includes(String(dq["mode"]).trim().toLowerCase())) {
    out.push(`draftQuality.mode "${String(dq["mode"])}" is not one of ${MODES.join("/")} — using "enforce".`);
  }
  const tiers = dq["tiers"];
  if (!isRecord(tiers)) return;
  for (const [tier, fields] of Object.entries(tiers)) {
    if (!TIERS.includes(tier)) {
      out.push(`draftQuality.tiers.${tier} is not a difficulty tier (${TIERS.join("/")}) — ignored.`);
      continue;
    }
    if (!isRecord(fields)) continue;
    for (const [field, value] of Object.entries(fields)) {
      if (!TIER_FIELDS.includes(field)) {
        out.push(`draftQuality.tiers.${tier}.${field} is unknown (expected ${TIER_FIELDS.join("/")}) — ignored.`);
      } else if (field === "requireVerification" ? typeof value !== "boolean" : typeof value !== "number" || value < 0) {
        out.push(`draftQuality.${tier}.${field} must be ${field === "requireVerification" ? "true or false" : "a number >= 0"} (got ${JSON.stringify(value)}) — using the default.`);
      }
    }
  }
}

export function collectConfigWarnings(raw: unknown): string[] {
  if (!isRecord(raw)) return [];
  const out: string[] = [];
  policyWarnings(raw, out);
  qualityWarnings(raw, out);
  return out;
}
