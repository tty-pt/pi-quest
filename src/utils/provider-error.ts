// HIGH_LEVEL: #configurations — one classifier for provider/API failure text.
// Errors from child reviewers arrive as plain strings, so this matches API
// protocol vocabulary (HTTP status codes on word boundaries, snake_case error
// codes, the provider's own fixed phrases) — never generic words like "model",
// "process" or "context" on their own, and never digits inside longer numbers.
const RATE_LIMIT = /\b429\b|rate[ _-]?limit|\bquota\b|overloaded|\bcapacity\b|\bcredits?\b|\bexceeded\b|\bexhausted\b/i;
const SERVER_BUSY = /\b(?:503|504|529)\b/;
const AUTH = /\b(?:401|403)\b|unauthori[sz]ed|forbidden|permission_error|oauth_not_allowed|\bauthentication\b/i;
const MODEL_MISSING = /\bmodel\b[^\n]{0,80}?\b(?:not found|cannot find|unknown)\b|\bunknown (?:provider|model)\b/i;

export function isRateLimitOrQuotaError(message?: string): boolean {
  return !!message && RATE_LIMIT.test(message);
}

/** Failures worth retrying against the next candidate model. */
export function isRetryableProviderError(message?: string): boolean {
  if (!message) return false;
  return (
    MODEL_MISSING.test(message) ||
    message.includes("provider_model_timeout") ||
    RATE_LIMIT.test(message) ||
    SERVER_BUSY.test(message) ||
    AUTH.test(message)
  );
}

/** True when the failure is attributable to the provider/model rather than local plumbing. */
export function isProviderSideFailure(message?: string): boolean {
  if (!message) return false;
  return (
    isRetryableProviderError(message) ||
    /\bprovider\b|context (?:length|window)|maximum context/i.test(message)
  );
}
