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

export function detectTestTampering(diffPatch: string): string[] {
  const violations: string[] = [];
  const fileDiffs = diffPatch.split(/^diff --git /m);

  for (const fileDiff of fileDiffs) {
    if (!fileDiff.trim()) continue;
    const headerMatch = fileDiff.match(/^[a-b]\/([^\s]+)/m) || fileDiff.match(/^\+\+\+ b\/([^\s]+)/m);
    const filePath = headerMatch ? headerMatch[1] : "";
    const isTestFile = /(?:^|\/)(?:tests?|spec)\/|\.(?:test|spec)\.[a-z]+$|_test\.[a-z]+$|test-[^/]+\.sh$/i.test(filePath);
    if (!isTestFile) continue;

    const lines = fileDiff.split(/\r?\n/);
    let deletedAssertions = 0;
    let addedAssertions = 0;
    let commentedOutAssertions = 0;

    const ASSERT_PATTERN = /\b(?:assert|expect|check|ASSERT_[A-Z0-9_]+|TEST_ASSERT[A-Z0-9_]*)\s*[(<]/;
    const COMMENTED_ASSERT_PATTERN = /^\+\s*(?:\/\/|\/\*|\*|#)\s*(?:assert|expect|check|ASSERT_[A-Z0-9_]+|TEST_ASSERT[A-Z0-9_]*)\s*[(<]/;

    for (const line of lines) {
      if (line.startsWith("---") || line.startsWith("+++")) continue;
      if (COMMENTED_ASSERT_PATTERN.test(line)) {
        commentedOutAssertions++;
      } else if (line.startsWith("-") && ASSERT_PATTERN.test(line.slice(1))) {
        deletedAssertions++;
      } else if (line.startsWith("+") && ASSERT_PATTERN.test(line.slice(1))) {
        addedAssertions++;
      }
    }

    if (commentedOutAssertions > 0) {
      violations.push(`Test assertion was commented out in ${filePath} (${commentedOutAssertions} occurrence(s)). Fix implementation, do not disable tests.`);
    } else if (deletedAssertions > addedAssertions) {
      violations.push(`Test assertions were deleted without replacement in ${filePath} (${deletedAssertions} deleted vs ${addedAssertions} added). Do not weaken tests to beat validation.`);
    }
  }
  return violations;
}

function checkImplementationDepth(state: QuestState, diffStat: string, diffPatch: string): void {
  if (state.rtm && state.rtm.length >= 3 && state.difficulty !== "trivial" && state.difficulty !== "minor") {
    const lines = diffStat.trim().split("\n").filter((l) => l.trim().length > 0 && !/\bchanged\b/i.test(l));
    if (lines.length <= 1 && (state.touchedFiles ?? []).length <= 1 && diffPatch.trim().length < 50) {
      throw new Error(
        `Cannot claim completion: Implementation depth check failed. Multi-requirement task (${state.rtm.length} requirements) requires substantive implementation before completion.`,
      );
    }
  }
}

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
    // Docs quests require modified files (documentation text).
    // Standard/code quests require modified files unless difficulty is trivial (e.g. clean-tree VCS chores).
    if (state.kind === "docs" || state.difficulty !== "trivial") {
      throw new Error("Cannot claim completion: No files have been modified.");
    }
  }

  // Documentation quests require modified files (docs/markdown), but binary test runner execution is not required.
  if (state.kind === "docs") {
    return;
  }

  // Trivial difficulty tasks (typo fixes, comments, config touch, version bumps) do not require mandatory binary test runner execution
  if (state.difficulty === "trivial") {
    return;
  }

  const getDiffPatch = options.getDiffPatch ?? (async () => "");
  const diffPatch = await getDiffPatch();
  if (diffPatch.trim().length > 0) {
    const tampering = detectTestTampering(diffPatch);
    if (tampering.length > 0) {
      throw new Error(`Cannot claim completion: Test integrity violation:\n${tampering.join("\n")}`);
    }

    const violations = runSemanticLints(diffPatch, options.lintRules ?? []);
    if (violations.length > 0) {
      const summary = violations.map((v) => `[${v.ruleId}] ${v.message}`).join("\n");
      throw new Error(`Cannot claim completion: Semantic boundary violation:\n${summary}`);
    }
  }

  checkImplementationDepth(state, diffStat, diffPatch);

  const testReceipt = getLatestTest();
  if (!testReceipt && !state.lastPassingTestReceipt) {
    throw new Error("Cannot claim completion: No build/test verification command was executed in this quest session.");
  }

  const passing = state.lastPassingTestReceipt;
  const isPassingValid = Boolean(passing && passing.exitCode === 0 && (
    !state.lastFileModifiedAt || (passing.executedAt ?? 0) >= state.lastFileModifiedAt
  ));
  const effectiveReceipt = (testReceipt && testReceipt.exitCode === 0)
    ? testReceipt
    : (isPassingValid && passing)
    ? passing
    : testReceipt;

  if (!effectiveReceipt) {
    throw new Error("Cannot claim completion: No build/test verification command was executed in this quest session.");
  }

  if (effectiveReceipt.exitCode !== 0) {
    throw new Error(`Cannot claim completion: The last test execution failed (exit code ${effectiveReceipt.exitCode}):\n${effectiveReceipt.tailOutput}`);
  }
}
