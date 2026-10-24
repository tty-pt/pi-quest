// HIGH_LEVEL: #modes
// HIGH_LEVEL: #validation — validator archives on PASS, demotes on FAIL.
// SPEC: B1.5 (completion + slim archive).
import { getState, updateState } from "../app/store";
import type { VerificationReceipt } from "../domain/quest";
import type { Pi } from "../hooks/events";
import { onSessionStart, onToolResult, onTurnEnd, onUserMessage } from "../hooks/events";
import { ensureValidationFlow, handleConfirmInput } from "./flow";
import { isTestCommand, recordTestExecution } from "./evidence-gate";

export function installValidation(pi: Pi): void {
  onTurnEnd(pi, (_event, ctx) => {
    void ensureValidationFlow(pi, ctx);
  });
  onSessionStart(pi, (_event, ctx) => {
    void ensureValidationFlow(pi, ctx);
  });
  onUserMessage(pi, (text, ctx) => {
    void handleConfirmInput(pi, ctx, text);
  });
  onToolResult(pi, (event, _ctx) => {
    if (event.toolName === "bash" && typeof event.input["command"] === "string") {
      const command = event.input["command"];
      const state = getState();
      if (isTestCommand(command, state.contract)) {
        const text = Array.isArray(event.content)
          ? event.content.map((c) => c.text ?? "").join("\n")
          : "";
        const receipt: VerificationReceipt = {
          command,
          exitCode: event.isError ? 1 : 0,
          tailOutput: text.slice(-2000),
          executedAt: Date.now(),
        };
        recordTestExecution(receipt);
        updateState((s) => ({ ...s, lastTestReceipt: receipt, snapshotPending: true }));
      }
    }
  });
}
