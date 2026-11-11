// HIGH_LEVEL: #tools (main agent) — quest_ask_human.
// Ask with a recommended default and timeout; never blocks.
// Dispatches through question providers (working-protocol tools first,
// built-in input fallback last).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getState } from "../../app/store";
import { draftPath } from "../../domain/paths";
import { draftFilePath } from "../../files";
import type { Qid } from "../../domain/qid";
import { parseDraftSections } from "../../drafting/plan-text";
import { isApprovalQuestion, isAffirmativeApproval } from "../../absence/ask";
import { firePlanValidationSubagent } from "../../drafting/plan-approval";
import { selectProvider } from "../../absence/providers";
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events";
import { textResult } from "./reply";

function extractDraftAnalysis(cwd: string, qid: string | null): string {
  if (!qid) return "";
  try {
    const fullPath = draftFilePath(cwd, qid as Qid);
    const content = readFileSync(fullPath, "utf8");
    const sections = parseDraftSections(content);
    return sections.analysis.trim();
  } catch {
    return "";
  }
}

export function isPlanDump(question: string): boolean {
  if (/^##\s+(?:Implementation Plan|Plan|Requirements|Evidence|Assumptions)/im.test(question)) {
    return true;
  }
  if (question.length > 250 && (/^\s*\d+\.\s+[^\n]+\n\s*\d+\.\s+/m.test(question) || /Phase\s+\d+:/i.test(question))) {
    return true;
  }
  return false;
}

function buildResult(answer: string, source: "user" | "default" | "cancelled", provider: string, ctx: PiCtx) {
  if (source === "cancelled") {
    return textResult(
      `Operator cancelled/dismissed the question (pressed Escape). The plan was NOT approved. Stay in drafting and ask the operator what revisions they want or wait for further input.`,
      { answer: "cancelled", source: "cancelled", provider, uiPresent: ctx.hasUI },
    );
  }
  return textResult(
    source === "user" ? `Human answered: "${answer}"` : `No human answer (absence) — proceeding with default: "${answer}"`,
    { answer, source, provider, uiPresent: ctx.hasUI },
  );
}

function renderAskCall(args: Record<string, unknown>, context: unknown): { render: (_width: number) => string[]; invalidate: () => void } {
  const state = getState();
  const cwd = (context && typeof (context as { cwd: string }).cwd === "string") ? (context as { cwd: string }).cwd : process.cwd();
  const qid = state.qid;
  const isDrafting = state.phase === "drafting";
  const analysis = isDrafting ? extractDraftAnalysis(cwd, qid) : "";
  const question = typeof args["question"] === "string" ? args["question"] : "";

  const lines: string[] = [];
  if (analysis) lines.push(`### Analysis (${qid ? `Quest ${qid}` : "Draft"})`, "", analysis, "");
  if (question) lines.push(question);
  return {
    render: (_width: number) => lines.length > 0 ? lines : [""],
    invalidate: () => {},
  };
}

function renderAskResult(result: { details?: unknown }, theme: unknown): { render: (_width: number) => string[]; invalidate: () => void } {
  const details = result.details as Record<string, unknown> | undefined;
  const answer = details?.["answer"];
  const source = details?.["source"];
  const label = source === "cancelled"
    ? `Operator cancelled (pressed Escape) — plan not approved`
    : source === "user"
      ? `Operator answered: "${answer}"`
      : `No operator answer (timeout): proceeding with default "${answer}"`;
  const themed = (theme && typeof (theme as { fg: (k: string, s: string) => string }).fg === "function")
    ? (theme as { fg: (k: string, s: string) => string }).fg("dim", label)
    : label;
  return {
    render: (_width: number) => [themed],
    invalidate: () => {},
  };
}

async function executeAsk(pi: Pi, ctx: PiCtx, params: Record<string, unknown>) {
  const question = params["question"];
  const def = params["default"];
  if (typeof question !== "string" || question.trim() === "") {
    return textResult("quest_ask_human needs a question.", { error: "missing_question" });
  }
  if (typeof def !== "string") {
    return textResult("quest_ask_human needs a default answer.", { error: "missing_default" });
  }
  if (isPlanDump(question)) {
    return textResult(
      "quest_ask_human rejected: Do not put the implementation plan or markdown sections in the 'question' parameter.\n" +
      "First, output your quest analysis in your response message so the operator can review it in the chat session.\n" +
      "Then, call quest_ask_human with a concise approval question (e.g. 'Do you approve the implementation plan?').",
      { error: "plan_in_question" },
    );
  }
  const timeoutMs = typeof params["timeoutMs"] === "number" ? params["timeoutMs"] as number : undefined;

  const state = getState();
  const isReview = isApprovalQuestion(question, state, def);
  const effectiveDef = (isReview && isAffirmativeApproval(def)) ? "hold" : def;
  let effectiveTimeoutMs = timeoutMs;
  if (isReview && (effectiveTimeoutMs === undefined || (effectiveTimeoutMs > 0 && effectiveTimeoutMs < 300000))) {
    effectiveTimeoutMs = 300000;
  }

  if (isReview) {
    void firePlanValidationSubagent(pi, ctx, state);
  }

  const provider = selectProvider(pi);
  const result = await provider.ask(pi, ctx, {
    question: question.trim(),
    defaultAnswer: effectiveDef,
    timeoutMs: effectiveTimeoutMs,
  });
  return buildResult(result.answer, result.source, provider.name, ctx);
}

export function askHumanTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_ask_human",
    label: "Ask Human",
    description: "Ask the user with a recommended default and timeout (5 minutes default, configurable). Never blocks: absence, cancellation, or timeout proceeds with the default (except plan reviews, which never default to confirming and do not proceed on Escape), and a late answer still applies. You MUST write your quest analysis in your assistant message text first so the operator can read it in the chat session. Keep the 'question' parameter concise (e.g. 'Do you approve the implementation plan?'). NEVER paste the implementation plan or markdown sections into the question parameter.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Concise question for the human (e.g. 'Do you approve the implementation plan?'). Do NOT put the implementation plan, code, or markdown sections here — present the analysis to the user in your message text before calling this tool." },
        default: { type: "string", description: "Recommended default used on absence, timeout, or cancellation. For plan reviews, use a non-confirming default such as 'hold'." },
        timeoutMs: { type: "number", description: "Wait duration in ms. 0 = no wait, negative = indefinite." },
      },
      required: ["question", "default"],
      additionalProperties: false,
    },
    renderShell: "self",
    renderCall: (args, _theme, context) => renderAskCall(args, context),
    renderResult: (result, _options, theme) => renderAskResult(result, theme),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => executeAsk(pi, ctx, params),
  };
}
