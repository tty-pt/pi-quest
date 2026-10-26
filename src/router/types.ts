// HIGH_LEVEL: #router — virtual model routing types for phase × difficulty matrix.

export type ModelRouteReason = "user" | "continuation" | "retry" | "direct";

export interface ModelRouteRequest<TState = unknown> {
  model: unknown;
  thinkingLevel: string;
  reason: ModelRouteReason;
  previous?: {
    model: unknown;
    thinkingLevel?: string;
  };
  failed?: {
    model: unknown;
    thinkingLevel?: string;
    message?: {
      errorMessage?: string;
      stopReason?: string;
    };
  };
  state?: TState;
  messages: readonly unknown[];
  signal?: AbortSignal;
}

export interface ModelRoute<TState = unknown> {
  model: unknown;
  thinkingLevel: string;
  state?: TState;
}

export interface VirtualModelDefinition<TState = unknown> {
  provider: string;
  id: string;
  name: string;
  thinkingLevels?: readonly string[];
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
  route(request: ModelRouteRequest<TState>, ctx: unknown): Promise<ModelRoute<TState>> | ModelRoute<TState>;
}

export type ModelSpec = string | string[];

export interface RouterConfig {
  enabled: boolean;
  provider: string;
  id: string;
  name: string;
  default: ModelSpec;
  direct: string;
  cooldownMs: number;
  matrix: Record<string, string | string[] | Record<string, string | string[]>>;
}

export interface ParsedModelSpec {
  raw: string;
  provider: string;
  id: string;
  thinkingLevel?: string;
}

export interface ActiveCell {
  phase: string;
  difficulty: string;
  modelKey: string;
}

export interface RouterState {
  cooldowns: Record<string, number>; // modelKey (provider/id) -> expiresAt ms
  lastCell?: ActiveCell;
}
