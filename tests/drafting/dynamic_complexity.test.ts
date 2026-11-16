import assert from "node:assert";
import {
  extractComplexityEvidence,
  inferDynamicDifficulty,
  recalibrateQuestDifficulty,
  ensureSubquestsScaffold,
} from "../../src/drafting/difficulty.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { parseDraftSections } from "../../src/drafting/plan-text.ts";
import { pushStackFrame, popStackFrame } from "../../src/domain/stack.ts";
import type { SubQuestContract, HandbackReceipt } from "../../src/domain/contract.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { replaceState, getState } from "../../src/app/store.ts";

Deno.test("dynamic_complexity: inferDynamicDifficulty elevates small-prompt tasks to complex based on evidence", () => {
  // Baseline standard from a small prompt
  const baseline = "standard";

  // Case 1: 11 requirements, 132 steps (like 1xPsim)
  const simEvidence = {
    requirementsCount: 11,
    planStepsCount: 132,
    subquestsCount: 0,
    hasSubquestBacklog: false,
    touchedFilesCount: 4,
  };
  assert.strictEqual(inferDynamicDifficulty(simEvidence, baseline), "complex");

  // Case 2: Explicit subquest backlog declared in doc
  const backlogEvidence = {
    requirementsCount: 2,
    planStepsCount: 4,
    subquestsCount: 2,
    hasSubquestBacklog: true,
  };
  assert.strictEqual(inferDynamicDifficulty(backlogEvidence, baseline), "complex");

  // Case 3: 5 requirements and 8 discrete steps -> major (cohesive multi-step plan stays in unified lane)
  const multiPhaseEvidence = {
    requirementsCount: 5,
    planStepsCount: 8,
    subquestsCount: 0,
    hasSubquestBacklog: false,
  };
  assert.strictEqual(inferDynamicDifficulty(multiPhaseEvidence, baseline), "major");

  // Case 3b: Truly massive scale (7 requirements and 12 discrete steps) -> complex
  const massiveEvidence = {
    requirementsCount: 7,
    planStepsCount: 12,
    subquestsCount: 0,
    hasSubquestBacklog: false,
  };
  assert.strictEqual(inferDynamicDifficulty(massiveEvidence, baseline), "complex");

  // Case 4: Moderate scope (5 requirements, 4 steps) -> major
  const majorEvidence = {
    requirementsCount: 5,
    planStepsCount: 4,
  };
  assert.strictEqual(inferDynamicDifficulty(majorEvidence, baseline), "major");

  // Case 5: Genuinely standard chore (2 requirements, 3 steps) -> standard
  const standardEvidence = {
    requirementsCount: 2,
    planStepsCount: 3,
  };
  assert.strictEqual(inferDynamicDifficulty(standardEvidence, baseline), "standard");
});

Deno.test("dynamic_complexity: recalibrateQuestDifficulty extracts evidence from state and doc", () => {
  const quest = createQuest("Small initial prompt", "tst001" as Qid, null, "standard");
  const doc = `## Requirements
- R1: Core WebGL separation
- R2: Elevation zero crossing
- R3: Noise LOD seams
- R4: Frustum culling
- R5: Zoom scaling
- R6: HUD dock
- R7: Minimap sync
- R8: Regression assertions

## Evidence
- src/a.c:10
- src/b.c:20

## Implementation Plan
1. Step 1: isolate shader
2. Step 2: fix elevation
3. Step 3: seam stitch
4. Step 4: culling
5. Step 5: zoom
6. Step 6: hud
7. Step 7: minimap
8. Step 8: tests
9. Step 9: assertions
10. Step 10: audit
11. Step 11: verify
12. Step 12: finalize
`;

  const sections = parseDraftSections(doc);
  const recalibrated = recalibrateQuestDifficulty(quest, sections, doc);
  assert.strictEqual(recalibrated, "complex");
});

Deno.test("dynamic_complexity: ensureSubquestsScaffold adds Sub-Quests section when task is complex", () => {
  const flatDoc = `## Requirements
- R1: Do something big

## Evidence
- src/main.c:1

## Implementation Plan
1. First step
`;

  const withScaffold = ensureSubquestsScaffold(flatDoc);
  assert.strictEqual(withScaffold.includes("## Sub-Quests"), true);
  assert.strictEqual(withScaffold.includes("COMPLEX TASK DETECTED"), true);
  assert.strictEqual(withScaffold.includes("- [ ] SQ1:"), true);

  // Idempotent: does not duplicate if already present
  const doubleCall = ensureSubquestsScaffold(withScaffold);
  const matches = doubleCall.match(/## Sub-Quests/g);
  assert.strictEqual(matches?.length, 1);
});

Deno.test("dynamic_complexity: recursive sub-quests allow child quests to discover complexity and spawn grandchildren", () => {
  try {
    const parentQid = "par010" as Qid;
    const parent = createQuest("Root Task", parentQid, null, "standard");
    replaceState(parent);

    // Parent spawns child SQ1
    const childContract: SubQuestContract = {
      qid: "chd010" as Qid,
      parentQid,
      title: "Child Sub-Task",
      assignedRequirements: ["R1"],
      allowedPaths: ["src/child/**"],
      requiredTestCommands: ["npm test"],
      acceptanceCriteria: ["Child complete"],
    };

    const childState = pushStackFrame(parent, childContract, "chd010" as Qid);
    replaceState(childState);

    const activeChild = getState();
    assert.strictEqual(activeChild.depth, 1);
    assert.strictEqual(activeChild.parentQid, parentQid);

    // Child discovers mid-quest that its sub-task is itself complex
    const childDoc = `## Requirements
- R1.1: Sub component A
- R1.2: Sub component B
- R1.3: Sub component C
- R1.4: Sub component D
- R1.5: Sub component E
- R1.6: Sub component F
- R1.7: Sub component G
- R1.8: Sub component H

## Implementation Plan
1. S1
2. S2
3. S3
4. S4
5. S5
6. S6
7. S7
8. S8
9. S9
10. S10
11. S11
12. S12
`;
    const childSections = parseDraftSections(childDoc);
    const childRecalibrated = recalibrateQuestDifficulty(activeChild, childSections, childDoc);
    assert.strictEqual(childRecalibrated, "complex");

    // Child spawns grandchild subquest
    const grandchildContract: SubQuestContract = {
      qid: "gch010" as Qid,
      parentQid: "chd010" as Qid,
      title: "Grandchild Sub-Task",
      assignedRequirements: ["R1.1"],
      allowedPaths: ["src/child/grandchild/**"],
      requiredTestCommands: ["npm test"],
      acceptanceCriteria: ["Grandchild complete"],
    };

    const grandchildState = pushStackFrame({ ...activeChild, difficulty: childRecalibrated }, grandchildContract, "gch010" as Qid);
    replaceState(grandchildState);

    const activeGrandchild = getState();
    assert.strictEqual(activeGrandchild.depth, 2);
    assert.strictEqual(activeGrandchild.parentQid, "chd010");
    assert.strictEqual(activeGrandchild.questStack.length, 2);

    // Grandchild completes and pops back to child
    const receipt: HandbackReceipt = {
      childQid: "gch010" as Qid,
      status: "COMPLETED",
      assignedRequirements: ["R1.1"],
      filesModified: ["src/child/grandchild/file.ts"],
      diffSummary: "1 file changed",
      testCommand: "npm test",
      testPassed: true,
      findings: "Grandchild finished successfully",
    };

    const restoredChild = popStackFrame(activeGrandchild, receipt);
    replaceState(restoredChild);

    const childAfter = getState();
    assert.strictEqual(childAfter.depth, 1);
    assert.strictEqual(childAfter.qid, "chd010");
    assert.strictEqual(childAfter.difficulty, "complex");
  } finally {
    replaceState(IDLE_STATE);
  }
});
