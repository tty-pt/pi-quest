// HIGH_LEVEL: #validation — the quest doc's ## Status section tracks the
// phase but never marks completion on the agent's say-so; the runtime keeps
// it honest on claims and demotes.
// Pure string helpers over the quest document; file I/O lives in the
// adapters (quest-doc.ts at src root), never here.
import { isHeading } from "./sections";
import type { HandbackReceipt } from "./contract";

export interface DocStatus {
  phase: string | null;
  complete: boolean;
}

function sectionEnd(lines: string[], header: number): number {
  for (let i = header + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

export function parseDocStatus(text: string): DocStatus {
  const status: DocStatus = { phase: null, complete: false };
  const lines = text.split("\n");
  const header = lines.findIndex((line) => isHeading(line, "status"));
  if (header === -1) return status;
  const end = sectionEnd(lines, header);
  for (let i = header + 1; i < end; i += 1) {
    const phase = lines[i].match(/^-\s*Phase:\s*(.+?)\s*$/i);
    if (phase !== null) status.phase = phase[1];
    const complete = lines[i].match(/^-\s*Complete:\s*(true|false)\s*$/i);
    if (complete !== null) status.complete = complete[1].toLowerCase() === "true";
  }
  return status;
}

// Insert or replace the quest doc's ## Status section. Idempotent: present
// Phase/Complete lines are overwritten, missing ones are inserted under the
// header, and a missing header appends the whole section.
export function upsertDocStatus(text: string, phase: string, complete: boolean): string {
  const lines = text.split("\n");
  const header = lines.findIndex((line) => isHeading(line, "status"));
  const phaseLine = `- Phase: ${phase}`;
  const completeLine = `- Complete: ${complete ? "true" : "false"}`;
  if (header === -1) {
    const body = text.endsWith("\n") ? text : `${text}\n`;
    return `${body}## Status\n${phaseLine}\n${completeLine}\n`;
  }
  const end = sectionEnd(lines, header);
  let phaseSet = false;
  let completeSet = false;
  const rebuilt = lines.slice(header, end).map((line) => {
    if (/^-\s*Phase:/i.test(line)) {
      phaseSet = true;
      return phaseLine;
    }
    if (/^-\s*Complete:/i.test(line)) {
      completeSet = true;
      return completeLine;
    }
    return line;
  });
  const insert: string[] = [];
  if (!phaseSet) insert.push(phaseLine);
  if (!completeSet) insert.push(completeLine);
  if (insert.length > 0) rebuilt.splice(1, 0, ...insert);
  return [...lines.slice(0, header), ...rebuilt, ...lines.slice(end)].join("\n");
}

export function reconcileDocContent(text: string, receipt: HandbackReceipt): string {
  let lines = text.split("\n");

  // 1. If COMPLETED, check off assigned requirements
  if (receipt.status === "COMPLETED" && receipt.assignedRequirements.length > 0) {
    const assigned = new Set(receipt.assignedRequirements.map((r) => r.toLowerCase()));
    lines = lines.map((line) => {
      const match = line.match(/^(\s*-\s*\[)\s*(\]\s*.*?(\b[A-Za-z0-9_.-]+\b).*)$/);
      if (match) {
        for (const req of assigned) {
          const pattern = new RegExp(`\\b${req}\\b`, "i");
          if (pattern.test(line)) {
            return line.replace(/^(\s*-\s*\[)\s*(\])/, "$1x$2");
          }
        }
      }
      return line;
    });
  }

  // 2. Format receipt bullet
  const mark = receipt.status === "COMPLETED" ? "x" : "!";
  const testInfo = receipt.testCommand ? ` [test: ${receipt.testCommand} ${receipt.testPassed ? "passed" : "failed"}]` : "";
  const receiptLine = `- [${mark}] Sub-Quest ${receipt.childQid} (${receipt.status}): ${receipt.findings}${testInfo}`;

  // 3. Insert into ## Sub-Quests if present, or append
  const headerIdx = lines.findIndex((l) => isHeading(l, "subquests"));
  if (headerIdx !== -1) {
    lines.splice(headerIdx + 1, 0, receiptLine);
    return lines.join("\n");
  }

  const endIdx = lines.findIndex((l) => isHeading(l, "plan"));
  if (endIdx !== -1) {
    lines.splice(endIdx, 0, `## Sub-Quests\n\n${receiptLine}\n`);
    return lines.join("\n");
  }

  return `${lines.join("\n").trimEnd()}\n\n## Sub-Quests\n\n${receiptLine}\n`;
}

function findMaxSequenceNumber(lines: string[], prefix: string): number {
  const pattern = new RegExp(`\\b${prefix}(\\d+)\\b`, "i");
  let max = 0;
  for (const line of lines) {
    const m = line.match(pattern);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num > max) max = num;
    }
  }
  return max;
}

function insertBeforeSectionEnd(lines: string[], header: number, item: string): string[] {
  const end = sectionEnd(lines, header);
  let insertIdx = end;
  while (insertIdx > header + 1 && lines[insertIdx - 1].trim() === "") {
    insertIdx--;
  }
  lines.splice(insertIdx, 0, item);
  return lines;
}

export function appendRequirementToDoc(text: string, requirementText: string): string {
  const lines = text.split("\n");
  const header = lines.findIndex((l) => isHeading(l, "requirements"));
  const nextR = findMaxSequenceNumber(lines, "R") + 1;
  const newReq = `- R${nextR}: [User Directive] ${requirementText.trim()}`;

  if (header === -1) {
    return `${text.trimEnd()}\n\n## Requirements\n\n${newReq}\n`;
  }
  return insertBeforeSectionEnd(lines, header, newReq).join("\n");
}

export function appendSubQuestBacklogItem(
  text: string,
  goal: string,
  options?: { paths?: string[]; tests?: string[] },
): string {
  const lines = text.split("\n");
  const nextSQ = findMaxSequenceNumber(lines, "SQ") + 1;
  const pathsTag = options?.paths && options.paths.length > 0 ? ` [paths: ${options.paths.join(", ")}]` : "";
  const testsTag = options?.tests && options.tests.length > 0
    ? ` [tests: ${options.tests.join(", ")}]`
    : " [tests: make test]";
  const sqLine = `- [ ] SQ${nextSQ}: ${goal.trim()}${pathsTag}${testsTag}`;

  const header = lines.findIndex((l) => isHeading(l, "subquests"));
  if (header !== -1) {
    return insertBeforeSectionEnd(lines, header, sqLine).join("\n");
  }

  const planIdx = lines.findIndex((l) => isHeading(l, "plan"));
  if (planIdx !== -1) {
    lines.splice(planIdx, 0, `## Sub-Quests\n\n${sqLine}\n`);
    return lines.join("\n");
  }

  return `${lines.join("\n").trimEnd()}\n\n## Sub-Quests\n\n${sqLine}\n`;
}

export function appendAmendmentToDoc(text: string, change: string, reason: string): string {
  const lines = text.split("\n");
  const header = lines.findIndex((l) => isHeading(l, "amendments"));
  const bullet = `- ${change.trim()} (${reason.trim()})`;

  if (header === -1) {
    const reqHeader = lines.findIndex((l) => isHeading(l, "requirements"));
    if (reqHeader !== -1) {
      lines.splice(reqHeader, 0, `## Amendments\n\n${bullet}\n`);
      return lines.join("\n");
    }
    return `## Amendments\n\n${bullet}\n\n${text}`;
  }

  return insertBeforeSectionEnd(lines, header, bullet).join("\n");
}