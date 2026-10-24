import { check } from "../check.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";
import {
  parseDraftSections,
  spliceAmendmentsSection,
  reviewMaterial,
} from "../../src/drafting/plan-text.ts";
import {
  buildReviewPrompt,
  getReviewCriteriaSummary,
} from "../../src/review/prompts.ts";
import { injectQuestContext } from "../../src/durability/injection.ts";
import { appendFollowUpToDraft } from "../../src/subquests/index.ts";
import { applyUpdate } from "../../src/surface/tools/update-state.ts";
import { createQuest, IDLE_STATE, type QuestState } from "../../src/domain/quest.ts";
import { createDraft, promote } from "../../src/domain/transitions.ts";
import { type Qid } from "../../src/domain/qid.ts";
import { getState, replaceState } from "../../src/app/store.ts";
import { draftPath } from "../../src/domain/paths.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import type { Pi } from "../../src/hooks/events.ts";
import { join } from "node:path";
import { mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";

Deno.test("prompt_amendments: renderDraftTemplate includes prompt, amendments section, and guidelines", () => {
  const rendered = renderDraftTemplate("TestQuest", "Build user audio player");
  check(rendered.includes("## Original request"), "has original request header");
  check(rendered.includes("Build user audio player"), "includes exact prompt/objective");
  check(rendered.includes("## Amendments"), "has amendments section");
  check(rendered.includes("REVIEW & COMPLIANCE GUIDELINES"), "has review compliance guidelines");
});

Deno.test("prompt_amendments: parseDraftSections extracts amendments from markdown", () => {
  const doc = `# TestQuest

## Original request
User prompt

## Amendments
- Drop MP3 support in favor of FLAC (MP3 decoder was removed in v0.2.0)
- Allow mono audio streams (mono stream was sanctioned in spec B1)

## Requirements
- R1: Player plays FLAC audio

## Evidence
- mods/player.c:10: init function
`;

  const sections = parseDraftSections(doc);
  check(sections.requirements.length === 1, "parsed 1 requirement");
  check((sections.amendments?.length ?? 0) === 2, "parsed 2 amendments");
  check(sections.amendments?.[0]?.includes("Drop MP3 support") ?? false, "first amendment text captured");
  check(sections.amendments?.[1]?.includes("Allow mono audio") ?? false, "second amendment text captured");
});

Deno.test("prompt_amendments: spliceAmendmentsSection replaces or appends amendments cleanly", () => {
  const doc = `# TestQuest

## Original request
User prompt

## Requirements
- R1: Player plays FLAC audio
`;

  const updated = spliceAmendmentsSection(doc, [
    "Use 48kHz sampling (DAC constraint in sound.c:42)",
  ]);
  check(updated.includes("## Amendments"), "amendments section inserted");
  check(updated.includes("Use 48kHz sampling"), "amendment bullet inserted");

  // Re-splicing replaces rather than duplicates
  const updatedAgain = spliceAmendmentsSection(updated, [
    "Use 96kHz sampling (Hardware revision 2)",
  ]);
  const sections = parseDraftSections(updatedAgain);
  check((sections.amendments?.length ?? 0) === 1, "exactly one amendment present after re-splice");
  check(sections.amendments?.[0]?.includes("96kHz") ?? false, "updated amendment present");
});

Deno.test("prompt_amendments: reviewMaterial unifies state.amendments and in-file amendments", () => {
  const baseQuest = createQuest("Test prompt", "xyz123");
  const questWithStateAmendment: QuestState = {
    ...baseQuest,
    amendments: [
      { change: "State amendment 1", reasons: "Hardware revision A" },
    ],
  };

  const sections = parseDraftSections(`## Amendments
- File amendment 2 (Repository constraint)
`);

  const mat = reviewMaterial(questWithStateAmendment, sections);
  check(mat.amendments.length === 2, "both state and file amendments included");
  check(mat.amendments.some((a) => a.includes("State amendment 1")), "has state amendment");
  check(mat.amendments.some((a) => a.includes("File amendment 2")), "has file amendment");
});

Deno.test("prompt_amendments: buildReviewPrompt mandates amendment validity checking in draft and validation", () => {
  const mat = {
    objective: "Add audio player",
    plan: "Implementation details",
    evidence: ["player.c:10"],
    amendments: ["Drop MP3 (Decoder absent)"],
  };

  const draftPrompt = buildReviewPrompt("draft", "tst123" as Qid, "plan", mat);
  check(draftPrompt.includes("AMENDMENT VALIDITY EVALUATION"), "draft guidance includes amendment validity evaluation");
  check(draftPrompt.includes("genuine, proven contradiction"), "mandates proving genuine contradiction");

  const valPrompt = buildReviewPrompt("validation", "tst123" as Qid, "plan", mat);
  check(valPrompt.includes("RECORDED AMENDMENTS"), "validation guidance checks recorded amendments");
  check(valPrompt.includes("contradiction"), "validation checks contradiction validity");
});

Deno.test("prompt_amendments: getReviewCriteriaSummary provides phase-specific checklist", () => {
  const draftPlan = getReviewCriteriaSummary("drafting", "standard");
  check(draftPlan.includes("Complete Coverage"), "draft plan criteria covers complete coverage");
  check(draftPlan.includes("Amendment Validity"), "draft plan criteria covers amendment validity");

  const valPlan = getReviewCriteriaSummary("implementing", "standard");
  check(valPlan.includes("Diff Completeness"), "validation plan criteria covers diff completeness");
  check(valPlan.includes("Zero Placeholders"), "validation plan criteria covers zero placeholders");
});

Deno.test("prompt_amendments: injectQuestContext includes compliance criteria in before_agent_start", () => {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const pi = fakePi();
  (pi as { on: unknown }).on = (event: string, handler: unknown) => {
    handlers.set(event, handler as (event: unknown, ctx: unknown) => unknown);
  };
  injectQuestContext(pi as unknown as Pi);

  // In drafting phase
  const drafting = createDraft(createQuest("work", "abc999"), "work");
  replaceState(drafting);
  const draftInjected = handlers.get("before_agent_start")!({}, fakeCtx("/tmp")) as
    | { message?: { content?: unknown } }
    | undefined;
  const draftContent = String(draftInjected?.message?.content ?? "");
  check(draftContent.includes("[Compliance Criteria]"), "drafting context contains compliance criteria");
  check(draftContent.includes("Complete Coverage"), "drafting context includes review rules");

  // In implementing phase
  const withPlan = {
    ...drafting,
    draft: { ...drafting.draft!, planAuthored: true },
  };
  const implementing = promote(withPlan, "review");
  replaceState(implementing);
  const impInjected = handlers.get("before_agent_start")!({}, fakeCtx("/tmp")) as
    | { message?: { content?: unknown } }
    | undefined;
  const impContent = String(impInjected?.message?.content ?? "");
  check(impContent.includes("[Compliance Criteria]"), "implementing context contains compliance criteria");
  check(impContent.includes("Zero Placeholders"), "implementing context includes validation rules");

  replaceState(IDLE_STATE);
});

Deno.test("prompt_amendments: appendFollowUpToDraft appends follow-up user prompt to draft file", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "quest_followup_test" });
  try {
    const qid = "flw123" as Qid;
    const ctx = fakeCtx(tmpDir);
    const draftRel = draftPath(qid);
    const fullDraft = join(tmpDir, draftRel);
    await mkdir(join(tmpDir, ".pi", "quest", "future"), { recursive: true });
    await Deno.writeTextFile(fullDraft, renderDraftTemplate("Test", "Initial prompt"));

    replaceState(createDraft(createQuest("Initial prompt", qid), "Test"));

    await appendFollowUpToDraft(ctx, qid, "Follow-up requirement: support 192kHz audio");

    const content = await Deno.readTextFile(fullDraft);
    check(content.includes("## Follow-up Requests"), "has follow-up requests section");
    check(content.includes("support 192kHz audio"), "contains the follow-up text");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    replaceState(IDLE_STATE);
  }
});

Deno.test("prompt_amendments: applyUpdate preserves kind on quest creation and syncs amendments to file", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "quest_update_test" });
  try {
    const ctx = fakeCtx(tmpDir);
    const pi = fakePi();
    replaceState(IDLE_STATE);

    // 1. Create analysis quest with kind: "analysis"
    const createRes = await applyUpdate(pi as unknown as Pi, ctx, {
      objective: "Analyze memory leak",
      kind: "analysis",
      draftName: "mem-leak-analysis",
    });
    check(!createRes.error, "creation succeeded without error");
    const state = getState();
    check(state.kind === "analysis", "quest kind is correctly preserved as analysis");

    // 2. Record amendment via applyUpdate
    const amendRes = await applyUpdate(pi as unknown as Pi, ctx, {
      amendment: {
        change: "Exclude third-party vendor leaks",
        reasons: "Vendor binary cannot be patched (vendor.so:12)",
      },
    });
    check(!amendRes.error, "amendment succeeded without error");
    check(getState().amendments.length === 1, "amendment recorded in state");

    const draftFile = join(tmpDir, draftPath(state.qid!));
    const content = await readFile(draftFile, "utf8");
    check(content.includes("## Amendments"), "draft file contains amendments header");
    check(content.includes("Exclude third-party vendor leaks"), "draft file contains the amendment text");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
    replaceState(IDLE_STATE);
  }
});
