// HIGH_LEVEL: #jev quest judge — intelligent Jev System One classification
// for determining whether incoming user input constitutes genuine quest material.
import type { QuestConfig } from "../config.ts";
import { isQuestLikeRequest } from "./detect.ts";

export function normalizeJevUrl(baseUrlOrUrl: string): string {
  const trimmed = baseUrlOrUrl.trim();
  if (trimmed.includes("/systemone")) {
    return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  }
  return `${trimmed.replace(/\/+$/, "")}/api/v1/systemone/`;
}

export function parseJevQuestChoice(data: unknown): "quest" | "conversation" {
  if (typeof data !== "object" || data === null) {
    throw new Error("Jev response must be an object");
  }
  const rec = data as Record<string, unknown>;
  let answerVal: unknown;

  // 1. Primary documented path: answers.quest_intent.choice
  if (typeof rec.answers === "object" && rec.answers !== null && !Array.isArray(rec.answers)) {
    const ansObj = rec.answers as Record<string, unknown>;
    const questAction = ansObj["quest_intent"] ?? ansObj["action"] ?? Object.values(ansObj)[0];
    if (typeof questAction === "object" && questAction !== null) {
      const objVal = questAction as Record<string, unknown>;
      answerVal = objVal["choice"] ?? objVal["answer"] ?? objVal["value"];
    } else {
      answerVal = questAction;
    }
  }

  // 2. Defensive fallback: array answers
  if (answerVal === undefined && Array.isArray(rec.answers)) {
    const list = rec.answers;
    if (list.length === 0) {
      throw new Error("Jev response contains empty answers list");
    }
    const matched = list.find(
      (a: unknown) =>
        typeof a === "object" && a !== null &&
        ((a as Record<string, unknown>).id === "quest_intent" || (a as Record<string, unknown>).question_id === "quest_intent"),
    );
    if (matched && typeof matched === "object") {
      const matchRec = matched as Record<string, unknown>;
      answerVal = matchRec.choice ?? matchRec.answer ?? matchRec.value;
    } else if (typeof list[0] === "string") {
      answerVal = list[0];
    } else if (typeof list[0] === "object" && list[0] !== null) {
      const firstRec = list[0] as Record<string, unknown>;
      answerVal = firstRec.choice ?? firstRec.answer ?? firstRec.value;
    }
  }

  if (typeof answerVal !== "string") {
    throw new Error(`Jev response missing choice answer: ${JSON.stringify(data).slice(0, 100)}`);
  }

  const normalized = answerVal.trim().toLowerCase();
  if (normalized === "quest" || normalized.startsWith("quest") || normalized.includes("software task")) {
    return "quest";
  }
  if (normalized === "conversation" || normalized.startsWith("conversation") || normalized.includes("dialogue")) {
    return "conversation";
  }

  throw new Error(`Invalid Jev quest choice answer: '${answerVal}' (expected 'quest' or 'conversation')`);
}

export async function callJevQuestJudge(prompt: string, cfg: QuestConfig): Promise<"quest" | "conversation"> {
  if (!cfg.judgeUrl) {
    throw new Error("Jev judge URL not configured");
  }
  const endpoint = normalizeJevUrl(cfg.judgeUrl);
  const controller = new AbortController();
  const timeoutMs = cfg.judgeTimeoutMs || 2000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    model: cfg.judgeModel || "qwen",
    state: `User: ${prompt}`,
    questions: {
      quest_intent: {
        type: "choice",
        instructions:
          "Determine whether the user message is an instruction or directive to start a new software engineering quest/task (such as fixing a bug, adding a feature, implementing code, building, refactoring, or auditing), versus casual conversational dialogue, questions, or greetings.",
        criteria: {
          quest: "Direct instruction or request to perform a software task, fix, implementation, investigation, or quest",
          conversation: "Casual conversation, narrative statement, memory probe, greeting, or general question",
        },
      },
    },
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
      throw new Error(`Jev service HTTP error ${res.status}: ${res.statusText}${errText ? ` - ${errText.slice(0, 100)}` : ""}`);
    }

    const data = await res.json();
    return parseJevQuestChoice(data);
  } finally {
    clearTimeout(timer);
  }
}

export interface QuestIntentResult {
  isQuest: boolean;
  source: "llm" | "heuristic";
  degraded?: boolean;
  reason?: string;
}

export async function evaluateQuestIntent(
  prompt: string,
  cfg: QuestConfig,
): Promise<QuestIntentResult> {
  // 1. Off mode
  if (cfg.judgeMode === "off") {
    return { isQuest: false, source: "heuristic", reason: "Judge mode is off" };
  }

  // 2. Explicit heuristic mode
  if (cfg.judgeMode === "heuristic") {
    const isQuest = isQuestLikeRequest(prompt);
    return { isQuest, source: "heuristic", reason: isQuest ? "Matched quest heuristic" : "Did not match quest heuristic" };
  }

  // 3. Auto / System One with missing endpoint
  if (!cfg.judgeUrl || cfg.judgeUrl.trim() === "") {
    if (cfg.judgeFallback === "skip") {
      return { isQuest: false, source: "heuristic", degraded: true, reason: "Judge unconfigured; fallback=skip" };
    }
    const isQuest = isQuestLikeRequest(prompt);
    return { isQuest, source: "heuristic", degraded: true, reason: "Judge unconfigured; fallback=heuristic" };
  }

  // 4. Call Jev System One judge
  try {
    const choice = await callJevQuestJudge(prompt, cfg);
    return {
      isQuest: choice === "quest",
      source: "llm",
      reason: choice === "quest" ? "Classified as quest by Jev System One" : "Classified as conversation by Jev System One",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Non-fatal fallback
    if (cfg.judgeFallback === "skip") {
      return {
        isQuest: false,
        source: "heuristic",
        degraded: true,
        reason: `Judge failed (${msg}); fallback=skip`,
      };
    }
    const isQuest = isQuestLikeRequest(prompt);
    return {
      isQuest,
      source: "heuristic",
      degraded: true,
      reason: `Judge failed (${msg}); fallback=heuristic`,
    };
  }
}
