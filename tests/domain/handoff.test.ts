import { check, assertEquals } from "../check.ts";
import { askedRows, buildHandoff, docSections, operatorDirectives, PLAN_CAP, type HandoffInput } from "../../src/domain/handoff.ts";
import { createQuest, type QuestState } from "../../src/domain/quest.ts";
import { handoffPath, handoffStamp } from "../../src/domain/paths.ts";
import type { Qid } from "../../src/domain/qid.ts";

const MISSION = "Terrain needs REAL height. Continuous. Chunked. Client-only high definition.";
const DOC = [
  "# 1xAAAA",
  "",
  "## Original request",
  "",
  MISSION,
  "",
  "## Follow-up Requests",
  "",
  "- also fix the trees popping out",
  "- also fix the trees popping out",
  "",
  "## Requirements",
  "",
  "<!-- template comment -->",
  "- [x] R1: heightfield shared with server",
  "- [ ] R2: level-set shorelines",
  "- R3: relief shading on dry land",
  "",
  "## Implementation Plan",
  "",
  "1. Unify noise.",
  "",
].join("\n");

function quest(patch: Partial<QuestState> = {}): QuestState {
  return {
    ...createQuest(MISSION, "1xAAAA"),
    phase: "implementing",
    refinements: ["also fix the trees popping out", "Rocks are missing a tile"],
    exactNextAction: "Implement R2 shoreline level-set.",
    ...patch,
  };
}

function input(patch: Partial<HandoffInput> = {}): HandoffInput {
  return {
    state: quest(),
    docText: DOC,
    docPath: ".pi/quest/future/1xAAAA.md",
    diffStat: " src/a.c | 10 +++++-----\n 1 file changed",
    now: new Date("2026-11-06T14:30:05Z"),
    reason: "operator-request",
    ...patch,
  };
}

Deno.test("mission is verbatim and never truncated", () => {
  const long = "x".repeat(5000);
  const out = buildHandoff(input({ docText: null, state: quest({ objective: long }) }));
  check(out.includes(long), "full objective present");
  check(buildHandoff(input()).includes(MISSION), "doc original request used");
});

Deno.test("operator directives are deduplicated and exclude the mission", () => {
  const sections = docSections(DOC);
  const d = operatorDirectives(quest({ refinements: [MISSION, "also fix the trees popping out"] }), sections);
  assertEquals(d, ["also fix the trees popping out"]);
});

Deno.test("only recorded status counts as done; everything else is UNVERIFIED", () => {
  const rows = askedRows(quest({ rtm: [{ id: "R3", description: "relief shading on dry land", status: "verified" }] }), docSections(DOC));
  assertEquals(rows.map((r) => `${r.id}:${r.status}`), ["R1:SATISFIED", "R2:UNVERIFIED", "R3:VERIFIED"]);
  const out = buildHandoff(input({ state: quest({ rtm: [{ id: "R3", description: "relief", status: "verified" }] }) }));
  check(out.includes("**1 verified · 1 satisfied (claimed, not validated) · 1 unverified** of 3"), "count line");
  check(out.includes("| R2 | level-set shorelines | **UNVERIFIED** | none recorded |"), "unverified row");
  check(out.includes("Do not claim completion until R1, R2"), "resume rule lists non-verified ids");
});

Deno.test("verification, tree, blockers and notes render; absence is explicit", () => {
  const bare = buildHandoff(input({ diffStat: "" }));
  check(bare.includes("**no test receipt recorded**"), "missing receipt called out");
  check(bare.includes("## Agent notes (root causes, dead ends, gotchas)\n\n_none recorded_"), "notes absent explicit");
  const full = buildHandoff(input({
    notes: "Root cause: nd_global_land_dist uses room boxes.",
    state: quest({
      baseCommit: "abc1234",
      touchedFiles: ["src/a.c"],
      lastTestReceipt: { command: "make test", exitCode: 2, tailOutput: "FAIL shore" },
      lastReview: { verdict: "FAIL", target: "t", findings: "R2 not done" },
      setbacks: [{ reason: "shader unavailable", evidence: ["vm lacks gpu"] }],
      children: [{ qid: "1xBBBB" as Qid, brief: "trees", status: "running", findings: null, acknowledged: false }],
    }),
  }));
  for (const s of ["`make test` → exit 2", "FAIL shore", "**FAIL** on t", "R2 not done", "Base commit: `abc1234`", "  - src/a.c",
    "src/a.c | 10", "Setback: shader unavailable (evidence: vm lacks gpu)", "Running sub-quest 1xBBBB: trees", "Root cause: nd_global_land_dist"]) {
    check(full.includes(s), `contains ${s}`);
  }
});

Deno.test("plan is capped with a pointer to the doc; comments stripped", () => {
  const doc = `## Implementation Plan\n\n<!-- hidden -->\n${"p".repeat(PLAN_CAP + 100)}\n`;
  const out = buildHandoff(input({ docText: doc }));
  check(out.includes(`[truncated at ${PLAN_CAP} chars — full text in .pi/quest/future/1xAAAA.md]`), "pointer");
  check(!out.includes("hidden"), "comments stripped");
});

Deno.test("handoff is deterministic and paths are sortable", () => {
  assertEquals(buildHandoff(input()), buildHandoff(input()));
  assertEquals(handoffStamp(new Date("2026-11-06T14:30:05Z")), "20261106-143005");
  assertEquals(handoffPath("1xAAAA" as Qid, new Date("2026-11-06T14:30:05Z")), ".pi/quest/handoffs/1xAAAA-20261106-143005.md");
});
