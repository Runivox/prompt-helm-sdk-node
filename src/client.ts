import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  parseErrorResponse,
  PromptHelmError,
  RateLimitError,
  TimeoutError,
} from "./errors.js";
import { withRetry } from "./retry.js";
import { readSseStream } from "./stream.js";
import { SDK_USER_AGENT } from "./version.js";
import type {
  ExecuteRequest,
  ExecuteResponse,
  RequestOptions,
  StreamEvent,
} from "./types.js";

export interface PromptHelmConfig {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
  /**
   * Prefix appended to the SDK's User-Agent header. Use it to identify the
   * application or service making the call (helpful when one tenant runs
   * many apps against the same prompt). Example: `"my-checkout-service/1.4.2"`.
   */
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = "https://api.prompthelm.app";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const API_KEY_LENGTH = 36;
const API_KEY_PREFIX = "phk_";
const SDK_UA = SDK_USER_AGENT;

export class PromptHelm {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly extraHeaders: Record<string, string>;
  private readonly userAgent: string;

  public constructor(config: PromptHelmConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.length === 0) {
      throw new Error(
        "PromptHelm: `apiKey` is required. Provide a PromptHelm API key starting with `phk_`.",
      );
    }
    if (
      !config.apiKey.startsWith(API_KEY_PREFIX) ||
      config.apiKey.length !== API_KEY_LENGTH
    ) {
      throw new Error(
        "PromptHelm: `apiKey` must start with `phk_` followed by 32 hex characters.",
      );
    }

    const baseURL = config.baseURL ?? DEFAULT_BASE_URL;
    if (!isValidUrl(baseURL)) {
      throw new Error(`PromptHelm: \`baseURL\` is not a valid URL: ${baseURL}`);
    }

    const timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new Error("PromptHelm: `timeout` must be a positive number of milliseconds.");
    }

    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new Error("PromptHelm: `maxRetries` must be a non-negative integer.");
    }

    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error(
        "PromptHelm: global `fetch` is not available. Use Node.js >= 18 or pass `config.fetch`.",
      );
    }

    this.apiKey = config.apiKey;
    this.baseURL = baseURL.replace(/\/+$/, "");
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.fetchFn = fetchImpl;
    this.extraHeaders = config.headers ?? {};
    this.userAgent = config.userAgent
      ? `${config.userAgent} ${SDK_UA}`
      : SDK_UA;
  }

  public async execute(
    request: ExecuteRequest,
    options?: RequestOptions,
  ): Promise<ExecuteResponse> {
    return withRetry(
      async () => this.executeOnce(request, options),
      {
        maxRetries: this.maxRetries,
        isRetryable: (err) => this.isRetryable(err),
      },
    );
  }

  public stream(
    request: ExecuteRequest,
    options?: RequestOptions,
  ): AsyncIterable<StreamEvent> {
    const url = `${this.baseURL}/api/v1/gateway/stream`;
    const body = JSON.stringify(request);
    const headers = this.buildHeaders({ accept: "text/event-stream" });
    const timeout = this.timeout;
    const fetchFn = this.fetchFn;
    const signal = options?.signal;

    return {
      [Symbol.asyncIterator]: (): AsyncIterator<StreamEvent> => {
        const controller = new AbortController();
        const composite = composeSignals(controller.signal, signal);
        const timeoutHandle = setTimeout(() => {
          controller.abort(new TimeoutError(timeout));
        }, timeout);

        const responsePromise = fetchFn(url, {
          method: "POST",
          headers,
          body,
          signal: composite,
        }).then(async (response) => {
          if (!response.ok) {
            clearTimeout(timeoutHandle);
            const errorBody = await safeReadJson(response);
            throw parseErrorResponse(response.status, errorBody);
          }
          if (!response.body) {
            clearTimeout(timeoutHandle);
            throw new ApiError(
              response.status,
              undefined,
              undefined,
              "Server returned an empty stream body.",
            );
          }
          return response.body;
        });

        let inner: AsyncGenerator<StreamEvent, void, void> | null = null;
        let finalized = false;

        const finalize = (): void => {
          if (finalized) {
            return;
          }
          finalized = true;
          clearTimeout(timeoutHandle);
        };

        return {
          next: async (): Promise<IteratorResult<StreamEvent>> => {
            try {
              if (!inner) {
                const body = await responsePromise.catch((err: unknown) => {
                  if (isAbortError(err) && controller.signal.aborted) {
                    const reason = controller.signal.reason;
                    if (reason instanceof TimeoutError) {
                      throw reason;
                    }
                  }
                  throw err;
                });
                inner = readSseStream(body, signal);
              }
              const result = await inner.next();
              if (result.done === true) {
                finalize();
                return { value: undefined, done: true };
              }
              const event = result.value;
              if (event.type === "error") {
                finalize();
                throw new ApiError(
                  500,
                  event.errorCode,
                  event.requestId,
                  event.message,
                );
              }
              if (event.type === "done") {
                finalize();
                return { value: event, done: false };
              }
              return { value: event, done: false };
            } catch (err) {
              finalize();
              if (
                isAbortError(err) &&
                controller.signal.aborted &&
                controller.signal.reason instanceof TimeoutError
              ) {
                throw controller.signal.reason;
              }
              throw err;
            }
          },
          return: async (): Promise<IteratorResult<StreamEvent>> => {
            finalize();
            controller.abort();
            if (inner) {
              await inner.return().catch(() => undefined);
            }
            return { value: undefined, done: true };
          },
          throw: async (err: unknown): Promise<IteratorResult<StreamEvent>> => {
            finalize();
            controller.abort();
            if (inner) {
              await inner.return().catch(() => undefined);
            }
            throw err;
          },
        };
      },
    };
  }

  private async executeOnce(
    request: ExecuteRequest,
    options?: RequestOptions,
  ): Promise<ExecuteResponse> {
    const url = `${this.baseURL}/api/v1/gateway/execute`;
    const controller = new AbortController();
    const composite = composeSignals(controller.signal, options?.signal);
    const timeoutHandle = setTimeout(() => {
      controller.abort(new TimeoutError(this.timeout));
    }, this.timeout);

    try {
      const response = await this.fetchFn(url, {
        method: "POST",
        headers: this.buildHeaders({ accept: "application/json" }),
        body: JSON.stringify(request),
        signal: composite,
      });

      if (!response.ok) {
        const errorBody = await safeReadJson(response);
        throw parseErrorResponse(response.status, errorBody);
      }

      const payload = (await response.json()) as ExecuteResponse;
      return payload;
    } catch (err) {
      if (
        isAbortError(err) &&
        controller.signal.aborted &&
        controller.signal.reason instanceof TimeoutError
      ) {
        throw controller.signal.reason;
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private buildHeaders(extra: Record<string, string>): Record<string, string> {
    return {
      "content-type": "application/json",
      accept: extra["accept"] ?? "application/json",
      authorization: `Bearer ${this.apiKey}`,
      "user-agent": this.userAgent,
      ...this.extraHeaders,
    };
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof TimeoutError) {
      return false;
    }
    if (err instanceof AuthenticationError) {
      return false;
    }
    if (err instanceof AuthorizationError) {
      return false;
    }
    if (err instanceof NotFoundError) {
      return false;
    }
    if (err instanceof RateLimitError) {
      return false;
    }
    if (err instanceof PromptHelmError) {
      return err.statusCode >= 500 && err.statusCode <= 599;
    }
    if (isAbortError(err)) {
      return false;
    }
    return true;
  }
}

function composeSignals(
  primary: AbortSignal,
  external?: AbortSignal,
): AbortSignal {
  if (!external) {
    return primary;
  }
  if (external.aborted) {
    return external;
  }
  const onAbort = (): void => {
    if (!primary.aborted) {
      const reason = (external as AbortSignal & { reason?: unknown }).reason;
      // Forward external aborts to the primary controller's signal.
      // We cannot abort the primary signal directly, so create a new controller.
      compositeController.abort(reason);
    }
  };
  const compositeController = new AbortController();
  external.addEventListener("abort", onAbort, { once: true });
  primary.addEventListener(
    "abort",
    () => {
      const reason = (primary as AbortSignal & { reason?: unknown }).reason;
      compositeController.abort(reason);
    },
    { once: true },
  );
  return compositeController.signal;
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const candidate = err as { name?: unknown };
  return candidate.name === "AbortError";
}

function isValidUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text === "") {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}
