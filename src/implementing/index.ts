// HIGH_LEVEL: #modes
// HIGH_LEVEL: #implementing — unrestricted by construction.
// HIGH_LEVEL: #plan revision — planRevision stages a re-reviewable revision; approval adopts.
// SPEC: B1.4, B1.7 (advisory setbacks), B1.8 (amendments).
import { dispatch, getState } from "../app/store";
import { sendSteer } from "../app/interpreter";
import { onToolResult, type Pi } from "../hooks/events";
import { detectSetback } from "./setbacks";
import { watchApproveInput, watchPlanRevisionCatchAll, watchPlanRevisionResume } from "./plan-revision";

export function installImplementing(pi: Pi): void {
  watchApproveInput(pi);
  watchPlanRevisionCatchAll(pi);
  watchPlanRevisionResume(pi);
  onToolResult(pi, (event) => {
    try {
      if (getState().disabled === true || getState().phase !== "implementing") return;
      const hit = detectSetback(event);
      if (!hit) return;
      const { effects } = dispatch({
        type: "SetbackRecorded",
        reason: hit.reason,
        evidence: hit.evidence,
        isTest: hit.isTest,
      });
      for (const eff of effects) {
        if (eff.kind === "Steer") sendSteer(pi, eff.text);
      }
    } catch {
      // Passive handler: never break the agent.
    }
  });
}
