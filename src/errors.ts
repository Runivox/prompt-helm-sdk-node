import type { ErrorEnvelope } from "./types.js";

export class PromptHelmError extends Error {
  public readonly statusCode: number;
  public readonly code: string | undefined;
  public readonly correlationId: string | undefined;

  constructor(
    statusCode: number,
    code: string | undefined,
    correlationId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "PromptHelmError";
    this.statusCode = statusCode;
    this.code = code;
    this.correlationId = correlationId;
  }
}

export class AuthenticationError extends PromptHelmError {
  constructor(
    statusCode: number,
    code: string | undefined,
    correlationId: string | undefined,
    message: string,
  ) {
    super(statusCode, code, correlationId, message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends PromptHelmError {
  constructor(
    statusCode: number,
    code: string | undefined,
    correlationId: string | undefined,
    message: string,
  ) {
    super(statusCode, code, correlationId, message);
    this.name = "AuthorizationError";
  }
}

export class RateLimitError extends PromptHelmError {
  constructor(
    statusCode: number,
    code: string | undefined,
    correlationId: string | undefined,
    message: string,
  ) {
    super(statusCode, code, correlationId, message);
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends PromptHelmError {
  constructor(
    statusCode: number,
    code: string | undefined,
    correlationId: string | undefined,
    message: string,
  ) {
    super(statusCode, code, correlationId, message);
    this.name = "NotFoundError";
  }
}

export class ApiError extends PromptHelmError {
  constructor(
    statusCode: number,
    code: string | undefined,
    correlationId: string | undefined,
    message: string,
  ) {
    super(statusCode, code, correlationId, message);
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

export function parseErrorResponse(
  status: number,
  body: unknown,
): PromptHelmError {
  const envelope = isErrorEnvelope(body) ? body : null;
  const message = envelope?.message ?? fallbackMessage(status);
  const code = envelope?.code;
  const correlationId = envelope?.correlationId;

  if (status === 401) {
    return new AuthenticationError(status, code, correlationId, message);
  }
  if (status === 403) {
    return new AuthorizationError(status, code, correlationId, message);
  }
  if (status === 404) {
    return new NotFoundError(status, code, correlationId, message);
  }
  if (status === 429) {
    return new RateLimitError(status, code, correlationId, message);
  }
  return new ApiError(status, code, correlationId, message);
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["statusCode"] === "number" &&
    typeof record["error"] === "string" &&
    typeof record["message"] === "string"
  );
}
