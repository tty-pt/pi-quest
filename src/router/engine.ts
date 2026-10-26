// HIGH_LEVEL: #router — virtual model routing engine with fallback and quota cooldown.
import { getState } from "../app/store";
import { parseModelSpec, resolveMatrixCell } from "./matrix";
import type {
  ModelRoute,
  ModelRouteRequest,
  ParsedModelSpec,
  RouterConfig,
  RouterState,
} from "./types";

export function isRateLimitOrQuotaError(message?: string): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("quota") ||
    lower.includes("overloaded") ||
    lower.includes("429") ||
    lower.includes("capacity") ||
    lower.includes("credit") ||
    lower.includes("exceeded") ||
    lower.includes("exhausted")
  );
}

export function cleanExpiredCooldowns(cooldowns: Record<string, number>, now = Date.now()): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, expiresAt] of Object.entries(cooldowns)) {
    if (expiresAt > now) {
      next[key] = expiresAt;
    }
  }
  return next;
}

export interface ModelCandidate {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  [key: string]: unknown;
}

export interface ModelRegistryLike {
  getAvailable?(): ModelCandidate[];
  find?(provider: string, id: string): ModelCandidate | undefined;
  hasConfiguredAuth?(model: ModelCandidate): boolean;
}

export function resolveCandidateModel(
  spec: ParsedModelSpec,
  registry: ModelRegistryLike | undefined,
): ModelCandidate | undefined {
  if (!registry) return undefined;

  // 1. If provider is explicitly specified:
  if (spec.provider) {
    if (typeof registry.find === "function") {
      const found = registry.find(spec.provider, spec.id);
      if (found) {
        // If hasConfiguredAuth exists, verify auth is configured
        if (typeof registry.hasConfiguredAuth === "function") {
          return registry.hasConfiguredAuth(found) ? found : undefined;
        }
        return found;
      }
    }
    // Fallback: check getAvailable()
    if (typeof registry.getAvailable === "function") {
      const available = registry.getAvailable();
      return available.find((m) => m.provider === spec.provider && m.id === spec.id);
    }
    return undefined;
  }

  // 2. If provider is omitted, look in available models by model id
  if (typeof registry.getAvailable === "function") {
    const available = registry.getAvailable();
    return available.find((m) => m.id === spec.id || `${m.provider}/${m.id}` === spec.id);
  }

  return undefined;
}

export function clampThinkingLevel(
  model: ModelCandidate,
  desiredThinking?: string,
  requestThinking?: string,
): string {
  // If model does not support reasoning/thinking, default to "off"
  const supportsReasoning = model.reasoning === true;
  if (!supportsReasoning) {
    return "off";
  }

  // Use desired level from model spec (e.g. :high), or pass through request thinking level
  const target = desiredThinking || requestThinking;
  return target || "off";
}

export async function routeRequest(
  request: ModelRouteRequest<RouterState>,
  ctx: { modelRegistry?: ModelRegistryLike } | unknown,
  config: RouterConfig,
): Promise<ModelRoute<RouterState>> {
  const now = Date.now();
  const rawState = request.state ?? { cooldowns: {} };
  let cooldowns = cleanExpiredCooldowns(rawState.cooldowns ?? {}, now);

  const registry = (ctx as { modelRegistry?: ModelRegistryLike } | undefined)?.modelRegistry;

  // 1. Direct requests (compaction summaries, standalone runs outside agent loop)
  if (request.reason === "direct") {
    const directSpec = parseModelSpec(config.direct);
    const directModel = resolveCandidateModel(directSpec, registry);
    if (directModel) {
      const thinking = clampThinkingLevel(directModel, directSpec.thinkingLevel, "off");
      return { model: directModel, thinkingLevel: thinking, state: { ...rawState, cooldowns } };
    }
  }

  // 2. Handle retry failures with quota / rate-limit detection
  if (request.reason === "retry" && request.failed) {
    const errorMsg = request.failed.message?.errorMessage;
    if (isRateLimitOrQuotaError(errorMsg)) {
      const failedModel = request.failed.model as ModelCandidate | undefined;
      if (failedModel && failedModel.provider && failedModel.id) {
        const failedKey = `${failedModel.provider}/${failedModel.id}`;
        cooldowns = { ...cooldowns, [failedKey]: now + config.cooldownMs };
      }
    }
  }

  // 3. Continuation turns (multi-tool loops) — preserve sticky model to keep prompt caches
  if (request.reason === "continuation" && request.previous?.model) {
    const prevModel = request.previous.model as ModelCandidate;
    const prevKey = prevModel.provider && prevModel.id ? `${prevModel.provider}/${prevModel.id}` : "";
    const isCoolingDown = prevKey ? (cooldowns[prevKey] ?? 0) > now : false;

    // Only stay sticky if the previous model is not on active cooldown
    if (!isCoolingDown) {
      return {
        model: prevModel,
        thinkingLevel: request.previous.thinkingLevel ?? "off",
        state: { ...rawState, cooldowns },
      };
    }
  }

  // 4. Resolve active quest cell (phase × difficulty)
  const quest = getState();
  const phase = quest?.phase ?? "idle";
  const difficulty = quest?.difficulty ?? "standard";

  const candidateSpecs = resolveMatrixCell(config.matrix, phase, difficulty, config.default);

  // 5. Evaluate candidate chain in order
  for (const rawSpec of candidateSpecs) {
    const spec = parseModelSpec(rawSpec);
    const modelKey = spec.provider ? `${spec.provider}/${spec.id}` : spec.id;

    // Skip if model is on active cooldown
    if (cooldowns[modelKey] && cooldowns[modelKey] > now) {
      continue;
    }

    const candidate = resolveCandidateModel(spec, registry);
    if (candidate) {
      const fullKey = `${candidate.provider}/${candidate.id}`;
      // Double check full provider/id key cooldown
      if (cooldowns[fullKey] && cooldowns[fullKey] > now) {
        continue;
      }

      const thinking = clampThinkingLevel(candidate, spec.thinkingLevel, request.thinkingLevel);
      const nextState: RouterState = {
        cooldowns,
        lastCell: { phase, difficulty, modelKey: fullKey },
      };
      return {
        model: candidate,
        thinkingLevel: thinking,
        state: nextState,
      };
    }
  }

  // 6. If all candidates are unavailable or on cooldown, attempt global default without cooldown check as fail-safe
  const defaultSpecs = Array.isArray(config.default) ? config.default : [config.default];
  for (const rawDefault of defaultSpecs) {
    const spec = parseModelSpec(rawDefault);
    const candidate = resolveCandidateModel(spec, registry);
    if (candidate) {
      const thinking = clampThinkingLevel(candidate, spec.thinkingLevel, request.thinkingLevel);
      return {
        model: candidate,
        thinkingLevel: thinking,
        state: {
          cooldowns,
          lastCell: { phase, difficulty, modelKey: `${candidate.provider}/${candidate.id}` },
        },
      };
    }
  }

  // 7. Last resort: pick any available model in the registry
  if (typeof registry?.getAvailable === "function") {
    const available = registry.getAvailable();
    if (available.length > 0) {
      const fallback = available[0];
      return {
        model: fallback,
        thinkingLevel: clampThinkingLevel(fallback, undefined, request.thinkingLevel),
        state: {
          cooldowns,
          lastCell: { phase, difficulty, modelKey: `${fallback.provider}/${fallback.id}` },
        },
      };
    }
  }

  throw new Error(`[pi-quest router] No available model found for phase '${phase}', difficulty '${difficulty}'.`);
}
