// HIGH_LEVEL: #router — virtual model registration hook for pi extension.
import type { Pi, PiCtx } from "../hooks/events";
import { readQuestConfig } from "../config";
import { routeRequest } from "./engine";
import { recordRoutedModel } from "./last-route";
import type { ModelRoute, ModelRouteRequest, RouterState, VirtualModelDefinition } from "./types";

export function installRouter(pi: Pi): void {
  if (typeof pi.registerVirtualModel !== "function") {
    return;
  }

  const def: VirtualModelDefinition<RouterState> = {
    provider: "quest",
    id: "auto",
    name: "Quest Auto Router",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    contextWindow: 1000000,
    maxTokens: 128000,
    async route(
      request: ModelRouteRequest<RouterState>,
      ctx: unknown,
    ): Promise<ModelRoute<RouterState>> {
      const piCtx = ctx as PiCtx | undefined;
      const cwd = piCtx?.cwd ?? (typeof process !== "undefined" ? process.cwd?.() ?? "." : ".");
      const config = await readQuestConfig(cwd);

      const route = await routeRequest(request, ctx, config.router);
      const routed = route.model as { provider?: unknown; id?: unknown } | undefined;
      if (typeof routed?.provider === "string" && typeof routed.id === "string") {
        recordRoutedModel(`${routed.provider}/${routed.id}`);
      }
      return route;
    },
  };

  pi.registerVirtualModel(def);
}
