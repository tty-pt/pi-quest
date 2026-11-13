import { isHeading, type SectionKey } from "../domain/sections";

export const RESERVED_SECTIONS = new Set([
  "requirements",
  "evidence",
  "assumptions",
  "assumptions & falsification criteria",
  "assumptions and falsification criteria",
  "assumptions & risks",
  "assumptions and risks",
  "sub-quests",
  "subquests",
  "amendments",
  "analysis",
  "implementation plan",
  "plan",
  "context / background discussion",
  "context",
  "original request",
]);

export function spliceSection(text: string, key: SectionKey, label: string, body: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => isHeading(line, key));
  if (start === -1) {
    const base = text.endsWith("\n") ? text : `${text}\n`;
    return `${base}\n## ${label}\n\n${body.trim()}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+.+?\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return [...lines.slice(0, start + 1), "", body.trim(), "", ...lines.slice(end)].join("\n");
}

export function splicePlanSection(text: string, plan: string): string {
  return spliceSection(text, "plan", "Implementation Plan", plan);
}

export function spliceAnalysisSection(text: string, analysis: string): string {
  return spliceSection(text, "analysis", "Analysis", analysis);
}

export function spliceSubquestsSection(text: string, subquests: string): string {
  return spliceSection(text, "subquests", "Sub-Quests", subquests);
}

export function spliceAmendmentsSection(text: string, amendments: string[]): string {
  const body = amendments.length > 0
    ? amendments.map((a) => `- ${a}`).join("\n")
    : "<!-- No amendments recorded -->";
  return spliceSection(text, "amendments", "Amendments", body);
}

export function spliceAssumptionsSection(text: string, assumptions: string[]): string {
  const body = assumptions.length > 0
    ? assumptions.map((a) => `- ${a}`).join("\n")
    : "<!-- No assumptions recorded -->";
  return spliceSection(text, "assumptions", "Assumptions & Falsification Criteria", body);
}

export function hasAuthoredText(text: string): boolean {
  return text.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

export function normalizeDeliverableHeadings(body: string, noun: "plan" | "analysis"): string {
  const lines = body.split(/\r?\n/);
  const normalized: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      const headingText = match[1].trim().toLowerCase();
      if (RESERVED_SECTIONS.has(headingText)) {
        throw new Error(
          `the ${noun} text contains a reserved section heading (${JSON.stringify(line.trim())}): "## " lines end the ${noun} section in the quest doc. Use "###" for sub-headings inside the ${noun}; requirements and evidence belong in the doc's own ## Requirements and ## Evidence sections (edit the draft file directly).`,
        );
      }
      normalized.push(`### ${match[1].trim()}`);
    } else {
      normalized.push(line);
    }
  }

  const result = normalized.join("\n");
  if (!hasAuthoredText(result)) throw new Error(`the ${noun} text has no content beyond comments`);
  return result;
}

export function assertNoSectionHeadings(body: string, noun: "plan" | "analysis"): string {
  return normalizeDeliverableHeadings(body, noun);
}
