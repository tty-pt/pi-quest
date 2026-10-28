// HIGH_LEVEL: #validation — evidence-gated completion checks.
import { unfinishedChildren } from "../domain/children";
import type { QuestState, VerificationReceipt } from "../domain/quest";
import type { LintRule } from "../config";
import { runSemanticLints } from "./semantic-lint";

export type { VerificationReceipt };

export interface EvidenceGateOptions {
  getDiffStat?: () => Promise<string>;
  getDiffPatch?: () => Promise<string>;
  getLatestTest?: () => VerificationReceipt | null;
  lintRules?: readonly LintRule[];
}

let latestTestReceipt: VerificationReceipt | null = null;

export function recordTestExecution(receipt: VerificationReceipt): void {
  latestTestReceipt = receipt;
}

export function getLatestTestExecution(): VerificationReceipt | null {
  return latestTestReceipt;
}

export function clearTestExecution(): void {
  latestTestReceipt = null;
}

export { isTestCommand } from "../utils/commands";

export async function assertCompletionEligibility(
  state: QuestState,
  options: EvidenceGateOptions = {},
): Promise<void> {
  const unfinished = unfinishedChildren(state);
  if (unfinished.length > 0) {
    throw new Error(`complete blocked: unfinished children ${unfinished.map((c) => c.qid).join(", ")}`);
  }

  // Analysis quests deliver written analysis; code diff and test execution are not required
  if (state.kind === "analysis") {
    return;
  }

  const getDiffStat = options.getDiffStat ?? (async () => "");
  const getLatestTest = options.getLatestTest ?? (() => state.lastTestReceipt ?? getLatestTestExecution());

  const diffStat = await getDiffStat();
  if (diffStat.trim() === "" && state.children.length === 0) {
    throw new Error("Cannot claim completion: No files have been modified.");
  }

  const getDiffPatch = options.getDiffPatch ?? (async () => "");
  const diffPatch = await getDiffPatch();
  if (diffPatch.trim().length > 0) {
    const violations = runSemanticLints(diffPatch, options.lintRules ?? []);
    if (violations.length > 0) {
      const summary = violations.map((v) => `[${v.ruleId}] ${v.message}`).join("\n");
      throw new Error(`Cannot claim completion: Semantic boundary violation:\n${summary}`);
    }
  }

  const testReceipt = getLatestTest();
  if (!testReceipt) {
    throw new Error("Cannot claim completion: No build/test verification command was executed in this quest session.");
  }

  if (testReceipt.exitCode !== 0) {
    throw new Error(`Cannot claim completion: The last test execution failed (exit code ${testReceipt.exitCode}):\n${testReceipt.tailOutput}`);
  }
}
