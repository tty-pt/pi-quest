// HIGH_LEVEL: #plan revision — save-time citation spot check.
// Pure-enough disk probe for the agent's plan writes: every file:line the
// plan cites must resolve, so a save surfaces drift before a review spends
// minutes re-deriving facts the plan got wrong.
import type { PiCtx } from "../../hooks/events";
import { resolveCitations } from "../../drafting/citations";

export async function checkPlanCitations(ctx: PiCtx, planText: string): Promise<string> {
  const report = await resolveCitations(ctx.cwd, planText);
  if (report.total === 0) return "";
  if (report.problems.length === 0) return `claims check: ${report.total} citations resolve`;
  const shown = report.problems.slice(0, 8).join("; ");
  const more = report.problems.length > 8 ? ` (+${report.problems.length - 8} more)` : "";
  return `claims check: ${report.resolved}/${report.total} citations resolve — verify: ${shown}${more}`;
}
