// HIGH_LEVEL: #tools (main agent) — quest_ask_human.
// Ask with a recommended default and timeout; never blocks.
// Dispatches through question providers (working-protocol tools first,
// built-in input fallback last).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getState } from "../../app/store";
import { draftPath } from "../../domain/paths";
import type { Qid } from "../../domain/qid";
import { parseDraftSections } from "../../drafting/plan-text";
import { selectProvider } from "../../absence/providers";
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events";
import { textResult } from "./reply";

function extractDraftAnalysis(cwd: string, qid: string | null): string {
  if (!qid) return "";
  try {
    const fullPath = join(cwd, draftPath(qid as Qid));
    const content = readFileSync(fullPath, "utf8");
    const sections = parseDraftSections(content);
    return sections.analysis.trim();
  } catch {
    return "";
  }
}

function buildResult(answer: string, source: "user" | "default", provider: string, ctx: PiCtx) {
  return textResult(
    source === "user" ? `Human answered: "${answer}"` : `No human answer (absence) — proceeding with default: "${answer}"`,
    { answer, source, provider, uiPresent: ctx.hasUI },
  );
}

export function askHumanTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_ask_human",
    label: "Ask Human",
    description: "Ask the user with a recommended default and timeout (one minute default, configurable). Never blocks: absence, cancellation, or timeout proceeds with the default, and a late answer still applies.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Question for the human, with context and options." },
        default: { type: "string", description: "Recommended default used on absence, timeout, or cancellation." },
        timeoutMs: { type: "number", description: "Wait duration in ms. 0 = no wait, negative = indefinite." },
      },
      required: ["question", "default"],
      additionalProperties: false,
    },
    renderShell: "self",
    renderCall: (args, _theme, context) => {
      const state = getState();
      const cwd = (context && typeof context.cwd === "string") ? context.cwd : process.cwd();
      const qid = state.qid;
      const isDrafting = state.phase === "drafting";
      const analysis = isDrafting ? extractDraftAnalysis(cwd, qid) : "";
      const question = typeof args["question"] === "string" ? args["question"] : "";

      const lines: string[] = [];
      if (analysis) {
        lines.push(`### Analysis (${qid ?? "Draft"})`, "", analysis, "");
      }
      if (question) {
        lines.push(question);
      }
      return {
        render: (_width: number) => lines.length > 0 ? lines : [""],
      };
    },
    renderResult: (result, _options, theme) => {
      const details = result.details as Record<string, unknown> | undefined;
      const answer = details?.["answer"];
      const source = details?.["source"];
      const label = source === "user"
        ? `Operator answered: "${answer}"`
        : `No operator answer (timeout): proceeding with default "${answer}"`;
      const themed = (theme && typeof (theme as { fg: (k: string, s: string) => string }).fg === "function")
        ? (theme as { fg: (k: string, s: string) => string }).fg("dim", label)
        : label;
      return {
        render: (_width: number) => [themed],
      };
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const question = params["question"];
      const def = params["default"];
      if (typeof question !== "string" || question.trim() === "") {
        return textResult("quest_ask_human needs a question.", { error: "missing_question" });
      }
      if (typeof def !== "string") {
        return textResult("quest_ask_human needs a default answer.", { error: "missing_default" });
      }
      const timeoutMs = typeof params["timeoutMs"] === "number" ? params["timeoutMs"] as number : undefined;
      const provider = selectProvider(pi);
      const result = await provider.ask(pi, ctx, {
        question: question.trim(),
        defaultAnswer: def,
        timeoutMs,
      });
      return buildResult(result.answer, result.source, provider.name, ctx);
    },
  };
}
