// HIGH_LEVEL: #plan revision — citation resolution against the working tree.
// A cited file:line is verifiable only if the file exists and the line is in
// range; shared by the save-time claims check and the draft quality bar.
import { readFile, stat } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { citeLocations } from "./plan-text";

const citableFileCache = new Map<string, string | null>();
const fileLineCountCache = new Map<string, { mtimeMs: number; lines: number }>();

export function clearCitationCache(): void {
  citableFileCache.clear();
  fileLineCountCache.clear();
}

async function resolveCitableFile(cwd: string, ref: string): Promise<string | null> {
  const cacheKey = `${cwd}:${ref}`;
  if (citableFileCache.has(cacheKey)) {
    return citableFileCache.get(cacheKey)!;
  }
  const candidates: string[] = [join(cwd, ref)];
  if (!ref.includes("/")) {
    try {
      for (const top of readdirSync(join(cwd, "mods"))) {
        candidates.push(join(cwd, "mods", top, ref));
      }
    } catch {
      // No mods dir to probe.
    }
  } else {
    candidates.push(join(cwd, "mods", ref));
  }
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        citableFileCache.set(cacheKey, candidate);
        return candidate;
      }
    } catch {
      // Keep probing candidates.
    }
  }
  citableFileCache.set(cacheKey, null);
  return null;
}

export interface CitationReport {
  total: number;
  resolved: number;
  problems: string[];
}

// Unique file:line[-line] citations in the text, each probed on disk.
export async function resolveCitations(cwd: string, text: string): Promise<CitationReport> {
  const seen = new Set<string>();
  const problems: string[] = [];
  let total = 0;
  const lineCounts = new Map<string, number>();
  for (const cite of citeLocations(text)) {
    const key = `${cite.file}:${cite.lineStart}${cite.lineEnd !== undefined ? `-${cite.lineEnd}` : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    const resolved = await resolveCitableFile(cwd, cite.file);
    if (resolved === null) {
      problems.push(`${cite.file}:${cite.lineStart} not found`);
      continue;
    }
    let lineCount: number | undefined;
    const cached = fileLineCountCache.get(resolved);
    try {
      const st = await stat(resolved);
      if (cached && cached.mtimeMs === st.mtimeMs) {
        lineCount = cached.lines;
      } else {
        lineCount = (await readFile(resolved, "utf8")).split("\n").length;
        fileLineCountCache.set(resolved, { mtimeMs: st.mtimeMs, lines: lineCount });
      }
    } catch {
      lineCount = cached?.lines;
    }
    if (lineCount === undefined) {
      lineCount = (await readFile(resolved, "utf8")).split("\n").length;
      fileLineCountCache.set(resolved, { mtimeMs: Date.now(), lines: lineCount });
    }
    if (cite.lineStart > lineCount) {
      problems.push(`${cite.file}:${cite.lineStart} beyond ${lineCount} lines`);
    } else if (cite.lineEnd !== undefined && cite.lineEnd > lineCount) {
      problems.push(`${cite.file}:${cite.lineStart}-${cite.lineEnd} beyond ${lineCount} lines`);
    }
  }
  return { total, resolved: total - problems.length, problems };
}
