// HIGH_LEVEL: #router — deterministic phase × difficulty matrix resolution.
import { THINKING_LEVELS } from "../review/model";
import type { ModelSpec, ParsedModelSpec } from "./types";

export const KNOWN_PHASES: ReadonlySet<string> = new Set([
  "idle",
  "provisional",
  "drafting",
  "implementing",
  "validating",
  "archived",
  "*",
]);

export const KNOWN_DIFFICULTIES: ReadonlySet<string> = new Set([
  "trivial",
  "standard",
  "complex",
  "*",
]);

export function parseModelSpec(spec: string): ParsedModelSpec {
  const trimmed = spec.trim();
  let base = trimmed;
  let thinkingLevel: string | undefined;

  const colonIdx = trimmed.lastIndexOf(":");
  if (colonIdx > 0) {
    const candidateSuffix = trimmed.substring(colonIdx + 1).toLowerCase();
    if (THINKING_LEVELS.has(candidateSuffix)) {
      thinkingLevel = candidateSuffix;
      base = trimmed.substring(0, colonIdx);
    }
  }

  const slashIdx = base.indexOf("/");
  if (slashIdx >= 0) {
    const provider = base.substring(0, slashIdx).trim();
    const id = base.substring(slashIdx + 1).trim();
    return { raw: trimmed, provider, id, thinkingLevel };
  }

  return { raw: trimmed, provider: "", id: base.trim(), thinkingLevel };
}

export function normalizeModelSpecs(spec: ModelSpec | undefined): string[] {
  if (spec === undefined) return [];
  if (typeof spec === "string") {
    const trimmed = spec.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(spec)) {
    return spec
      .filter((s) => typeof s === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

function findKeyCaseInsensitive(record: Record<string, unknown>, target: string): unknown {
  const lower = target.toLowerCase();
  for (const [key, val] of Object.entries(record)) {
    if (key.toLowerCase() === lower) return val;
  }
  return undefined;
}

export function resolveMatrixCell(
  matrix: Record<string, unknown>,
  phase: string,
  difficulty: string,
  fallbackDefault: ModelSpec,
): string[] {
  // 1. Check phase-specific entry
  const phaseEntry = findKeyCaseInsensitive(matrix, phase);
  if (phaseEntry !== undefined) {
    if (typeof phaseEntry === "string" || Array.isArray(phaseEntry)) {
      const specs = normalizeModelSpecs(phaseEntry as ModelSpec);
      if (specs.length > 0) return specs;
    } else if (typeof phaseEntry === "object" && phaseEntry !== null) {
      const subRecord = phaseEntry as Record<string, unknown>;
      // Exact difficulty match
      const diffEntry = findKeyCaseInsensitive(subRecord, difficulty);
      if (diffEntry !== undefined) {
        const specs = normalizeModelSpecs(diffEntry as ModelSpec);
        if (specs.length > 0) return specs;
      }
      // Difficulty wildcard
      const wildDiffEntry = findKeyCaseInsensitive(subRecord, "*");
      if (wildDiffEntry !== undefined) {
        const specs = normalizeModelSpecs(wildDiffEntry as ModelSpec);
        if (specs.length > 0) return specs;
      }
    }
  }

  // 2. Check phase wildcard '*'
  const wildPhaseEntry = findKeyCaseInsensitive(matrix, "*");
  if (wildPhaseEntry !== undefined) {
    if (typeof wildPhaseEntry === "string" || Array.isArray(wildPhaseEntry)) {
      const specs = normalizeModelSpecs(wildPhaseEntry as ModelSpec);
      if (specs.length > 0) return specs;
    } else if (typeof wildPhaseEntry === "object" && wildPhaseEntry !== null) {
      const subRecord = wildPhaseEntry as Record<string, unknown>;
      const diffEntry = findKeyCaseInsensitive(subRecord, difficulty);
      if (diffEntry !== undefined) {
        const specs = normalizeModelSpecs(diffEntry as ModelSpec);
        if (specs.length > 0) return specs;
      }
      const wildDiffEntry = findKeyCaseInsensitive(subRecord, "*");
      if (wildDiffEntry !== undefined) {
        const specs = normalizeModelSpecs(wildDiffEntry as ModelSpec);
        if (specs.length > 0) return specs;
      }
    }
  }

  // 3. Fallback to global default
  return normalizeModelSpecs(fallbackDefault);
}

export function validateMatrixConfig(matrix: Record<string, unknown>): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  for (const [phaseKey, phaseVal] of Object.entries(matrix)) {
    if (!KNOWN_PHASES.has(phaseKey.toLowerCase())) {
      warnings.push(`Unknown phase '${phaseKey}' in router matrix.`);
    }
    if (typeof phaseVal === "object" && phaseVal !== null && !Array.isArray(phaseVal)) {
      for (const diffKey of Object.keys(phaseVal as Record<string, unknown>)) {
        if (!KNOWN_DIFFICULTIES.has(diffKey.toLowerCase())) {
          warnings.push(`Unknown difficulty '${diffKey}' under phase '${phaseKey}' in router matrix.`);
        }
      }
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
