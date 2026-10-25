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

  lines.push(`[-] Intent Evaluation: mode='${cfg.judgeMode}', model='${cfg.judgeModel}', timeout=${cfg.judgeTimeoutMs}ms`);
  lines.push(`[-] Fallback Policy: ${cfg.judgeFallback}`);
  lines.push(`[-] Active Trigger Prefixes: ${cfg.triggerPrefixes.map((p) => `'${p}'`).join(", ")}`);

  return lines;
}

export async function runQuestDoctor(_pi: Pi, ctx: PiCtx): Promise<string> {
  const lines = await getQuestDoctorLines(ctx);
  return ["=== Quest System & Judge Doctor ===", ...lines].join("\n");
}
