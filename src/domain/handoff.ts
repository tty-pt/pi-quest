// HIGH_LEVEL: #surviving — a handoff is the quest, rendered for a stranger.
// When context is about to be lost (compaction, a new agent, the operator
// asking "give me a handoff"), the next agent must get EVERYTHING the operator
// asked for, verbatim, next to an honest account of what is actually done.
// Pure: state + quest-doc text + diff stat in, markdown out. Nothing here
// trusts the agent's prose — "done" only comes from recorded status
// (RTM verified/satisfied, a checked doc box); everything else is UNVERIFIED.
import type { QuestState } from "./quest";
import { bulletParts, uniqueDirectives } from "./dedupe";
import { sectionKeyOf } from "./sections";

export type HandoffReason = "operator-request" | "compaction" | "manual" | "agent";

export interface HandoffInput {
  state: QuestState;
  docText: string | null;
  docPath: string;
  diffStat: string;
  now: Date;
  reason: HandoffReason;
  notes?: string;
}

export type RowStatus = "VERIFIED" | "SATISFIED" | "UNVERIFIED";

export interface AskedRow {
  id: string;
  requirement: string;
  status: RowStatus;
  evidence: string;
}

export const PLAN_CAP = 8000;
const TAIL_CAP = 1500;

/** Body of every `## <title>` section, keyed by lowercased title. */
export function docSections(docText: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (docText === null) return out;
  let title: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (title !== null) out.set(title, stripComments(body.join("\n")).trim());
  };
  for (const line of docText.split("\n")) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h === null) {
      body.push(line);
      continue;
    }
    flush();
    title = h[1].trim().toLowerCase();
    body = [];
  }
  flush();
  return out;
}

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function sectionBy(sections: Map<string, string>, key: ReturnType<typeof sectionKeyOf>): string {
  for (const [title, body] of sections) if (sectionKeyOf(title) === key) return body;
  return "";
}

function bullets(body: string): string[] {
  return body.split("\n")
    .map((l) => l.match(/^\s*[-*+]\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].trim());
}

const REQ = /^\*{0,2}\[?(R\d+)\]?\*{0,2}\s*[:\-]\s*(.*)$/i;

/** Requirement rows: RTM is authoritative; doc bullets fill gaps and add checkboxes. */
export function askedRows(state: QuestState, sections: Map<string, string>): AskedRow[] {
  const rows = new Map<string, AskedRow>();
  for (const item of state.rtm ?? []) {
    const status: RowStatus = item.status === "verified" ? "VERIFIED" : item.status === "satisfied" ? "SATISFIED" : "UNVERIFIED";
    const evidence = status === "UNVERIFIED" ? "none recorded" : `RTM status: ${item.status}${item.owner ? ` (${item.owner})` : ""}`;
    rows.set(item.id.toUpperCase(), { id: item.id.toUpperCase(), requirement: item.description, status, evidence });
  }
  const docReqs = bullets(sectionBy(sections, "requirements"));
  docReqs.forEach((text, i) => {
    const { checked, body } = bulletParts(text);
    const m = body.match(REQ);
    const id = m ? m[1].toUpperCase() : `R${i + 1}`;
    const requirement = m ? m[2].trim() : body;
    const existing = rows.get(id);
    if (existing === undefined) {
      rows.set(id, checked
        ? { id, requirement, status: "SATISFIED", evidence: "checked in quest doc" }
        : { id, requirement, status: "UNVERIFIED", evidence: "none recorded" });
    } else if (checked && existing.status === "UNVERIFIED") {
      rows.set(id, { ...existing, status: "SATISFIED", evidence: "checked in quest doc" });
    }
  });
  return [...rows.values()].sort((a, b) => idNum(a.id) - idNum(b.id));
}

function idNum(id: string): number {
  const n = Number(id.replace(/\D+/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function cell(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** Every directive the operator gave, verbatim and deduplicated (original request excluded). */
export function operatorDirectives(state: QuestState, sections: Map<string, string>): string[] {
  const followUps = bullets(sectionBy(sections, "followups"));
  const amendments = state.amendments.map((a) => a.change);
  const answers = state.humanAnswers.map((h) => `Q: ${h.question.trim()} → A: ${h.answer.trim()}${h.late ? " (late)" : ""}`);
  const all = uniqueDirectives([...state.refinements, ...followUps, ...amendments, ...answers]);
  const mission = (sections.get("original request") ?? state.objective).trim().toLowerCase();
  return all.filter((d) => d.trim().toLowerCase() !== mission);
}

function block(title: string, body: string): string {
  return `## ${title}\n\n${body.trim() === "" ? "_none recorded_" : body.trim()}\n`;
}

function fenced(text: string): string {
  return "```\n" + text.replace(/```/g, "ʼʼʼ") + "\n```";
}

function tail(text: string, cap: number): string {
  return text.length <= cap ? text : `…${text.slice(text.length - cap)}`;
}

function verificationBody(state: QuestState): string {
  const out: string[] = [];
  const r = state.lastTestReceipt;
  if (r) {
    const when = r.executedAt ? ` at ${new Date(r.executedAt).toISOString()}` : "";
    out.push(`- Last test: \`${r.command}\` → exit ${r.exitCode}${when}`);
    if (r.tailOutput.trim() !== "") out.push(fenced(tail(r.tailOutput.trim(), TAIL_CAP)));
  } else {
    out.push("- Last test: **no test receipt recorded** — nothing has been verified by a test run.");
  }
  const lr = state.lastReview;
  if (lr) {
    out.push(`- Last review: **${lr.verdict}** on ${lr.target}`);
    if (lr.verdict === "FAIL" && lr.findings.trim() !== "") out.push(fenced(tail(lr.findings.trim(), TAIL_CAP)));
  }
  return out.join("\n");
}

function blockersBody(state: QuestState): string {
  const out: string[] = [];
  for (const s of state.setbacks) {
    out.push(`- Setback: ${s.reason}${s.evidence.length ? ` (evidence: ${s.evidence.join("; ")})` : ""}`);
  }
  if (state.lastReview?.verdict === "FAIL") out.push("- Outstanding review FAIL (findings above) must be addressed.");
  for (const c of state.children.filter((c) => c.status === "running")) out.push(`- Running sub-quest ${c.qid}: ${c.brief}`);
  for (const c of state.children.filter((c) => c.status === "failed")) out.push(`- Failed sub-quest ${c.qid}: ${c.findings ?? c.brief}`);
  return out.join("\n");
}

function treeBody(state: QuestState, diffStat: string): string {
  const files = state.touchedFiles ?? [];
  const out: string[] = [];
  if (state.baseCommit) out.push(`- Base commit: \`${state.baseCommit}\``);
  out.push(files.length ? `- Files touched (${files.length}):\n${files.map((f) => `  - ${f}`).join("\n")}` : "- Files touched: none recorded");
  if (diffStat.trim() !== "") out.push(`- Diff stat vs base:\n${fenced(diffStat.trim())}`);
  return out.join("\n");
}

function tableBody(rows: AskedRow[]): string {
  if (rows.length === 0) return "_No requirements recorded — derive them from the mission and directives above before working._";
  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const head = `**${count("VERIFIED")} verified · ${count("SATISFIED")} satisfied (claimed, not validated) · ${count("UNVERIFIED")} unverified** of ${rows.length}`;
  const lines = rows.map((r) => `| ${r.id} | ${cell(r.requirement)} | ${r.status === "UNVERIFIED" ? "**UNVERIFIED**" : r.status} | ${cell(r.evidence)} |`);
  return [head, "", "| ID | Requirement | Status | Evidence |", "|---|---|---|---|", ...lines].join("\n");
}

function planBody(sections: Map<string, string>, state: QuestState, docPath: string): string {
  const plan = state.kind === "analysis" ? sectionBy(sections, "analysis") : sectionBy(sections, "plan") || sectionBy(sections, "analysis");
  if (plan.length <= PLAN_CAP) return plan;
  return `${plan.slice(0, PLAN_CAP)}\n\n… [truncated at ${PLAN_CAP} chars — full text in ${docPath}]`;
}

/** Render the full handoff document. Deterministic for a given input. */
export function buildHandoff(input: HandoffInput): string {
  const { state, docPath, now, reason } = input;
  const sections = docSections(input.docText);
  const qid = state.qid ?? "none";
  const mission = sections.get("original request") || state.objective || state.pendingRootRequest || "";
  const rows = askedRows(state, sections);
  const directives = operatorDirectives(state, sections);
  const unverified = rows.filter((r) => r.status !== "VERIFIED").map((r) => r.id);
  return [
    `# Handoff — quest ${qid}${state.name ? ` (${state.name})` : ""}`,
    "",
    `> Generated ${now.toISOString()} · reason: ${reason} · phase: ${state.phase} · kind: ${state.kind} · difficulty: ${state.difficulty}`,
    `> Quest doc: \`${docPath}\`${state.parentQid ? ` · parent quest: ${state.parentQid}` : ""}`,
    "",
    block("Mission (verbatim operator request)", mission),
    block("Everything else the operator asked for (verbatim, deduplicated)", directives.map((d, i) => `${i + 1}. ${d}`).join("\n")),
    block("Asked vs. accomplished", tableBody(rows)),
    block(state.kind === "analysis" ? "Approved analysis" : "Approved plan", planBody(sections, state, docPath)),
    block("Work in the tree", treeBody(state, input.diffStat)),
    block("Last verification", verificationBody(state)),
    block("Blockers & open threads", blockersBody(state)),
    block("Exact next action", state.exactNextAction),
    block("How to resume", [
      `1. Run \`/quest ${qid}\` (or read \`${docPath}\`) to re-mount the quest.`,
      "2. Re-read the Mission and every operator directive above — they are the contract, not the plan.",
      unverified.length
        ? `3. Do not claim completion until ${unverified.join(", ")} each have concrete evidence (test output, file:line).`
        : "3. All requirements are verified; confirm with the operator before archiving.",
    ].join("\n")),
    block("Agent notes (root causes, dead ends, gotchas)", input.notes ?? ""),
  ].join("\n");
}
