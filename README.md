# @prompt-helm/sdk

Official Node.js SDK for [PromptHelm](https://prompthelm.app) — call your managed prompts from any application.

PromptHelm is an enterprise LLMOps control plane: versioned prompts, encrypted provider keys, a multi-provider gateway (OpenAI, Anthropic, Gemini, DeepSeek), and first-class cost / latency / cache analytics. This SDK gives you a typed, ergonomic client for the PromptHelm gateway.

## Features

- Typed `execute` and `stream` methods backed by the PromptHelm gateway
- Native `fetch` and `AbortController` — no runtime dependencies
- Typed error hierarchy for auth, rate limit, and server failures
- Async iterable streaming with structured SSE events
- Configurable timeout and exponential-backoff retry for transient failures
- ESM and CJS builds, full TypeScript declarations, Node 18+

## Installation

```bash
npm install @prompt-helm/sdk
```

## Quickstart

```ts
import { PromptHelm } from "@prompt-helm/sdk";

const ph = new PromptHelm({
  apiKey: process.env.PROMPTHELM_API_KEY ?? "<your-api-token>",
});

const result = await ph.execute({
  promptSlug: "welcome-email",
  variables: { name: "World" },
});

console.log(result.output);
console.log(`Tokens: ${result.totalTokens}, cost: $${result.cost.toFixed(6)}`);
```

## Streaming

`stream` returns an async iterable of typed events. The iterator terminates after a `done` event and throws a typed error if the server emits an `error` event.

```ts
import { PromptHelm } from "@prompt-helm/sdk";

const ph = new PromptHelm({
  apiKey: process.env.PROMPTHELM_API_KEY ?? "<your-api-token>",
});

for await (const event of ph.stream({
  promptSlug: "release-notes",
  variables: { version: "1.4.0" },
})) {
  if (event.type === "chunk") {
    process.stdout.write(event.content);
  } else if (event.type === "done") {
    console.log(`\n[done] tokens=${event.totalTokens} cost=${event.cost}`);
  }
}
```

You can stop a stream early with an `AbortSignal`:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

for await (const event of ph.stream(
  { promptSlug: "long-form" },
  { signal: controller.signal },
)) {
  if (event.type === "chunk") {
    process.stdout.write(event.content);
  }
}
```

## Configuration

| Option       | Type                    | Default                        | Description                                                          |
| ------------ | ----------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `apiKey`     | `string`                | required                       | PromptHelm API key in the form `phk_<32 hex>`.                       |
| `baseURL`    | `string`                | `https://api.prompthelm.app`   | Override the API host for self-hosted or non-production deployments.  |
| `timeout`    | `number` (ms)           | `60000`                        | Per-request timeout. Aborts the underlying fetch on expiry.          |
| `maxRetries` | `number`                | `2`                            | Retries on network and 5xx errors. 4xx responses are never retried.  |
| `userAgent`  | `string`                | `—`                            | Prefix appended to the SDK's User-Agent. Use it to identify the calling app (e.g. `"checkout-service/1.4.2"`). |
| `headers`    | `Record<string,string>` | `{}`                           | Extra headers merged into every request.                             |
| `fetch`      | `typeof fetch`          | `globalThis.fetch`             | Inject a custom `fetch` implementation (used in tests).              |

## Retries, timeouts & streaming

This is the reference SDK that the other-language clients mirror, so its
transport behavior is deliberately precise:

- **Retries** apply to `execute` only. The client retries network failures and
  `5xx` responses with exponential backoff plus jitter, up to `maxRetries`
  (default `2`). `4xx` responses (`400`/`401`/`403`/`404`/`429`) are **never**
  retried, nor are timeouts or caller-initiated aborts. `stream` is not retried
  automatically — re-issue the call yourself if a stream fails.
- **Timeouts** are enforced per request via an internal `AbortController`. When
  `timeout` (default `60000` ms) elapses the underlying `fetch` is aborted and a
  `TimeoutError` is thrown. For streaming, the timeout covers establishing the
  response; long-lived streams that keep emitting events are not cut off by it.
- **Cancellation**: pass `options.signal` (an `AbortSignal`) to either method.
  Aborting cancels the in-flight HTTP request; for `stream` the iterator stops
  cleanly and the connection is released.
- **Streaming protocol**: `stream` consumes Server-Sent Events from
  `POST /api/v1/gateway/stream`. Each `data:` frame is a JSON `StreamEvent`
  (`chunk` | `done` | `error`). The iterator yields `chunk` and `done` events;
  an `error` event is thrown as an `ApiError` carrying `errorCode`, `message`,
  and `requestId`. The stream always ends after a `done` or `error` event.

## Error handling

Every non-2xx response is translated into a typed error so consumers can branch on failure modes:

```ts
import {
  PromptHelm,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ApiError,
  TimeoutError,
} from "@prompt-helm/sdk";

const ph = new PromptHelm({
  apiKey: process.env.PROMPTHELM_API_KEY ?? "<your-api-token>",
});

try {
  const result = await ph.execute({ promptSlug: "welcome-email" });
  return result.output;
} catch (err) {
  if (err instanceof AuthenticationError) {
    // Rotate or refresh the API key.
  } else if (err instanceof RateLimitError) {
    // Back off and retry later.
  } else if (err instanceof NotFoundError) {
    // The slug does not exist in this environment.
  } else if (err instanceof AuthorizationError) {
    // The key cannot access this prompt.
  } else if (err instanceof TimeoutError) {
    // The request exceeded the configured timeout.
  } else if (err instanceof ApiError) {
    // 5xx or unknown server error. Safe to retry with backoff.
  }
  throw err;
}
```

Every `PromptHelmError` exposes `statusCode`, `errorCode`, and `requestId` so failures can be filed against PromptHelm support with full traceability. Quote the `requestId` when contacting support — it correlates your call to the server-side execution log.

## API reference

### `new PromptHelm(config: PromptHelmConfig)`

Construct a client. Throws synchronously if `apiKey` is missing or malformed, if `baseURL` is invalid, or if `timeout` / `maxRetries` are out of range.

### `execute(request, options?): Promise<ExecuteResponse>`

Performs a single non-streaming gateway call.

`request` accepts:

- `promptSlug?: string` — managed prompt slug.
- `promptId?: string` — managed prompt id (alternative to `promptSlug`).
- `variables?: Record<string, string>` — template variables.
- `system?: string`, `user?: string` — ad-hoc messages.
- `model?: string` — override the prompt's default model.
- `temperature?`, `maxTokens?`, `topP?`, `stopSequences?` — provider parameters.
- `environment?: "production" | "development"` — which prompt branch to resolve.
- `timeoutMs?: number` — server-side execution deadline.

`options.signal` lets you cancel mid-flight.

### `stream(request, options?): AsyncIterable<StreamEvent>`

Same request shape as `execute`. Yields:

- `{ type: "chunk", content: string }` — incremental output.
- `{ type: "done", inputTokens, outputTokens, totalTokens, cost, model, latencyMs }` — final usage and pricing.

If the server emits `{ type: "error", errorCode, message, requestId }`, the iterator throws an `ApiError` exposing those fields. If the external `AbortSignal` fires, the iterator stops and the underlying HTTP request is cancelled.

## Versioning

`@prompt-helm/sdk` follows [Semantic Versioning](https://semver.org). Breaking changes will only ship on a major version bump. See the changelog for details.

## License

MIT — see [LICENSE](./LICENSE).
