// HIGH_LEVEL: #modes
// HIGH_LEVEL: #validation — validator archives on PASS, demotes on FAIL.
// SPEC: B1.5 (completion + slim archive).
import { dispatch, getState } from "../app/store";
import { readQuestConfig } from "../config";
import type { VerificationReceipt } from "../domain/quest";
import type { Pi } from "../hooks/events";
import { onSessionStart, onToolResult, onTurnEnd, onUserMessage } from "../hooks/events";
import { ensureValidationFlow, handleConfirmInput } from "./flow";
import { isTestCommand, recordTestExecution } from "./evidence-gate";
import { findPrimaryRepoRoot, runTestInPrimaryWorkspace } from "../utils/git";

export function installValidation(pi: Pi): void {
  onTurnEnd(pi, (_event, ctx) => {
    if (getState().disabled === true) return;
    void ensureValidationFlow(pi, ctx);
  });
  onSessionStart(pi, (_event, ctx) => {
    if (getState().disabled === true) return;
    void ensureValidationFlow(pi, ctx);
  });
  onUserMessage(pi, (text, ctx) => {
    if (getState().disabled === true) return;
    void handleConfirmInput(pi, ctx, text);
  });
  onToolResult(pi, async (event, ctx) => {
    if (getState().disabled === true) return;
    if (event.toolName === "bash" && typeof event.input["command"] === "string") {
      const command = event.input["command"];
      const state = getState();
      const config = await readQuestConfig(ctx.cwd);
      if (isTestCommand(command, state.contract, config.testCommands)) {
        const text = Array.isArray(event.content)
          ? event.content.map((c) => c.text ?? "").join("\n")
          : "";
        const details = event.details as Record<string, unknown> | undefined;
        const rawCode = details?.["exitCode"] ?? details?.["code"];
        const exitCode = typeof rawCode === "number" ? rawCode : (event.isError ? 1 : 0);
        let receipt: VerificationReceipt = {
          command,
          exitCode,
          tailOutput: text.slice(-2000),
          executedAt: Date.now(),
        };

        const worktreePath = state.worktreePath ?? state.contract?.worktreePath;
        const worktreeBranch = state.worktreeBranch ?? state.contract?.worktreeBranch;
        if (config.gitWorkflow?.testInPrimaryWorkspace === true && worktreePath && worktreeBranch) {
          const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
          try {
            receipt = await runTestInPrimaryWorkspace({
              primaryRoot,
              command,
              qid: state.qid ?? "unknown",
              worktreePath,
              worktreeBranch,
              pi,
            });
          } catch {
            // Keep direct execution receipt as fallback
          }
        }

        recordTestExecution(receipt);
        dispatch({ type: "TestRunRecorded", receipt });
      }
    }

    if (!event.isError && (event.toolName === "edit" || event.toolName === "write")) {
      const p = event.input["path"];
      if (typeof p === "string" && p.trim().length > 0) {
        const { isAbsolute, resolve } = await import("node:path");
        const resolved = isAbsolute(p) ? p : resolve(ctx.cwd, p);
        dispatch({ type: "FileModified", path: resolved });
      }
    }
  });
}
