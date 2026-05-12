import { describe, expect, it, vi } from "vitest";
import { PromptHelm } from "../client.js";
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
} from "../errors.js";
import type { ExecuteResponse, StreamEvent } from "../types.js";

const VALID_KEY = "phk_0123456789abcdef0123456789abcdef";

interface JsonResponseInit {
  status?: number;
  body?: unknown;
}

function jsonResponse(init: JsonResponseInit = {}): Response {
  const status = init.status ?? 200;
  const body = init.body ?? {};
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sseResponse(parts: string[], status = 200): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller): void {
      if (index < parts.length) {
        const part = parts[index];
        if (part !== undefined) {
          controller.enqueue(encoder.encode(part));
        }
        index += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

const sampleResponse: ExecuteResponse = {
  id: "exec-1",
  output: "Hello",
  model: "gpt-4o",
  inputTokens: 5,
  outputTokens: 10,
  totalTokens: 15,
  latencyMs: 120,
  cost: 0.0001,
  timestamp: "2026-05-12T00:00:00.000Z",
};

describe("PromptHelm constructor", () => {
  it("throws when apiKey is missing", () => {
    expect(
      () =>
        new PromptHelm({
          apiKey: "",
          fetch: vi.fn(),
        }),
    ).toThrow(/apiKey/);
  });

  it("throws when apiKey has wrong prefix", () => {
    expect(
      () =>
        new PromptHelm({
          apiKey: "sk_0123456789abcdef0123456789abcdef",
          fetch: vi.fn(),
        }),
    ).toThrow(/phk_/);
  });

  it("throws when apiKey has wrong length", () => {
    expect(
      () =>
        new PromptHelm({
          apiKey: "phk_short",
          fetch: vi.fn(),
        }),
    ).toThrow(/32 hex/);
  });

  it("throws on invalid baseURL", () => {
    expect(
      () =>
        new PromptHelm({
          apiKey: VALID_KEY,
          baseURL: "not a url",
          fetch: vi.fn(),
        }),
    ).toThrow(/baseURL/);
  });

  it("throws on non-positive timeout", () => {
    expect(
      () =>
        new PromptHelm({
          apiKey: VALID_KEY,
          timeout: 0,
          fetch: vi.fn(),
        }),
    ).toThrow(/timeout/);
  });

  it("throws on negative maxRetries", () => {
    expect(
      () =>
        new PromptHelm({
          apiKey: VALID_KEY,
          maxRetries: -1,
          fetch: vi.fn(),
        }),
    ).toThrow(/maxRetries/);
  });
});

describe("PromptHelm.execute", () => {
  it("sends authorization header and JSON body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ body: sampleResponse }));
    const client = new PromptHelm({ apiKey: VALID_KEY, fetch: fetchMock });
    const result = await client.execute({
      promptSlug: "welcome",
      variables: { name: "World" },
    });

    expect(result).toEqual(sampleResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("fetch was not called");
    }
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe("https://api.prompthelm.app/api/v1/gateway/execute");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${VALID_KEY}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(
      JSON.stringify({ promptSlug: "welcome", variables: { name: "World" } }),
    );
  });

  it("maps 401 to AuthenticationError without retry", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: 401,
        body: {
          statusCode: 401,
          error: "Unauthorized",
          message: "Invalid API key",
        },
      }),
    );
    const client = new PromptHelm({
      apiKey: VALID_KEY,
      fetch: fetchMock,
      maxRetries: 3,
    });
    await expect(client.execute({ promptSlug: "x" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 403 to AuthorizationError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: 403,
        body: {
          statusCode: 403,
          error: "Forbidden",
          message: "No access",
        },
      }),
    );
    const client = new PromptHelm({ apiKey: VALID_KEY, fetch: fetchMock });
    await expect(client.execute({ promptSlug: "x" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("maps 404 to NotFoundError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: 404,
        body: {
          statusCode: 404,
          error: "Not Found",
          message: "Missing",
        },
      }),
    );
    const client = new PromptHelm({ apiKey: VALID_KEY, fetch: fetchMock });
    await expect(client.execute({ promptSlug: "x" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("maps 429 to RateLimitError and does not retry", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: 429,
        body: {
          statusCode: 429,
          error: "Too Many Requests",
          message: "Slow down",
        },
      }),
    );
    const client = new PromptHelm({
      apiKey: VALID_KEY,
      fetch: fetchMock,
      maxRetries: 3,
    });
    await expect(client.execute({ promptSlug: "x" })).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 500 responses and eventually throws ApiError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        status: 500,
        body: {
          statusCode: 500,
          error: "Internal Server Error",
          message: "Boom",
        },
      }),
    );
    const client = new PromptHelm({
      apiKey: VALID_KEY,
      fetch: fetchMock,
      maxRetries: 2,
    });
    await expect(client.execute({ promptSlug: "x" })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 30_000);

  it("recovers when a retried request eventually succeeds", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts += 1;
      if (attempts < 2) {
        return jsonResponse({
          status: 502,
          body: {
            statusCode: 502,
            error: "Bad Gateway",
            message: "Upstream",
          },
        });
      }
      return jsonResponse({ body: sampleResponse });
    });
    const client = new PromptHelm({
      apiKey: VALID_KEY,
      fetch: fetchMock,
      maxRetries: 2,
    });
    const result = await client.execute({ promptSlug: "x" });
    expect(result).toEqual(sampleResponse);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("throws TimeoutError when the configured timeout is exceeded", async () => {
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const abortError = new Error("aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }
        }),
    );
    const client = new PromptHelm({
      apiKey: VALID_KEY,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      timeout: 20,
      maxRetries: 0,
    });
    await expect(client.execute({ promptSlug: "x" })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it("propagates external AbortSignal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const abortError = new Error("aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }
        }),
    );
    const client = new PromptHelm({
      apiKey: VALID_KEY,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
      maxRetries: 0,
    });
    const promise = client.execute(
      { promptSlug: "x" },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses a custom baseURL when provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ body: sampleResponse }));
    const client = new PromptHelm({
      apiKey: VALID_KEY,
      baseURL: "https://staging.prompthelm.app/",
      fetch: fetchMock,
    });
    await client.execute({ promptSlug: "x" });
    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error("fetch was not called");
    }
    const [url] = call as unknown as [string, RequestInit];
    expect(url).toBe("https://staging.prompthelm.app/api/v1/gateway/execute");
  });
});

describe("PromptHelm.stream", () => {
  function chunk(content: string): string {
    return `data: ${JSON.stringify({ type: "chunk", content })}\n\n`;
  }
  function done(): string {
    return `data: ${JSON.stringify({
      type: "done",
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      cost: 0.0001,
      model: "gpt-4o",
      latencyMs: 50,
    })}\n\n`;
  }
  function err(): string {
    return `data: ${JSON.stringify({
      type: "error",
      errorCode: "UPSTREAM_FAILURE",
      message: "Provider error",
      requestId: "req-9",
    })}\n\n`;
  }

  it("yields chunk events and terminates on done", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([chunk("Hello"), chunk(" world"), done()]),
    );
    const client = new PromptHelm({ apiKey: VALID_KEY, fetch: fetchMock });
    const events: StreamEvent[] = [];
    for await (const event of client.stream({ promptSlug: "x" })) {
      events.push(event);
    }
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "chunk", content: "Hello" });
    expect(events[1]).toMatchObject({ type: "chunk", content: " world" });
    expect(events[2]).toMatchObject({ type: "done", totalTokens: 3 });
  });

  it("throws when the server emits an error event", async () => {
    const fetchMock = vi.fn(async () => sseResponse([chunk("partial"), err()]));
    const client = new PromptHelm({ apiKey: VALID_KEY, fetch: fetchMock });
    const events: StreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of client.stream({ promptSlug: "x" })) {
          events.push(event);
        }
      })(),
    ).rejects.toBeInstanceOf(ApiError);
    expect(events).toHaveLength(1);
  });

  it("translates non-2xx responses into typed errors before streaming", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          statusCode: 401,
          error: "Unauthorized",
          message: "bad token",
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const client = new PromptHelm({ apiKey: VALID_KEY, fetch: fetchMock });
    await expect(
      (async () => {
        for await (const _event of client.stream({ promptSlug: "x" })) {
          // exhaust
        }
      })(),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("stops iteration when the external signal is aborted", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () =>
      sseResponse([chunk("a"), chunk("b"), chunk("c"), done()]),
    );
    const client = new PromptHelm({ apiKey: VALID_KEY, fetch: fetchMock });
    const events: StreamEvent[] = [];
    for await (const event of client.stream(
      { promptSlug: "x" },
      { signal: controller.signal },
    )) {
      events.push(event);
      controller.abort();
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.length).toBeLessThan(4);
  });
});
