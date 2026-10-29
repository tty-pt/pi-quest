// HIGH_LEVEL: #validation — deterministic zero-token semantic linting over diff patches.
import type { LintRule } from "../config.ts";

export interface LintViolation {
  ruleId: string;
  file: string;
  line?: number;
  message: string;
}

interface FilePatch {
  file: string;
  addedLines: Array<{ lineNum?: number; text: string }>;
}

export function parseGitDiff(diffText: string): FilePatch[] {
  const patches: FilePatch[] = [];
  const lines = diffText.split("\n");
  let currentFile: string | null = null;
  let currentAdded: Array<{ lineNum?: number; text: string }> = [];

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (currentFile && currentAdded.length > 0) {
        patches.push({ file: currentFile, addedLines: currentAdded });
      }
      currentFile = null;
      currentAdded = [];
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) currentFile = match[2];
    } else if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6).trim();
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      currentAdded.push({ text: line.slice(1) });
    }
  }

  if (currentFile && currentAdded.length > 0) {
    patches.push({ file: currentFile, addedLines: currentAdded });
  }

  return patches;
}

// Generic, repo-independent rule: unresolved merge conflict markers.
const CONFLICT_MARKER = /^\s*(<{7}|={7}|>{7})(\s|$)/;

function applyRule(rule: LintRule, patch: FilePatch, violations: LintViolation[]): void {
  if (rule.filePattern !== undefined && !new RegExp(rule.filePattern).test(patch.file)) return;
  if (rule.excludeFilePattern !== undefined && new RegExp(rule.excludeFilePattern).test(patch.file)) return;
  const line = new RegExp(rule.linePattern);
  const exempt = rule.excludeLinePattern !== undefined ? new RegExp(rule.excludeLinePattern) : null;
  for (const { text } of patch.addedLines) {
    if (!line.test(text)) continue;
    if (exempt !== null && exempt.test(text)) continue;
    violations.push({ ruleId: rule.id, file: patch.file, message: rule.message.replace("{file}", patch.file).replace("{line}", text.trim()) });
  }
}

/**
 * Run the built-in conflict-marker check plus the repo's own rules from
 * settings `pi-quest.lintRules`. No repo-specific policy ships in code.
 */
export function runSemanticLints(diffText: string, rules: readonly LintRule[] = []): LintViolation[] {
  const patches = parseGitDiff(diffText);
  const violations: LintViolation[] = [];

  for (const patch of patches) {
    for (const { text } of patch.addedLines) {
      if (CONFLICT_MARKER.test(text)) {
        violations.push({
          ruleId: "no-conflict-markers",
          file: patch.file,
          message: `Unresolved git conflict markers found in ${patch.file}.`,
        });
      }
    }
    for (const rule of rules) applyRule(rule, patch, violations);
  }

  return violations;
}
