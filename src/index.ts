import { installDrafting } from "./drafting";
import { installImplementing } from "./implementing";
import { installValidation } from "./validation";
import { installSubQuests } from "./subquests";
import { installHumanAbsence } from "./absence";
import { installDurability } from "./durability";
import { installSurface } from "./surface";
import { installRouter } from "./router/virtual-model";
import { onSessionStart, type Pi } from "./hooks/events";
import { resetNoticedReviews } from "./review/flow";
import { resetAnnouncements } from "./validation/flow";
import { normalizeKey } from "./views/plan-keys";
import { viewActivePlan } from "./surface/commands/plan";

export default function install(pi: Pi): void {
  installDrafting(pi);
  installImplementing(pi);
  installValidation(pi);
  installSubQuests(pi);
  installHumanAbsence(pi);
  installDurability(pi);
  installSurface(pi);
  installRouter(pi);
  // HIGH_LEVEL: #independent review contexts — fresh-session bookkeeping; a
  // stale "Review running" marker must never suppress a notice or a retry.
  onSessionStart(pi, (_e, ctx) => {
    resetNoticedReviews();
    resetAnnouncements();
    ctx.ui?.setStatus?.("quest-judge", undefined);
    if (typeof ctx.ui?.onTerminalInput === "function") {
      ctx.ui.onTerminalInput((data: string) => {
        if (normalizeKey(data) !== "ctrlQ") return undefined;
        void viewActivePlan(ctx);
        return { consume: true };
      });
    }

    // Zero-config axil-auren daemon auto-start & download + proactive dependency check
    void (async () => {
      try {
        const { readQuestConfig } = await import("./config");
        const cfg = await readQuestConfig(ctx.cwd);

        // Core C Engine dependency check for proactive user guidance
        const { checkAllEngineVersions, formatRemediationToast } = await import("./versions");
        const engineReports = checkAllEngineVersions({ cwd: ctx.cwd });
        for (const rep of engineReports) {
          if (rep.name === "axil-auren" && (rep.status === "missing" || rep.status === "outdated")) {
            if (cfg.judgeMode !== "off" && cfg.judgeMode !== "heuristic") {
              ctx.ui?.notify?.(`[pi-quest] ${formatRemediationToast(rep)}`, "warning");
            }
          }
        }

        if (cfg.judgeMode === "off" || cfg.judgeMode === "heuristic") return;
        if (cfg.judgeUrl && !cfg.judgeUrl.includes("4242")) return;
        const { ensureAuren } = await import("./auren-bootstrap");
        const confirmFn = ctx.ui ? (m: string) => ctx.ui!.confirm("pi-quest: local model", m) : undefined;
        const told = new Set<string>();
        void ensureAuren({
          cwd: ctx.cwd,
          settings: { autoStart: cfg.autoStartAuren, autoDownloadModels: cfg.autoDownloadModels },
          confirm: confirmFn,
          onUpdate: (st) => {
            if (typeof ctx.ui?.notify === "function") {
              for (const n of st.notices) {
                if (n.code === "downloading") continue;
                const k = `${n.code}:${n.message}`;
                if (told.has(k)) continue;
                told.add(k);
                ctx.ui.notify(`[pi-quest] ${n.message} See: ${n.link}`, n.severity);
              }
            }
          },
        });
      } catch {
        // Best effort background bring-up
      }
    })();
  });
}