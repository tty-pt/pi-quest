// HIGH_LEVEL: #router — remembers the physical model quest/auto last routed to,
// so model-keyed policy (policyByModel) judges the model really doing the work
// rather than the virtual wrapper.
let lastRouted: string | undefined;

export function recordRoutedModel(modelKey: string): void {
  lastRouted = modelKey.trim() === "" ? undefined : modelKey.trim();
}

export function lastRoutedModel(): string | undefined {
  return lastRouted;
}

export function resetRoutedModel(): void {
  lastRouted = undefined;
}
