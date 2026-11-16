import { getState, dispatch } from "../../app/store";
import { readQuestConfig } from "../../config";
import type { VerificationReceipt } from "../../domain/quest";
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events";
import { findPrimaryRepoRoot, runTestInPrimaryWorkspace, execTestShell } from "../../utils/git";
import { recordTestExecution } from "../../validation/evidence-gate";
import { textResult } from "./reply";

async function executeRunTest(pi: Pi, ctx: PiCtx, params: Record<string, unknown>) {
  if (getState().disabled === true) {
    return textResult(
      "pi-quest is paused for this session (/quest pause). Run tests directly with bash or bg_run in the normal workflow.",
      { error: "quest_paused" },
    );
  }
  const command = typeof params["command"] === "string" ? params["command"].trim() : "";
  if (!command) {
    return textResult("Error: command parameter is required and cannot be empty.", { error: "empty command" });
  }

  const state = getState();
  const qid = state.qid ?? "unknown";
  const config = await readQuestConfig(ctx.cwd);
  const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
  const worktreePath = state.worktreePath ?? state.contract?.worktreePath;
  const worktreeBranch = state.worktreeBranch ?? state.contract?.worktreeBranch;
  const usePrimary = config.gitWorkflow?.testInPrimaryWorkspace === true;

  try {
    let receipt: VerificationReceipt;
    if (usePrimary && worktreePath && worktreeBranch) {
      receipt = await runTestInPrimaryWorkspace({
        primaryRoot,
        command,
        qid,
        worktreePath,
        worktreeBranch,
        pi,
      });
    } else {
      const execTarget = worktreePath ?? ctx.cwd;
      const res = await execTestShell(command, execTarget, pi);
      receipt = {
        command,
        exitCode: res.exitCode,
        tailOutput: (res.stdout + (res.stderr ? `\n${res.stderr}` : "")).slice(-2000),
        executedAt: Date.now(),
      };
    }

    recordTestExecution(receipt);
    dispatch({ type: "TestRunRecorded", receipt });

    const statusLabel = receipt.exitCode === 0 ? "PASS ✓" : `FAIL (exit code ${receipt.exitCode})`;
    const summary = [
      `Test Execution Result: ${statusLabel}`,
      `Command: \`${receipt.command}\``,
      receipt.tailOutput ? `\nOutput:\n${receipt.tailOutput}` : "",
    ].filter(Boolean).join("\n");

    return textResult(summary, {
      exitCode: receipt.exitCode,
      command: receipt.command,
      output: receipt.tailOutput,
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    return textResult(`Failed to run test: ${errMessage}`, { error: errMessage });
  }
}

export function runTestTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_run_test",
    label: "Run Verification Test",
    description:
      "Safely execute a verification test command inside the active worktree (or primary repository root when not in a worktree, or when testInPrimaryWorkspace is explicitly configured). " +
      "Records the verification test receipt.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Test command to execute (e.g. 'make test-fast' or 'deno test').",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    execute: (_toolCallId, params, _signal, _onUpdate, ctx: PiCtx) => executeRunTest(pi, ctx, params),
  };
}
