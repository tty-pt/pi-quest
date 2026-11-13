import { parseDraftSections, spliceAssumptionsSection } from "../../src/drafting/plan-text.ts";
import { renderDraftTemplate } from "../../src/views/draft-template.ts";

function check(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`CHECK FAILED: ${msg}`);
}

Deno.test("assumptions: parseDraftSections extracts assumptions from markdown", () => {
  const doc = `# TestQuest

## Original request
Fix the map renderer

## Requirements
- R1: Render lakes cleanly

## Evidence
- src/render.c:10: ground pass

## Assumptions & Falsification Criteria
- [A1] LOD 1 elevation matches LOD 0 elevation. Falsified if elevation divergence exceeds 0.1.
- [A2] Texture atlas contains mipmaps. Falsified if glGetTexLevelParameteriv returns 0 width.

## Implementation Plan
1. Check elevation tables.
`;

  const sections = parseDraftSections(doc);
  check(sections.requirements.length === 1, "parsed 1 requirement");
  check((sections.assumptions?.length ?? 0) === 2, "parsed 2 assumptions");
  check(sections.assumptions?.[0]?.includes("[A1]") ?? false, "first assumption parsed");
  check(sections.assumptions?.[1]?.includes("[A2]") ?? false, "second assumption parsed");
});

Deno.test("assumptions: spliceAssumptionsSection updates or appends assumptions", () => {
  const initial = `# Test\n\n## Requirements\n- R1: Fix\n\n## Implementation Plan\nDo fix\n`;
  const spliced = spliceAssumptionsSection(initial, ["[A1] DB is online", "[A2] Port 8080 open"]);
  check(spliced.includes("## Assumptions & Falsification Criteria"), "heading spliced");
  check(spliced.includes("- [A1] DB is online"), "first assumption spliced");
  check(spliced.includes("- [A2] Port 8080 open"), "second assumption spliced");

  const sections = parseDraftSections(spliced);
  check(sections.assumptions?.length === 2, "re-parsed spliced assumptions");
});

Deno.test("assumptions: renderDraftTemplate scaffolds Assumptions section", () => {
  const rendered = renderDraftTemplate("TestQuest", "Implement audio subsystem");
  check(rendered.includes("## Assumptions & Falsification Criteria"), "scaffolds assumptions section");
  check(rendered.includes("falsification condition"), "includes guidance on falsification");
});
