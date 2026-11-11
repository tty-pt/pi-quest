import { installDrafting } from "./drafting";
import { installImplementing } from "./implementing";
import { installValidation } from "./validation";
import { installSubQuests } from "./subquests";
import { installHumanAbsence } from "./absence";
import { installDurability } from "./durability";
import { installSurface } from "./surface";
import { installRouter } from "./router/virtual-model";
import { installToolInterception } from "./surface/tools/handlers/interception";
import { onSessionStart, type Pi } from "./hooks/events";
import { resetNoticedReviews } from "./review/flow";
import { resetAnnouncements } from "./validation/flow";

export default function install(pi: Pi): void {
  installDrafting(pi);
  installImplementing(pi);
  installValidation(pi);
  installSubQuests(pi);
  installHumanAbsence(pi);
  installDurability(pi);
  installSurface(pi);
  installRouter(pi);
  installToolInterception(pi);
  // HIGH_LEVEL: #independent review contexts — fresh-session bookkeeping; a
  // stale "Review running" marker must never suppress a notice or a retry.
  onSessionStart(pi, (_e, ctx) => {
    resetNoticedReviews();
    resetAnnouncements();

    // Proactive engine dependency check and worktree pool audit
    void (async () => {
      try {
        const { readQuestConfig } = await import("./config");
        const cfg = await readQuestConfig(ctx.cwd);
        const { getState, updateState } = await import("./app/store");
        const curr = getState();

        // Core C Engine dependency check for proactive user guidance (only when pi-quest is active)
        if (!curr.disabled && cfg.judgeMode !== "off") {
          const { checkAllEngineVersions, formatRemediationToast } = await import("./versions");
          const engineReports = checkAllEngineVersions({ cwd: ctx.cwd });
          for (const rep of engineReports) {
            if (rep.name === "axil-auren" && (rep.status === "missing" || rep.status === "outdated")) {
              ctx.ui?.notify?.(`[pi-quest] ${formatRemediationToast(rep)}`, "warning");
            }
          }
        }

        // Reclaim stale scratch workspace leases from dead processes or completed quests,
        // and re-attach active in-flight quests if their worktree was lost across restart.
        try {
          const { findPrimaryRepoRoot, auditAndReclaimPool, ensureQuestWorktreeAttached } = await import("./utils/git");
          const primaryRoot = findPrimaryRepoRoot(ctx.cwd);
          const activeQids = new Set<string>();
          if (curr.qid) activeQids.add(curr.qid);
          for (const f of curr.questStack ?? []) activeQids.add(f.qid);
          await auditAndReclaimPool(primaryRoot, cfg.gitWorkflow?.worktreePoolDir || ".pi/scratch", activeQids, pi);

          // If the current quest is implementing or validating, verify or re-attach its worktree slot now
          if (curr.qid && !curr.disabled && (curr.phase === "implementing" || curr.phase === "validating")) {
            const mode = cfg.gitWorkflow?.worktreeMode ?? "auto";
            if (mode !== "off") {
              const res = await ensureQuestWorktreeAttached(
                primaryRoot,
                curr.qid,
                curr.baseCommit ?? null,
                curr.worktreePath,
                curr.worktreeBranch,
                cfg.gitWorkflow,
                pi,
              );
              if (res.ok && res.slotPath && res.slotBranch && (res.slotPath !== curr.worktreePath || res.slotBranch !== curr.worktreeBranch)) {
                updateState((s) => ({
                  ...s,
                  worktreePath: res.slotPath,
                  worktreeBranch: res.slotBranch,
                  snapshotPending: true,
                }));
                ctx.ui?.notify?.(`[pi-quest] Re-attached active quest ${curr.qid} to scratch worktree (${res.slotPath})`, "info");
              }
            }
          }
        } catch { /* best-effort pool audit */ }
      } catch {
        // Best effort background bring-up
      }
    })();
  });
}