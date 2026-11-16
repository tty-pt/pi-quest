// HIGH_LEVEL: #tools (main agent) — quest_handoff.
// HIGH_LEVEL: #surviving — an honest handoff for the next agent on demand.
import type { HandoffReason } from "../../domain/handoff";
import { resolveHandoffState, writeHandoff, type WrittenHandoff } from "../../durability/handoff-io";
import type { Pi, PiCtx, PiToolSpec } from "../../hooks/events";
import { textResult } from "./reply";

/** Write a handoff for `qid` (default active). Returns null when no such quest exists. */
export async function produceHandoff(
  pi: Pi,
  ctx: PiCtx,
  qid: string | undefined,
  reason: HandoffReason,
  notes?: string,
): Promise<WrittenHandoff | null> {
  const state = await resolveHandoffState(ctx, qid);
  if (state === null) return null;
  return await writeHandoff(pi, ctx, state, reason, notes);
}

export function handoffTool(pi: Pi): PiToolSpec {
  return {
    name: "quest_handoff",
    label: "Quest Handoff",
    description:
      "Write an honest, self-contained handoff document for the next agent: verbatim operator request and every directive, " +
      "asked-vs-accomplished requirement table (anything without recorded evidence is UNVERIFIED), approved plan, files touched + diff stat, " +
      "last test/review, blockers, exact next action. Saved to .pi/quest/handoffs/<qid>-<stamp>.md and returned in full. " +
      "Pass `notes` with everything you know that the quest state cannot: root causes found, dead ends tried, hypotheses, gotchas, exact commands. " +
      "Use it whenever the operator asks for a handoff/summary for a new agent or before context is lost. Allowed in every phase.",
    parameters: {
      type: "object",
      properties: {
        qid: { type: "string", description: "Quest id. Defaults to the active quest." },
        notes: {
          type: "string",
          description: "Agent knowledge not in quest state: root causes, failed approaches, hypotheses, gotchas, commands. Be exhaustive.",
        },
      },
      additionalProperties: false,
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const qid = typeof params["qid"] === "string" ? params["qid"] : undefined;
      const notes = typeof params["notes"] === "string" ? params["notes"] : undefined;
      try {
        const done = await produceHandoff(pi, ctx, qid, "agent", notes);
        if (done === null) return textResult(`No quest found${qid ? ` for ${qid}` : " (none active)"}; nothing to hand off.`);
        return textResult(
          `Handoff for quest ${done.qid} written to ${done.relPath}. Present it to the operator verbatim (it is self-contained).\n\n${done.content}`,
          { qid: done.qid, path: done.relPath },
        );
      } catch (err) {
        return textResult(`Handoff failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
