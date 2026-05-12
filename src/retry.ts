export interface RetryOptions {
  maxRetries: number;
  isRetryable: (err: unknown) => boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computeBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(random() * 100);
  return Math.min(exponential + jitter, maxDelayMs);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.maxRetries || !opts.isRetryable(err)) {
        throw err;
      }
      const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs, random);
      await sleep(delay);
      attempt += 1;
    }
  }
}
