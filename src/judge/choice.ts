// HIGH_LEVEL: #drafting — the single seam for asking the System One judge a closed
// multiple-choice question. Every semantic decision that used to be a word list
// (steering, quest intent, difficulty, plan verification) goes through here.
// The answer must equal one of the declared option keys; anything else — HTTP
// failure, timeout, unknown label, malformed body — is `null` ("unavailable"),
// never a guess. Callers decide their own language-neutral fallback.
import { type QuestConfig, resolveRoleModel } from "../config.ts";

export interface JudgeOption {
  key: string;
  description: string;
}

export interface JudgeQuestion {
  /** Stable question id (also the key in the Jev `answers` object). */
  id: string;
  /** Context handed to the judge (phase, pending state, the user's message). */
  state: string;
  instructions: string;
  options: readonly JudgeOption[];
}

export function normalizeJevUrl(baseUrlOrUrl: string): string {
  const trimmed = baseUrlOrUrl.trim();
  if (trimmed.includes("/systemone")) {
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }
  return `${trimmed.replace(/\/+$/, "")}/api/v1/systemone/`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickChoiceValue(rec: Record<string, unknown>): unknown {
  return rec["choice"] ?? rec["answer"] ?? rec["value"];
}

/**
 * Extract the raw answer for `questionId` from a Jev response (keyed object or
 * array form). Returns undefined when absent.
 */
export function extractJevAnswer(data: unknown, questionId: string): unknown {
  if (!isRecord(data)) return undefined;
  const answers = data["answers"];
  if (isRecord(answers)) {
    const entry = answers[questionId] ?? Object.values(answers)[0];
    return isRecord(entry) ? pickChoiceValue(entry) : entry;
  }
  if (Array.isArray(answers) && answers.length > 0) {
    const matched = answers.find((a) => isRecord(a) && (a["id"] === questionId || a["question_id"] === questionId));
    const entry = matched ?? answers[0];
    return isRecord(entry) ? pickChoiceValue(entry) : entry;
  }
  return undefined;
}

/**
 * Resolve a raw judge answer to exactly one declared option key. Case and
 * surrounding whitespace are ignored; there is deliberately NO synonym or
 * substring matching — an unknown label is "unavailable", not a best guess.
 */
export function resolveChoice(raw: unknown, options: readonly JudgeOption[]): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  const hit = options.find((o) => o.key.toLowerCase() === normalized);
  return hit ? hit.key : null;
}

export function buildJevPayload(q: JudgeQuestion, model: string): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const o of q.options) criteria[o.key] = o.description;
  return {
    model,
    state: q.state,
    questions: {
      [q.id]: { type: "choice", instructions: q.instructions, criteria },
    },
  };
}

export function judgeAvailable(cfg: QuestConfig): boolean {
  if (cfg.judgeMode === "off" || cfg.judgeMode === "heuristic") return false;
  return typeof cfg.judgeUrl === "string" && cfg.judgeUrl.trim() !== "";
}

/**
 * Ask the judge a closed question. Resolves to the chosen option key, or null
 * when the judge is off, unconfigured, unreachable, slow, or answers outside
 * the declared options.
 */
export async function askJudgeChoice(
  cfg: QuestConfig,
  q: JudgeQuestion,
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  if (!judgeAvailable(cfg) || cfg.judgeUrl === undefined) return null;
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? (cfg.judgeTimeoutMs || 2000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.judgeKey && cfg.judgeKey.trim() !== "") headers["Authorization"] = `Bearer ${cfg.judgeKey.trim()}`;
  try {
    const res = await fetch(normalizeJevUrl(cfg.judgeUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(buildJevPayload(q, resolveRoleModel(cfg, "judge") || cfg.judgeModel || "qwen")),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return resolveChoice(extractJevAnswer(await res.json(), q.id), q.options);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
