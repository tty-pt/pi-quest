// HIGH_LEVEL: #sub-quests — contracts, requirement traceability matrix, and handback receipts.
import type { Qid } from "./qid";

export interface RtmItem {
  id: string;
  description: string;
  status: "pending" | "satisfied" | "verified";
  owner?: string;
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

export function checkRtmCoverage(
  rtm: RtmItem[] | undefined,
  planText: string,
): { covered: boolean; missing: string[] } {
  if (!rtm || rtm.length === 0) return { covered: true, missing: [] };
  const missing: string[] = [];
  for (const item of rtm) {
    // Check if item id (e.g. "R1") is referenced in the plan or has an owner
    const pattern = new RegExp(`\\b${item.id}\\b`, "i");
    if (!pattern.test(planText) && !item.owner) {
      missing.push(item.id);
    }
  }
  return { covered: missing.length === 0, missing };
}
