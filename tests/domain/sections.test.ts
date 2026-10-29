import { check } from "../check.ts";
import { isHeading, sectionKeyOf } from "../../src/domain/sections.ts";

Deno.test("section headings match by title prefix at a word boundary, not by contained word", () => {
  check(sectionKeyOf("Requirements") === "requirements", "exact");
  check(sectionKeyOf("Implementation Plan — concrete redesign") === "plan", "suffixed plan");
  check(sectionKeyOf("Evidence (file-backed)") === "evidence", "parenthetical suffix");
  check(sectionKeyOf("Findings (pre-draft investigation)") === "predraft", "pre-draft findings");
  check(sectionKeyOf("Sub-Quests") === "subquests" && sectionKeyOf("Subquests") === "subquests", "sub-quests spellings");
  check(sectionKeyOf("Evidence requirements") === "evidence", "contained word does not win");
  check(sectionKeyOf("Notes on requirements") === null, "buried word is not a section");
  check(sectionKeyOf("Analysisparalysis") === null, "no mid-word match");
  check(isHeading("## Follow-up Requests", "followups"), "followups heading");
  check(!isHeading("### Requirements", "requirements"), "only ## headings");
});
