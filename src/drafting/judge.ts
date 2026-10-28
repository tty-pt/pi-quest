// HIGH_LEVEL: #drafting — intelligent Jev System One classification
// for determining whether incoming user input constitutes genuine quest material.
import { type QuestConfig, resolveRoleModel } from "../config.ts";
import { askJudgeChoice, extractJevAnswer, normalizeJevUrl, resolveChoice, type JudgeQuestion } from "../judge/choice.ts";
import { isQuestLikeRequest } from "./detect.ts";

export { normalizeJevUrl };

export const QUEST_INTENT_QUESTION: JudgeQuestion = {
  id: "quest_intent",
  state: "",
  instructions:
    "Determine whether the user message is an instruction or directive to start a new software engineering quest/task (such as fixing a bug, adding a feature, implementing code, building, refactoring, or auditing), versus casual conversational dialogue, questions, or greetings.",
  options: [
    { key: "quest", description: "Direct instruction or request to perform a software task, fix, implementation, investigation, or quest" },
    { key: "conversation", description: "Casual conversation, narrative statement, memory probe, greeting, or general question" },
  ],
};

export function parseJevQuestChoice(data: unknown): "quest" | "conversation" {
  if (typeof data !== "object" || data === null) {
    throw new Error("Jev response must be an object");
  }
  const raw = extractJevAnswer(data, QUEST_INTENT_QUESTION.id);
  if (typeof raw !== "string") {
    throw new Error(`Jev response missing choice answer: ${JSON.stringify(data).slice(0, 100)}`);
  }
  const choice = resolveChoice(raw, QUEST_INTENT_QUESTION.options);
  if (choice === "quest" || choice === "conversation") return choice;
  throw new Error(`Invalid Jev quest choice answer: '${raw}' (expected 'quest' or 'conversation')`);
}

export function normalizeSystemZeroUrl(baseUrlOrUrl: string): string {
  const trimmed = baseUrlOrUrl.trim();
  if (trimmed.includes("/systemzero")) {
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }
  return `${trimmed.replace(/\/+$/, "").replace(/\/api\/v1\/systemone$/, "").replace(/\/v1$/, "")}/api/v1/systemzero/`;
}

export async function callSystemZeroQuestJudge(prompt: string, cfg: QuestConfig): Promise<"quest" | "conversation"> {
  if (!cfg.judgeUrl) {
    throw new Error("Judge URL not configured");
  }
  const endpoint = normalizeSystemZeroUrl(cfg.judgeUrl);
  const controller = new AbortController();
  const timeoutMs = cfg.judgeTimeoutMs || 2000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    model: resolveRoleModel(cfg, "judge") || cfg.judgeModel || "default",
    prompt: `Determine whether the following user message is an instruction or directive to start a software engineering task or quest (such as fixing a bug, adding a feature, implementing code, building, refactoring, or auditing), versus conversational chat, questions, or greetings.\nUser Message: ${prompt}\nAnswer [y/n]:`,
    threshold: 0.5,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.judgeKey && cfg.judgeKey.trim() !== "") {
    headers["Authorization"] = `Bearer ${cfg.judgeKey.trim()}`;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`SystemZero HTTP error ${res.status}: ${res.statusText}${errText ? ` - ${errText.slice(0, 100)}` : ""}`);
    }

    const data = await res.json() as Record<string, unknown>;
    const decision = data["decision"];
    if (typeof decision === "boolean") {
      return decision ? "quest" : "conversation";
    }
    if (typeof data["choice"] !== "string") {
      throw new Error("SystemZero response has neither a boolean decision nor a choice");
    }
    const choice = data["choice"].trim().toLowerCase();
    return (choice === "y" || choice === "yes" || choice === "quest") ? "quest" : "conversation";
  } finally {
    clearTimeout(timer);
  }
}

export async function callJevQuestJudge(prompt: string, cfg: QuestConfig): Promise<"quest" | "conversation"> {
  if (!cfg.judgeUrl) {
    throw new Error("Jev judge URL not configured");
  }
  const choice = await askJudgeChoice(cfg, { ...QUEST_INTENT_QUESTION, state: `User: ${prompt}` });
  if (choice === "quest" || choice === "conversation") return choice;
  throw new Error("Jev service unavailable or returned an unknown choice");
}

import type { PiCtx } from "../hooks/events.ts";

export interface JudgeHealthReport {
  ok: boolean;
  endpoint: string;
  latencyMs: number;
  models?: string[];
  error?: string;
}

export async function checkJudgeHealth(cfg: QuestConfig): Promise<JudgeHealthReport> {
  const rawUrl = cfg.judgeUrl ? cfg.judgeUrl.trim() : "http://127.0.0.1:4242";
  const base = rawUrl.replace(/\/+$/, "").replace(/\/api\/v1\/systemone$/, "").replace(/\/v1$/, "");
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.judgeTimeoutMs || 2000, 3000));

  try {
    const res = await fetch(`${base}/v1/models`, {
      method: "GET",
      headers: cfg.judgeKey ? { Authorization: `Bearer ${cfg.judgeKey.trim()}` } : {},
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      return { ok: false, endpoint: base, latencyMs, error: `HTTP ${res.status}: ${res.statusText}` };
    }

    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data?.data)
      ? data.data.map((m: { id?: string }) => m.id).filter((id: unknown): id is string => typeof id === "string")
      : undefined;

    return { ok: true, endpoint: base, latencyMs, models };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, endpoint: base, latencyMs, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

export interface QuestIntentResult {
  isQuest: boolean;
  source: "llm" | "heuristic" | "trigger";
  degraded?: boolean;
  reason?: string;
}

export async function evaluateQuestIntent(
  prompt: string,
  cfg: QuestConfig,
  _ctx?: PiCtx,
): Promise<QuestIntentResult> {
  // 1. Off mode
  if (cfg.judgeMode === "off") {
    return { isQuest: false, source: "heuristic", reason: "Judge mode is off" };
  }

  // 2. Explicit heuristic mode (opt-in legacy)
  if (cfg.judgeMode === "heuristic") {
    const isQuest = isQuestLikeRequest(prompt);
    return { isQuest, source: "heuristic", reason: isQuest ? "Matched quest heuristic" : "Did not match quest heuristic" };
  }

  // 3. Auto / System One with missing endpoint
  if (!cfg.judgeUrl || cfg.judgeUrl.trim() === "") {
    if (cfg.judgeFallback === "heuristic") {
      const isQuest = isQuestLikeRequest(prompt);
      return { isQuest, source: "heuristic", degraded: true, reason: "Judge unconfigured; fallback=heuristic" };
    }
    return { isQuest: false, source: "heuristic", degraded: true, reason: "Judge unconfigured; fallback=skip" };
  }

  // 4. Call judge via configured protocol (auto | systemzero | systemone)
  try {
    let choice: "quest" | "conversation";
    let usedProtocol = cfg.judgeProtocol;
    const url = cfg.judgeUrl || "";

    if (cfg.judgeProtocol === "systemzero" || url.includes("/systemzero")) {
      choice = await callSystemZeroQuestJudge(prompt, cfg);
      usedProtocol = "systemzero";
    } else if (cfg.judgeProtocol === "systemone" || cfg.judgeMode === "systemone" || url.includes("/systemone")) {
      choice = await callJevQuestJudge(prompt, cfg);
      usedProtocol = "systemone";
    } else {
      // "auto": Try systemzero first, fall back to systemone on error
      try {
        choice = await callSystemZeroQuestJudge(prompt, cfg);
        usedProtocol = "systemzero";
      } catch {
        choice = await callJevQuestJudge(prompt, cfg);
        usedProtocol = "systemone";
      }
    }

    const isQuest = choice === "quest";

    return {
      isQuest,
      source: "llm",
      reason: isQuest
        ? `Classified as quest by ${usedProtocol}`
        : `Classified as conversation by ${usedProtocol}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (cfg.judgeFallback === "heuristic") {
      const isQuest = isQuestLikeRequest(prompt);
      return {
        isQuest,
        source: "heuristic",
        degraded: true,
        reason: `Judge failed (${msg}); fallback=heuristic`,
      };
    }

    return {
      isQuest: false,
      source: "heuristic",
      degraded: true,
      reason: `Judge failed (${msg}); fallback=skip (triggers or /quest required)`,
    };
  }
}
