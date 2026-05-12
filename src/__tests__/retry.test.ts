import { describe, expect, it, vi } from "vitest";
import { computeBackoff, withRetry } from "../retry.js";

describe("withRetry", () => {
  it("returns the value on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, {
      maxRetries: 3,
      isRetryable: () => true,
      sleep: async () => undefined,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries up to maxRetries on retryable errors then returns success", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient");
      }
      return "done";
    });
    const sleep = vi.fn(async () => undefined);
    const result = await withRetry(fn, {
      maxRetries: 3,
      isRetryable: () => true,
      sleep,
    });
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      withRetry(fn, {
        maxRetries: 2,
        isRetryable: () => true,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry when isRetryable returns false", async () => {
    const fn = vi.fn(async () => {
      throw new Error("nope");
    });
    await expect(
      withRetry(fn, {
        maxRetries: 5,
        isRetryable: () => false,
        sleep: async () => undefined,
      }),
    ).rejects.toThrow("nope");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("computeBackoff grows exponentially and respects max", () => {
    const random = (): number => 0;
    expect(computeBackoff(0, 100, 10_000, random)).toBe(100);
    expect(computeBackoff(1, 100, 10_000, random)).toBe(200);
    expect(computeBackoff(2, 100, 10_000, random)).toBe(400);
    expect(computeBackoff(20, 100, 10_000, random)).toBe(10_000);
  });

  it("computeBackoff adds jitter from random()", () => {
    const value = computeBackoff(0, 100, 10_000, () => 0.5);
    expect(value).toBeGreaterThanOrEqual(100);
    expect(value).toBeLessThanOrEqual(200);
  });
});
