// HIGH_LEVEL: #commands — /quest-router status and configuration viewer.
import type { PiCtx } from "../../hooks/events";
import { readQuestConfig } from "../../config";
import { getState } from "../../app/store";
import { resolveMatrixCell, validateMatrixConfig } from "../../router/matrix";

export async function getRouterStatusLines(ctx: PiCtx): Promise<string[]> {
  const config = await readQuestConfig(ctx.cwd);
  const routerCfg = config.router;
  const quest = getState();

  const lines: string[] = [];
  lines.push("=== Pi-Quest Virtual Model Router ===");
  lines.push(`Virtual Model : ${routerCfg.provider}/${routerCfg.id} ("${routerCfg.name}")`);
  lines.push(`Status        : ${routerCfg.enabled ? "[✓] Enabled" : "[-] Disabled (set router.enabled: true in settings.json)"}`);
  lines.push(`Activation    : Use '/model ${routerCfg.provider}/${routerCfg.id}' in TUI or set "defaultModel": "${routerCfg.provider}/${routerCfg.id}" in settings.`);
  lines.push("");

  const phase = quest?.phase ?? "idle";
  const difficulty = quest?.difficulty ?? "standard";
  lines.push(`Current Quest : ${quest?.qid ? `${quest.qid} ("${quest.name || quest.objective?.slice(0, 40)}")` : "(no active quest)"}`);
  lines.push(`Current Cell  : Phase='${phase}', Difficulty='${difficulty}'`);

  const resolved = resolveMatrixCell(routerCfg.matrix, phase, difficulty, routerCfg.default);
  lines.push(`Target Models : ${resolved.join(" -> ")}`);
  lines.push(`Direct Model  : ${routerCfg.direct} (compaction / background)`);
  lines.push(`Default Model : ${Array.isArray(routerCfg.default) ? routerCfg.default.join(" -> ") : routerCfg.default}`);
  lines.push(`Cooldown Time : ${Math.round(routerCfg.cooldownMs / 1000)}s on rate limit/quota failure`);
  lines.push("");

  lines.push("Matrix Overview:");
  if (Object.keys(routerCfg.matrix).length === 0) {
    lines.push("  (empty matrix — all requests fall back to default model)");
  } else {
    for (const [phaseKey, val] of Object.entries(routerCfg.matrix)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        lines.push(`  • ${phaseKey}:`);
        for (const [diffKey, diffVal] of Object.entries(val as Record<string, unknown>)) {
          const formatted = Array.isArray(diffVal) ? diffVal.join(" -> ") : String(diffVal);
          lines.push(`      - ${diffKey}: ${formatted}`);
        }
      } else {
        const formatted = Array.isArray(val) ? val.join(" -> ") : String(val);
        lines.push(`  • ${phaseKey}: ${formatted}`);
      }
    }
  }

  const validation = validateMatrixConfig(routerCfg.matrix);
  if (!validation.valid) {
    lines.push("");
    lines.push("Config Warnings:");
    for (const w of validation.warnings) {
      lines.push(`  [!] ${w}`);
    }
  }

  return lines;
}
