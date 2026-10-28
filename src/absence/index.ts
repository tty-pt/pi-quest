// HIGH_LEVEL: #working together
// HIGH_LEVEL: #human absence — ask-with-default + timeout race.
// SPEC: B1.9.
import { getState } from "../app/store";
import { readQuestConfig } from "../config";
import { interpretUserTurn } from "../domain/intent";
import { onUserMessage, type Pi } from "../hooks/events";
import { noteLateAnswer, pendingQuestion } from "./ask";
import { installObservedQuestions } from "./observed";

export function installHumanAbsence(pi: Pi): void {
  onUserMessage(pi, async (text, ctx) => {
    const state = getState();
    if (state.qid === null || pendingQuestion(state.qid) === undefined) return;
    // Steering ("go on") approves; it is never the answer to a pending question.
    const intent = await interpretUserTurn(text, state.phase, await readQuestConfig(ctx.cwd));
    if (intent.kind === "advance" || intent.kind === "abort") return;
    noteLateAnswer(pi, text);
  });
  installObservedQuestions(pi);
}
