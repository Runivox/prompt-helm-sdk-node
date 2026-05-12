import { describe, expect, it } from "vitest";
import { parseStreamEvent, readSseStream, SseParser } from "../stream.js";
import type { StreamEvent } from "../types.js";

function streamFromStrings(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
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
}

describe("SseParser", () => {
  it("parses framed events separated by blank lines", () => {
    const parser = new SseParser();
    const frames = parser.feed("data: hello\n\ndata: world\n\n");
    expect(frames).toEqual([{ data: "hello" }, { data: "world" }]);
  });

  it("joins multi-line data fields with newlines", () => {
    const parser = new SseParser();
    const frames = parser.feed("data: line1\ndata: line2\n\n");
    expect(frames).toEqual([{ data: "line1\nline2" }]);
  });

  it("ignores comment lines starting with colon", () => {
    const parser = new SseParser();
    const frames = parser.feed(": keep-alive\ndata: payload\n\n");
    expect(frames).toEqual([{ data: "payload" }]);
  });

  it("handles CRLF line endings", () => {
    const parser = new SseParser();
    const frames = parser.feed("data: a\r\n\r\ndata: b\r\n\r\n");
    expect(frames).toEqual([{ data: "a" }, { data: "b" }]);
  });

  it("buffers across feed boundaries", () => {
    const parser = new SseParser();
    expect(parser.feed("data: par")).toEqual([]);
    expect(parser.feed("tial\n\n")).toEqual([{ data: "partial" }]);
  });
});

describe("parseStreamEvent", () => {
  it("parses chunk events", () => {
    const event = parseStreamEvent(
      JSON.stringify({ type: "chunk", content: "Hello" }),
    );
    expect(event).toEqual({ type: "chunk", content: "Hello" });
  });

  it("parses done events", () => {
    const payload = {
      type: "done",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      cost: 0.001,
      model: "gpt-4o",
      latencyMs: 250,
    };
    expect(parseStreamEvent(JSON.stringify(payload))).toEqual(payload);
  });

  it("parses error events", () => {
    const payload = {
      type: "error",
      errorCode: "GATEWAY_FAILURE",
      message: "Upstream timeout",
      requestId: "req-1",
    };
    expect(parseStreamEvent(JSON.stringify(payload))).toEqual(payload);
  });

  it("returns null for malformed JSON", () => {
    expect(parseStreamEvent("not json")).toBeNull();
  });

  it("returns null for unrecognized event shape", () => {
    expect(parseStreamEvent(JSON.stringify({ type: "weird" }))).toBeNull();
  });

  it("returns null for [DONE] sentinel", () => {
    expect(parseStreamEvent("[DONE]")).toBeNull();
  });
});

describe("readSseStream", () => {
  it("yields parsed events from a ReadableStream", async () => {
    const body = streamFromStrings([
      `data: ${JSON.stringify({ type: "chunk", content: "Hi" })}\n\n`,
      `data: ${JSON.stringify({
        type: "done",
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        cost: 0.0001,
        model: "gpt-4o",
        latencyMs: 50,
      })}\n\n`,
    ]);
    const events: StreamEvent[] = [];
    for await (const event of readSseStream(body)) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "chunk", content: "Hi" });
    expect(events[1]).toMatchObject({ type: "done", totalTokens: 2 });
  });

  it("stops iteration when signal is aborted", async () => {
    const controller = new AbortController();
    const body = streamFromStrings([
      `data: ${JSON.stringify({ type: "chunk", content: "first" })}\n\n`,
      `data: ${JSON.stringify({ type: "chunk", content: "second" })}\n\n`,
    ]);
    const events: StreamEvent[] = [];
    for await (const event of readSseStream(body, controller.signal)) {
      events.push(event);
      controller.abort();
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.length).toBeLessThan(3);
  });
});
