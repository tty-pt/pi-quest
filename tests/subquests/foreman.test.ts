import { check } from "../check.ts";
import { createQuest, type QuestState } from "../../src/domain/quest.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { pushStackFrame, popStackFrame } from "../../src/domain/stack.ts";
import type { HandbackReceipt } from "../../src/domain/contract.ts";
import {
  parseSubQuestBacklog,
  nextPendingSubQuest,
  advanceForeman,
  createContractForBacklogItem,
} from "../../src/subquests/foreman.ts";

const ROOT_QID = "root01" as Qid;
const SQ1_QID = "sq0001" as Qid;
const SQ2_QID = "sq0002" as Qid;

Deno.test("parseSubQuestBacklog parses markdown backlog bullets", () => {
  const planText = `
## Requirements
- [ ] R1: Parse headers
- [ ] R2: Render UI

## Sub-Quests
- [ ] SQ1: Implement parser [paths: mods/song/*] [test: make test] [req: R1]
- [ ] SQ2: Implement UI [paths: mods/ui/*] [test: npm test] [req: R2]
`;
  const items = parseSubQuestBacklog(planText);
  check(items.length === 2, "2 items parsed");
  check(items[0].id === "SQ1", "SQ1 id matches");
  check(items[0].goal === "Implement parser", "SQ1 goal matches");
  check(items[0].allowedPaths[0] === "mods/song/*", "SQ1 allowed paths");
  check(items[0].requiredTestCommands[0] === "make test", "SQ1 required test");
  check(items[0].assignedRequirements[0] === "R1", "SQ1 requirement");

  check(items[1].id === "SQ2", "SQ2 id matches");
  check(items[1].goal === "Implement UI", "SQ2 goal matches");
});

Deno.test("nextPendingSubQuest identifies first uncompleted item", () => {
  const items = [
    { id: "SQ1", goal: "First", allowedPaths: [], requiredTestCommands: [], assignedRequirements: ["R1"] },
    { id: "SQ2", goal: "Second", allowedPaths: [], requiredTestCommands: [], assignedRequirements: ["R2"] },
  ];
  const receipts: HandbackReceipt[] = [
    {
      childQid: "child1" as Qid,
      status: "COMPLETED",
      assignedRequirements: ["R1"],
      filesModified: [],
      diffSummary: "",
      testCommand: "test",
      testPassed: true,
      findings: "SQ1 done",
    },
  ];

  const next = nextPendingSubQuest(items, receipts);
  check(next !== null, "next item found");
  check(next?.id === "SQ2", "SQ2 is next");
});

Deno.test("advanceForeman sequences from completed SQ1 directly into SQ2 mounting", () => {
  const root = createQuest("Master Task", ROOT_QID);
  root.phase = "implementing";
  const plan = `
## Sub-Quests
- [ ] SQ1: Parse headers [paths: parser.c] [test: make test] [req: R1]
- [ ] SQ2: Render UI [paths: ui.c] [test: npm test] [req: R2]
`;
  root.draft = {
    name: "root-draft",
    contentHash: "abc",
    lastReviewedPlan: plan,
    planAuthored: true,
    approvedBy: null,
    outstandingFindings: false,
    approvedPlanHash: null,
    planRevisions: [],
  };

  // Mount SQ1
  const contract1 = createContractForBacklogItem(
    { id: "SQ1", goal: "Parse headers", allowedPaths: ["parser.c"], requiredTestCommands: ["make test"], assignedRequirements: ["R1"] },
    ROOT_QID,
    SQ1_QID,
  );
  const sq1State = pushStackFrame(root, contract1, SQ1_QID);

  // Complete SQ1
  const receipt1: HandbackReceipt = {
    childQid: SQ1_QID,
    status: "COMPLETED",
    assignedRequirements: ["R1"],
    filesModified: ["parser.c"],
    diffSummary: "parser done",
    testCommand: "make test",
    testPassed: true,
    findings: "SQ1 succeeded",
  };
  const restoredParent = popStackFrame(sq1State, receipt1);

  // Advance foreman
  const advanced = advanceForeman(restoredParent, SQ2_QID);
  check(advanced !== null, "foreman advanced to next sub-quest");
  if (advanced) {
    check(advanced.nextMountedState.qid === SQ2_QID, "SQ2 mounted as active qid");
    check(advanced.nextMountedState.phase === "implementing", "SQ2 in implementing");
    check(advanced.nextMountedState.contract?.assignedRequirements[0] === "R2", "R2 assigned to SQ2");
    check(advanced.nextMountedState.questStack.length === 1, "parent frame saved in questStack");
    check(advanced.nextItem.id === "SQ2", "nextItem is SQ2");
  }
});

Deno.test("failed SQ1 halts automatic dispatch and preserves failure setback", () => {
  const root = createQuest("Master Task", ROOT_QID);
  root.phase = "implementing";
  const plan = `
## Sub-Quests
- [ ] SQ1: Parse headers [paths: parser.c] [test: make test] [req: R1]
- [ ] SQ2: Render UI [paths: ui.c] [test: npm test] [req: R2]
`;
  root.draft = {
    name: "root-draft",
    contentHash: "abc",
    lastReviewedPlan: plan,
    planAuthored: true,
    approvedBy: null,
    outstandingFindings: false,
    approvedPlanHash: null,
    planRevisions: [],
  };

  const contract1 = createContractForBacklogItem(
    { id: "SQ1", goal: "Parse headers", allowedPaths: ["parser.c"], requiredTestCommands: ["make test"], assignedRequirements: ["R1"] },
    ROOT_QID,
    SQ1_QID,
  );
  const sq1State = pushStackFrame(root, contract1, SQ1_QID);

  const failureReceipt: HandbackReceipt = {
    childQid: SQ1_QID,
    status: "FAILED",
    assignedRequirements: ["R1"],
    filesModified: [],
    diffSummary: "",
    testCommand: "make test",
    testPassed: false,
    findings: "Compiler error",
  };
  const restoredParent = popStackFrame(sq1State, failureReceipt);

  check(restoredParent.setbacks.length === 1, "failure setback recorded");
  check(restoredParent.exactNextAction.includes("sq0001"), "exactNextAction guides recovery");
});
