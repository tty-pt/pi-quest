// HIGH_LEVEL: #validation — retry backoff and consecutive verdict failure tracking.
export const MAX_CONSECUTIVE_VALIDATION_FAILS = 2;
export const MAX_VALIDATION_RETRIES = 3;
export const VALIDATION_RETRY_BASE_MS = 4000;

const consecutiveValidationFails = new Map<string, number>();
const validationRetries = new Map<string, number>();

let dispatchValidationRetry: (delayMs: number, fn: () => void) => void = (delayMs, fn) => {
  setTimeout(fn, delayMs);
};

export function noteValidationVerdictFailed(qid: string): number {
  const next = (consecutiveValidationFails.get(qid) ?? 0) + 1;
  consecutiveValidationFails.set(qid, next);
  return next;
}

export function clearValidationVerdictFails(qid: string): void {
  consecutiveValidationFails.delete(qid);
}

export function getValidationVerdictFails(qid: string): number {
  return consecutiveValidationFails.get(qid) ?? 0;
}

export function validationRetryCount(qid: string): number {
  return validationRetries.get(qid) ?? 0;
}

export function clearValidationRetries(qid: string): void {
  validationRetries.delete(qid);
}

export function setValidationRetryDispatcher(
  next: (delayMs: number, fn: () => void) => void,
): (delayMs: number, fn: () => void) => void {
  const previous = dispatchValidationRetry;
  dispatchValidationRetry = next;
  return previous;
}

export function scheduleValidationRetry(qid: string, onRetry: (attempt: number) => void): boolean {
  const attempts = validationRetries.get(qid) ?? 0;
  if (attempts < MAX_VALIDATION_RETRIES) {
    const attempt = attempts + 1;
    validationRetries.set(qid, attempt);
    const delay = VALIDATION_RETRY_BASE_MS * 2 ** (attempt - 1);
    dispatchValidationRetry(delay, () => onRetry(attempt));
    return true;
  }
  validationRetries.delete(qid);
  return false;
}
