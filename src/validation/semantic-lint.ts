// HIGH_LEVEL: #validation — deterministic zero-token semantic linting over diff patches.

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

function isSanctionedGuard(text: string): boolean {
  return /^\s*#\s*ifndef\s+[A-Za-z0-9_]+_C\b/.test(text);
}

function checkUxPatch(patch: FilePatch, violations: LintViolation[]): void {
  const isUx = patch.file.includes("/ux/") && patch.file.endsWith(".c");
  if (!isUx) return;

  const isSiteUi = patch.file.endsWith("site_ui.c");

  for (const { text } of patch.addedLines) {
    const isCompileBranch = /^\s*#\s*(if|ifdef|elif)\b/.test(text) ||
      (/^\s*#\s*ifndef\b/.test(text) && !isSanctionedGuard(text));

    if (isCompileBranch) {
      if (isSiteUi && /^\s*#\s*ifndef\s+__wasm__\b/.test(text)) {
        // Sanctioned aggregator exemption
      } else {
        violations.push({
          ruleId: "no-ux-compile-branch",
          file: patch.file,
          message: `UX avoids compile-time branching: forbidden macro branch '${text.trim()}' in ${patch.file}. Use runtime state branching instead.`,
        });
      }
    }

    if (/\b(corm_|source_|axil_|lemma_|hyle_source|XY_)/.test(text)) {
      violations.push({
        ruleId: "no-ux-engine-symbols",
        file: patch.file,
        message: `Forbidden engine symbol in isomorphic UX: ${patch.file} cannot reference XY_/corm_/source_/axil_/lemma_/hyle_source.`,
      });
    }
  }
}

function checkIncludesAndConflicts(patch: FilePatch, violations: LintViolation[]): void {
  const isSanctionedAggregator = patch.file.endsWith("site_ui.c") || patch.file.endsWith("list.c");

  for (const { text } of patch.addedLines) {
    if (/^\s*(<{7}|={7}|>{7})(\s|$)/.test(text)) {
      violations.push({
        ruleId: "no-conflict-markers",
        file: patch.file,
        message: `Unresolved git conflict markers found in ${patch.file}.`,
      });
    }

    if (!isSanctionedAggregator && /^\s*#\s*include\s+["<].*?\.c[">]/.test(text)) {
      violations.push({
        ruleId: "no-cross-module-c-include",
        file: patch.file,
        message: `Forbidden #include '*.c' in ${patch.file}. Cross-module calls must use XY boundaries.`,
      });
    }
  }
}

export function runSemanticLints(diffText: string): LintViolation[] {
  const patches = parseGitDiff(diffText);
  const violations: LintViolation[] = [];

  for (const patch of patches) {
    checkUxPatch(patch, violations);
    checkIncludesAndConflicts(patch, violations);
  }

  return violations;
}
