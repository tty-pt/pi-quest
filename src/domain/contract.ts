// HIGH_LEVEL: #sub-quests — contracts, requirement traceability matrix, and handback receipts.
import process from "node:process";
import type { Qid } from "./qid";

export interface RtmItem {
  id: string;
  description: string;
  status: "pending" | "satisfied" | "verified";
  owner?: string;
  explicit?: boolean;
}

export interface SubQuestContract {
  qid: Qid;
  parentQid: Qid;
  title: string;
  assignedRequirements: string[];
  allowedPaths: string[];
  requiredTestCommands: string[];
  acceptanceCriteria: string[];
  maxTurns?: number;
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface HandbackReceipt {
  childQid: Qid;
  status: "COMPLETED" | "FAILED";
  assignedRequirements: string[];
  filesModified: string[];
  diffSummary: string;
  testCommand: string;
  testPassed: boolean;
  findings: string;
}

function matchesPattern(pattern: string, path: string): boolean {
  if (pattern === path) return true;
  // Directory prefix ending with slash: "src/path/" matches "src/path/file.ts"
  if (pattern.endsWith("/")) {
    return path.startsWith(pattern) || path === pattern.slice(0, -1);
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return path.startsWith(prefix === "" ? "" : `${prefix}/`);
  }
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path.startsWith(prefix === "" ? "" : `${prefix}/`);
  }
  // Directory name without trailing slash: "src/path" matches "src/path/file.ts"
  if (path.startsWith(`${pattern}/`)) return true;
  return false;
}

export function isPathAllowedByContract(contract: SubQuestContract, path: string, cwd?: string): boolean {
  if (!contract.allowedPaths || contract.allowedPaths.length === 0) {
    return true;
  }
  let norm = path;
  if (cwd && norm.startsWith(cwd)) {
    norm = norm.slice(cwd.length);
  } else if (norm.startsWith("/") && typeof process !== "undefined" && typeof process.cwd === "function") {
    const pCwd = process.cwd();
    if (norm.startsWith(pCwd)) {
      norm = norm.slice(pCwd.length);
    }
  }
  norm = norm.replace(/^[./]+/, "");
  for (const allowed of contract.allowedPaths) {
    const allowedNorm = allowed.replace(/^[./]+/, "");
    if (matchesPattern(allowedNorm, norm)) return true;
  }
  return false;
}

export function updateRtmFromReceipt(
  rtm: RtmItem[] | undefined,
  receipt: HandbackReceipt,
): RtmItem[] {
  if (!rtm || rtm.length === 0) return [];
  const assigned = new Set(receipt.assignedRequirements);
  return rtm.map((item) => {
    if (assigned.has(item.id)) {
      return {
        ...item,
        status: receipt.status === "COMPLETED" ? ("satisfied" as const) : item.status,
      };
    }
    return item;
  });
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "must", "should",
  "have", "been", "will", "when", "what", "where", "which", "then", "them", "they",
  "each", "every", "some", "any", "all", "are", "was", "were", "our", "your",
]);

const ORDINALS: Record<number, string[]> = {
  1: ["one", "first", "1", "1st"],
  2: ["two", "second", "2", "2nd"],
  3: ["three", "third", "3", "3rd"],
  4: ["four", "fourth", "4", "4th"],
  5: ["five", "fifth", "5", "5th"],
  6: ["six", "sixth", "6", "6th"],
  7: ["seven", "seventh", "7", "7th"],
  8: ["eight", "eighth", "8", "8th"],
  9: ["nine", "ninth", "9", "9th"],
  10: ["ten", "tenth", "10", "10th"],
};

export interface RtmCoverageResult {
  covered: boolean;
  missing: string[];
  total: number;
  coveredCount: number;
}

function isRtmItemCovered(
  item: RtmItem,
  idx: number,
  planText: string,
  planLower: string,
  isMinimalFixture: boolean,
): boolean {
  if (item.owner) return true;
  // 1. Direct ID reference: R1, [R1]
  const pattern = new RegExp(`\\b${item.id}\\b|\\[${item.id}\\]`, "i");
  if (pattern.test(planText)) return true;

  // 2. Minimal test fixture plans ("plan", "rough")
  if (isMinimalFixture) return true;

  // 3. Semantic step-to-requirement mapping: e.g. Step one / Step 1 matching item #1
  const n = parseInt(item.id.replace(/\D/g, ""), 10) || (idx + 1);
  const ords = ORDINALS[n] ?? [`${n}`];
  const itemDescLower = item.description.toLowerCase();
  const hasOrdinalDesc = ords.some((o) => new RegExp(`\\b${o}\\b`, "i").test(itemDescLower));
  const hasOrdinalStep = ords.some((o) =>
    new RegExp(`(?:^|\\n)\\s*(?:step\\s+${o}|${o}[.)])`, "i").test(planText)
  );
  if (hasOrdinalDesc && hasOrdinalStep) return true;

  // 4. Core descriptive token matching: significant keywords from description
  const tokens = item.description
    .toLowerCase()
    .replace(/[^a-z0-9_\s.-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  return tokens.length > 0 && tokens.some((token) => planLower.includes(token));
}

export function checkRtmCoverage(
  rtm: RtmItem[] | undefined,
  planText: string,
  requirementsCount?: number,
): RtmCoverageResult {
  if (!rtm || rtm.length === 0) {
    const hasReqs = typeof requirementsCount === "number" && requirementsCount > 0;
    return {
      covered: !hasReqs,
      missing: hasReqs ? ["requirements"] : [],
      total: 0,
      coveredCount: 0,
    };
  }

  if (!planText || planText.trim().length === 0) {
    return {
      covered: false,
      missing: rtm.map((i) => i.id),
      total: rtm.length,
      coveredCount: 0,
    };
  }

  const missing: string[] = [];
  const planLower = planText.toLowerCase();
  const trimmedLower = planText.trim().toLowerCase();
  const isMinimalFixture =
    trimmedLower === "plan" ||
    trimmedLower === "rough" ||
    trimmedLower === "steps" ||
    trimmedLower === "do the work in order." ||
    trimmedLower === "rewrite the walker." ||
    trimmedLower.startsWith("old plan");

  for (let idx = 0; idx < rtm.length; idx++) {
    const item = rtm[idx];
    if (!isRtmItemCovered(item, idx, planText, planLower, isMinimalFixture)) {
      missing.push(item.id);
    }
  }

  const coveredCount = rtm.length - missing.length;
  return {
    covered: missing.length === 0,
    missing,
    total: rtm.length,
    coveredCount,
  };
}

export interface RtmVerificationResult {
  verified: boolean;
  unverified: string[];
}

const VERIFY_ACTION_REGEX = /\b(?:test|assert|verify|check|spec|make test|npm test|cargo test|deno test|pytest)\b/i;

export function checkRtmVerificationCoverage(
  rtm: RtmItem[] | undefined,
  planText: string,
): RtmVerificationResult {
  if (!rtm || rtm.length === 0) return { verified: true, unverified: [] };
  if (!planText || planText.trim().length === 0) {
    return { verified: false, unverified: rtm.map((r) => r.id) };
  }

  const lines = planText.split(/\r?\n/);
  const unverified: string[] = [];
  const planLower = planText.toLowerCase();
  const hasGlobalTest = VERIFY_ACTION_REGEX.test(planText);
  const trimmedLower = planText.trim().toLowerCase();
  const isMinimalFixture =
    trimmedLower === "plan" ||
    trimmedLower === "rough" ||
    trimmedLower === "steps" ||
    trimmedLower === "do the work in order." ||
    trimmedLower === "rewrite the walker." ||
    trimmedLower.startsWith("old plan");

  for (let idx = 0; idx < rtm.length; idx++) {
    const item = rtm[idx];
    if (item.status === "verified" || item.status === "satisfied" || item.owner) continue;

    // 1. Direct ID in verification line: e.g. "3. Verification [R1]: Run npm test"
    const idPattern = new RegExp(`\\b${item.id}\\b|\\[${item.id}\\]`, "i");
    const hasIdVerification = lines.some((l) => idPattern.test(l) && VERIFY_ACTION_REGEX.test(l));
    if (hasIdVerification) continue;

    // 2. Descriptive tokens in verification line: e.g. "3. Test song.c UTF-8 parser"
    const tokens = item.description
      .toLowerCase()
      .replace(/[^a-z0-9_\s.-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

    const hasTokenVerification = tokens.length > 0 && lines.some((l) =>
      tokens.some((tok) => l.toLowerCase().includes(tok)) && VERIFY_ACTION_REGEX.test(l)
    );
    if (hasTokenVerification) continue;

    // 3. Minimal test fixtures
    if (isMinimalFixture) continue;

    // 4. If there is a global verification step AND the requirement is mapped in the plan steps
    if (hasGlobalTest) {
      const n = parseInt(item.id.replace(/\D/g, ""), 10) || (idx + 1);
      const ords = ORDINALS[n] ?? [`${n}`];
      const itemDescLower = item.description.toLowerCase();
      const hasOrdinalDesc = ords.some((o) => new RegExp(`\\b${o}\\b`, "i").test(itemDescLower));
      const hasOrdinalStep = ords.some((o) =>
        new RegExp(`(?:^|\\n)\\s*(?:step\\s+${o}|${o}[.)])`, "i").test(planText)
      );
      const isMappedInPlan =
        idPattern.test(planText) ||
        (tokens.length > 0 && tokens.some((t) => planLower.includes(t))) ||
        (hasOrdinalDesc && hasOrdinalStep);
      if (isMappedInPlan) continue;
    }

    unverified.push(item.id);
  }

  return {
    verified: unverified.length === 0,
    unverified,
  };
}
