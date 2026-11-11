import { check } from "../check.ts";
import { extractRtmFromRequirements } from "../../src/drafting/plan-text.ts";
import { extractInitialRequirements, renderDraftTemplate } from "../../src/views/draft-template.ts";
import { checkRtmCoverage } from "../../src/domain/contract.ts";

Deno.test("extractRtmFromRequirements: normalizes unlabelled markdown bullets to sequential R1, R2, ...", () => {
  const bullets = [
    "Support UTF-8 encoding in song.c",
    "Add regression test cases for multibyte strings",
  ];
  const rtm = extractRtmFromRequirements(bullets);
  check(rtm.length === 2, "extracted 2 rtm items");
  check(rtm[0].id === "R1", "first bullet normalized to R1");
  check(rtm[0].description === "Support UTF-8 encoding in song.c", "first description preserved");
  check(rtm[0].explicit === false, "marked as not explicit");
  check(rtm[1].id === "R2", "second bullet normalized to R2");
  check(rtm[1].description === "Add regression test cases for multibyte strings", "second description preserved");
  check(rtm[1].explicit === false, "marked as not explicit");
});

Deno.test("checkRtmCoverage: disallows empty RTM when requirements exist", () => {
  const result = checkRtmCoverage([], "plan body", 2);
  check(result.covered === false, "empty RTM with requirementsCount > 0 is not covered");
  check(result.missing.includes("requirements"), "missing contains requirements");
});

Deno.test("checkRtmCoverage: disallows empty plan when RTM items exist", () => {
  const rtm = [{ id: "R1", description: "do something", status: "pending" as const }];
  const result = checkRtmCoverage(rtm, "");
  check(result.covered === false, "empty plan is not covered");
  check(result.missing.includes("R1"), "missing contains R1");
});

Deno.test("extractRtmFromRequirements: extracts explicit R1, R2, and bracketed [R1] labels", () => {
  const bullets = [
    "R1: Support UTF-8 encoding in song.c",
    "[R2]: Add regression test cases for multibyte strings",
  ];
  const rtm = extractRtmFromRequirements(bullets);
  check(rtm.length === 2, "extracted 2 rtm items");
  check(rtm[0].id === "R1", "first bullet is R1");
  check(rtm[0].description === "Support UTF-8 encoding in song.c", "first description preserved");
  check(rtm[1].id === "R2", "second bullet is R2");
  check(rtm[1].description === "Add regression test cases for multibyte strings", "second description preserved");
});

Deno.test("extractRtmFromRequirements: preserves explicit multi-digit R-labels", () => {
  const bullets = [
    "R10: Explicit requirement 10",
    "R20: Explicit requirement 20",
  ];
  const rtm = extractRtmFromRequirements(bullets);
  check(rtm.length === 2, "extracted 2 items");
  check(rtm[0].id === "R10", "R10 preserved");
  check(rtm[1].id === "R20", "R20 preserved");
});

Deno.test("extractInitialRequirements: extracts bullet items from structured prompt", () => {
  const prompt = `We need the following fixes:
- Fix parser leak in song.c
- Add unit test in test/song.test.ts
- Update documentation in README.md`;

  const reqs = extractInitialRequirements(prompt);
  check(reqs.length === 3, `extracted 3 initial requirements, got ${reqs.length}`);
  check(reqs[0].includes("R1: Fix parser leak in song.c"), "first bullet formatted");
  check(reqs[1].includes("R2: Add unit test in test/song.test.ts"), "second bullet formatted");
  check(reqs[2].includes("R3: Update documentation in README.md"), "third bullet formatted");
});

Deno.test("renderDraftTemplate: pre-populates requirements section when prompt has bullets", () => {
  const prompt = `Fix bugs:
1. Fix null dereference in song.c
2. Add assertion in tests`;
  const rendered = renderDraftTemplate("TestQuest", prompt);
  check(rendered.includes("- R1: Fix null dereference in song.c"), "R1 pre-populated in template");
  check(rendered.includes("- R2: Add assertion in tests"), "R2 pre-populated in template");
});

