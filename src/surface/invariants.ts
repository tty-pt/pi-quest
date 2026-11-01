// HIGH_LEVEL: #storage — query active L2 invariants / standing directives from memory.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ActiveInvariant {
  ref?: number;
  summary: string;
  subsystem?: string;
  project?: string;
}

function parseInvariantItem(item: unknown): ActiveInvariant | null {
  if (typeof item !== "object" || item === null) return null;
  const d = item as Record<string, unknown>;
  const summary = typeof d["summary"] === "string" ? d["summary"] : typeof d["text"] === "string" ? d["text"] : "";
  if (!summary) return null;
  return {
    ref: typeof d["ref"] === "number" ? d["ref"] : undefined,
    summary,
    subsystem: typeof d["subsystem"] === "string" ? d["subsystem"] : undefined,
    project: typeof d["project"] === "string" ? d["project"] : undefined,
  };
}

export async function fetchActiveInvariants(cwd: string): Promise<ActiveInvariant[]> {
  // 1. Try globalThis in-memory scheduler or directives cache (0ms)
  try {
    const globalObj = globalThis as Record<string, unknown>;
    const cached = globalObj["__pi_mm_directives"];
    if (Array.isArray(cached) && cached.length > 0) {
      return cached
        .map(parseInvariantItem)
        .filter((inv): inv is ActiveInvariant => inv !== null);
    }
    const scheduler = globalObj["__pi_mm_scheduler"] as { getDirectives?: () => unknown[] } | undefined;
    if (scheduler && typeof scheduler.getDirectives === "function") {
      const dirs = scheduler.getDirectives();
      if (Array.isArray(dirs) && dirs.length > 0) {
        return dirs
          .map(parseInvariantItem)
          .filter((inv): inv is ActiveInvariant => inv !== null);
      }
    }
  } catch {
    // Best-effort in-memory check
  }

  // 2. Try reading standing_directives.json or invariants.json from .pi/mm on disk
  const candidateFiles = [
    join(cwd, ".pi", "mm", "standing_directives.json"),
    join(cwd, ".pi", "mm", "invariants.json"),
  ];

  for (const filePath of candidateFiles) {
    if (existsSync(filePath)) {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .map(parseInvariantItem)
            .filter((inv): inv is ActiveInvariant => inv !== null);
        }
      } catch {
        // Fall through
      }
    }
  }

  return [];
}

export function formatInvariantsComment(invariants: Array<ActiveInvariant | string>): string {
  if (!invariants || invariants.length === 0) return "";
  const lines: string[] = [
    "<!-- [Compliance Criteria]",
    "[Active Mid-Quest Directives - Must be satisfied]",
    "[Standing Repository Invariants from Memory]:",
  ];
  for (const inv of invariants) {
    if (typeof inv === "string") {
      lines.push(`  • Invariant: ${inv}`);
    } else {
      const refStr = inv.ref !== undefined ? ` (Ref ${inv.ref})` : "";
      lines.push(`  • Invariant${refStr}: ${inv.summary}`);
    }
  }
  lines.push("-->");
  return lines.join("\n");
}
