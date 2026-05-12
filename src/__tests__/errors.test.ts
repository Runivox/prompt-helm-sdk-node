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
      error: "Unauthorized",
      message: "Invalid token",
      code: "AUTH_INVALID",
      correlationId: "corr-1",
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("AUTH_INVALID");
    expect(err.correlationId).toBe("corr-1");
    expect(err.message).toBe("Invalid token");
  });

  it("maps 403 to AuthorizationError", () => {
    const err = parseErrorResponse(403, {
      statusCode: 403,
      error: "Forbidden",
      message: "No access",
    });
    expect(err).toBeInstanceOf(AuthorizationError);
  });

  it("maps 404 to NotFoundError", () => {
    const err = parseErrorResponse(404, {
      statusCode: 404,
      error: "Not Found",
      message: "Prompt does not exist",
    });
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it("maps 429 to RateLimitError", () => {
    const err = parseErrorResponse(429, {
      statusCode: 429,
      error: "Too Many Requests",
      message: "Slow down",
    });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it("maps 500 and other statuses to ApiError", () => {
    const err = parseErrorResponse(503, {
      statusCode: 503,
      error: "Service Unavailable",
      message: "Try again later",
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
