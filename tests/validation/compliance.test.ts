import { check } from "../check.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getState, replaceState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { claimComplete, createDraft, promote } from "../../src/domain/transitions.ts";
import { draftPath } from "../../src/domain/paths.ts";
import type { Qid } from "../../src/domain/qid.ts";
import {
  ensureValidationFlow,
  validationBrief,
} from "../../src/validation/flow.ts";
import { claimForValidation } from "../../src/surface/tools/update-params.ts";
import { buildReviewPrompt, type ReviewMaterial } from "../../src/review/prompts.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";
import { splicePlanSection } from "../../src/drafting/plan-text.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "pi-quest-compliance-"));
}

const QID = "comp123" as Qid;

function createTestQuest(userRequest: string) {
  const s = createDraft(createQuest(userRequest, QID), "compliance-test");
  return claimComplete({ ...promote({ ...s, draft: { ...s.draft!, planAuthored: true } }, "review"), phase: "implementing" as const });
}

function writeSampleDraftFile(cwd: string, userRequest: string, planBody: string, contextChat: string) {
  mkdirSync(join(cwd, ".pi/quest/future"), { recursive: true });
  const template = renderDraftTemplate(
    "compliance-test",
    userRequest,
    contextChat,
    "standard",
    "<!-- Invariant: pure C only; no regex string stripping -->",
  );
  const withPlan = splicePlanSection(template, planBody);
  const withReqs = withPlan.replace(
    "## Requirements\n",
    "## Requirements\n\n- R1: User requested feature A\n- R2: User requested feature B\n",
  );
  writeFileSync(join(cwd, draftPath(QID)), withReqs, "utf8");
}

Deno.test("validationBrief: slices clean deliverable, stripping background chat and invariant noise", async () => {
  const cwd = tmp();
  const userRequest = "Implement feature A and feature B with zero regressions";
  const contextChat = "[user] How should we do it?\n[assistant] Maybe we could do something else.\n[user] No, feature A and B.";
  const planBody = "Step 1: Write feature A.\nStep 2: Write feature B.";

  writeSampleDraftFile(cwd, userRequest, planBody, contextChat);
  const state = createTestQuest(userRequest);
  replaceState(state);

  const ctx = fakeCtx(cwd);
  const brief = await validationBrief(ctx, state);

  // 1. Deliverable must contain the implementation plan steps
  check(brief.plan.includes("Step 1: Write feature A"), "brief.plan has plan body");
  check(brief.plan.includes("Step 2: Write feature B"), "brief.plan has plan body step 2");

  // 2. Deliverable must NOT contain the conversation chatter, template headers, or invariant blocks
  check(!brief.plan.includes("## Context / Background Discussion"), "brief.plan strips context heading");
  check(!brief.plan.includes("[assistant] Maybe we could do something else"), "brief.plan strips chat history");
  check(!brief.plan.includes("Draft proposal under adversarial review"), "brief.plan strips template banner");
  check(!brief.plan.includes("<!-- Invariant: pure C only"), "brief.plan strips invariant comments");

  // 3. User request is preserved as the supreme objective
  check(brief.objective === userRequest, "brief.objective holds user request");

  // 4. Requirements are structured
  check(Boolean(brief.requirements?.some((r) => r.includes("feature A"))), "requirements extracted R1");
  check(Boolean(brief.requirements?.some((r) => r.includes("feature B"))), "requirements extracted R2");

  replaceState(IDLE_STATE);
});

Deno.test("validationBrief: captures git diff when changes are present", async () => {
  const cwd = tmp();
  const userRequest = "Add helper function";
  writeSampleDraftFile(cwd, userRequest, "Add helper", "none");
  const state = createTestQuest(userRequest);
  replaceState(state);

  const pi = fakePi();
  // Mock pi.exec to return a git diff
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[]) => {
    if (cmd === "git" && args[0] === "diff") {
      return { code: 0, stdout: "diff --git a/foo.c b/foo.c\n+void helper() {}" };
    }
    return { code: 0, stdout: "" };
  };

  const ctx = fakeCtx(cwd);
  mkdirSync(join(cwd, ".git"), { recursive: true });

  const brief = await validationBrief(ctx, state, pi);
  check(brief.codeDiff !== undefined, "codeDiff is populated in brief");
  check(brief.codeDiff!.includes("void helper() {}"), "codeDiff contains git diff patch");

  replaceState(IDLE_STATE);
});

Deno.test("buildReviewPrompt: foregrounds USER REQUEST SUPREMACY in validation guidance", () => {
  const material: ReviewMaterial = {
    objective: "Create widget with color red",
    plan: "Create widget with color blue",
    evidence: [],
    amendments: [],
    requirements: ["- R1: widget must be red"],
  };

  const prompt = buildReviewPrompt("validation", QID, "target123", material);

  check(prompt.includes("USER REQUEST SUPREMACY"), "prompt mentions USER REQUEST SUPREMACY");
  check(prompt.includes("ORIGINAL REQUEST"), "prompt mentions ORIGINAL REQUEST");
  check(
    prompt.includes("merely the implementer's internal proposal") ||
    prompt.includes("proposal, NOT the acceptance specification") ||
    prompt.includes("merely an internal proposal"),
    "prompt explains that plan is merely an internal proposal",
  );
  check(
    prompt.includes("fails to fulfill what the user asked") ||
    prompt.includes("failing to deliver what the user requested"),
    "prompt warns that following plan but failing user request is a FAIL",
  );
});

Deno.test("ensureValidationFlow: balanced policy restricts completion bypass to trivial chores only", async () => {
  const cwd = tmp();
  const pi = fakePi();

  // 1. Standard task with passing tests does NOT bypass validation under balanced policy
  const standardState = createTestQuest("Standard task");
  standardState.difficulty = "standard";
  standardState.lastTestReceipt = {
    command: "npm test",
    exitCode: 0,
    tailOutput: "all tests passed",
    executedAt: Date.now(),
  };
  replaceState(standardState);
  writeSampleDraftFile(cwd, "Standard task", "Step 1: Do standard task", "none");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ "pi-quest": { reviewPolicy: "balanced", autoArchive: true } }),
    "utf8",
  );

  await ensureValidationFlow(pi, fakeCtx(cwd));
  check(getState().phase !== "idle", "standard task does not auto-bypass validation under balanced policy");

  // 2. Minor task with passing tests does NOT bypass validation under balanced policy
  const minorState = createTestQuest("Minor task");
  minorState.difficulty = "minor";
  minorState.lastTestReceipt = {
    command: "npm test",
    exitCode: 0,
    tailOutput: "all tests passed",
    executedAt: Date.now(),
  };
  replaceState(minorState);
  await ensureValidationFlow(pi, fakeCtx(cwd));
  check(getState().phase !== "idle", "minor task does not auto-bypass validation under balanced policy");

  // 3. Trivial chore with passing tests DOES bypass validation under balanced policy
  const trivialState = createTestQuest("Trivial chore");
  trivialState.difficulty = "trivial";
  trivialState.lastTestReceipt = {
    command: "npm test",
    exitCode: 0,
    tailOutput: "all tests passed",
    executedAt: Date.now(),
  };
  replaceState(trivialState);
  await ensureValidationFlow(pi, fakeCtx(cwd));
  check(getState().phase === "idle", "trivial chore auto-bypasses validation under balanced policy");

  replaceState(IDLE_STATE);
});

Deno.test("ensureValidationFlow: strictMode prevents auto-bypassing validation even for trivial chores", async () => {
  const cwd = tmp();
  const pi = fakePi();
  const state = createTestQuest("Trivial chore with strict mode");
  state.difficulty = "trivial";
  state.lastTestReceipt = {
    command: "npm test",
    exitCode: 0,
    tailOutput: "all tests passed",
    executedAt: Date.now(),
  };
  replaceState(state);

  writeSampleDraftFile(cwd, "Trivial chore with strict mode", "Step 1: Do task", "none");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ "pi-quest": { reviewPolicy: "balanced", strictMode: true, autoArchive: true } }),
    "utf8",
  );

  // In strictMode, even trivial task should NOT bypass validation to idle!
  await ensureValidationFlow(pi, fakeCtx(cwd));
  check(getState().phase !== "idle", "strictMode did not bypass validation for trivial chore");

  replaceState(IDLE_STATE);
});

Deno.test("validationBrief: captures submodule git diffs and combines them", async () => {
  const cwd = tmp();
  const userRequest = "Modify submodule libhyle";
  writeSampleDraftFile(cwd, userRequest, "Edit submodule", "none");
  const state = createTestQuest(userRequest);
  replaceState(state);

  mkdirSync(join(cwd, ".git"), { recursive: true });
  const subPath = join(cwd, "external/libhyle");
  mkdirSync(join(subPath, ".git"), { recursive: true });

  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    if (cmd === "git" && args[0] === "status" && args[1] === "--porcelain") {
      if (opts?.cwd === cwd) {
        return { code: 0, stdout: " M external/libhyle\n" };
      }
    }
    if (cmd === "git" && args[0] === "diff") {
      if (opts?.cwd === subPath) {
        return { code: 0, stdout: "diff --git a/query.c b/query.c\n+void hyle_exec() {}" };
      }
      return { code: 0, stdout: "" };
    }
    return { code: 0, stdout: "" };
  };

  const ctx = fakeCtx(cwd);
  const brief = await validationBrief(ctx, state, pi);

  check(brief.codeDiff !== undefined, "codeDiff is present for submodule changes");
  check(brief.codeDiff!.includes("SUBMODULE: external/libhyle"), "codeDiff has submodule header");
  check(brief.codeDiff!.includes("void hyle_exec() {}"), "codeDiff contains submodule patch");

  replaceState(IDLE_STATE);
});

Deno.test("validationBrief: captures external repository diff when files outside ctx.cwd are touched", async () => {
  const cwd = tmp();
  const extRepo = tmp();
  mkdirSync(join(extRepo, ".git"), { recursive: true });
  mkdirSync(join(cwd, ".git"), { recursive: true });

  const userRequest = "Fix bug in external repo";
  writeSampleDraftFile(cwd, userRequest, "Edit external repo", "none");
  const state = createTestQuest(userRequest);
  state.touchedFiles = [join(extRepo, "src/foo.ts")];
  replaceState(state);

  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[], opts?: { cwd?: string }) => {
    if (cmd === "git" && args[0] === "diff") {
      if (opts?.cwd === extRepo) {
        return { code: 0, stdout: "diff --git a/src/foo.ts b/src/foo.ts\n+const fixed = true;" };
      }
      return { code: 0, stdout: "" };
    }
    return { code: 0, stdout: "" };
  };

  const ctx = fakeCtx(cwd);
  const brief = await validationBrief(ctx, state, pi);

  check(brief.codeDiff !== undefined, "codeDiff is present for external repo");
  check(brief.codeDiff!.includes("EXTERNAL REPOSITORY:"), "codeDiff identifies external repository");
  check(brief.codeDiff!.includes("const fixed = true;"), "codeDiff has external repo patch");

  replaceState(IDLE_STATE);
});

Deno.test("validationBrief: retains intermediate commits when baseCommit is provided", async () => {
  const cwd = tmp();
  mkdirSync(join(cwd, ".git"), { recursive: true });
  const userRequest = "Multi-commit feature";
  writeSampleDraftFile(cwd, userRequest, "Do multi-commit", "none");

  const state = createTestQuest(userRequest);
  state.baseCommit = "c0ffee123456789";
  replaceState(state);

  const pi = fakePi();
  (pi as unknown as { exec: unknown }).exec = async (cmd: string, args: string[]) => {
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--verify") {
      return { code: 0, stdout: "c0ffee123456789" };
    }
    if (cmd === "git" && args[0] === "diff" && args[1] === "c0ffee123456789") {
      return { code: 0, stdout: "diff --git a/multi.ts b/multi.ts\n+commit1\n+commit2\n+commit3" };
    }
    return { code: 0, stdout: "" };
  };

  const ctx = fakeCtx(cwd);
  const brief = await validationBrief(ctx, state, pi);

  check(brief.codeDiff !== undefined, "codeDiff is present from baseCommit");
  check(brief.codeDiff!.includes("+commit1") && brief.codeDiff!.includes("+commit3"), "diff includes all intermediate commits");

  replaceState(IDLE_STATE);
});

Deno.test("validationBrief: provides touchedFiles manifest and switches guidance when workspace is non-git", () => {
  const nonGitDir = tmp();
  // Ensure no .git exists
  const touchedFilePath = join(nonGitDir, "script.js");

  const material: ReviewMaterial = {
    objective: "Add logging to non-git script",
    plan: "Step 1: Add console.log",
    evidence: [],
    amendments: [],
    touchedFiles: [touchedFilePath],
  };

  const prompt = buildReviewPrompt("validation", QID, "target123", material);

  // 1. Prompt includes the touched files list for direct inspection
  check(prompt.includes("TOUCHED FILES (no VCS diff available"), "prompt includes TOUCHED FILES header");
  check(prompt.includes(touchedFilePath), "prompt lists the non-git touched file");

  // 2. Guidance commands direct inspection via read/search tools
  check(prompt.includes("When NO VCS DIFF is available"), "guidance covers non-git mode");
  check(prompt.includes("directly inspect the target files"), "guidance commands direct workspace file inspection");

  replaceState(IDLE_STATE);
});

Deno.test("claimForValidation: enforces universal completion eligibility on non-git workspace", async () => {
  const cwd = tmp();
  // Ensure no .git exists in cwd
  const pi = fakePi();
  const ctx = fakeCtx(cwd);

  const state = createTestQuest("Non-git task");
  state.phase = "implementing";
  state.lastTestReceipt = {
    command: "node test.js",
    exitCode: 0,
    tailOutput: "tests passed",
    executedAt: Date.now(),
  };

  // A. With 0 touched files, claiming complete must fail with "No files have been modified"
  state.touchedFiles = [];
  replaceState(state);
  let failed = false;
  try {
    await claimForValidation(pi, ctx, state);
  } catch (err: unknown) {
    failed = true;
    check(String(err).includes("No files have been modified"), "throws no files modified error");
  }
  check(failed, "completion claimed with 0 touched files fails");

  // B. With touched files, claiming complete succeeds
  state.touchedFiles = [join(cwd, "script.js")];
  replaceState(state);
  const claimed = await claimForValidation(pi, ctx, state);
  check(claimed.phase === "validating", "successfully moves to validating when touchedFiles is present");

  replaceState(IDLE_STATE);
});

Deno.test("claimForValidation: rejects non-git workspace with zero touched files and no test receipt", async () => {
  const cwd = tmp();
  const pi = fakePi();
  const ctx = fakeCtx(cwd);

  const state = createTestQuest("Non-git blank task");
  state.phase = "implementing";
  state.touchedFiles = [];
  state.lastTestReceipt = undefined;
  replaceState(state);

  let failed = false;
  let errMsg = "";
  try {
    await claimForValidation(pi, ctx, state);
  } catch (err: unknown) {
    failed = true;
    errMsg = String(err);
  }
  check(failed, "completion claimed with 0 touched files and no test receipt fails");
  check(errMsg.includes("No files have been modified"), "throws no files modified error");

  replaceState(IDLE_STATE);
});

