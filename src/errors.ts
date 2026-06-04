import type { ErrorEnvelope } from "./types.js";

export class PromptHelmError extends Error {
  /** HTTP status code (or the inferred status for SSE error events). */
  public readonly statusCode: number;
  /** Machine-readable error code from the API envelope, e.g. `VALIDATION_ERROR`. */
  public readonly errorCode: string | undefined;
  /** Request correlation id — quote this when contacting PromptHelm support. */
  public readonly requestId: string | undefined;

  constructor(
    statusCode: number,
    errorCode: string | undefined,
    requestId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "PromptHelmError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.requestId = requestId;
  }
}

export class AuthenticationError extends PromptHelmError {
  constructor(
    statusCode: number,
    errorCode: string | undefined,
    requestId: string | undefined,
    message: string,
  ) {
    super(statusCode, errorCode, requestId, message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends PromptHelmError {
  constructor(
    statusCode: number,
    errorCode: string | undefined,
    requestId: string | undefined,
    message: string,
  ) {
    super(statusCode, errorCode, requestId, message);
    this.name = "AuthorizationError";
  }
}

export class RateLimitError extends PromptHelmError {
  constructor(
    statusCode: number,
    errorCode: string | undefined,
    requestId: string | undefined,
    message: string,
  ) {
    super(statusCode, errorCode, requestId, message);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends PromptHelmError {
  constructor(
    statusCode: number,
    errorCode: string | undefined,
    requestId: string | undefined,
    message: string,
  ) {
    super(statusCode, errorCode, requestId, message);
    this.name = "NotFoundError";
  }
}

export class ApiError extends PromptHelmError {
  constructor(
    statusCode: number,
    errorCode: string | undefined,
    requestId: string | undefined,
    message: string,
  ) {
    super(statusCode, errorCode, requestId, message);
    this.name = "ApiError";
  }
}

export class TimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Request timed out after ${String(timeoutMs)}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

function fallbackMessage(status: number): string {
  if (status === 401) {
    return "Authentication failed. Check that your API key is valid and not revoked.";
  }
  if (status === 403) {
    return "You do not have permission to perform this action.";
  }
  if (status === 404) {
    return "The requested prompt or resource was not found.";
  }
  if (status === 429) {
    return "Rate limit exceeded. Slow down requests or upgrade your plan.";
  }
  if (status >= 500) {
    return "PromptHelm encountered an internal error. The request can be retried.";
  }
  return `Request failed with status ${String(status)}.`;
}

function normalizeMessage(message: string | string[]): string {
  return Array.isArray(message) ? message.join("; ") : message;
}

export function parseErrorResponse(
  status: number,
  body: unknown,
): PromptHelmError {
  const envelope = isErrorEnvelope(body) ? body : null;
  const message = envelope
    ? normalizeMessage(envelope.message)
    : fallbackMessage(status);
  const errorCode = envelope?.errorCode;
  const requestId = envelope?.requestId;
  const statusCode = envelope?.statusCode ?? status;

  if (statusCode === 401) {
    return new AuthenticationError(statusCode, errorCode, requestId, message);
  }
  if (statusCode === 403) {
    return new AuthorizationError(statusCode, errorCode, requestId, message);
  }
  if (statusCode === 404) {
    return new NotFoundError(statusCode, errorCode, requestId, message);
  }
  if (statusCode === 429) {
    return new RateLimitError(statusCode, errorCode, requestId, message);
  }
  return new ApiError(statusCode, errorCode, requestId, message);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const message = record["message"];
  const messageOk =
    typeof message === "string" ||
    (Array.isArray(message) &&
      message.every((item) => typeof item === "string"));
  return (
    typeof record["statusCode"] === "number" &&
    typeof record["errorCode"] === "string" &&
    messageOk
  );
}
