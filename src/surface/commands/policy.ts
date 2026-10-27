// HIGH_LEVEL: #commands — /quest-policy: which review policy and draft-quality
// bar apply right now, and why. Read-only; the answer to "why did (or didn't)
// my plan get reviewed?".
import type { PiCtx } from "../../hooks/events";
import { readQuestConfig, readQuestSettings } from "../../config";
import { getState } from "../../app/store";
import { effectivePolicy, resolveActiveModel } from "../../policy/effective";
import { collectConfigWarnings } from "../../policy/warnings";

export async function getPolicyStatusLines(ctx: PiCtx): Promise<string[]> {
  const config = await readQuestConfig(ctx.cwd);
  const eff = effectivePolicy(config, ctx);
  const model = resolveActiveModel(ctx, config);
  const difficulty = getState().difficulty;
  const lines: string[] = ["=== Pi-Quest Review Policy ==="];
  lines.push(`Active model     : ${model || "(unknown)"}`);
  lines.push(`Configured policy: ${config.reviewPolicy}`);
  lines.push(`Effective policy : ${eff.policy}${eff.rule !== undefined ? ` (matched policyByModel "${eff.rule}")` : config.policyByModel.length > 0 ? " (no policyByModel rule matched)" : ""}`);
  lines.push("");
  lines.push("policyByModel (first match wins):");
  if (config.policyByModel.length === 0) {
    lines.push('  (no rules — add e.g. "policyByModel": { "anthropic/claude-sonnet-5*": "balanced" } to .pi/settings.json)');
  } else {
    for (const rule of config.policyByModel) lines.push(`  "${rule.pattern}" -> ${rule.policy}`);
  }
  lines.push("");
  const dq = config.draftQuality;
  lines.push(`Draft quality    : ${dq.mode}${dq.mode === "enforce" ? " (holds balanced/off drafts below the bar)" : dq.mode === "warn" ? " (advisory only)" : " (disabled)"}`);
  for (const tier of ["trivial", "standard", "complex"] as const) {
    const t = dq.tiers[tier];
    const mark = tier === difficulty ? " <- current quest" : "";
    lines.push(`  ${tier.padEnd(8)} citations>=${t.citations} steps>=${t.steps} verification=${t.requireVerification ? "required" : "optional"}${mark}`);
  }
  const warnings = collectConfigWarnings(await readQuestSettings(ctx.cwd));
  if (warnings.length > 0) {
    lines.push("");
    lines.push("Config Warnings:");
    for (const w of warnings) lines.push(`  [!] ${w}`);
  }
  return lines;
}
