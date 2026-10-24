// HIGH_LEVEL: #configurations — settings under "pi-quest", all optional.
// HIGH_LEVEL: #interfaces — the review binding names the peer runner; built-ins apply otherwise.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export interface DraftThresholds {
  requirements: number;
  evidence: number;
}

export interface InterfaceBindings {
  reviewRunner: { tool: string };
}

export type StatusStyle = "icon" | "text";
export type JudgeMode = "auto" | "systemone" | "heuristic" | "off";
export type JudgeFallback = "heuristic" | "skip";

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
  bindings: InterfaceBindings;
  statusStyle: StatusStyle;
  autoArchive: boolean;
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
  bindings: { reviewRunner: { tool: "subagent" } },
  statusStyle: "icon",
  autoArchive: true,
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

  return {
    askTimeoutMs: typeof timeout === "number" ? timeout : DEFAULT_CONFIG.askTimeoutMs,
    depthCap: typeof depth === "number" ? depth : DEFAULT_CONFIG.depthCap,
    statusStyle: style === "icon" || style === "text" ? style : DEFAULT_CONFIG.statusStyle,
    autoArchive: typeof autoArchive === "boolean" ? autoArchive : DEFAULT_CONFIG.autoArchive,
    draftThresholds: {
      requirements: typeof thresholds?.["requirements"] === "number"
        ? thresholds["requirements"] as number
        : DEFAULT_CONFIG.draftThresholds.requirements,
      evidence: typeof thresholds?.["evidence"] === "number"
        ? thresholds["evidence"] as number
        : DEFAULT_CONFIG.draftThresholds.evidence,
    },
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
