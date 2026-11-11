// HIGH_LEVEL: #commands — unified /quest command handle.
import type { Pi, PiCtx } from "../../hooks/events";
import { finishQuestOrSlot, killQuest, startNewQuestInSlot } from "./quest-del";
import { listQuests } from "./quests";
import { editActivePlan } from "./plan";
import { pickQuest } from "./pick";
import { formatQuestCard, listDraftQids, readDraftHeading, resumeQuest, toggleQuestDisabled } from "./quest";
import { getQuestDoctorLines, createQuestDoctorComponent, type QuestDoctorData } from "./doctor";
import { getRouterStatusLines } from "./router";
import { getPolicyStatusLines } from "./policy";
import { getRatingsStatusLines } from "./ratings";
import { refreshStatus } from "../../durability/status";
import { hasInFlight, cancelReview } from "../../review/tracker";
import { clearPlanRevisionRetries } from "../../implementing/plan-revision";
import { clearDraftReviewRetry } from "../../drafting/reviews";
import { getState } from "../../app/store";
import { runContinuitySubcommand } from "./continuity";
import { findPrimaryRepoRoot } from "../../utils/git";
import { readQuestConfig } from "../../config";
import { inspectScratchSlots, formatSlotSummary } from "../../utils/git/pool-inspect";

export async function getScratchesLines(ctx: PiCtx, pi?: Pi): Promise<string[]> {
  const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
  const config = await readQuestConfig(ctx.cwd);
  const poolDir = config.gitWorkflow?.worktreePoolDir || ".pi/scratch";
  const slots = await inspectScratchSlots(primaryRoot, poolDir, pi);
  return formatSlotSummary(slots);
}

export function cancelActiveReview(_ctx?: { ui?: { notify?: (m: string, t: "info" | "warning" | "error") => void } }): string {
  const state = getState();
  const qid = state.qid;
  if (qid === null) return "No active quest.";
  if (!hasInFlight(qid)) {
    return `No review currently in-flight for quest ${qid}.`;
  }
  cancelReview(qid);
  clearPlanRevisionRetries(qid);
  clearDraftReviewRetry(qid);
  return `Cancelled in-flight review for quest ${qid}. Tool operations unblocked.`;
}

function notify(ctx: { ui: { notify: (m: string, t: "info" | "warning" | "error") => void } }, text: string): void {
  try {
    ctx.ui.notify(text, "info");
  } catch {
    // Notification is best-effort.
  }
}

const SUBCOMMAND_COMPLETIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "edit", label: "edit — Open active quest plan in $EDITOR" },
  { value: "list", label: "list — List active & draft quests with triage info" },
  { value: "pick", label: "pick — Interactively select a quest to resume" },
  { value: "new", label: "new — Start a new quest on the current scratch slot (/quest new [goal])" },
  { value: "finish", label: "finish — Finish/integrate active quest or retained scratch slot (/quest finish [--keep-slot])" },
  { value: "pause", label: "pause — Pause pi-quest for this session" },
  { value: "on", label: "on — Re-enable pi-quest for this session (/quest on [goal])" },
  { value: "toggle", label: "toggle — Toggle pi-quest on or off for this session (Alt+Q)" },
  { value: "cancel", label: "cancel — Cancel in-flight review and unblock tools" },
  { value: "del", label: "del — Delete quest (--keep-slot|-s) or prune drafts (--stale|--empty|--orphans|--all)" },
  { value: "handoff", label: "handoff — Write and show handoff document" },
  { value: "slots", label: "slots — Inspect scratch worktree slots" },
  { value: "doctor", label: "doctor — Check judge, models & engine versions" },
  { value: "policy", label: "policy — Inspect effective review policy & quality bar" },
  { value: "router", label: "router — Inspect phase × difficulty model router" },
  { value: "ratings", label: "ratings — Inspect model accuracy ratings & autonomy" },
];

export async function getQuestCompletions(
  prefix: string,
  cwd: string = process.cwd(),
): Promise<Array<{ value: string; label: string }>> {
  const lower = prefix.trim().toLowerCase();
  const items: Array<{ value: string; label: string }> = [];
  for (const sub of SUBCOMMAND_COMPLETIONS) {
    if (lower === "" || sub.value.startsWith(lower)) {
      items.push(sub);
    }
  }
  try {
    const qids = await listDraftQids(cwd);
    for (const qid of qids) {
      const heading = await readDraftHeading(cwd, qid);
      const display = heading && heading !== qid ? `${heading} (${qid})` : qid;
      const val = heading && heading !== qid && !/\s/.test(heading) ? heading : qid;
      if (
        lower === "" ||
        qid.toLowerCase().startsWith(lower) ||
        (heading && heading.toLowerCase().includes(lower))
      ) {
        items.push({ value: val, label: `${display} — Resume quest` });
      }
    }
  } catch { /* best effort */ }
  return items;
}

function registerDoctorRenderer(pi: Pi): void {
  const extApi = pi as unknown as {
    registerEntryRenderer?: (type: string, renderer: unknown) => void;
  };
  if (typeof extApi.registerEntryRenderer === "function") {
    extApi.registerEntryRenderer(
      "quest-doctor",
      (entry: { data?: QuestDoctorData }, _options: unknown, theme: unknown) => {
        const data = entry?.data ?? { lines: [] };
        return createQuestDoctorComponent(data, theme as Parameters<typeof createQuestDoctorComponent>[1]);
      },
    );
  }
}

async function handleDoctor(pi: Pi, ctx: PiCtx): Promise<void> {
  const extApi = pi as unknown as { appendEntry?: (type: string, data: unknown) => void };
  const lines = await getQuestDoctorLines(ctx);
  if (typeof extApi.appendEntry === "function") {
    extApi.appendEntry("quest-doctor", { lines });
  } else {
    notify(ctx, lines.join("\n"));
  }
}

async function handleBareQuest(pi: Pi, ctx: PiCtx): Promise<void> {
  if (getState().qid === null && !getState().disabled) {
    const candidates = await listDraftQids(ctx.cwd);
    if (candidates.length === 1) {
      const adopted = await pickQuest(pi, ctx);
      refreshStatus(ctx);
      notify(ctx, `${adopted}\n\n${formatQuestCard(ctx.cwd)}`);
      return;
    }
  }
  refreshStatus(ctx);
  notify(ctx, formatQuestCard(ctx.cwd));
}

async function handleInspectSubcommand(pi: Pi, ctx: PiCtx, head: string): Promise<boolean> {
  if (head === "doctor") {
    await handleDoctor(pi, ctx);
    return true;
  }
  if (head === "policy") {
    notify(ctx, (await getPolicyStatusLines(ctx)).join("\n"));
    return true;
  }
  if (head === "router") {
    notify(ctx, (await getRouterStatusLines(ctx)).join("\n"));
    return true;
  }
  if (head === "ratings") {
    notify(ctx, (await getRatingsStatusLines(ctx)).join("\n"));
    return true;
  }
  if (head === "slots" || head === "scratches") {
    notify(ctx, (await getScratchesLines(ctx, pi)).join("\n"));
    return true;
  }
  return false;
}

const SUBCOMMAND_HANDLERS: Record<
  string,
  (pi: Pi, ctx: PiCtx, rest: string) => Promise<string | void>
> = {
  edit: async (pi, ctx) => { await editActivePlan(pi, ctx); },
  plan: async (pi, ctx) => { await editActivePlan(pi, ctx); },
  list: async (_pi, ctx) => {
    const rows = await listQuests(ctx);
    try { ctx.ui.setWidget("quest", undefined); } catch { /* best effort */ }
    return rows.join("\n");
  },
  ls: (pi, ctx, r) => SUBCOMMAND_HANDLERS.list(pi, ctx, r),
  quests: (pi, ctx, r) => SUBCOMMAND_HANDLERS.list(pi, ctx, r),
  pick: (pi, ctx) => pickQuest(pi, ctx),
  switch: (pi, ctx) => pickQuest(pi, ctx),
  new: (pi, ctx, rest) => startNewQuestInSlot(pi, ctx, rest),
  chain: (pi, ctx, rest) => startNewQuestInSlot(pi, ctx, rest),
  next: (pi, ctx, rest) => startNewQuestInSlot(pi, ctx, rest),
  finish: (pi, ctx, rest) => finishQuestOrSlot(pi, ctx, rest),
  merge: (pi, ctx, rest) => finishQuestOrSlot(pi, ctx, rest),
  integrate: (pi, ctx, rest) => finishQuestOrSlot(pi, ctx, rest),
  pause: (pi, ctx) => toggleQuestDisabled(pi, ctx, true),
  off: (pi, ctx) => toggleQuestDisabled(pi, ctx, true),
  disable: (pi, ctx) => toggleQuestDisabled(pi, ctx, true),
  on: (pi, ctx, rest) => toggleQuestDisabled(pi, ctx, false, rest),
  enable: (pi, ctx, rest) => toggleQuestDisabled(pi, ctx, false, rest),
  toggle: (pi, ctx) => toggleQuestDisabled(pi, ctx, !getState().disabled),
  cancel: (_pi, ctx) => Promise.resolve(cancelActiveReview(ctx)),
  "cancel-review": (_pi, ctx) => Promise.resolve(cancelActiveReview(ctx)),
  del: (pi, ctx, rest) => killQuest(pi, ctx, rest),
  delete: (pi, ctx, rest) => killQuest(pi, ctx, rest),
  drop: (pi, ctx, rest) => killQuest(pi, ctx, rest),
  kill: (pi, ctx, rest) => killQuest(pi, ctx, rest),
};

async function handleUnifiedQuestCommand(pi: Pi, args: string, ctx: PiCtx): Promise<void> {
  const trimmed = args.trim();
  if (trimmed === "") {
    await handleBareQuest(pi, ctx);
    return;
  }

  const [headRaw, ...restParts] = trimmed.split(/\s+/);
  const head = headRaw.toLowerCase();
  const rest = restParts.join(" ").trim();

  const subHandler = SUBCOMMAND_HANDLERS[head];
  if (subHandler) {
    const out = await subHandler(pi, ctx, rest);
    refreshStatus(ctx);
    if (typeof out === "string") notify(ctx, out);
    return;
  }

  if (await handleInspectSubcommand(pi, ctx, head)) return;
  if (await runContinuitySubcommand(pi, ctx, trimmed)) return;

  const resumeTarget = head === "resume" && rest !== "" ? rest : trimmed;
  const out = await resumeQuest(pi, ctx, resumeTarget);
  refreshStatus(ctx);
  notify(ctx, out);
}

export function installCommands(pi: Pi): void {
  registerDoctorRenderer(pi);

  const spec = {
    description: "Manage quests: /quest [edit|list|pick|new|pause|on|toggle|cancel|del|handoff|slots|doctor|policy|router|ratings|<name|qid>]",
    getArgumentCompletions: (prefix: string) => getQuestCompletions(prefix),
    handler: async (args: string, ctx: PiCtx) => {
      await handleUnifiedQuestCommand(pi, args, ctx);
    },
  };

  pi.registerCommand("quest", spec);

  if (typeof pi.registerShortcut === "function") {
    pi.registerShortcut("alt+q", {
      description: "Toggle pi-quest on or off for this session (/quest on | /quest off)",
      handler: async (ctx: PiCtx) => {
        const out = await toggleQuestDisabled(pi, ctx, !getState().disabled);
        refreshStatus(ctx);
        notify(ctx, out);
      },
    });
  }
}
