import { check } from "../check.ts";
import { createQuest, IDLE_STATE, type QuestState } from "../../src/domain/quest.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { pushStackFrame, popStackFrame } from "../../src/domain/stack.ts";
import type { HandbackReceipt } from "../../src/domain/contract.ts";
import {
  parseSubQuestBacklog,
  nextPendingSubQuest,
  advanceForeman,
  createContractForBacklogItem,
} from "../../src/subquests/foreman.ts";
import { parseDraftSections, deliverableBody } from "../../src/drafting/plan-text.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";
import { promoteAfterPass } from "../../src/drafting/promote.ts";
import { replaceState, getState } from "../../src/app/store.ts";
import { fakePi, fakeCtx } from "../fake-pi.ts";

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

Deno.test("parseDraftSections extracts ## Sub-Quests and folds into deliverableBody", () => {
  const doc = `## Requirements
- R1: Core engine

## Sub-Quests
- [ ] SQ1: Core architecture [paths: src/core] [tests: make test] [req: R1]

## Implementation Plan
### Step 1
Detailed plan instructions.
`;
  const sections = parseDraftSections(doc);
  check(sections.subquests !== undefined && sections.subquests.includes("SQ1"), "subquests captured");
  const body = deliverableBody(sections, "standard");
  check(body.includes("## Sub-Quests"), "deliverableBody includes Sub-Quests header");
  check(body.includes("SQ1: Core architecture"), "deliverableBody includes SQ1");
  check(body.includes("Detailed plan instructions"), "deliverableBody includes plan");
});

Deno.test("renderDraftTemplate injects structured SQ items when difficulty is complex", () => {
  const standardDoc = renderDraftTemplate("Standard Quest", "Do something", "", "standard");
  check(!standardDoc.includes("## Sub-Quests"), "standard omits Sub-Quests completely");

  const complexDoc = renderDraftTemplate("Complex Quest", "Overhaul engine", "", "complex");
  check(complexDoc.includes("COMPLEX TASK DETECTED"), "complex banner present");
  check(complexDoc.includes("- [ ] SQ1:"), "SQ1 active in complex doc");
  check(complexDoc.includes("- [ ] SQ2:"), "SQ2 active in complex doc");
});

Deno.test("promoteAfterPass auto-kicks off Foreman to mount SQ1 when backlog is present", async () => {
  const pi = fakePi();
  const cwd = Deno.makeTempDirSync({ prefix: "pi-quest-promote-foreman-" });
  try {
    const parentQid = "par001" as Qid;
    const parent = createQuest("Complex Parent Task", parentQid, null, "complex");
    parent.phase = "drafting";
    const plan = `## Sub-Quests
- [ ] SQ1: Core foundation [paths: src/foundation] [tests: npm test] [req: R1]
- [ ] SQ2: Feature implementation [paths: src/feat] [tests: npm test] [req: R2]

## Implementation Plan
Detailed execution.`;

    parent.draft = {
      name: "complex-plan",
      contentHash: "hash123",
      lastReviewedPlan: plan,
      planAuthored: true,
      approvedBy: null,
      outstandingFindings: false,
      approvedPlanHash: null,
      planRevisions: [],
    };
    replaceState(parent);

    const message = await promoteAfterPass(pi, fakeCtx(cwd), parentQid, "review");
    check(message !== null, "promotion succeeded");
    check(message!.includes("Foreman: Automatically mounting SQ1"), "Foreman message announced");

    const current = getState();
    check(current.depth === 1, "child depth is 1");
    check(current.parentQid === parentQid, "parent is linked");
    check(current.contract?.assignedRequirements[0] === "R1", "R1 assigned to SQ1");
    check(current.contract?.allowedPaths[0] === "src/foundation", "paths bounded");
    check(current.questStack.length === 1, "parent saved in questStack");
    check(current.questStack[0].qid === parentQid, "parent frame matches");

    // Verify child doc was created on disk
    const childDocExists = Deno.statSync(`${cwd}/.pi/quest/future/${current.qid}.md`).isFile;
    check(childDocExists, "child doc created on disk");
  } finally {
    Deno.removeSync(cwd, { recursive: true });
    replaceState(IDLE_STATE);
  }
});

Deno.test("promoteAfterPass stays single-lane for standard difficulty task even if SQ items exist in plan", async () => {
  const pi = fakePi();
  const cwd = Deno.makeTempDirSync({ prefix: "pi-quest-promote-standard-" });
  try {
    const parentQid = "std001" as Qid;
    const parent = createQuest("Standard Parent Task", parentQid, null, "standard");
    parent.phase = "drafting";
    const plan = `## Sub-Quests
- [ ] SQ1: Core foundation [paths: src/foundation] [tests: npm test] [req: R1]

## Implementation Plan
Detailed execution.`;

    parent.draft = {
      name: "standard-plan",
      contentHash: "hash456",
      lastReviewedPlan: plan,
      planAuthored: true,
      approvedBy: null,
      outstandingFindings: false,
      approvedPlanHash: null,
      planRevisions: [],
    };
    replaceState(parent);

    const message = await promoteAfterPass(pi, fakeCtx(cwd), parentQid, "review");
    check(message !== null, "promotion succeeded");
    check(!message!.includes("Foreman: Automatically mounting"), "Foreman is not mounted for standard difficulty");
    check(message!.includes("Proceed autonomously from the draft plan"), "stays single lane");

    const current = getState();
    check(current.depth === 0, "stays at root depth 0");
    check(current.qid === parentQid, "stays on parent quest");
    check(current.phase === "implementing", "parent in implementing");
  } finally {
    Deno.removeSync(cwd, { recursive: true });
    replaceState(IDLE_STATE);
  }
});

