import { check } from "../check.ts";
import { isProviderSideFailure, isRateLimitOrQuotaError, isRetryableProviderError } from "../../src/utils/provider-error.ts";

Deno.test("provider errors: status codes match on word boundaries only", () => {
  check(isRateLimitOrQuotaError("HTTP 429 Too Many Requests"), "429");
  check(!isRateLimitOrQuotaError("listening on port 14290"), "digits inside a longer number");
  check(!isRetryableProviderError("exit code 4010"), "401 inside 4010");
  check(isRetryableProviderError("503 Service Unavailable"), "503");
});

Deno.test("provider errors: generic words alone are not provider failures", () => {
  check(!isProviderSideFailure("the model wrote a long process description"), "model/process words");
  check(!isProviderSideFailure("context: reviewing the diff"), "context word");
  check(isProviderSideFailure("maximum context length exceeded"), "context window error");
  check(isRetryableProviderError('Model "x/y" not found'), "model not found");
});
