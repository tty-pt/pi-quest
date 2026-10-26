// HIGH_LEVEL: #configurations — settings under "pi-quest", all optional.
// HIGH_LEVEL: #interfaces — the review binding names the peer runner; built-ins apply otherwise.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { QuestDifficulty } from "./domain/quest.ts";
export type { QuestDifficulty };

export interface DraftThresholds {
  requirements: number;
  evidence: number;
}

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
export type JudgeFallback = "heuristic" | "skip";
export type ReviewPolicy = "strict" | "balanced" | "off";

export interface RoleModels {
  reviewer?: string;
  validator?: string;
  judge?: string;
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
  reviewerModel?: string;
  validatorModel?: string;
  roles: RoleModels;
  reviewInactivityMs: number;
  reviewMaxDurationMs: number;
  planEditor: string | null;
  judgeMode: JudgeMode;
  judgeUrl?: string;
  judgeModel?: string;
  judgeKey?: string;
  judgeFallback: JudgeFallback;
  judgeTimeoutMs: number;
  triggerPrefixes: string[];
}

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
  reviewerModel: undefined,
  validatorModel: undefined,
  roles: {},
  reviewInactivityMs: 300000,
  reviewMaxDurationMs: 1500000,
  planEditor: null,
  judgeMode: "auto",
  judgeUrl: undefined,
  judgeModel: "qwen",
  judgeKey: undefined,
  judgeFallback: "skip",
  judgeTimeoutMs: 2000,
  triggerPrefixes: DEFAULT_TRIGGER_PREFIXES,
};

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
  judgeUrl?: string;
  judgeModel?: string;
  judgeKey?: string;
  judgeFallback: JudgeFallback;
  judgeTimeoutMs: number;
  triggerPrefixes: string[];
} {
  const rawJudgeMode = record["judgeMode"] ?? getEnv("PI_QUEST_JUDGE_MODE") ?? getEnv("PI_MM_JUDGE_MODE");
  const judgeMode: JudgeMode =
    rawJudgeMode === "auto" || rawJudgeMode === "systemone" || rawJudgeMode === "heuristic" || rawJudgeMode === "off"
      ? rawJudgeMode
      : DEFAULT_CONFIG.judgeMode;

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

  return {
    judgeMode,
    judgeUrl,
    judgeModel,
    judgeKey,
    judgeFallback,
    judgeTimeoutMs,
    triggerPrefixes,
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

  const reviewerModel =
    typeof rawRoles["reviewer"] === "string" && rawRoles["reviewer"].trim() !== ""
      ? rawRoles["reviewer"].trim()
      : typeof record["reviewerModel"] === "string" && record["reviewerModel"].trim() !== ""
      ? record["reviewerModel"].trim()
      : getEnv("PI_QUEST_REVIEWER_MODEL") ?? getEnv("PI_REVIEW_MODEL");

  const validatorModel =
    typeof rawRoles["validator"] === "string" && rawRoles["validator"].trim() !== ""
      ? rawRoles["validator"].trim()
      : typeof record["validatorModel"] === "string" && record["validatorModel"].trim() !== ""
      ? record["validatorModel"].trim()
      : getEnv("PI_QUEST_VALIDATOR_MODEL") ?? getEnv("PI_VALIDATOR_MODEL");

  const judgeModelOverride =
    typeof rawRoles["judge"] === "string" && rawRoles["judge"].trim() !== ""
      ? rawRoles["judge"].trim()
      : judge.judgeModel;

  const roles: RoleModels = {
    reviewer: reviewerModel,
    validator: validatorModel,
    judge: judgeModelOverride,
  };

  // Align judge.judgeModel with roles.judge if set
  if (roles.judge) {
    judge.judgeModel = roles.judge;
  }

  return {
    askTimeoutMs: typeof timeout === "number" ? timeout : DEFAULT_CONFIG.askTimeoutMs,
    depthCap: typeof depth === "number" ? depth : DEFAULT_CONFIG.depthCap,
    statusStyle: style === "icon" || style === "text" ? style : DEFAULT_CONFIG.statusStyle,
    autoArchive: typeof autoArchive === "boolean" ? autoArchive : DEFAULT_CONFIG.autoArchive,
    reviewPolicy,
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
    planEditor: typeof record["planEditor"] === "string" ? record["planEditor"] : DEFAULT_CONFIG.planEditor,
    ...judge,
  };
}

export function getThresholdsForDifficulty(
  cfg: QuestConfig,
  difficulty: QuestDifficulty = "standard",
): DraftThresholds {
  return cfg.difficultyThresholds?.[difficulty] ?? cfg.draftThresholds ?? DEFAULT_CONFIG.draftThresholds;
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
