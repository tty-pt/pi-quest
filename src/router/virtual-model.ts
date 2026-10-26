// HIGH_LEVEL: #router — virtual model registration hook for pi extension.
import type { Pi, PiCtx } from "../hooks/events";
import { readQuestConfig } from "../config";
import { routeRequest } from "./engine";
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

      return routeRequest(request, ctx, config.router);
    },
  };

  pi.registerVirtualModel(def);
}
