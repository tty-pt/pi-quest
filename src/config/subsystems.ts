import type {
  JudgeFallback,
  JudgeMode,
  JudgeProtocol,
  ModelSpec,
  RouterConfig,
} from "./schema";
import { DEFAULT_CONFIG, DEFAULT_ROUTER_CONFIG, DEFAULT_TRIGGER_PREFIXES } from "./defaults";
import { getEnv } from "./env";

export function loadJudgeConfig(record: Record<string, unknown>): {
  judgeMode: JudgeMode;
  judgeProtocol: JudgeProtocol;
  judgeUrl?: string;
  judgeModel: string;
  judgeKey?: string;
  judgeFallback: JudgeFallback;
  judgeTimeoutMs: number;
  triggerPrefixes: string[];
  autoStartAuren: boolean;
  autoDownloadModels: "auto" | "ask" | "never";
} {
  const rawMode = record["judgeMode"] ?? getEnv("PI_QUEST_JUDGE_MODE") ?? getEnv("PI_MM_JUDGE_MODE");
  const judgeMode: JudgeMode =
    rawMode === "auto" || rawMode === "systemone" || rawMode === "off" ? rawMode : DEFAULT_CONFIG.judgeMode;

  const rawProto = record["judgeProtocol"] ?? getEnv("PI_QUEST_JUDGE_PROTOCOL") ?? getEnv("PI_MM_JUDGE_PROTOCOL");
  const judgeProtocol: JudgeProtocol =
    rawProto === "systemzero" || rawProto === "systemone" || rawProto === "auto" ? rawProto : DEFAULT_CONFIG.judgeProtocol;

  const rawUrl = record["judgeUrl"] ?? getEnv("PI_QUEST_JUDGE_URL") ?? getEnv("PI_MM_JUDGE_URL") ??
    (judgeMode === "auto" || judgeMode === "systemone" ? "http://127.0.0.1:4242" : undefined);
  const judgeUrl = typeof rawUrl === "string" && rawUrl.trim() !== "" ? rawUrl.trim() : undefined;

  const rawModel = record["judgeModel"] ?? getEnv("PI_QUEST_JUDGE_MODEL") ?? getEnv("PI_MM_JUDGE_MODEL") ?? DEFAULT_CONFIG.judgeModel;
  const judgeModel = typeof rawModel === "string" ? rawModel.trim() : DEFAULT_CONFIG.judgeModel;

  const rawKey = record["judgeKey"] ?? getEnv("PI_QUEST_JUDGE_KEY") ?? getEnv("PI_MM_JUDGE_KEY");
  const judgeKey = typeof rawKey === "string" && rawKey.trim() !== "" ? rawKey.trim() : undefined;

  const rawFallback = record["judgeFallback"] ?? getEnv("PI_QUEST_JUDGE_FALLBACK");
  const judgeFallback: JudgeFallback = rawFallback === "skip" ? rawFallback : DEFAULT_CONFIG.judgeFallback;

  const rawTimeout = record["judgeTimeoutMs"] ?? getEnv("PI_QUEST_JUDGE_TIMEOUT_MS");
  const judgeTimeoutMs = typeof rawTimeout === "number" && rawTimeout > 0 ? rawTimeout
    : typeof rawTimeout === "string" && !isNaN(Number(rawTimeout)) ? Number(rawTimeout) : DEFAULT_CONFIG.judgeTimeoutMs;

  const rawTriggers = record["triggerPrefixes"] ?? getEnv("PI_QUEST_TRIGGERS");
  let triggerPrefixes: string[] = DEFAULT_TRIGGER_PREFIXES;
  if (Array.isArray(rawTriggers)) {
    triggerPrefixes = rawTriggers.filter((t) => typeof t === "string" && t.trim() !== "").map((t) => (t as string).trim());
  } else if (typeof rawTriggers === "string" && rawTriggers.trim() !== "") {
    triggerPrefixes = rawTriggers.split(",").map((t) => t.trim()).filter(Boolean);
  }

  const autoStartRaw = record["autoStartAuren"] ?? getEnv("PI_QUEST_AUTO_START_AUREN") ?? getEnv("PI_MM_AUTO_START_AUREN");
  const autoStartAuren = typeof autoStartRaw === "boolean" ? autoStartRaw : !(autoStartRaw === "0" || autoStartRaw === "false");
  const autoDlRaw = record["autoDownloadModels"] ?? getEnv("PI_QUEST_AUTO_DOWNLOAD_MODELS") ?? getEnv("PI_MM_AUTO_DOWNLOAD_MODELS");
  const autoDownloadModels = autoDlRaw === "auto" || autoDlRaw === "ask" || autoDlRaw === "never" ? autoDlRaw : "ask";

  return { judgeMode, judgeProtocol, judgeUrl, judgeModel, judgeKey, judgeFallback, judgeTimeoutMs, triggerPrefixes, autoStartAuren, autoDownloadModels };
}

export function loadRouterConfig(raw: Record<string, unknown>): RouterConfig {
  const r = (typeof raw["router"] === "object" && raw["router"] !== null) ? (raw["router"] as Record<string, unknown>) : {};
  const envEnabled = getEnv("PI_QUEST_ROUTER_ENABLED");
  const enabled = typeof r["enabled"] === "boolean" ? r["enabled"]
    : envEnabled !== undefined ? (envEnabled === "true" || envEnabled === "1")
    : r["matrix"] !== undefined && typeof r["matrix"] === "object" && r["matrix"] !== null && Object.keys(r["matrix"]).length > 0;

  const provider = typeof r["provider"] === "string" && r["provider"].trim() !== "" ? r["provider"].trim()
    : getEnv("PI_QUEST_ROUTER_PROVIDER") ?? DEFAULT_ROUTER_CONFIG.provider;
  const id = typeof r["id"] === "string" && r["id"].trim() !== "" ? r["id"].trim() : getEnv("PI_QUEST_ROUTER_ID") ?? DEFAULT_ROUTER_CONFIG.id;
  const name = typeof r["name"] === "string" && r["name"].trim() !== "" ? r["name"].trim() : DEFAULT_ROUTER_CONFIG.name;
  const defaultModel = r["default"] !== undefined ? (r["default"] as ModelSpec) : getEnv("PI_QUEST_ROUTER_DEFAULT") ?? DEFAULT_ROUTER_CONFIG.default;
  const direct = typeof r["direct"] === "string" && r["direct"].trim() !== "" ? r["direct"].trim() : getEnv("PI_QUEST_ROUTER_DIRECT") ?? DEFAULT_ROUTER_CONFIG.direct;

  const rawCd = r["cooldownMs"] ?? getEnv("PI_QUEST_ROUTER_COOLDOWN_MS");
  const cooldownMs = typeof rawCd === "number" && rawCd > 0 ? rawCd
    : typeof rawCd === "string" && !isNaN(Number(rawCd)) && Number(rawCd) > 0 ? Number(rawCd) : DEFAULT_ROUTER_CONFIG.cooldownMs;
  const matrix = (typeof r["matrix"] === "object" && r["matrix"] !== null)
    ? (r["matrix"] as Record<string, string | string[] | Record<string, string | string[]>>) : {};

  return { enabled, provider, id, name, default: defaultModel, direct, cooldownMs, matrix };
}
