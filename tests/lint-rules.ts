// Fixture mirroring a repo-local `pi-quest.lintRules` setting (the rules the
// site repo ships in its own .pi/settings.json). The extension itself ships none.
import type { LintRule } from "../src/config.ts";

const BRANCH = "^\\s*#\\s*(?:if|ifdef|elif)\\b|^\\s*#\\s*ifndef\\b";
const BRANCH_MSG = "UX avoids compile-time branching: forbidden macro branch '{line}' in {file}. Use runtime state branching instead.";

export const SITE_LINT_RULES: LintRule[] = [
  { id: "no-ux-compile-branch", filePattern: "/ux/[^/]*\\.c$", excludeFilePattern: "site_ui\\.c$", linePattern: BRANCH, excludeLinePattern: "^\\s*#\\s*ifndef\\s+[A-Za-z0-9_]+_C\\b", message: BRANCH_MSG },
  { id: "no-ux-compile-branch", filePattern: "site_ui\\.c$", linePattern: BRANCH, excludeLinePattern: "^\\s*#\\s*ifndef\\s+(?:[A-Za-z0-9_]+_C|__wasm__)\\b", message: BRANCH_MSG },
  { id: "no-ux-engine-symbols", filePattern: "/ux/[^/]*\\.c$", linePattern: "\\b(?:corm_|source_|axil_|lemma_|hyle_source|XY_)", message: "Forbidden engine symbol in isomorphic UX: {file} cannot reference XY_/corm_/source_/axil_/lemma_/hyle_source." },
  { id: "no-cross-module-c-include", excludeFilePattern: "(?:site_ui|list)\\.c$", linePattern: "^\\s*#\\s*include\\s+[\"<].*?\\.c[\">]", message: "Forbidden #include '*.c' in {file}. Cross-module calls must use XY boundaries." },
];
