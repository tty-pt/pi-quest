import { check } from "../check.ts";
import { parseDocStatus, upsertDocStatus, reconcileDocContent } from "../../src/domain/quest-doc.ts";
import { draftPath, stageDir, archivePath, isQuestPath, QUEST_ROOT, FUTURE_DIR, ARCHIVE_DIR, STAGING_DIR } from "../../src/domain/paths.ts";
import { addChild, settleChild, acknowledgeChild, unfinishedChildren } from "../../src/domain/children.ts";
import { createQuest, IDLE_STATE, type QuestState } from "../../src/domain/quest.ts";
import { type Qid } from "../../src/domain/qid.ts";
import type { HandbackReceipt } from "../../src/domain/contract.ts";

Deno.test("quest_doc: parseDocStatus parses phase and completion accurately", () => {
  // Empty text
  const empty = parseDocStatus("");
  check(empty.phase === null, "empty text yields null phase");
  check(empty.complete === false, "empty text yields false complete");

  // Missing status header
  const noStatus = parseDocStatus("# My Quest\n## Original request\nSome request\n");
  check(noStatus.phase === null, "missing status header yields null phase");
  check(noStatus.complete === false, "missing status header yields false complete");

  // Valid status block
  const valid = parseDocStatus(`
# My Quest
## Status
- Phase: implementing
- Complete: false
## Next section
`);
  check(valid.phase === "implementing", "parsed phase accurately");
  check(valid.complete === false, "parsed complete as false");

  // Complete status
  const completed = parseDocStatus(`
## Status
- Phase: validating
- Complete: true
`);
  check(completed.phase === "validating", "parsed validating phase");
  check(completed.complete === true, "parsed complete as true");
});

Deno.test("quest_doc: upsertDocStatus inserts and replaces status section idempotently", () => {
  const initialDoc = `# Quest A

## Original request
Build feature

## Implementation Plan
Steps here.
`;

  // Insert status
  const withStatus = upsertDocStatus(initialDoc, "drafting", false);
  check(withStatus.includes("## Status"), "status header added");
  check(withStatus.includes("- Phase: drafting"), "phase line added");
  check(withStatus.includes("- Complete: false"), "complete line added");

  // Update status
  const updatedStatus = upsertDocStatus(withStatus, "implementing", false);
  check(updatedStatus.includes("- Phase: implementing"), "phase updated");
  check(!updatedStatus.includes("- Phase: drafting"), "old phase removed");

  // Transition to complete
  const finished = upsertDocStatus(updatedStatus, "validating", true);
  check(finished.includes("- Phase: validating"), "phase updated to validating");
  check(finished.includes("- Complete: true"), "complete updated to true");

  // Idempotency: re-applying exact same values produces identical output
  const same = upsertDocStatus(finished, "validating", true);
  check(same === finished, "upsertDocStatus is strictly idempotent");
});

Deno.test("quest_doc: reconcileDocContent checks off requirements and records handback findings", () => {
  const doc = `# Parent Quest

## Requirements
- [ ] R1: Parse audio format
- [ ] R2: Initialize audio buffer
- [ ] R3: Play audio stream

## Evidence
- audio.c:10
`;

  const receipt: HandbackReceipt = {
    childQid: "sub123" as Qid,
    status: "COMPLETED",
    assignedRequirements: ["R1", "R2"],
    filesModified: ["audio.c"],
    diffSummary: "added audio buffer",
    testCommand: "deno test",
    testPassed: true,
    findings: "Both R1 and R2 verified with tests",
  };

  const reconciled = reconcileDocContent(doc, receipt);
  check(reconciled.includes("- [x] R1: Parse audio format"), "R1 checked off");
  check(reconciled.includes("- [x] R2: Initialize audio buffer"), "R2 checked off");
  check(reconciled.includes("- [ ] R3: Play audio stream"), "R3 remains unchecked");
  check(reconciled.includes("sub123"), "receipt childQid recorded");
  check(reconciled.includes("Both R1 and R2 verified with tests"), "receipt findings recorded");
});

Deno.test("paths: draftPath, stageDir, archivePath, and isQuestPath follow directory structure", () => {
  const qid = "abc123" as Qid;

  check(draftPath(qid) === `${FUTURE_DIR}/abc123.md`, "draftPath matches future dir");
  check(stageDir(qid) === `${STAGING_DIR}/abc123`, "stageDir matches staging dir");
  check(archivePath(qid) === `${ARCHIVE_DIR}/abc123.zip`, "archivePath matches archive dir");

  check(isQuestPath(".pi/quest"), "root is quest path");
  check(isQuestPath(".pi/quest/future/abc.md"), "future path is quest path");
  check(isQuestPath(".pi/quest/archive/abc.zip"), "archive path is quest path");
  check(!isQuestPath(".pi/settings.json"), "settings.json is not quest path");
  check(!isQuestPath("src/main.ts"), "source file is not quest path");
});

Deno.test("children: addChild, settleChild, acknowledgeChild, and unfinishedChildren manage child lifecycle", () => {
  const parent = createQuest("Parent quest", "par001" as Qid);

  // 1. Add child
  const link1 = { qid: "chld01" as Qid, brief: "Task 1", status: "running" as const, findings: null, acknowledged: false };
  const withChild1 = addChild(parent, link1);
  check(withChild1.children.length === 1, "child 1 added");
  check(withChild1.children[0].status === "running", "child starts in running status");
  check(withChild1.children[0].acknowledged === false, "child starts unacknowledged");

  // 2. Add second child
  const link2 = { qid: "chld02" as Qid, brief: "Task 2", status: "running" as const, findings: null, acknowledged: false };
  const withTwoChildren = addChild(withChild1, link2);
  check(withTwoChildren.children.length === 2, "child 2 added");

  // 3. unfinishedChildren detects both running
  const unfinished = unfinishedChildren(withTwoChildren);
  check(unfinished.length === 2, "both children are unfinished");

  // 4. Settle child 1
  const settled1 = settleChild(withTwoChildren, "chld01" as Qid, "returned", "Task 1 done");
  check(settled1.children[0].status === "returned", "child 1 settled as returned");
  check(settled1.children[0].findings === "Task 1 done", "child 1 findings recorded");

  // Unfinished now returns only child 2
  const stillUnfinished = unfinishedChildren(settled1);
  check(stillUnfinished.length === 1, "only 1 unfinished child remaining");
  check(stillUnfinished[0].qid === "chld02", "chld02 is unfinished");

  // 5. Acknowledge child 1
  const acked1 = acknowledgeChild(settled1, "chld01" as Qid);
  check(acked1.children[0].acknowledged === true, "child 1 acknowledged");

  // 6. Acknowledge unknown child throws
  let threw = false;
  try {
    acknowledgeChild(acked1, "unknown" as Qid);
  } catch {
    threw = true;
  }
  check(threw, "acknowledging unknown child throws error");
});
