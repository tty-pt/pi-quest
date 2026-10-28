// HIGH_LEVEL: #drafting — one canonical registry of the `## ` section headings
// the quest document uses. Headings are recognized by exact (normalized) title,
// never by "contains word", so a heading like "## Evidence requirements" can no
// longer be mistaken for Requirements, and the title list lives in one place.
export type SectionKey =
  | "requirements"
  | "evidence"
  | "analysis"
  | "subquests"
  | "plan"
  | "amendments"
  | "predraft"
  | "status"
  | "followups";

export const SECTION_TITLES: Record<SectionKey, readonly string[]> = {
  requirements: ["requirements"],
  evidence: ["evidence"],
  analysis: ["analysis"],
  subquests: ["sub-quests", "subquests", "sub-quest"],
  plan: ["implementation plan"],
  amendments: ["amendments"],
  predraft: ["findings (pre-draft investigation)"],
  status: ["status"],
  followups: ["follow-up requests"],
};

function norm(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Section key for the text after `## `, or null for an unknown heading. A title
 * matches when the heading IS the title or starts with it followed by a
 * non-word character ("Implementation Plan — redesign", "Evidence (files)").
 * It never matches a title buried mid-heading ("Evidence requirements" is
 * Evidence, not Requirements).
 */
export function sectionKeyOf(headingText: string): SectionKey | null {
  const full = norm(headingText);
  for (const key of Object.keys(SECTION_TITLES) as SectionKey[]) {
    for (const alias of SECTION_TITLES[key]) {
      if (full === alias) return key;
      if (full.startsWith(alias) && !/[a-z0-9]/.test(full.charAt(alias.length))) return key;
    }
  }
  return null;
}

/** True when `line` is the `## ` heading of section `key`. */
export function isHeading(line: string, key: SectionKey): boolean {
  const m = line.match(/^##\s+(.+?)\s*$/);
  return m !== null && sectionKeyOf(m[1]) === key;
}

/** Canonical display title for a section. */
export function sectionTitle(key: SectionKey): string {
  const t = key === "plan" ? "Implementation Plan" : key === "subquests" ? "Sub-Quests" : key === "followups" ? "Follow-up Requests" : key.charAt(0).toUpperCase() + key.slice(1);
  return t;
}
