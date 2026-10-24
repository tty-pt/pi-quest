// HIGH_LEVEL: #commands — three manual handles.
import type { Pi } from "../../hooks/events";
import { killQuest } from "./quest-del";
import { listQuests } from "./quests";
import { viewActivePlan, editActivePlan } from "./plan";
import { pickQuest } from "./pick";
import { resumeQuest } from "./quest";
import { runQuestDoctor, getQuestDoctorLines, createQuestDoctorComponent, type QuestDoctorData } from "./doctor";
import { refreshStatus } from "../../durability/status";

function notify(ctx: { ui: { notify: (m: string, t: "info" | "warning" | "error") => void } }, text: string): void {
  try {
    ctx.ui.notify(text, "info");
  } catch {
    // Notification is best-effort.
  }
}

export function installCommands(pi: Pi): void {
  const extApi = pi as unknown as {
    registerEntryRenderer?: (type: string, renderer: unknown) => void;
    appendEntry?: (type: string, data: unknown) => void;
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

  pi.registerCommand("quest", {
    description: "Resume a quest or drafting phase, show the active quest, or run 'doctor'.",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed === "doctor") {
        const lines = await getQuestDoctorLines(ctx);
        if (typeof extApi.appendEntry === "function") {
          extApi.appendEntry("quest-doctor", { lines });
        } else {
          notify(ctx, lines.join("\n"));
        }
        return;
      }
      const out = trimmed === "" ? await pickQuest(pi, ctx) : await resumeQuest(pi, ctx, trimmed);
      refreshStatus(ctx);
      notify(ctx, out);
    },
  });
  pi.registerCommand("quest-doctor", {
    description: "Check judge endpoint health, latency, models, and trigger word families.",
    handler: async (_args, ctx) => {
      const lines = await getQuestDoctorLines(ctx);
      if (typeof extApi.appendEntry === "function") {
        extApi.appendEntry("quest-doctor", { lines });
      } else {
        notify(ctx, lines.join("\n"));
      }
    },
  });
  pi.registerCommand("quests", {
    description: "List all quests with their states and the active marker.",
    handler: async (_args, ctx) => {
      const rows = await listQuests(ctx);
      try {
        ctx.ui.setWidget("quest", rows);
      } catch {
        // Widget is best-effort.
      }
      refreshStatus(ctx);
    },
  });
  pi.registerCommand("quest-del", {
    description: "Archive (kill) the current or named quest.",
    handler: async (args, ctx) => {
      const out = await killQuest(pi, ctx, args);
      refreshStatus(ctx);
      notify(ctx, out);
    },
  });
}
