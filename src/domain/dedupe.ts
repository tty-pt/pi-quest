// HIGH_LEVEL: #working together — operator directives are recorded once.
// Repeating a message (re-sent prompt, double input event, resumed session)
// must never mint a second amendment or a second R#. Identity is exact text
// after whitespace/case normalization — never a fuzzy or semantic match, so
// two genuinely different directives are always both kept.
import { sectionKeyOf, type SectionKey } from "./sections";

/** Canonical identity of a directive: trimmed, whitespace-collapsed, lowercased. */
export function normalizeDirective(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** True when `list` already holds `text` (normalized comparison). */
export function hasDirective(list: readonly string[], text: string): boolean {
  const key = normalizeDirective(text);
  if (key === "") return false;
  return list.some((item) => normalizeDirective(item) === key);
}

/** Order-preserving unique list (first occurrence wins). */
export function uniqueDirectives(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = normalizeDirective(item);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/;
const REQ_ID = /^\*{0,2}\[?R\d+\]?\*{0,2}\s*[:\-]\s*(.*)$/i;
const DIRECTIVE_TAG = "[user directive]";

export interface BulletParts {
  checked: boolean | null;
  body: string;
}

/** Split a bullet's text into its checkbox state and its body. */
export function bulletParts(text: string): BulletParts {
  const box = text.match(CHECKBOX);
  return box === null
    ? { checked: null, body: text }
    : { checked: box[1].toLowerCase() === "x", body: box[2] };
}

/**
 * Identity of a requirement bullet: the text after the checkbox, the `R<n>:`
 * id and the optional `[User Directive]` tag. `R7: foo` and `R9: [User
 * Directive] foo` are the same requirement.
 */
export function requirementIdentity(bulletText: string): string {
  let body = bulletParts(bulletText).body.trim();
  const id = body.match(REQ_ID);
  if (id !== null) body = id[1];
  let key = normalizeDirective(body);
  if (key.startsWith(DIRECTIVE_TAG)) key = key.slice(DIRECTIVE_TAG.length).trim();
  return key;
}

function identityFor(section: SectionKey, bulletText: string): string {
  if (section === "requirements") return requirementIdentity(bulletText);
  return normalizeDirective(bulletParts(bulletText).body);
}

const DEDUPED: ReadonlySet<SectionKey> = new Set<SectionKey>(["requirements", "amendments", "followups"]);

export interface DedupeResult {
  text: string;
  removed: number;
}

/**
 * Remove duplicate bullets inside ## Requirements, ## Amendments and
 * ## Follow-up Requests (first occurrence wins; a checked duplicate upgrades
 * the kept bullet to checked). Everything else in the doc is untouched.
 */
export function dedupeDocBullets(docText: string): DedupeResult {
  const lines = docText.split("\n");
  const out: string[] = [];
  let section: SectionKey | null = null;
  let seen = new Map<string, number>();
  let removed = 0;
  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading !== null) {
      section = sectionKeyOf(heading[1]);
      seen = new Map();
      out.push(line);
      continue;
    }
    const bullet = line.match(BULLET);
    if (section === null || !DEDUPED.has(section) || bullet === null) {
      out.push(line);
      continue;
    }
    const key = identityFor(section, bullet[1]);
    const keptAt = seen.get(key);
    if (key === "" || keptAt === undefined) {
      if (key !== "") seen.set(key, out.length);
      out.push(line);
      continue;
    }
    removed += 1;
    if (bulletParts(bullet[1]).checked === true) out[keptAt] = out[keptAt].replace("[ ]", "[x]");
  }
  return { text: out.join("\n"), removed };
}

/** Count of bullets `dedupeDocBullets` would remove. */
export function countDuplicateBullets(docText: string): number {
  return dedupeDocBullets(docText).removed;
}
