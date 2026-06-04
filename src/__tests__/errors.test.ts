import { describe, expect, it } from "vitest";
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  parseErrorResponse,
  PromptHelmError,
  RateLimitError,
  TimeoutError,
} from "../errors.js";

describe("parseErrorResponse", () => {
  it("maps 401 to AuthenticationError", () => {
    const err = parseErrorResponse(401, {
      statusCode: 401,
      errorCode: "UNAUTHORIZED",
      message: "Invalid token",
      timestamp: "2026-06-05T00:00:00.000Z",
      requestId: "req-1",
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(err.errorCode).toBe("UNAUTHORIZED");
    expect(err.requestId).toBe("req-1");
    expect(err.message).toBe("Invalid token");
  });

  it("joins array messages from validation errors", () => {
    const err = parseErrorResponse(400, {
      statusCode: 400,
      errorCode: "VALIDATION_ERROR",
      message: ["promptId is required", "environment is invalid"],
      timestamp: "2026-06-05T00:00:00.000Z",
      requestId: "req-2",
    });
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("promptId is required; environment is invalid");
    expect(err.errorCode).toBe("VALIDATION_ERROR");
  });

  it("maps 403 to AuthorizationError", () => {
    const err = parseErrorResponse(403, {
      statusCode: 403,
      errorCode: "FORBIDDEN",
      message: "No access",
      timestamp: "2026-06-05T00:00:00.000Z",
      requestId: "req-3",
    });
    expect(err).toBeInstanceOf(AuthorizationError);
  });

  it("maps 404 to NotFoundError", () => {
    const err = parseErrorResponse(404, {
      statusCode: 404,
      errorCode: "PROMPT_VERSION_NOT_FOUND",
      message: "Prompt does not exist",
      timestamp: "2026-06-05T00:00:00.000Z",
      requestId: "req-4",
    });
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("maps 429 to RateLimitError", () => {
    const err = parseErrorResponse(429, {
      statusCode: 429,
      errorCode: "TOO_MANY_REQUESTS",
      message: "Slow down",
      timestamp: "2026-06-05T00:00:00.000Z",
      requestId: "req-5",
    });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("maps 500 and other statuses to ApiError", () => {
    const err = parseErrorResponse(503, {
      statusCode: 503,
      errorCode: "INTERNAL_ERROR",
      message: "Try again later",
      timestamp: "2026-06-05T00:00:00.000Z",
      requestId: "req-6",
    });
    expect(err).toBeInstanceOf(ApiError);
  });

  it("uses fallback message when body is not a recognizable envelope", () => {
    const err = parseErrorResponse(500, null);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain("internal error");
  });

  it("all subclasses inherit PromptHelmError", () => {
    const err = parseErrorResponse(401, null);
    expect(err).toBeInstanceOf(PromptHelmError);
  });

  it("TimeoutError carries the configured timeout", () => {
    const err = new TimeoutError(1500);
    expect(err.name).toBe("TimeoutError");
    expect(err.timeoutMs).toBe(1500);
    expect(err.message).toContain("1500");
  });
});
