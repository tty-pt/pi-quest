// HIGH_LEVEL: #tools (main agent) — quest_scratches.
// View active scratch workspace slots, assigned quests, and current activity.
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events";
import { findPrimaryRepoRoot } from "../../utils/git";
import { readQuestConfig } from "../../config";
import { inspectScratchSlots, formatSlotSummary } from "../../utils/git/pool-inspect";
import { getState } from "../../app/store";
import { textResult } from "./reply";

export function scratchesTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_scratches",
    label: "View Active Scratch Workspaces",
    get description(): string {
      const state = getState();
      const wt = state.worktreePath ?? state.contract?.worktreePath;
      return `Inspect scratch workspace slots (.pi/scratch/slot-N): view lease status, assigned quests, process health, git status, and what each quest is currently doing.${wt ? ` [Active worktree: ${wt}]` : ""}`;
    },
    parameters: {
      type: "object",
      properties: {
        slotId: {
          type: "string",
          description: "Optional slot ID filter (e.g. 'slot-1'). Omit to view all slots.",
        },
      },
      additionalProperties: false,
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx: PiCtx) => {
      const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
      const config = await readQuestConfig(ctx.cwd);
      const poolDir = config.gitWorkflow?.worktreePoolDir || ".pi/scratch";
      const slots = await inspectScratchSlots(primaryRoot, poolDir, pi);

      const targetSlot = typeof params["slotId"] === "string" ? params["slotId"].trim() : "";
      const filtered = targetSlot ? slots.filter((s) => s.slotId === targetSlot) : slots;

      if (targetSlot && filtered.length === 0) {
        return textResult(`Scratch slot '${targetSlot}' not found in ${poolDir}.`, { slots: [] });
      }

      const formatted = formatSlotSummary(filtered).join("\n");
      return textResult(formatted, { slots: filtered });
    },
  };
}
