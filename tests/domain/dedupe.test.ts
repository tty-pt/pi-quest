import { check, assertEquals } from "../check.ts";
import {
  countDuplicateBullets,
  dedupeDocBullets,
  hasDirective,
  normalizeDirective,
  requirementIdentity,
  uniqueDirectives,
} from "../../src/domain/dedupe.ts";
import { appendAmendmentToDoc, appendRequirementToDoc } from "../../src/domain/quest-doc.ts";
import { createQuest, recordAmendment, recordRefinement } from "../../src/domain/quest.ts";

const ASK = "I'll compact but you will forget your most important thoughts. Help me out by giving me a handoff prompt.";

// Modelled on .pi/quest/future/1xPSoJ.md (the duplication this module fixes).
const POLLUTED = [
  "# Quest 1xPSoJ",
  "",
  "## Amendments",
  "",
  `- ${ASK} (User mid-quest directive)`,
  `- ${ASK} (User mid-quest directive)`,
  `-   ${ASK.toUpperCase()}   (User mid-quest directive)`,
  "",
  "## Requirements",
  "",
  "- R1: render from the field",
  `- R7: [User Directive] ${ASK}`,
  `- R8: [User Directive] ${ASK}`,
  `- R9: ${ASK}`,
  "",
  "## Implementation Plan",
  "",
  `- ${ASK} (User mid-quest directive)`,
  "",
].join("\n");

Deno.test("normalizeDirective collapses whitespace and case only", () => {
  assertEquals(normalizeDirective("  Fix   The\tBug "), "fix the bug");
  check(normalizeDirective("fix the bug") !== normalizeDirective("fix the bugs"), "no fuzzy match");
});

Deno.test("hasDirective / uniqueDirectives keep first occurrence", () => {
  check(hasDirective(["Use UTF-8"], "  use utf-8 "), "normalized hit");
  check(!hasDirective(["Use UTF-8"], ""), "empty never matches");
  assertEquals(uniqueDirectives(["a", "A ", "b", " a"]), ["a", "b"]);
});

Deno.test("requirementIdentity ignores id, checkbox and directive tag", () => {
  const id = requirementIdentity("R1: Do the thing");
  assertEquals(requirementIdentity("[x] R9: [User Directive] do the  thing"), id);
  assertEquals(requirementIdentity("R12 - do the thing"), id);
});

Deno.test("dedupeDocBullets repairs a 1xPSoJ-style doc and leaves other sections alone", () => {
  const { text, removed } = dedupeDocBullets(POLLUTED);
  assertEquals(removed, 4);
  check(text.includes("- R7: [User Directive]"), "first requirement kept");
  check(!text.includes("- R8:") && !text.includes("- R9:"), "duplicate requirements removed");
  const amendmentSection = text.split("## Requirements")[0];
  assertEquals(amendmentSection.split("(User mid-quest directive)").length - 1, 1, "one amendment left");
  check(text.split("## Implementation Plan")[1].includes(ASK), "plan section untouched");
  assertEquals(dedupeDocBullets(text).removed, 0, "idempotent");
  assertEquals(countDuplicateBullets(POLLUTED), 4);
});

Deno.test("a checked duplicate upgrades the kept bullet", () => {
  const doc = "## Requirements\n- [ ] R1: ship\n- [x] R2: ship\n";
  const { text, removed } = dedupeDocBullets(doc);
  assertEquals(removed, 1);
  check(text.includes("- [x] R1: ship"), "kept bullet checked");
});

Deno.test("appendRequirementToDoc / appendAmendmentToDoc are idempotent", () => {
  const once = appendAmendmentToDoc(appendRequirementToDoc("# Q\n", ASK), ASK, "User mid-quest directive");
  const twice = appendAmendmentToDoc(appendRequirementToDoc(once, ASK), ASK, "User mid-quest directive");
  assertEquals(twice, once);
  check(once.includes("- R1: [User Directive]"), "first append numbered R1");
  const other = appendRequirementToDoc(once, "a different directive");
  check(other.includes("- R2: [User Directive] a different directive"), "distinct directive still appended");
});

Deno.test("recordAmendment / recordRefinement skip duplicates", () => {
  const base = { ...createQuest("x", "1xAAAA"), phase: "implementing" as const };
  const a = recordAmendment(recordAmendment(base, ASK, "r"), ` ${ASK} `, "r2");
  assertEquals(a.amendments.length, 1);
  const r = recordRefinement(recordRefinement(base, "use tabs"), "Use  tabs");
  assertEquals(r.refinements.length, 1);
  assertEquals(recordRefinement(r, "use spaces").refinements.length, 2);
});
