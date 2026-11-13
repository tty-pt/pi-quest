// HIGH_LEVEL: #human absence — ask-with-default + timeout race.
// HIGH_LEVEL: #interfaces — prompting uses pi UI; providers dispatch it.
// SPEC: B1.9.
import { getState, updateState } from "../app/store";
import { emitNow, sendSteer } from "../app/interpreter";
import { readQuestConfig, type QuestConfig } from "../config";
import { recordHumanAnswer, type QuestState } from "../domain/quest";
import { isFallbackAdvance } from "../domain/intent";
import { approveDraft } from "../drafting/reviews";
import { hasInFlight } from "../review/tracker";
import { bypassesDraftReview } from "../drafting/bypass";
import type { Pi, PiCtx } from "../hooks/events";

export function isAffirmativeApproval(text: string, extraPhrases: readonly string[] = []): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (isFallbackAdvance(trimmed, extraPhrases)) return true;
  const norm = trimmed.toLowerCase().replace(/^[!.,;:?\s]+|[!.,;:?\s]+$/g, "");
  const affirmatives = new Set([
    "yes", "y", "proceed", "go", "approved", "approve", "looks good", "ok", "okay",
    "sure", "sim", "bora", "aprovado", "vai em frente", "manda bala", "confirm", "confirmed"
  ]);
  if (affirmatives.has(norm)) return true;
  for (const word of ["yes", "proceed", "go", "approved", "ok", "okay", "sure", "sim", "bora", "aprovado", "confirm"]) {
    if (norm.startsWith(`${word},`) || norm.startsWith(`${word} `)) return true;
  }
  return false;
}

export function isApprovalQuestion(
  question: string,
  state: QuestState,
  defaultAnswer?: string,
): boolean {
  if (state.phase !== "drafting" || !state.qid) return false;
  const q = question.toLowerCase();
  const next = (state.exactNextAction || "").toLowerCase();
  if (next.includes("approval") || next.includes("approve")) {
    return true;
  }
  const approvalKeywords = [
    "approve",
    "approval",
    "proceed",
    "implement",
    "implementation",
    "start coding",
    "begin implementation",
    "plan approved",
    "accept plan",
    "prosseguir",
    "aprovar",
    "aprovado",
  ];
  if (approvalKeywords.some((kw) => q.includes(kw))) {
    return true;
  }
  if (defaultAnswer && isAffirmativeApproval(defaultAnswer)) {
    return true;
  }
  return false;
}

export interface PendingQuestion {
  question: string;
  at: number;
  resolve: ((answer: string | null) => void) | null;
}

const pendingByQid = new Map<string, PendingQuestion>();
const LATE_WINDOW_MS = 15 * 60 * 1000;

export interface AskArgs {
  question: string;
  defaultAnswer: string;
  timeoutMs?: number;
}

export const APPROVAL_OPTION_APPROVE = "✓ Approve & Begin Implementation";
export const APPROVAL_OPTION_HOLD = "⏸️ Hold / Request Changes";
export const APPROVAL_OPTION_CUSTOM = "✎ Provide Custom Feedback...";

export interface AskResult {
  answer: string;
  source: "user" | "default" | "cancelled";
}

function promptLine(question: string): string {
  const trimmed = question.trim();
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return trimmed;
  const lastQ = [...lines].reverse().find((l) => l.endsWith("?"));
  return lastQ || lines[0] || trimmed;
}

async function recordAskOutcome(
  pi: Pi,
  ctx: PiCtx,
  question: string,
  answer: string,
  source: AskResult["source"],
  late: boolean,
  isReviewApproval: boolean,
  config: QuestConfig,
): Promise<AskResult> {
  updateState((s) => recordHumanAnswer(s, question, answer, late));
  emitNow(pi);
  const curr = getState();
  if (curr.phase === "drafting" && curr.qid !== null && curr.draft !== null) {
    if (source === "user") {
      if (isAffirmativeApproval(answer, config.steeringPhrases)) {
        await approveDraft(pi, ctx, curr.qid, "user");
      }
    } else if (source === "cancelled") {
      sendSteer(pi, "Operator cancelled/dismissed the review prompt (pressed Escape). The plan was NOT approved. Remaining in drafting.");
      updateState((s) => ({
        ...s,
        exactNextAction: "Operator cancelled review via Escape. Address operator concerns or wait for guidance.",
      }));
    } else if (source === "default" && isReviewApproval) {
      sendSteer(pi, "Review question timed out without operator confirmation. The plan was NOT approved. Remaining in drafting.");
      updateState((s) => ({
        ...s,
        exactNextAction: "Review prompt timed out without confirmation. Awaiting operator input.",
      }));
    }
  }
  return { answer, source };
}

async function promptInteractiveUser(
  ctx: PiCtx,
  qid: string,
  question: string,
  defaultAnswer: string,
  timeoutMs: number,
  isApproval: boolean = false,
  approvalMode: "select" | "input" | "chat" = "select",
): Promise<{ value: string | null; wasTimeout: boolean }> {
  const controller = new AbortController();
  let timedOut = false;
  let done = false;
  const startTime = Date.now();

  return new Promise<{ value: string | null; wasTimeout: boolean }>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (value: string | null, isTimeout: boolean) => {
      if (done) return;
      done = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve({ value, wasTimeout: isTimeout });
    };

    pendingByQid.set(qid, { question, at: Date.now(), resolve: (val) => settle(val, false) });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (done) return;
        timedOut = true;
        ctx.ui.notify(`Question timed out: ${question.slice(0, 120)} — defaulting to "${defaultAnswer}"`, "warning");
        controller.abort();
        settle(null, true);
      }, timeoutMs);
    }

    const showInputFallback = () => {
      void ctx.ui.input(
        `Quest ${qid}: ${promptLine(question)}`,
        defaultAnswer,
        timeoutMs > 0 ? { timeout: timeoutMs, signal: controller.signal } : { signal: controller.signal },
      ).then(
        (value) => {
          const elapsed = Date.now() - startTime;
          const reachedTimeout = timedOut || controller.signal.aborted || (timeoutMs > 0 && elapsed >= timeoutMs - 50);
          if (reachedTimeout) {
            settle(null, true);
            return;
          }
          if (value !== null && value !== undefined && value.trim() === "") {
            settle(isApproval ? "approve" : defaultAnswer, false);
            return;
          }
          settle(value ?? null, false);
        },
        () => {
          const elapsed = Date.now() - startTime;
          const reachedTimeout = timedOut || controller.signal.aborted || (timeoutMs > 0 && elapsed >= timeoutMs - 50);
          settle(null, reachedTimeout);
        },
      );
    };

    if (isApproval && approvalMode === "select" && typeof ctx.ui.select === "function") {
      ctx.ui.select(
        `Quest ${qid}: ${promptLine(question)}`,
        [APPROVAL_OPTION_APPROVE, APPROVAL_OPTION_HOLD, APPROVAL_OPTION_CUSTOM],
        timeoutMs > 0 ? { timeout: timeoutMs, signal: controller.signal } : { signal: controller.signal },
      ).then(
        (selected) => {
          const elapsed = Date.now() - startTime;
          const reachedTimeout = timedOut || controller.signal.aborted || (timeoutMs > 0 && elapsed >= timeoutMs - 50);
          if (reachedTimeout) {
            settle(null, true);
            return;
          }
          if (selected === APPROVAL_OPTION_APPROVE || (selected && selected.toLowerCase().includes("approve"))) {
            settle("approve", false);
            return;
          }
          if (selected === APPROVAL_OPTION_HOLD || (selected && selected.toLowerCase().includes("hold"))) {
            settle("hold", false);
            return;
          }
          if (selected === APPROVAL_OPTION_CUSTOM) {
            showInputFallback();
            return;
          }
          if (selected === undefined) {
            if (ctx.mode === "test" && typeof ctx.ui.input === "function") {
              showInputFallback();
              return;
            }
            settle(null, false);
            return;
          }
          settle(selected, false);
        },
        () => {
          if (ctx.mode === "test" && typeof ctx.ui.input === "function") {
            showInputFallback();
          } else {
            settle(null, false);
          }
        },
      );
    } else {
      showInputFallback();
    }
  });
}

export async function askWithDefault(pi: Pi, ctx: PiCtx, args: AskArgs): Promise<AskResult> {
  const state = getState();
  const qid = state.qid ?? "none";
  const config = await readQuestConfig(ctx.cwd);
  const isReviewApproval = isApprovalQuestion(args.question, state, args.defaultAnswer);

  let defaultAnswer = args.defaultAnswer;
  if (isReviewApproval && isAffirmativeApproval(defaultAnswer)) {
    defaultAnswer = "hold";
  }

  let timeoutMs = args.timeoutMs ?? config.askTimeoutMs;
  if (isReviewApproval && timeoutMs === undefined) {
    timeoutMs = 300000;
  }

  if (isReviewApproval && config.approvalMode === "chat") {
    pendingByQid.set(qid, { question: args.question, at: Date.now(), resolve: null });
    ctx.ui?.notify?.(`[Quest ${qid}] Implementation plan ready. Reply 'go' or 'approve' in chat to start implementation.`, "info");
    sendSteer(
      pi,
      `Implementation plan presented for ${qid}. Waiting for operator review in chat: reply "go" or "approve" to advance to implementation, or provide change requests in the conversation.`,
    );
    return {
      answer: "awaiting_chat_reply",
      source: "user",
    };
  }

  if (!ctx.hasUI || timeoutMs === 0) {
    pendingByQid.set(qid, { question: args.question, at: Date.now(), resolve: null });
    const label = ctx.hasUI ? "zero wait" : "no UI";
    sendSteer(pi, ctx.hasUI
      ? `Question not shown (zero wait): defaulting to "${defaultAnswer}". No human checkpoint occurred.`
      : `No interactive UI present — this question was not shown to a human. Answering with default "${defaultAnswer}". A quest_ask_human default is not live human approval.`);
    ctx.ui.notify(`Question (${label}): ${args.question.slice(0, 120)} — defaulting to "${defaultAnswer}"`, "warning");
    return await recordAskOutcome(pi, ctx, args.question, defaultAnswer, "default", false, isReviewApproval, config);
  }

  const raw = await promptInteractiveUser(ctx, qid, args.question, defaultAnswer, timeoutMs, isReviewApproval, config.approvalMode);
  const pending = pendingByQid.get(qid);
  if (pending) pending.resolve = null;

  if (raw.wasTimeout) {
    return await recordAskOutcome(pi, ctx, args.question, defaultAnswer, "default", false, isReviewApproval, config);
  }
  if (raw.value === null || raw.value === undefined) {
    const outcomeVal = isReviewApproval ? "cancelled" : defaultAnswer;
    const outcomeSrc = isReviewApproval ? "cancelled" : "default";
    return await recordAskOutcome(pi, ctx, args.question, outcomeVal, outcomeSrc, false, isReviewApproval, config);
  }
  const cleanVal = raw.value.trim();
  const effectiveVal = (cleanVal === "" && isReviewApproval) ? "approve" : (cleanVal === "" ? defaultAnswer : cleanVal);
  return await recordAskOutcome(pi, ctx, args.question, effectiveVal, "user", false, isReviewApproval, config);
}

export function noteLateAnswer(pi: Pi, text: string): boolean {
  const state = getState();
  if (state.qid === null) return false;
  const pending = pendingByQid.get(state.qid);
  if (pending === undefined) return false;
  if (Date.now() - pending.at > LATE_WINDOW_MS) {
    pendingByQid.delete(state.qid);
    return false;
  }
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/")) return false;
  // A bare steering word is approval, not an answer to the pending question.
  if (isFallbackAdvance(trimmed)) return false;
  if (trimmed.length >= 500) return false;
  if (pending.resolve !== null) {
    const resolve = pending.resolve;
    pending.resolve = null;
    resolve(trimmed);
    return true;
  }
  updateState((s) => recordHumanAnswer(s, pending.question, trimmed, true));
  emitNow(pi);
  sendSteer(pi, `Late human answer applied as refinement: "${trimmed.slice(0, 300)}"`);
  return true;
}

export function pendingQuestion(qid: string): PendingQuestion | undefined {
  return pendingByQid.get(qid);
}

export function cancelPendingQuestion(qid: string): void {
  const pending = pendingByQid.get(qid);
  if (pending === undefined) return;
  pendingByQid.delete(qid);
  if (pending.resolve !== null) {
    const resolve = pending.resolve;
    pending.resolve = null;
    resolve(null);
  }
}

