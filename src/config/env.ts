import type { ActionRule, LintRule, PolicyRule, ReviewPolicy } from "./schema";

const POLICIES: ReadonlySet<string> = new Set(["strict", "balanced", "off"]);

function asPolicy(raw: unknown): ReviewPolicy | undefined {
  if (typeof raw !== "string") return undefined;
  const lower = raw.trim().toLowerCase();
  return POLICIES.has(lower) ? (lower as ReviewPolicy) : undefined;
}

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

export function getEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process?.env) {
    return process.env[key];
  }
  if (typeof Deno !== "undefined" && Deno?.env) {
    return Deno.env.get(key);
  }
  return undefined;
}

export function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim());
}

export function unitInterval(raw: unknown, fallback: number): number {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

export function parseExemplars(raw: unknown): Record<string, string[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [kind, list] of Object.entries(raw)) {
    const items = stringList(list);
    if (items.length > 0) out[kind] = items;
  }
  return out;
}

export function parseLintRules(raw: unknown): LintRule[] {
  if (!Array.isArray(raw)) return [];
  const out: LintRule[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r["id"] !== "string" || typeof r["linePattern"] !== "string" || typeof r["message"] !== "string") continue;
    const optional = ["filePattern", "excludeFilePattern", "excludeLinePattern"] as const;
    try {
      new RegExp(r["linePattern"]);
      for (const k of optional) if (typeof r[k] === "string") new RegExp(r[k] as string);
    } catch {
      continue;
    }
    const rule: LintRule = { id: r["id"], message: r["message"], linePattern: r["linePattern"] };
    for (const k of optional) if (typeof r[k] === "string") rule[k] = r[k] as string;
    out.push(rule);
  }
  return out;
}

export function parseActionMatrix(raw: unknown): ActionRule[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionRule[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const pattern = typeof r["pattern"] === "string" ? r["pattern"].trim() : "";
    if (pattern === "") continue;
    try {
      new RegExp(pattern);
    } catch {
      continue;
    }
    const buildCommands = stringList(r["buildCommands"] ?? r["build"]);
    const testCommands = stringList(r["testCommands"] ?? r["test"]);
    const scope = typeof r["scope"] === "string" ? r["scope"].trim() : undefined;
    const name = typeof r["name"] === "string" ? r["name"].trim() : undefined;
    const warning = typeof r["warning"] === "string" ? r["warning"].trim() : undefined;
    out.push({
      ...(name ? { name } : {}),
      ...(scope ? { scope } : {}),
      pattern,
      ...(buildCommands.length > 0 ? { buildCommands } : {}),
      ...(testCommands.length > 0 ? { testCommands } : {}),
      ...(warning ? { warning } : {}),
    });
  }
  return out;
}

export function parseModelList(raw: unknown): string[] {
  const items = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  return items
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter((m) => m !== "");
}

export function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
