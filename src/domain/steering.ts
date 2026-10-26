// HIGH_LEVEL: #steering — natural language circuit breaking and intent evaluation
// allowing human operators to advance, abort, or refine active quests without rigid keyword matching.
import type { QuestConfig } from "../config.ts";
import { normalizeJevUrl } from "../drafting/judge.ts";

export type SteeringAction = "advance" | "abort" | "neutral";

export interface SteeringIntent {
  action: SteeringAction;
  source: "heuristic" | "judge";
  confidence: number;
  reason: string;
}

const ADVANCE_PHRASES = [
  // English
  "go", "proceed", "advance", "approve", "approved", "lgtm", "looks good",
  "ship it", "ship", "confirm", "confirmed", "accept", "accepted", "done",
  "wrap it up", "finish", "start coding", "go ahead", "let's go", "looks good to me",
  "all good", "fine by me", "do it", "make it so", "yes proceed", "yes go",
  // Portuguese (input comprehension)
  "avança", "avanca", "força", "forca", "vai", "segue", "está bom", "esta bom",
  "está feito", "esta feito", "aprovo", "aprovado", "pode ser", "pode avançar",
  "pode avancar", "pode ir", "pode fechar", "fecha a quest", "conclui", "concluído",
  "concluido", "dá por concluído", "da por concluido", "tudo bem", "parece-me bem",
  "segue em frente", "continua", "podes avançar", "podes avancar",
];

const ABORT_PHRASES = [
  // English
  "abort", "cancel", "kill quest", "stop quest", "abandon", "drop it",
  "forget it", "nevermind", "kill it", "stop the quest", "abort quest",
  // Portuguese (input comprehension)
  "cancela", "cancela a quest", "para a quest", "pára a quest", "esquece",
  "esquece lá isso", "esquece la isso", "aborta", "para tudo", "não faças",
  "nao facas", "deixa estar", "pára tudo",
];

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics for robust matching
    .replace(/[!?.,;:]+$/g, "")
    .trim();
}

/**
 * Fast zero-network heuristic intent classification.
 */
export function evaluateSteeringHeuristic(text: string): SteeringIntent {
  const clean = normalizeText(text);
  if (!clean) {
    return { action: "neutral", source: "heuristic", confidence: 1.0, reason: "empty text" };
  }

  // Exact phrase match
  for (const phrase of ABORT_PHRASES) {
    const normPhrase = normalizeText(phrase);
    if (clean === normPhrase) {
      return { action: "abort", source: "heuristic", confidence: 0.95, reason: `matched abort phrase "${phrase}"` };
    }
  }

  for (const phrase of ADVANCE_PHRASES) {
    const normPhrase = normalizeText(phrase);
    if (clean === normPhrase) {
      return { action: "advance", source: "heuristic", confidence: 0.95, reason: `matched advance phrase "${phrase}"` };
    }
  }

  // Bounded sentence match for short messages (<= 120 chars)
  if (clean.length <= 120) {
    for (const phrase of ABORT_PHRASES) {
      const normPhrase = normalizeText(phrase);
      if (clean.startsWith(`${normPhrase} `) || clean.endsWith(` ${normPhrase}`) || clean.includes(` ${normPhrase} `)) {
        return { action: "abort", source: "heuristic", confidence: 0.85, reason: `contains abort phrase "${phrase}"` };
      }
    }

    for (const phrase of ADVANCE_PHRASES) {
      const normPhrase = normalizeText(phrase);
      if (clean.startsWith(`${normPhrase} `) || clean.endsWith(` ${normPhrase}`) || clean.includes(` ${normPhrase} `)) {
        return { action: "advance", source: "heuristic", confidence: 0.85, reason: `contains advance phrase "${phrase}"` };
      }
    }
  }

  return { action: "neutral", source: "heuristic", confidence: 0.5, reason: "no steering keywords detected" };
}

export function parseJevSteeringChoice(data: unknown): SteeringAction {
  if (typeof data !== "object" || data === null) {
    return "neutral";
  }
  const rec = data as Record<string, unknown>;
  let answerVal: unknown;

  if (typeof rec.answers === "object" && rec.answers !== null && !Array.isArray(rec.answers)) {
    const ansObj = rec.answers as Record<string, unknown>;
    const actionObj = ansObj["steering_intent"] ?? ansObj["action"] ?? Object.values(ansObj)[0];
    if (typeof actionObj === "object" && actionObj !== null) {
      const objVal = actionObj as Record<string, unknown>;
      answerVal = objVal["choice"] ?? objVal["answer"] ?? objVal["value"];
    } else {
      answerVal = actionObj;
    }
  }

  if (answerVal === undefined && Array.isArray(rec.answers) && rec.answers.length > 0) {
    const first = rec.answers[0];
    if (typeof first === "object" && first !== null) {
      const firstRec = first as Record<string, unknown>;
      answerVal = firstRec["choice"] ?? firstRec["answer"] ?? firstRec["value"];
    } else {
      answerVal = first;
    }
  }

  if (typeof answerVal === "string") {
    const lower = answerVal.trim().toLowerCase();
    if (lower === "advance" || lower === "abort" || lower === "neutral") {
      return lower;
    }
  }
  return "neutral";
}

/**
 * Call remote Jev System One judge to classify steering intent when available.
 */
export async function callJevSteeringJudge(
  prompt: string,
  phase: string,
  cfg: QuestConfig,
): Promise<SteeringAction> {
  if (!cfg.judgeUrl) return "neutral";
  const endpoint = normalizeJevUrl(cfg.judgeUrl);
  const timeoutMs = Math.min(cfg.judgeTimeoutMs || 2000, 2000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    model: cfg.judgeModel || "qwen",
    state: `Quest Phase: ${phase}\nUser steering message: ${prompt}`,
    questions: {
      steering_intent: {
        type: "choice",
        instructions:
          "Determine whether the user message expresses an intention to advance/approve the quest, abort/cancel the quest, or is neutral/instructional.",
        criteria: {
          advance: "The user approves, accepts, confirms completion, skips review, or asks to proceed/start coding/ship it.",
          abort: "The user asks to cancel, stop, abandon, or delete the quest.",
          neutral: "The user provides technical guidance, asks questions, makes refinements, or normal conversational input.",
        },
      },
    },
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
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
    if (!res.ok) return "neutral";
    const data = await res.json();
    return parseJevSteeringChoice(data);
  } catch {
    return "neutral";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Evaluates user steering input with dual fallback (fast heuristic + optional neural judge).
 */
export async function evaluateSteeringIntent(
  text: string,
  phase: string,
  cfg: QuestConfig,
): Promise<SteeringIntent> {
  const heuristic = evaluateSteeringHeuristic(text);
  // High confidence heuristic match returns immediately (zero latency)
  if (heuristic.confidence >= 0.8 && heuristic.action !== "neutral") {
    return heuristic;
  }

  // If judge is disabled or unconfigured, return heuristic verdict
  if (cfg.judgeMode === "off" || cfg.judgeMode === "heuristic" || !cfg.judgeUrl || cfg.judgeUrl.trim() === "") {
    return heuristic;
  }

  // Consult judge for ambiguous / nuanced messages
  try {
    const judgeAction = await callJevSteeringJudge(text, phase, cfg);
    if (judgeAction !== "neutral") {
      return {
        action: judgeAction,
        source: "judge",
        confidence: 0.9,
        reason: `classified by judge as ${judgeAction}`,
      };
    }
  } catch {
    // Fail safe to heuristic
  }

  return heuristic;
}
