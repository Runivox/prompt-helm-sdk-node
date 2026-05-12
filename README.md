# @prompthelm/sdk

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
npm install @prompthelm/sdk
```

## Quickstart

```ts
import { PromptHelm } from "@prompthelm/sdk";

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
import { PromptHelm } from "@prompthelm/sdk";

const ph = new PromptHelm({ apiKey: "<your-api-token>" });

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
| `baseURL`    | `string`                | `https://api.prompthelm.app`   | Override for self-hosted deployments or staging environments.        |
| `timeout`    | `number` (ms)           | `60000`                        | Per-request timeout. Aborts the underlying fetch on expiry.          |
| `maxRetries` | `number`                | `2`                            | Retries on network and 5xx errors. 4xx responses are never retried.  |
| `headers`    | `Record<string,string>` | `{}`                           | Extra headers merged into every request.                             |
| `fetch`      | `typeof fetch`          | `globalThis.fetch`             | Inject a custom `fetch` implementation (used in tests).              |

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
} from "@prompthelm/sdk";

const ph = new PromptHelm({ apiKey: "<your-api-token>" });

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

Every `PromptHelmError` exposes `statusCode`, `code`, and `correlationId` so failures can be filed against PromptHelm support with full traceability.

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

If the server emits `{ type: "error" }`, the iterator throws an `ApiError`. If the external `AbortSignal` fires, the iterator stops and the underlying HTTP request is cancelled.

## Versioning

`@prompthelm/sdk` follows [Semantic Versioning](https://semver.org). Breaking changes will only ship on a major version bump. See the changelog for details.

## License

MIT — see [LICENSE](./LICENSE).
