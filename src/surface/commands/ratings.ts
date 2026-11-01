// HIGH_LEVEL: #commands — /quest-ratings: inspect model accuracy ratings,
// learned Beta distributions, episode counts, and active autonomy levels.
import type { PiCtx } from "../../hooks/events";
import { readQuestConfig } from "../../config";
import { readRatingsStore } from "../../durability/ratings";
import { resolveActiveModel, resolveAutonomyLevel, calculateReviewNeed } from "../../policy/effective";

export async function getRatingsStatusLines(ctx: PiCtx): Promise<string[]> {
  const config = await readQuestConfig(ctx.cwd);
  const activeModel = resolveActiveModel(ctx, config);
  const store = await readRatingsStore(ctx.cwd);
  const lines: string[] = ["=== Pi-Quest Model Reliability & Autonomy Ratings ==="];
  lines.push(`Active session model : ${activeModel || "(unspecified)"}`);
  lines.push(`Memory discount (γ)  : 0.98 (~35 episode half-life)`);
  lines.push("");

  const modelKeys = new Set([
    ...Object.keys(store.models),
    ...Object.keys(config.modelAccuracy),
  ]);

  if (modelKeys.size === 0) {
    lines.push("No model ratings recorded yet. Ratings are updated automatically upon quest completion.");
  } else {
    lines.push("Tracked Models:");
    for (const m of modelKeys) {
      const tracked = store.models[m];
      const configuredAccuracy = config.modelAccuracy[m];
      const mean = tracked ? tracked.overall.mean : (configuredAccuracy ?? 0.8);
      const episodes = tracked ? tracked.overall.episodes : 0;
      const needStandard = calculateReviewNeed(3, m, 0, config.modelAccuracy);
      const level = resolveAutonomyLevel(needStandard);

      const levelLabel = level === 3 ? "Level 3 (Full Autonomy)" : level === 2 ? "Level 2 (Balanced Autonomy)" : "Level 1 (Supervised Audit)";
      const isCurrent = m === activeModel || (activeModel && activeModel.includes(m)) ? " <- active" : "";

      lines.push(`• ${m}${isCurrent}`);
      lines.push(`    Reliability : ${(mean * 100).toFixed(1)}% (episodes: ${episodes})`);
      lines.push(`    Autonomy    : ${levelLabel} [ReviewNeed (standard): ${needStandard}]`);
      if (tracked?.byTier && Object.keys(tracked.byTier).length > 0) {
        const tiers = Object.entries(tracked.byTier)
          .map(([t, b]) => `${t}: ${(b.mean * 100).toFixed(0)}% (${b.episodes})`)
          .join(" | ");
        lines.push(`    By Tier     : ${tiers}`);
      }
    }
  }

  lines.push("");
  lines.push("Autonomy Ladder Thresholds:");
  lines.push("  Level 3 (Full Autonomy)     : ReviewNeed <= 2.2  [Zero subagents, auto-approved on test pass]");
  lines.push("  Level 2 (Balanced Autonomy) : 2.2 < Need <= 4.5  [Plan self-approved, test receipt gates archive]");
  lines.push("  Level 1 (Supervised Audit)  : ReviewNeed > 4.5   [Independent reviewer & validator subagents]");

  return lines;
}
