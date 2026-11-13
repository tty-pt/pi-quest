import { isPlanDump, askHumanTool } from "../../src/surface/tools/ask-human.ts";
import { fakeCtx, fakePi } from "../fake-pi.ts";

function check(condition: boolean, msg: string): void {
  if (!condition) throw new Error(`CHECK FAILED: ${msg}`);
}

Deno.test("isPlanDump: correctly distinguishes concise questions from plan dumps", () => {
  check(!isPlanDump("Do you approve the implementation plan?"), "concise approval question is not a plan dump");
  check(!isPlanDump("Ready to begin implementation?"), "short question is not a plan dump");
  check(!isPlanDump("Which approach do you prefer: option A or option B?"), "options question is not a plan dump");

  // Plan dumps with markdown headings
  check(isPlanDump("## Implementation Plan\n1. Modify src/foo.c\n2. Run tests\n\nApprove?"), "markdown implementation plan is a plan dump");
  check(isPlanDump("## Requirements\n- R1: test\n## Plan\n1. Step"), "plan with requirements heading is a plan dump");

  // Long text with phased steps
  const longPhasedDump = "Here is the plan:\n" +
    "Phase 1: Architecture review and refactoring of ground rendering module in mods/nd/ux/nd_seven_ground.c\n" +
    "Phase 2: Add elevation matching tables across LOD levels\n" +
    "Phase 3: Run comprehensive verification suites and ensure zero artifacts.\n" +
    "Do you approve this plan?";
  check(isPlanDump(longPhasedDump), "long phased text is recognized as a plan dump");
});

Deno.test("askHumanTool: rejects plan dump with actionable instructions", async () => {
  const pi = fakePi();
  const tool = askHumanTool(pi);
  const ctx = fakeCtx("/tmp");

  const planDump = "## Implementation Plan\n1. Edit files\n2. Verify tests";
  const result = await tool.execute("call1", { question: planDump, default: "proceed" }, undefined, undefined, ctx);

  const details = result.details as Record<string, unknown> | undefined;
  check(details?.["error"] === "plan_in_question", "tool rejected plan dump");
  const text = result.content[0].text ?? "";
  check(text.includes("Do not put the implementation plan"), "rejection guides agent to not put plan in question");
  check(text.includes("output your quest analysis in your response message"), "rejection instructs agent to write analysis in chat");
});
