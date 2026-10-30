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
    ctx.ui?.setStatus?.("auren-model", "🔌 off");
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
            if (cfg.judgeMode !== "off") {
              ctx.ui?.notify?.(`[pi-quest] ${formatRemediationToast(rep)}`, "warning");
            }
          }
        }

        if (cfg.embedMode === "off") return;
        if (cfg.embedUrl && !cfg.embedUrl.includes("4242")) return;
        const { ensureAuren, describeModelStatus } = await import("./auren-bootstrap");
        const confirmFn = ctx.ui ? (m: string) => ctx.ui!.confirm("pi-quest: local model", m) : undefined;
        const told = new Set<string>();
        const tell = (key: string, text: string, level: "info" | "warning" = "info") => {
          if (typeof ctx.ui?.notify !== "function" || told.has(key)) return;
          told.add(key);
          ctx.ui.notify(text, level);
        };
        void ensureAuren({
          cwd: ctx.cwd,
          settings: { autoStart: cfg.autoStartAuren, autoDownloadModels: cfg.autoDownloadModels },
          confirm: confirmFn,
          onUpdate: (st) => {
            const statusText = describeModelStatus(st);
            ctx.ui?.setStatus?.("auren-model", statusText);
            if (st.downloads.length > 0) {
              const dl = st.downloads[0];
              tell(`download:${dl.id}`, `[pi-quest] Downloading local embedding model "${dl.id}" for fast in-memory classification...`, "info");
            }
            if (st.running && st.activeModel) {
              tell(`active:${st.activeModel}`, `[pi-quest] Local model active: ${st.activeModel} (port 4242, in-memory classification)`, "info");
            }
            for (const n of st.notices) {
              if (n.code === "downloading") continue;
              tell(`${n.code}:${n.message}`, `[pi-quest] ${n.message} See: ${n.link}`, n.severity);
            }
          },
        });
      } catch {
        // Best effort background bring-up
      }
    })();
  });
}