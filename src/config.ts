// HIGH_LEVEL: #configurations — settings under "pi-quest", all optional.
// HIGH_LEVEL: #interfaces — the review binding names the peer runner; built-ins apply otherwise.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { QuestDifficulty } from "./domain/quest.ts";
import type { RouterConfig, ModelSpec } from "./router/types.ts";
import { parsePolicyRules, type PolicyRule } from "./policy/effective.ts";
import { DEFAULT_DRAFT_QUALITY, parseDraftQuality, type DraftQualityConfig } from "./drafting/quality-config.ts";
export type { QuestDifficulty, RouterConfig, ModelSpec };

export interface DraftThresholds {
  requirements: number;
  evidence: number;
}

export type EmbedMode = "auto" | "off";
export type DifficultyMode = "auto" | "judge" | "heuristic" | "off";

export type DifficultyThresholds = Record<QuestDifficulty, DraftThresholds>;

export const DEFAULT_DIFFICULTY_THRESHOLDS: DifficultyThresholds = {
  trivial: { requirements: 1, evidence: 2 },
  standard: { requirements: 2, evidence: 7 },
  complex: { requirements: 3, evidence: 10 },
};

export interface InterfaceBindings {
  reviewRunner: { tool: string };
}

export type StatusStyle = "icon" | "text";
export type JudgeMode = "auto" | "systemone" | "heuristic" | "off";
export type JudgeProtocol = "auto" | "systemzero" | "systemone";
export type JudgeFallback = "heuristic" | "skip";
export type ReviewPolicy = "strict" | "balanced" | "off";

export interface LintRule {
  id: string;
  /** Regex source matched against the changed file path (all files when absent). */
  filePattern?: string;
  /** Files matching this regex source are exempt. */
  excludeFilePattern?: string;
  /** Added lines matching this regex source are exempt (sanctioned forms). */
  excludeLinePattern?: string;
  /** Regex source matched against each added line. */
  linePattern: string;
  message: string;
}

export type MidQuestMode = "hybrid" | "autonomous" | "interactive" | "off";
export type SubQuestAction = "queue_backlog" | "preempt_now" | "ask_human";

export interface MidQuestConfig {
  mode: MidQuestMode;
  subquestAction: SubQuestAction;
  autoAmendRequirements: boolean;
  turnInjection: boolean;
  promptTimeoutMs: number;
}

export const DEFAULT_MID_QUEST_CONFIG: MidQuestConfig = {
  mode: "hybrid",
  subquestAction: "queue_backlog",
  autoAmendRequirements: true,
  turnInjection: true,
  promptTimeoutMs: 10000,
};

export interface RoleModels {
  reviewer?: string;
  validator?: string;
  judge?: string;
  // Ordered fallback models tried after the primary role model when a launch
  // fails with a provider/model/rate-limit error. Derived from the tail of
  // roles.reviewer / roles.validator; the legacy *Fallback settings keys are no
  // longer read.
  reviewerChain?: string[];
  validatorChain?: string[];
}

export const DEFAULT_TRIGGER_PREFIXES: string[] = [
  "quest:",
  "task:",
  "fix:",
  "feat:",
  "refactor:",
  "chore:",
  "test:",
  "@quest",
  "!quest",
];

export interface QuestConfig {
  askTimeoutMs: number;
  depthCap: number;
  draftThresholds: DraftThresholds;
  difficultyMode: DifficultyMode;
  defaultDifficulty: QuestDifficulty;
  difficultyThresholds: DifficultyThresholds;
  bindings: InterfaceBindings;
  statusStyle: StatusStyle;
  autoArchive: boolean;
  reviewPolicy: ReviewPolicy;
  /** Ordered glob rules mapping the active "provider/id" to a policy. */
  policyByModel: PolicyRule[];
  /** Set by withEffectivePolicy: why reviewPolicy has its current value. */
  policyNote?: string;
  draftQuality: DraftQualityConfig;
  reviewerModel?: string;
  validatorModel?: string;
  roles: RoleModels;
  reviewInactivityMs: number;
  reviewMaxDurationMs: number;
  planRevisionInactivityMs?: number;
  planRevisionMaxDurationMs?: number;
  planEditor: string | null;
  judgeMode: JudgeMode;
  judgeProtocol: JudgeProtocol;
  judgeUrl?: string;
  judgeModel?: string;
  judgeKey?: string;
  judgeFallback: JudgeFallback;
  judgeTimeoutMs: number;
  /** "auto" classifies operator steering by embedding similarity; "off" skips embeddings (judge / fallback only). */
  embedMode: EmbedMode;
  /** Embeddings server base URL; defaults to the judge URL. */
  embedUrl?: string;
  embedModel: string;
  /** Best-vs-runner-up cosine margin an actionable verdict (advance, abort, constraint, sub-task) must clear. */
  intentMinMargin: number;
  /** Minimum cosine similarity to the nearest exemplar for any verdict; below it the message is a refinement. */
  intentMinSimilarity: number;
  /** Operator exemplars per intent kind (any language), merged with the shipped defaults. */
  intentExemplars: Record<string, string[]>;
  triggerPrefixes: string[];
  /** Operator-owned exact messages (any language) that advance a quest when the judge is unavailable. */
  steeringPhrases: string[];
  /** Operator-declared command prefixes that count as test/build evidence (in addition to built-ins). */
  testCommands: string[];
  /** Repo-local semantic diff lint rules (none ship by default). */
  lintRules: LintRule[];
  autoStartAuren?: boolean;
  autoDownloadModels?: "auto" | "ask" | "never";
  midQuest: MidQuestConfig;
  router: RouterConfig;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  enabled: false,
  provider: "quest",
  id: "auto",
  name: "Quest Auto Router",
  default: "antigravity/gemini-3.8-flash",
  direct: "antigravity/gemini-3.8-flash",
  cooldownMs: 900000,
  matrix: {},
};

export const DEFAULT_CONFIG: QuestConfig = {
  askTimeoutMs: 60000,
  depthCap: 3,
  draftThresholds: { requirements: 2, evidence: 7 },
  difficultyMode: "auto",
  defaultDifficulty: "standard",
  difficultyThresholds: DEFAULT_DIFFICULTY_THRESHOLDS,
  bindings: { reviewRunner: { tool: "subagent" } },
  statusStyle: "icon",
  autoArchive: true,
  reviewPolicy: "strict",
  policyByModel: [],
  draftQuality: DEFAULT_DRAFT_QUALITY,
  reviewerModel: undefined,
  validatorModel: undefined,
  roles: {},
  reviewInactivityMs: 300000,
  reviewMaxDurationMs: 1500000,
  planRevisionInactivityMs: 60000,
  planRevisionMaxDurationMs: 300000,
  planEditor: null,
  judgeMode: "auto",
  judgeProtocol: "systemone",
  judgeUrl: undefined,
  judgeModel: "olmoe",
  judgeKey: undefined,
  judgeFallback: "heuristic",
  judgeTimeoutMs: 6000,
  embedMode: "auto",
  embedUrl: undefined,
  embedModel: "bge-base",
  intentMinMargin: 0.075,
  intentMinSimilarity: 0.6,
  intentExemplars: {},
  triggerPrefixes: DEFAULT_TRIGGER_PREFIXES,
  steeringPhrases: [],
  testCommands: [],
  lintRules: [],
  autoStartAuren: true,
  autoDownloadModels: "ask",
  midQuest: DEFAULT_MID_QUEST_CONFIG,
  router: DEFAULT_ROUTER_CONFIG,
};

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim());
}

function unitInterval(raw: unknown, fallback: number): number {
  const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

function parseExemplars(raw: unknown): Record<string, string[]> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [kind, list] of Object.entries(raw)) {
    const items = stringList(list);
    if (items.length > 0) out[kind] = items;
  }
  return out;
}

function parseLintRules(raw: unknown): LintRule[] {
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

function getEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process?.env) {
    return process.env[key];
  }
  if (typeof Deno !== "undefined" && Deno?.env) {
    return Deno.env.get(key);
  }
  return undefined;
}

function loadJudgeConfig(record: Record<string, unknown>): {
  judgeMode: JudgeMode;
  judgeProtocol: JudgeProtocol;
  judgeUrl?: string;
  judgeModel?: string;
  judgeKey?: string;
  judgeFallback: JudgeFallback;
  judgeTimeoutMs: number;
  triggerPrefixes: string[];
  autoStartAuren: boolean;
  autoDownloadModels: "auto" | "ask" | "never";
} {
  const rawJudgeMode = record["judgeMode"] ?? getEnv("PI_QUEST_JUDGE_MODE") ?? getEnv("PI_MM_JUDGE_MODE");
  const judgeMode: JudgeMode =
    rawJudgeMode === "auto" || rawJudgeMode === "systemone" || rawJudgeMode === "heuristic" || rawJudgeMode === "off"
      ? rawJudgeMode
      : DEFAULT_CONFIG.judgeMode;

  const rawJudgeProto = record["judgeProtocol"] ?? getEnv("PI_QUEST_JUDGE_PROTOCOL") ?? getEnv("PI_MM_JUDGE_PROTOCOL");
  const judgeProtocol: JudgeProtocol =
    rawJudgeProto === "systemzero" || rawJudgeProto === "systemone" || rawJudgeProto === "auto"
      ? rawJudgeProto
      : DEFAULT_CONFIG.judgeProtocol;

  const rawJudgeUrl =
    record["judgeUrl"] ??
    getEnv("PI_QUEST_JUDGE_URL") ??
    getEnv("PI_MM_JUDGE_URL") ??
    (judgeMode === "auto" || judgeMode === "systemone" ? "http://127.0.0.1:4242" : undefined);
  const judgeUrl = typeof rawJudgeUrl === "string" && rawJudgeUrl.trim() !== "" ? rawJudgeUrl.trim() : undefined;

  const rawJudgeModel =
    record["judgeModel"] ??
    getEnv("PI_QUEST_JUDGE_MODEL") ??
    getEnv("PI_MM_JUDGE_MODEL") ??
    DEFAULT_CONFIG.judgeModel;
  const judgeModel = typeof rawJudgeModel === "string" ? rawJudgeModel.trim() : DEFAULT_CONFIG.judgeModel;

  const rawJudgeKey =
    record["judgeKey"] ??
    getEnv("PI_QUEST_JUDGE_KEY") ??
    getEnv("PI_MM_JUDGE_KEY");
  const judgeKey = typeof rawJudgeKey === "string" && rawJudgeKey.trim() !== "" ? rawJudgeKey.trim() : undefined;

  const rawJudgeFallback = record["judgeFallback"] ?? getEnv("PI_QUEST_JUDGE_FALLBACK");
  const judgeFallback: JudgeFallback =
    rawJudgeFallback === "heuristic" || rawJudgeFallback === "skip"
      ? rawJudgeFallback
      : DEFAULT_CONFIG.judgeFallback;

  const rawJudgeTimeout = record["judgeTimeoutMs"] ?? getEnv("PI_QUEST_JUDGE_TIMEOUT_MS");
  const judgeTimeoutMs =
    typeof rawJudgeTimeout === "number" && rawJudgeTimeout > 0
      ? rawJudgeTimeout
      : typeof rawJudgeTimeout === "string" && !isNaN(Number(rawJudgeTimeout))
      ? Number(rawJudgeTimeout)
      : DEFAULT_CONFIG.judgeTimeoutMs;

  const rawTriggers = record["triggerPrefixes"] ?? getEnv("PI_QUEST_TRIGGERS");
  let triggerPrefixes: string[] = DEFAULT_TRIGGER_PREFIXES;
  if (Array.isArray(rawTriggers)) {
    triggerPrefixes = rawTriggers
      .filter((t) => typeof t === "string" && t.trim() !== "")
      .map((t) => (t as string).trim());
  } else if (typeof rawTriggers === "string" && rawTriggers.trim() !== "") {
    triggerPrefixes = rawTriggers.split(",").map((t) => t.trim()).filter(Boolean);
  }

  const autoStartRaw = record["autoStartAuren"] ?? getEnv("PI_QUEST_AUTO_START_AUREN") ?? getEnv("PI_MM_AUTO_START_AUREN");
  const autoStartAuren = typeof autoStartRaw === "boolean" ? autoStartRaw : !(autoStartRaw === "0" || autoStartRaw === "false");
  const autoDlRaw = record["autoDownloadModels"] ?? getEnv("PI_QUEST_AUTO_DOWNLOAD_MODELS") ?? getEnv("PI_MM_AUTO_DOWNLOAD_MODELS");
  const autoDownloadModels = autoDlRaw === "auto" || autoDlRaw === "ask" || autoDlRaw === "never" ? autoDlRaw : "ask";

  return {
    judgeMode,
    judgeProtocol,
    judgeUrl,
    judgeModel,
    judgeKey,
    judgeFallback,
    judgeTimeoutMs,
    triggerPrefixes,
    autoStartAuren,
    autoDownloadModels,
  };
}

export function loadRouterConfig(raw: Record<string, unknown>): RouterConfig {
  const rawRouter = (typeof raw["router"] === "object" && raw["router"] !== null)
    ? (raw["router"] as Record<string, unknown>)
    : {};

  const envEnabled = getEnv("PI_QUEST_ROUTER_ENABLED");
  const enabled = typeof rawRouter["enabled"] === "boolean"
    ? rawRouter["enabled"]
    : envEnabled !== undefined
    ? envEnabled === "true" || envEnabled === "1"
    : rawRouter["matrix"] !== undefined && typeof rawRouter["matrix"] === "object" && rawRouter["matrix"] !== null && Object.keys(rawRouter["matrix"]).length > 0;

  const provider = typeof rawRouter["provider"] === "string" && rawRouter["provider"].trim() !== ""
    ? rawRouter["provider"].trim()
    : getEnv("PI_QUEST_ROUTER_PROVIDER") ?? DEFAULT_ROUTER_CONFIG.provider;

  const id = typeof rawRouter["id"] === "string" && rawRouter["id"].trim() !== ""
    ? rawRouter["id"].trim()
    : getEnv("PI_QUEST_ROUTER_ID") ?? DEFAULT_ROUTER_CONFIG.id;

  const name = typeof rawRouter["name"] === "string" && rawRouter["name"].trim() !== ""
    ? rawRouter["name"].trim()
    : DEFAULT_ROUTER_CONFIG.name;

  const defaultModel = rawRouter["default"] !== undefined
    ? (rawRouter["default"] as ModelSpec)
    : getEnv("PI_QUEST_ROUTER_DEFAULT") ?? DEFAULT_ROUTER_CONFIG.default;

  const direct = typeof rawRouter["direct"] === "string" && rawRouter["direct"].trim() !== ""
    ? rawRouter["direct"].trim()
    : getEnv("PI_QUEST_ROUTER_DIRECT") ?? DEFAULT_ROUTER_CONFIG.direct;

  const rawCooldown = rawRouter["cooldownMs"] ?? getEnv("PI_QUEST_ROUTER_COOLDOWN_MS");
  const cooldownMs = typeof rawCooldown === "number" && rawCooldown > 0
    ? rawCooldown
    : typeof rawCooldown === "string" && !isNaN(Number(rawCooldown)) && Number(rawCooldown) > 0
    ? Number(rawCooldown)
    : DEFAULT_ROUTER_CONFIG.cooldownMs;

  const matrix = (typeof rawRouter["matrix"] === "object" && rawRouter["matrix"] !== null)
    ? (rawRouter["matrix"] as Record<string, string | string[] | Record<string, string | string[]>>)
    : {};

  return {
    enabled,
    provider,
    id,
    name,
    default: defaultModel,
    direct,
    cooldownMs,
    matrix,
  };
}

export function loadConfig(raw: unknown): QuestConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG;
  const record = raw as Record<string, unknown>;
  const timeout = record["askTimeoutMs"];
  const depth = record["depthCap"];
  const style = record["statusStyle"];
  const autoArchive = record["autoArchive"];
  const reviewInactivity = record["reviewInactivityMs"];
  const reviewMaxDuration = record["reviewMaxDurationMs"];
  const thresholds = record["draftThresholds"] as Record<string, unknown> | undefined;
  const bindings = record["bindings"] as Record<string, unknown> | undefined;
  const judge = loadJudgeConfig(record);

  const rawDiffMode = record["difficultyMode"] ?? getEnv("PI_QUEST_DIFFICULTY_MODE");
  const difficultyMode: DifficultyMode =
    rawDiffMode === "auto" || rawDiffMode === "judge" || rawDiffMode === "heuristic" || rawDiffMode === "off"
      ? rawDiffMode
      : DEFAULT_CONFIG.difficultyMode;

  const rawDefaultDiff = record["defaultDifficulty"] ?? getEnv("PI_QUEST_DEFAULT_DIFFICULTY");
  const defaultDifficulty: QuestDifficulty =
    rawDefaultDiff === "trivial" || rawDefaultDiff === "standard" || rawDefaultDiff === "complex"
      ? rawDefaultDiff
      : DEFAULT_CONFIG.defaultDifficulty;

  const rawDiffThresholds = record["difficultyThresholds"] as Record<string, unknown> | undefined;
  const parseTier = (tier: QuestDifficulty, fallback: DraftThresholds): DraftThresholds => {
    const obj = rawDiffThresholds?.[tier] as Record<string, unknown> | undefined;
    return {
      requirements: typeof obj?.["requirements"] === "number" ? obj["requirements"] : fallback.requirements,
      evidence: typeof obj?.["evidence"] === "number" ? obj["evidence"] : fallback.evidence,
    };
  };

  const draftThresholds: DraftThresholds = {
    requirements: typeof thresholds?.["requirements"] === "number"
      ? thresholds["requirements"] as number
      : DEFAULT_CONFIG.draftThresholds.requirements,
    evidence: typeof thresholds?.["evidence"] === "number"
      ? thresholds["evidence"] as number
      : DEFAULT_CONFIG.draftThresholds.evidence,
  };

  const difficultyThresholds: DifficultyThresholds = {
    trivial: parseTier("trivial", DEFAULT_DIFFICULTY_THRESHOLDS.trivial),
    standard: parseTier("standard", draftThresholds),
    complex: parseTier("complex", DEFAULT_DIFFICULTY_THRESHOLDS.complex),
  };

  const rawPolicy = record["reviewPolicy"] ?? getEnv("PI_QUEST_REVIEW_POLICY");
  const reviewPolicy: ReviewPolicy =
    rawPolicy === "strict" || rawPolicy === "balanced" || rawPolicy === "off"
      ? rawPolicy
      : DEFAULT_CONFIG.reviewPolicy;

  const rawRoles = (typeof record["roles"] === "object" && record["roles"] !== null)
    ? (record["roles"] as Record<string, unknown>)
    : {};

  // roles.reviewer / roles.validator accept a model string or an ordered list:
  // the first entry is the primary, the rest are fallbacks tried before the
  // separate *Fallback list.
  const reviewerList = parseModelList(rawRoles["reviewer"]);
  const reviewerModel =
    reviewerList[0] ??
    (typeof record["reviewerModel"] === "string" && record["reviewerModel"].trim() !== ""
      ? record["reviewerModel"].trim()
      : getEnv("PI_QUEST_REVIEWER_MODEL") ?? getEnv("PI_REVIEW_MODEL"));

  const validatorList = parseModelList(rawRoles["validator"]);
  const validatorModel =
    validatorList[0] ??
    (typeof record["validatorModel"] === "string" && record["validatorModel"].trim() !== ""
      ? record["validatorModel"].trim()
      : getEnv("PI_QUEST_VALIDATOR_MODEL") ?? getEnv("PI_VALIDATOR_MODEL"));

  const judgeModelOverride =
    parseModelList(rawRoles["judge"])[0] ?? judge.judgeModel;

  const roles: RoleModels = {
    reviewer: reviewerModel,
    validator: validatorModel,
    judge: judgeModelOverride,
    reviewerChain: dedupe(reviewerList.slice(1)),
    validatorChain: dedupe(validatorList.slice(1)),
  };

  // Align judge.judgeModel with roles.judge if set
  if (roles.judge) {
    judge.judgeModel = roles.judge;
  }

  const rawMidQuest = (typeof record["midQuest"] === "object" && record["midQuest"] !== null)
    ? (record["midQuest"] as Record<string, unknown>)
    : {};
  const rawMidQuestMode = rawMidQuest["mode"] ?? getEnv("PI_QUEST_MID_QUEST_MODE");
  const midQuestMode: MidQuestMode =
    rawMidQuestMode === "hybrid" || rawMidQuestMode === "autonomous" || rawMidQuestMode === "interactive" || rawMidQuestMode === "off"
      ? rawMidQuestMode
      : DEFAULT_MID_QUEST_CONFIG.mode;

  const rawSubquestAction = rawMidQuest["subquestAction"] ?? getEnv("PI_QUEST_MID_QUEST_SUBQUEST_ACTION");
  const subquestAction: SubQuestAction =
    rawSubquestAction === "queue_backlog" || rawSubquestAction === "preempt_now" || rawSubquestAction === "ask_human"
      ? rawSubquestAction
      : DEFAULT_MID_QUEST_CONFIG.subquestAction;

  const midQuest: MidQuestConfig = {
    mode: midQuestMode,
    subquestAction,
    autoAmendRequirements: typeof rawMidQuest["autoAmendRequirements"] === "boolean"
      ? rawMidQuest["autoAmendRequirements"]
      : DEFAULT_MID_QUEST_CONFIG.autoAmendRequirements,
    turnInjection: typeof rawMidQuest["turnInjection"] === "boolean"
      ? rawMidQuest["turnInjection"]
      : DEFAULT_MID_QUEST_CONFIG.turnInjection,
    promptTimeoutMs: typeof rawMidQuest["promptTimeoutMs"] === "number" && rawMidQuest["promptTimeoutMs"] > 0
      ? rawMidQuest["promptTimeoutMs"]
      : DEFAULT_MID_QUEST_CONFIG.promptTimeoutMs,
  };

  return {
    askTimeoutMs: typeof timeout === "number" ? timeout : DEFAULT_CONFIG.askTimeoutMs,
    depthCap: typeof depth === "number" ? depth : DEFAULT_CONFIG.depthCap,
    statusStyle: style === "icon" || style === "text" ? style : DEFAULT_CONFIG.statusStyle,
    autoArchive: typeof autoArchive === "boolean" ? autoArchive : DEFAULT_CONFIG.autoArchive,
    reviewPolicy,
    policyByModel: parsePolicyRules(record["policyByModel"] ?? getEnv("PI_QUEST_POLICY_BY_MODEL")),
    draftQuality: parseDraftQuality(record["draftQuality"] ?? getEnv("PI_QUEST_DRAFT_QUALITY")),
    reviewerModel,
    validatorModel,
    roles,
    draftThresholds,
    difficultyMode,
    defaultDifficulty,
    difficultyThresholds,
    bindings: {
      reviewRunner: {
        tool:
          typeof (bindings?.["reviewRunner"] as Record<string, unknown> | undefined)?.["tool"] === "string"
            ? (bindings?.["reviewRunner"] as Record<string, unknown>)["tool"] as string
            : DEFAULT_CONFIG.bindings.reviewRunner.tool,
      },
    },
    reviewInactivityMs: typeof reviewInactivity === "number"
      ? reviewInactivity
      : DEFAULT_CONFIG.reviewInactivityMs,
    reviewMaxDurationMs: typeof reviewMaxDuration === "number"
      ? reviewMaxDuration
      : DEFAULT_CONFIG.reviewMaxDurationMs,
    planRevisionInactivityMs: typeof record["planRevisionInactivityMs"] === "number"
      ? record["planRevisionInactivityMs"] as number
      : DEFAULT_CONFIG.planRevisionInactivityMs,
    planRevisionMaxDurationMs: typeof record["planRevisionMaxDurationMs"] === "number"
      ? record["planRevisionMaxDurationMs"] as number
      : DEFAULT_CONFIG.planRevisionMaxDurationMs,
    planEditor: typeof record["planEditor"] === "string" ? record["planEditor"] : DEFAULT_CONFIG.planEditor,
    midQuest,
    router: loadRouterConfig(record),
    ...judge,
    embedMode: (record["embedMode"] ?? getEnv("PI_QUEST_EMBED_MODE")) === "off" ? "off" : "auto",
    embedUrl: (() => {
      const raw = record["embedUrl"] ?? getEnv("PI_QUEST_EMBED_URL") ?? judge.judgeUrl ?? "http://127.0.0.1:4242";
      return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : undefined;
    })(),
    embedModel: (() => {
      const raw = record["embedModel"] ?? getEnv("PI_QUEST_EMBED_MODEL");
      return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : DEFAULT_CONFIG.embedModel;
    })(),
    intentMinMargin: unitInterval(record["intentMinMargin"] ?? getEnv("PI_QUEST_INTENT_MIN_MARGIN"), DEFAULT_CONFIG.intentMinMargin),
    intentMinSimilarity: unitInterval(
      record["intentMinSimilarity"] ?? getEnv("PI_QUEST_INTENT_MIN_SIMILARITY"),
      DEFAULT_CONFIG.intentMinSimilarity,
    ),
    intentExemplars: parseExemplars(record["intentExemplars"]),
    steeringPhrases: stringList(record["steeringPhrases"]),
    testCommands: stringList(record["testCommands"]),
    lintRules: parseLintRules(record["lintRules"]),
  };
}

export function getThresholdsForDifficulty(
  cfg: QuestConfig,
  difficulty: QuestDifficulty = "standard",
): DraftThresholds {
  return cfg.difficultyThresholds?.[difficulty] ?? cfg.draftThresholds ?? DEFAULT_CONFIG.draftThresholds;
}

// Accepts a single model string or an array of them; blanks are dropped.
function parseModelList(raw: unknown): string[] {
  const items = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  return items
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter((m) => m !== "");
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
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

// The raw "pi-quest" settings section (unvalidated), for diagnostics.
export async function readQuestSettings(cwd: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)["pi-quest"] : undefined;
  } catch {
    return undefined;
  }
}

export async function readQuestConfig(cwd: string): Promise<QuestConfig> {
  try {
    const raw = await readFile(join(cwd, ".pi", "settings.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CONFIG;
    return loadConfig((parsed as Record<string, unknown>)["pi-quest"]);
  } catch {
    return DEFAULT_CONFIG;
  }
}
