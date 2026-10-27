// HIGH_LEVEL: #commands — probe judge service health, report latency, and display trigger word families.
import { readQuestConfig } from "../../config";
import { checkJudgeHealth } from "../../drafting/judge";
import type { Pi, PiCtx } from "../../hooks/events";

export interface QuestDoctorData {
  lines: string[];
}

export function createQuestDoctorComponent(
  data: QuestDoctorData,
  theme?: {
    fg?: (name: string, text: string) => string;
    bold?: (text: string) => string;
  },
) {
  return {
    render(width: number): string[] {
      const w = Math.max(30, Math.min(width - 2, 76));
      const border = theme?.fg ? theme.fg("border", "─".repeat(w)) : "─".repeat(w);
      const title = theme?.bold && theme?.fg ? theme.bold(theme.fg("accent", " Quest System & Judge Doctor ")) : " Quest System & Judge Doctor ";
      const output: string[] = [border, title, border];
      for (const line of data.lines) {
        let styled = line;
        if (theme?.fg) {
          if (line.startsWith("[✓]")) styled = `${theme.fg("success", "[✓]")}${line.slice(3)}`;
          else if (line.startsWith("[✗]")) styled = `${theme.fg("error", "[✗]")}${line.slice(3)}`;
          else if (line.startsWith("[-]")) styled = `${theme.fg("dim", "[-]")}${line.slice(3)}`;
          else if (line.startsWith("[!]")) styled = `${theme.fg("warning", "[!]")}${line.slice(3)}`;
        }
        output.push(`  ${styled}`);
      }
      output.push(border);
      return output;
    },
    invalidate(): void {},
  };
}

export async function getQuestDoctorLines(ctx: PiCtx): Promise<string[]> {
  const cfg = await readQuestConfig(ctx.cwd);

  const { ensureAuren, getBootstrapState, findUserConfig, serverLogPath, MODEL_CATALOG, presentModels, modelsDir } =
    await import("../../auren-bootstrap");

  let bootState = getBootstrapState();
  if (!cfg.judgeUrl || cfg.judgeUrl.includes("4242")) {
    try {
      bootState = await ensureAuren({
        cwd: ctx.cwd,
        settings: { autoStart: cfg.autoStartAuren, autoDownloadModels: cfg.autoDownloadModels },
      });
    } catch { /* best effort */ }
  }

  const health = await checkJudgeHealth(cfg);

  const lines: string[] = [];

  if (health.ok) {
    lines.push(`[✓] Judge Service: ${health.endpoint} (200 OK, latency: ${health.latencyMs}ms)`);
    if (health.models && health.models.length > 0) {
      lines.push(`[✓] Models Available: ${health.models.join(", ")}`);
    }
  } else {
    lines.push(`[✗] Judge Service: ${health.endpoint} (OFFLINE - ${health.error})`);
    lines.push(`[!] Status: Offline fail-closed active. Trigger word families and /quest required.`);
  }

  const uCfg = findUserConfig({ cwd: ctx.cwd });
  lines.push(`[-] Auren Config: ${uCfg ?? "None (auto-managed at ~/.config/auren/config.json)"}`);
  const home = typeof process !== "undefined" && process.env?.HOME ? process.env.HOME : "/tmp";
  const present = presentModels(MODEL_CATALOG, home);
  if (present.length > 0) {
    lines.push(`[✓] Local GGUF Models (~/.models): ${present.map((m) => m.id).join(", ")}`);
  } else {
    lines.push("[-] Local GGUF Models (~/.models): None found");
  }
  if (bootState.downloads.length > 0) {
    for (const dl of bootState.downloads) {
      const pct = dl.total > 0 ? Math.floor((dl.done / dl.total) * 100) : 0;
      lines.push(`[-] Downloading: ${dl.id} (${pct}%)`);
    }
  }
  lines.push(`[-] Daemon Log: ${serverLogPath(home)}`);

  for (const n of bootState.notices) {
    if (n.code === "downloading") continue;
    lines.push("");
    lines.push(`[!] ${n.message}`);
    lines.push(`    -> Guide: ${n.link}`);
  }

  // Core C Engine Versions & Requirements
  const { checkAllEngineVersions } = await import("../../versions");
  const engineReports = checkAllEngineVersions({ cwd: ctx.cwd });
  lines.push("[-] Core C Engines & Versions:");
  for (const rep of engineReports) {
    const symbol = rep.status === "satisfied" ? "[✓]" : rep.status === "outdated" ? "[!]" : "[✗]";
    const ver = rep.version ? `${rep.version} (${rep.source})` : "not installed";
    lines.push(`  ${symbol} ${rep.name.padEnd(11)}: ${ver} (requires >= ${rep.minRequired})`);
  }

  lines.push(`[-] Intent Evaluation: mode='${cfg.judgeMode}', model='${cfg.judgeModel}', timeout=${cfg.judgeTimeoutMs}ms`);
  lines.push(`[-] Fallback Policy: ${cfg.judgeFallback}`);
  lines.push(`[-] Active Trigger Prefixes: ${cfg.triggerPrefixes.map((p) => `'${p}'`).join(", ")}`);

  return lines;
}

export async function runQuestDoctor(_pi: Pi, ctx: PiCtx): Promise<string> {
  const lines = await getQuestDoctorLines(ctx);
  return ["=== Quest System & Judge Doctor ===", ...lines].join("\n");
}
