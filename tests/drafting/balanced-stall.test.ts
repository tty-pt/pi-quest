// Regression: under reviewPolicy balanced/off a below-bar draft used to return
// silently — no subagent, no promotion, no message — leaving the quest stuck
// in drafting with the tool gate locked and the agent never told why.
import { check } from "../check.ts";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getState, replaceState, updateState } from "../../src/app/store.ts";
import { createQuest, IDLE_STATE } from "../../src/domain/quest.ts";
import { createDraft } from "../../src/domain/transitions.ts";
import type { Qid } from "../../src/domain/qid.ts";
import { draftPath } from "../../src/domain/paths.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";
import { DEFAULT_CONFIG } from "../../src/config.ts";
import { bootDraftReview } from "../../src/drafting/reviews.ts";
import { draftProfileText, hashContent, meetsReviewThresholds, parseDraftSections } from "../../src/drafting/plan-text.ts";
import { applyUpdate } from "../../src/surface/tools/update-state.ts";
import { parsePolicyRules } from "../../src/policy/effective.ts";

async function setup(qid: Qid, doc: string) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-quest-stall-"));
  replaceState(createDraft(createQuest("req", qid), "mat"));
  const file = join(cwd, draftPath(qid));
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, doc, "utf8");
  const target = hashContent(doc);
  updateState((s) => s.draft === null ? s : { ...s, draft: { ...s.draft, planAuthored: true, contentHash: target } });
  const pi = fakePi();
  pi.toolNames = ["subagent"];
  return { cwd, qid, target, pi };
}

function wakeTexts(pi: ReturnType<typeof fakePi>): string[] {
  return pi.sent.filter((m) => m.options?.triggerTurn === true).map((m) => String(m.message.content));
}

const BAL = { ...DEFAULT_CONFIG, reviewPolicy: "balanced" as const };

Deno.test("balanced: a below-bar draft is not silent — the agent is woken with what is missing", async () => {
  const doc = "## Requirements\n- R1: only one\n\n## Evidence\n- one\n\n## Implementation Plan\nR1: do it.\n";
  const d = await setup("stall01" as Qid, doc);
  try {
    await bootDraftReview(d.pi, fakeCtx(d.cwd), d.target, BAL);
    check(getState().phase === "drafting", "still drafting: bar not met");
    const wakes = wakeTexts(d.pi);
    check(wakes.length === 1, `exactly one wake, got ${wakes.length}`);
    check(wakes[0].includes("maturity bar NOT met"), "wake carries the draft profile");
    check(wakes[0].includes("balanced"), "wake names the policy");
    check(wakes[0].includes("go"), "wake mentions the live-user go override");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("off policy: below-bar draft also wakes the agent", async () => {
  const doc = "## Requirements\n- R1: only one\n\n## Implementation Plan\nR1: do it.\n";
  const d = await setup("stall02" as Qid, doc);
  try {
    await bootDraftReview(d.pi, fakeCtx(d.cwd), d.target, { ...DEFAULT_CONFIG, reviewPolicy: "off" as const });
    check(getState().phase === "drafting", "still drafting");
    check(wakeTexts(d.pi).some((t) => t.includes("policy 'off'")), "wake names policy off");
  } finally {
    replaceState(IDLE_STATE);
  }
});

// The shape that wedged quest 1xLO7I: Requirements/Evidence/Steps headings
// nested inside the plan text end the ## Implementation Plan section at once.
const NESTED = `## Requirements

<!-- placeholder -->

## Evidence

<!-- placeholder -->

## Implementation Plan

<!-- pi-quest: review-count 0 -->
## Requirements
- R1: first
- R2: second

## Evidence
- a
- b

## Steps
1. do R1
2. do R2
`;

Deno.test("a marker-only plan (headings nested in the plan) is not 'authored' and is reported", async () => {
  const sections = parseDraftSections(NESTED);
  check(!meetsReviewThresholds(sections, DEFAULT_CONFIG.draftThresholds, "standard"), "marker-only plan is below the bar");
  const profile = draftProfileText(sections, DEFAULT_CONFIG.draftThresholds, "", "standard", "standard");
  check(profile.includes("NOT met"), `profile must agree with the gate, got: ${profile}`);
  check(profile.includes("plan missing"), "marker-only plan counts as missing");

  const d = await setup("stall03" as Qid, NESTED);
  try {
    await bootDraftReview(d.pi, fakeCtx(d.cwd), d.target, BAL);
    check(getState().phase === "drafting", "not promoted");
    check(wakeTexts(d.pi).length === 1, "agent woken instead of silently stalled");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("profile agrees with the gate when requirements are not mapped into the plan", () => {
  const doc = "## Requirements\n- R1: a\n- R2: b\n\n## Implementation Plan\nDo something unrelated.\n";
  const sections = parseDraftSections(doc);
  check(!meetsReviewThresholds(sections, DEFAULT_CONFIG.draftThresholds, "standard"), "gate: R1/R2 unmapped");
  const profile = draftProfileText(sections, DEFAULT_CONFIG.draftThresholds, "", "standard", "standard");
  check(profile.includes("NOT met") && profile.includes("R1, R2"), `profile reports the same gap, got: ${profile}`);
});

Deno.test("a plan carrying its own ## headings is refused with an actionable error", async () => {
  const pi = fakePi();
  const ctx = fakeCtx(mkdtempSync(join(tmpdir(), "pi-quest-stall-")));
  try {
    const made = await applyUpdate(pi, ctx, { objective: "Build the thing." });
    check(made.error === undefined, "quest created");
    await applyUpdate(pi, ctx, { refinement: "looked around" });
    await applyUpdate(pi, ctx, { draftName: "thing" });
    const bad = await applyUpdate(pi, ctx, { plan: "## Requirements\n- R1: x\n\n## Steps\n1. do R1" });
    check(bad.error !== undefined && bad.error.includes("###"), `refused with ### hint, got ${bad.error}`);
    check(!bad.applied.includes("plan recorded in the draft file"), "nothing recorded");
    const good = await applyUpdate(pi, ctx, { plan: "### Steps\n1. do R1" });
    check(good.error === undefined, `### headings are fine, got ${good.error}`);
  } finally {
    replaceState(IDLE_STATE);
  }
});

// --- draftQuality + policyByModel integration -------------------------------

const SHALLOW = "## Requirements\n- R1: a\n- R2: b\n\n## Evidence\n- one\n\n## Implementation Plan\nR1: do it. R2: do it too.\n";

Deno.test("balanced: a count-bar-clearing but shallow draft is held with the quality gaps", async () => {
  const d = await setup("qual01" as Qid, SHALLOW);
  try {
    await bootDraftReview(d.pi, fakeCtx(d.cwd), d.target, BAL);
    check(getState().phase === "drafting", "shallow plan does not promote under balanced");
    const wakes = wakeTexts(d.pi);
    check(wakes.length === 1, `one wake, got ${wakes.length}`);
    check(wakes[0].includes("draft quality"), "wake carries the quality summary");
    check(wakes[0].includes("citations"), "wake names the citation gap");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("balanced + draftQuality warn: shallow draft promotes with an advisory", async () => {
  const d = await setup("qual02" as Qid, SHALLOW);
  try {
    const cfg = { ...BAL, draftQuality: { ...DEFAULT_CONFIG.draftQuality, mode: "warn" as const } };
    await bootDraftReview(d.pi, fakeCtx(d.cwd), d.target, cfg);
    check(getState().phase === "implementing", "warn mode does not block");
    check(wakeTexts(d.pi).some((t) => t.includes("quality advisory")), "advisory attached");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("policyByModel: strict base policy becomes balanced for a matching model", async () => {
  const d = await setup("qual03" as Qid, SHALLOW);
  try {
    const cfg = {
      ...DEFAULT_CONFIG,
      reviewPolicy: "strict" as const,
      draftQuality: { ...DEFAULT_CONFIG.draftQuality, mode: "off" as const },
      policyByModel: parsePolicyRules({ "anthropic/claude-sonnet-5*": "balanced" }),
    };
    const ctx = Object.assign(fakeCtx(d.cwd), { model: { provider: "anthropic", id: "claude-sonnet-5-5" } });
    await bootDraftReview(d.pi, ctx, d.target, cfg);
    check(getState().phase === "implementing", "bypass promoted: policy followed the model");
    const text = wakeTexts(d.pi).join("\n");
    check(text.includes("policyByModel"), "wake explains which rule applied");
  } finally {
    replaceState(IDLE_STATE);
  }
});

Deno.test("policyByModel: non-matching model keeps strict (no bypass, reviewer path)", async () => {
  const d = await setup("qual04" as Qid, SHALLOW);
  try {
    const cfg = {
      ...DEFAULT_CONFIG,
      reviewPolicy: "strict" as const,
      policyByModel: parsePolicyRules({ "anthropic/*": "balanced" }),
    };
    const ctx = Object.assign(fakeCtx(d.cwd), { model: { provider: "antigravity", id: "gemini-3.8-flash" } });
    d.pi.toolNames = [];
    await bootDraftReview(d.pi, ctx, d.target, cfg);
    check(getState().phase === "drafting", "strict: not promoted without a reviewer");
    check(!wakeTexts(d.pi).some((t) => t.includes("bypassed")), "no bypass wake");
  } finally {
    replaceState(IDLE_STATE);
  }
});
