import { check } from "../check.ts";
import { createQuest } from "../../src/domain/quest.ts";
import type { Qid } from "../../src/domain/qid.ts";
import {
  pushStackFrame,
  popStackFrame,
} from "../../src/domain/stack.ts";
import type { SubQuestContract, HandbackReceipt, RtmItem } from "../../src/domain/contract.ts";
import { encodeSnapshot, decodeSnapshot } from "../../src/durability/snapshots.ts";
import { reconcileDocContent } from "../../src/domain/quest-doc.ts";

const ROOT_QID = "root01" as Qid;
const CHILD1_QID = "child1" as Qid;
const SUB1_QID = "sub001" as Qid;
const SUB2_QID = "sub002" as Qid;
const PREV_QID = "prev01" as Qid;

Deno.test("stack push saves parent state into stack frame and initializes child", () => {
  const root = createQuest("Master objective", ROOT_QID);
  const rtm: RtmItem[] = [
    { id: "R1", description: "Parser safety", status: "pending" },
    { id: "R2", description: "WASM UX display", status: "pending" },
  ];
  root.rtm = rtm;
  root.phase = "implementing";

  const contract: SubQuestContract = {
    qid: CHILD1_QID,
    parentQid: ROOT_QID,
    title: "Implement parser safety",
    assignedRequirements: ["R1"],
    allowedPaths: ["mods/song/parser.c", "mods/song/parser.h"],
    requiredTestCommands: ["make test"],
    acceptanceCriteria: ["Nested brackets parsed safely"],
  };

  const childState = pushStackFrame(root, contract, CHILD1_QID);
  check(childState.qid === CHILD1_QID, "child qid set");
  check(childState.parentQid === ROOT_QID, "parent qid linked");
  check(childState.phase === "implementing", "child enters implementing directly");
  check(childState.depth === 1, "depth bumped");
  check(childState.contract !== undefined, "contract attached");
  check(childState.contract?.allowedPaths[0] === "mods/song/parser.c", "allowed paths inherited");
  check(childState.questStack.length === 1, "parent frame in questStack");
  check(childState.questStack[0].qid === ROOT_QID, "parent frame qid matches");
});

Deno.test("stack pop restores parent, settles child, checks off RTM, and records receipt", () => {
  const root = createQuest("Master objective", ROOT_QID);
  root.rtm = [
    { id: "R1", description: "Parser safety", status: "pending" },
    { id: "R2", description: "WASM UX display", status: "pending" },
  ];
  root.phase = "implementing";

  const contract: SubQuestContract = {
    qid: CHILD1_QID,
    parentQid: ROOT_QID,
    title: "Implement parser safety",
    assignedRequirements: ["R1"],
    allowedPaths: ["mods/song/parser.c"],
    requiredTestCommands: ["make test"],
    acceptanceCriteria: ["Safe parsing"],
  };

  const childState = pushStackFrame(root, contract, CHILD1_QID);
  check(childState.questStack.length === 1, "stack has 1 frame");

  const receipt: HandbackReceipt = {
    childQid: CHILD1_QID,
    status: "COMPLETED",
    assignedRequirements: ["R1"],
    filesModified: ["mods/song/parser.c"],
    diffSummary: "1 file changed, 10 insertions(+)",
    testCommand: "make test",
    testPassed: true,
    findings: "Safe parser verified.",
  };

  const restoredParent = popStackFrame(childState, receipt);
  check(restoredParent.qid === ROOT_QID, "restored to root qid");
  check(restoredParent.phase === "implementing", "restored phase");
  check(restoredParent.questStack.length === 0, "stack popped empty");
  
  // RTM check
  const r1 = restoredParent.rtm?.find((r) => r.id === "R1");
  const r2 = restoredParent.rtm?.find((r) => r.id === "R2");
  check(r1?.status === "satisfied", "assigned requirement R1 satisfied");
  check(r2?.status === "pending", "unassigned requirement R2 still pending");

  // Child settled
  const childLink = restoredParent.children.find((c) => c.qid === CHILD1_QID);
  check(childLink?.status === "returned", "child link marked returned");
  check(Boolean(childLink?.findings?.includes("Safe parser verified")), "findings attached");

  // Handback receipts in parent
  check((restoredParent.handbackReceipts ?? []).length === 1, "handback receipt recorded");
});

Deno.test("stack supports 3-level nesting", () => {
  const root = createQuest("Root", ROOT_QID);
  root.phase = "implementing";

  const contract1: SubQuestContract = {
    qid: SUB1_QID,
    parentQid: ROOT_QID,
    title: "Sub 1",
    assignedRequirements: ["R1"],
    allowedPaths: ["a.c"],
    requiredTestCommands: ["test1"],
    acceptanceCriteria: ["ok"],
  };

  const sub1 = pushStackFrame(root, contract1, SUB1_QID);
  check(sub1.depth === 1, "sub1 depth 1");
  check(sub1.questStack.length === 1, "sub1 stack length 1");

  const contract2: SubQuestContract = {
    qid: SUB2_QID,
    parentQid: SUB1_QID,
    title: "Sub 2",
    assignedRequirements: ["R1.1"],
    allowedPaths: ["b.c"],
    requiredTestCommands: ["test2"],
    acceptanceCriteria: ["ok2"],
  };

  const sub2 = pushStackFrame(sub1, contract2, SUB2_QID);
  check(sub2.depth === 2, "sub2 depth 2");
  check(sub2.questStack.length === 2, "sub2 stack length 2");

  // Pop sub2 -> sub1
  const receipt2: HandbackReceipt = {
    childQid: SUB2_QID,
    status: "COMPLETED",
    assignedRequirements: ["R1.1"],
    filesModified: ["b.c"],
    diffSummary: "b.c modified",
    testCommand: "test2",
    testPassed: true,
    findings: "Sub 2 done",
  };
  const restoredSub1 = popStackFrame(sub2, receipt2);
  check(restoredSub1.qid === SUB1_QID, "back to sub1");
  check(restoredSub1.questStack.length === 1, "stack length 1");

  // Pop sub1 -> root
  const receipt1: HandbackReceipt = {
    childQid: SUB1_QID,
    status: "COMPLETED",
    assignedRequirements: ["R1"],
    filesModified: ["a.c", "b.c"],
    diffSummary: "a.c and b.c modified",
    testCommand: "test1",
    testPassed: true,
    findings: "Sub 1 done",
  };
  const restoredRoot = popStackFrame(restoredSub1, receipt1);
  check(restoredRoot.qid === ROOT_QID, "back to root");
  check(restoredRoot.questStack.length === 0, "root stack empty");
});

Deno.test("snapshot codec encodes and decodes questStack, contract, rtm, and receipts", () => {
  const root = createQuest("Root with stack", ROOT_QID);
  root.phase = "implementing";
  root.rtm = [{ id: "R1", description: "Requirement 1", status: "satisfied" }];

  const contract: SubQuestContract = {
    qid: CHILD1_QID,
    parentQid: ROOT_QID,
    title: "Child Contract",
    assignedRequirements: ["R1"],
    allowedPaths: ["path/to/file.c"],
    requiredTestCommands: ["make test"],
    acceptanceCriteria: ["Criteria 1"],
    maxTurns: 10,
  };

  const child = pushStackFrame(root, contract, CHILD1_QID);
  child.handbackReceipts = [{
    childQid: PREV_QID,
    status: "COMPLETED",
    assignedRequirements: ["R0"],
    filesModified: ["prev.c"],
    diffSummary: "prev.c +5",
    testCommand: "make test",
    testPassed: true,
    findings: "Done",
  }];

  const encoded = encodeSnapshot(child);
  const decoded = decodeSnapshot(encoded);
  check(decoded !== null, "decoded successfully");
  if (!decoded) throw new Error("null decoded");

  check(decoded.qid === CHILD1_QID, "decoded qid");
  check(decoded.questStack.length === 1, "decoded questStack length");
  check(decoded.questStack[0].qid === ROOT_QID, "decoded stack parent qid");
  check(decoded.contract?.title === "Child Contract", "decoded contract title");
  check(decoded.contract?.allowedPaths[0] === "path/to/file.c", "decoded allowedPaths");
  check(decoded.contract?.maxTurns === 10, "decoded maxTurns");
  check(decoded.handbackReceipts.length === 1, "decoded receipts length");
});

Deno.test("stack pop on FAILED receipt injects structured setback and actionable exactNextAction", () => {
  const root = createQuest("Master objective", ROOT_QID);
  root.phase = "implementing";
  root.rtm = [
    { id: "R1", description: "Parser safety", status: "pending" },
  ];

  const contract: SubQuestContract = {
    qid: CHILD1_QID,
    parentQid: ROOT_QID,
    title: "Implement parser safety",
    assignedRequirements: ["R1"],
    allowedPaths: ["mods/song/parser.c"],
    requiredTestCommands: ["make test"],
    acceptanceCriteria: ["Safe parsing"],
  };

  const childState = pushStackFrame(root, contract, CHILD1_QID);
  const failureReceipt: HandbackReceipt = {
    childQid: CHILD1_QID,
    status: "FAILED",
    assignedRequirements: ["R1"],
    filesModified: ["mods/song/parser.c"],
    diffSummary: "syntax error introduced",
    testCommand: "make test",
    testPassed: false,
    findings: "Compiler error at line 42",
  };

  const restoredParent = popStackFrame(childState, failureReceipt);
  check(restoredParent.qid === ROOT_QID, "restored to root");
  check(restoredParent.setbacks.length === 1, "structured setback recorded");
  check(restoredParent.setbacks[0].reason.includes("Sub-quest child1 failed"), "setback reason set");
  check(restoredParent.setbacks[0].evidence.some((e) => e.includes("make test")), "test command in evidence");
  check(restoredParent.exactNextAction.includes("child1"), "exactNextAction guides recovery");

  // RTM status remains pending
  const r1 = restoredParent.rtm?.find((r) => r.id === "R1");
  check(r1?.status === "pending", "R1 still pending on failure");
});

Deno.test("reconcileDocContent updates markdown checkboxes and records receipt bullet", () => {
  const initialDoc = `# root01

## Requirements

- [ ] **R1: Parser safety**: Implement parser safety.
- [ ] **R2: WASM UX**: Implement WASM UX.

## Implementation Plan

### Phase 1: Parser
`;

  const completedReceipt: HandbackReceipt = {
    childQid: CHILD1_QID,
    status: "COMPLETED",
    assignedRequirements: ["R1"],
    filesModified: ["mods/song/parser.c"],
    diffSummary: "10 lines changed",
    testCommand: "make test",
    testPassed: true,
    findings: "Parser safety verified.",
  };

  const updatedDoc = reconcileDocContent(initialDoc, completedReceipt);
  check(updatedDoc.includes("- [x] **R1: Parser safety**"), "R1 checkbox checked");
  check(updatedDoc.includes("- [ ] **R2: WASM UX**"), "R2 checkbox still unchecked");
  check(updatedDoc.includes("## Sub-Quests"), "Sub-Quests header added");
  check(updatedDoc.includes("Sub-Quest child1 (COMPLETED): Parser safety verified."), "Receipt recorded");
  check(updatedDoc.includes("[test: make test passed]"), "Test verification noted");
});


