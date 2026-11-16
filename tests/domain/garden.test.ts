import { check, assertEquals } from "../check.ts";
import { assessQuest, docFacts, renderGarden, selectForPrune, type GardenInput } from "../../src/domain/garden.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6);
const TEMPLATE = "# 1xEEEE\n\n## Original request\n\nsomething\n\n## Requirements\n\n<!-- - R1: example -->\n\n## Implementation Plan\n\n<!-- write here\nstill comment -->\n";
const FULL = "# Quest 1xFFFF: Seven renders from the field\n\n## Requirements\n\n- [x] R1: a\n- [ ] R2: b\n- R2: b\n\n## Implementation Plan\n\n1. do it\n\n## Status\n- Phase: implementing\n- Complete: false\n";
const CHILD = "# 1xCCCC\n\n## Parent Quest Link\n- Parent: 1xGONE (.pi/quest/future/1xGONE.md)\n\n## Requirements\n- R1: x\n";

function input(qid: string, docText: string, ageDays: number, patch: Partial<GardenInput> = {}): GardenInput {
  return { qid, docText, mtimeMs: NOW - ageDays * DAY, now: NOW, protectedQids: new Set(), liveQids: new Set([qid]), staleDays: 7, ...patch };
}

Deno.test("docFacts reads title, progress, plan and parent; ignores template comments", () => {
  const t = docFacts("1xEEEE", TEMPLATE);
  assertEquals([t.title, t.reqTotal, t.hasPlan], ["something", 0, false]);
  const f = docFacts("1xFFFF", FULL);
  assertEquals([f.title, f.reqTotal, f.reqDone, f.hasPlan], ["Seven renders from the field", 3, 1, true]);
  assertEquals(docFacts("1xCCCC", CHILD).parentQid, "1xGONE");
});

Deno.test("verdicts: active > orphan > empty-shell > stale > fresh", () => {
  assertEquals(assessQuest(input("1xFFFF", FULL, 30, { protectedQids: new Set(["1xFFFF"]) })).verdict, "active");
  assertEquals(assessQuest(input("1xCCCC", CHILD, 0)).verdict, "orphan");
  assertEquals(assessQuest(input("1xCCCC", CHILD, 0, { liveQids: new Set(["1xCCCC", "1xGONE"]) })).verdict, "fresh");
  assertEquals(assessQuest(input("1xEEEE", TEMPLATE, 2)).verdict, "empty-shell");
  assertEquals(assessQuest(input("1xEEEE", TEMPLATE, 0)).verdict, "fresh", "brand-new draft is not a shell yet");
  assertEquals(assessQuest(input("1xFFFF", FULL, 8)).verdict, "stale");
  assertEquals(assessQuest(input("1xFFFF", FULL, 8, { staleDays: 30 })).verdict, "fresh");
  const row = assessQuest(input("1xFFFF", FULL, 1));
  assertEquals([row.phase, row.duplicates], ["implementing", 1]);
});

Deno.test("selectForPrune never selects the active quest, even by explicit qid", () => {
  const rows = [
    assessQuest(input("1xFFFF", FULL, 30, { protectedQids: new Set(["1xFFFF"]) })),
    assessQuest(input("1xEEEE", TEMPLATE, 30)),
    assessQuest(input("1xCCCC", CHILD, 0)),
  ];
  const none = { stale: false, empty: false, orphans: false, qids: [] as string[] };
  assertEquals(selectForPrune(rows, { ...none, qids: ["1xFFFF"] }).length, 0);
  assertEquals(selectForPrune(rows, { ...none, empty: true }).map((r) => r.qid), ["1xEEEE"]);
  assertEquals(selectForPrune(rows, { ...none, orphans: true, qids: ["1xEEEE"] }).map((r) => r.qid), ["1xEEEE", "1xCCCC"]);
  const lines = renderGarden(rows, 7);
  check(lines[1].includes("1 active") && lines[1].includes("1 orphan") && lines[1].includes("1 empty-shell"), lines[1]);
  check(lines.some((l) => l.includes("/quest del")), "suggests next commands");
});
