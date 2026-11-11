// HIGH_LEVEL: #storage — the future/ directory is a garden: quests that
// were started and never finished pile up. Triage is pure: doc text + file
// age in, a verdict per quest out. Pruning (archiving as ABANDONED) is the
// adapter's job and never touches the active quest.
import { countDuplicateBullets } from "./dedupe";
import { parseDocStatus } from "./quest-doc";
import { sectionKeyOf } from "./sections";

export type GardenVerdict = "active" | "orphan" | "empty-shell" | "stale" | "fresh";

export interface GardenInput {
  qid: string;
  docText: string;
  mtimeMs: number;
  now: number;
  /** The active quest and its ancestors on the quest stack: never pruned. */
  protectedQids: ReadonlySet<string>;
  /** qids that still have a live doc in future/ (to detect orphans). */
  liveQids: ReadonlySet<string>;
  staleDays: number;
}

export interface GardenRow {
  qid: string;
  title: string;
  ageDays: number;
  phase: string;
  reqTotal: number;
  reqDone: number;
  hasPlan: boolean;
  duplicates: number;
  parentQid: string | null;
  verdict: GardenVerdict;
}

export const DEFAULT_STALE_DAYS = 7;
const DAY_MS = 86_400_000;
const TITLE_MAX = 60;

interface DocFacts {
  title: string;
  reqTotal: number;
  reqDone: number;
  hasPlan: boolean;
  parentQid: string | null;
}

function authored(body: string[]): boolean {
  return body.join("\n").replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_MAX ? `${flat.slice(0, TITLE_MAX - 1)}…` : flat;
}

/** Title, requirement progress, plan presence and parent link from a quest doc. */
export function docFacts(qid: string, docText: string): DocFacts {
  let heading = "";
  let original = "";
  let section: string | null = null;
  const plan: string[] = [];
  let reqTotal = 0;
  let reqDone = 0;
  let parentQid: string | null = null;
  let inComment = false;
  for (const line of docText.split("\n")) {
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.trim().startsWith("<!--")) {
      inComment = !line.includes("-->");
      continue;
    }
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2 !== null) {
      section = sectionKeyOf(h2[1]) ?? h2[1].trim().toLowerCase();
      continue;
    }
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1 !== null && heading === "") heading = h1[1].replace(/^Quest\s+\S+:\s*/i, "").trim();
    if (section === "original request" && original === "" && line.trim() !== "") original = line.trim();
    if (section === "plan" || section === "analysis") plan.push(line);
    const parent = line.match(/^-\s*Parent:\s*(\S+)/);
    if (parent !== null && section === "parent quest link") parentQid = parent[1];
    if (section === "requirements" && /^\s*[-*+]\s+\S/.test(line)) {
      reqTotal += 1;
      if (/^\s*[-*+]\s+\[[xX]\]/.test(line)) reqDone += 1;
    }
  }
  const title = heading !== "" && heading !== qid ? heading : original;
  return { title: oneLine(title || "(untitled)"), reqTotal, reqDone, hasPlan: authored(plan), parentQid };
}

function verdictFor(input: GardenInput, facts: DocFacts, ageDays: number): GardenVerdict {
  if (input.protectedQids.has(input.qid)) return "active";
  if (facts.parentQid !== null && !input.liveQids.has(facts.parentQid)) return "orphan";
  if (facts.reqTotal === 0 && !facts.hasPlan && ageDays >= 1) return "empty-shell";
  if (ageDays >= input.staleDays) return "stale";
  return "fresh";
}

export function assessQuest(input: GardenInput): GardenRow {
  const facts = docFacts(input.qid, input.docText);
  const ageDays = Math.max(0, Math.floor((input.now - input.mtimeMs) / DAY_MS));
  return {
    qid: input.qid,
    title: facts.title,
    ageDays,
    phase: parseDocStatus(input.docText).phase ?? "drafting",
    reqTotal: facts.reqTotal,
    reqDone: facts.reqDone,
    hasPlan: facts.hasPlan,
    duplicates: countDuplicateBullets(input.docText),
    parentQid: facts.parentQid,
    verdict: verdictFor(input, facts, ageDays),
  };
}

export interface PruneFilter {
  stale: boolean;
  empty: boolean;
  orphans: boolean;
  all?: boolean;
  qids: readonly string[];
}

/** Rows a prune would archive. The active quest is never selected. */
export function selectForPrune(rows: readonly GardenRow[], filter: PruneFilter): GardenRow[] {
  return rows.filter((r) => {
    if (r.verdict === "active") return false;
    if (filter.all) return true;
    if (filter.qids.includes(r.qid)) return true;
    return (filter.stale && r.verdict === "stale") ||
      (filter.empty && r.verdict === "empty-shell") ||
      (filter.orphans && r.verdict === "orphan");
  });
}

const ORDER: Record<GardenVerdict, number> = { active: 0, fresh: 1, stale: 2, orphan: 3, "empty-shell": 4 };

export function renderGarden(rows: readonly GardenRow[], staleDays: number): string[] {
  if (rows.length === 0) return ["Quests: .pi/quest/future is empty."];
  const sorted = [...rows].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || a.ageDays - b.ageDays);
  const count = (v: GardenVerdict) => rows.filter((r) => r.verdict === v).length;
  const dupes = rows.filter((r) => r.duplicates > 0);
  const lines = [
    `Quests — ${rows.length} in .pi/quest/future (stale ≥ ${staleDays}d)`,
    `  ${count("active")} active · ${count("fresh")} fresh · ${count("stale")} stale · ${count("orphan")} orphan · ${count("empty-shell")} empty-shell${dupes.length > 0 ? ` · ${dupes.length} with duplicate bullets` : ""}`,
    "",
    ...sorted.map((r) => {
      const reqs = r.reqTotal ? `${r.reqDone}/${r.reqTotal} req` : "no req";
      const extra = [r.hasPlan ? "plan" : "no plan", r.duplicates ? `${r.duplicates} dup` : "", r.parentQid ? `↑${r.parentQid}` : ""]
        .filter((s) => s !== "").join(", ");
      const activeMark = r.verdict === "active" ? "  ◀ active" : "";
      return `  ${r.verdict.padEnd(11)} ${r.qid} ${String(r.ageDays).padStart(3)}d ${r.phase.padEnd(12)} ${reqs.padEnd(9)} ${r.title}  (${extra})${activeMark}`;
    }),
    "",
    "Next: /quest del --all · /quest del --empty --orphans · /quest del --stale [--days N] · /quest del <qid>… · /quest handoff <qid>",
  ];
  return lines;
}
