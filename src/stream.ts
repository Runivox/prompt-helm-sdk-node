import type { StreamEvent } from "./types.js";

interface ParsedFrame {
  data: string;
}

export class SseParser {
  private buffer = "";
  private dataLines: string[] = [];

  public feed(chunk: string): ParsedFrame[] {
    this.buffer += chunk;
    const frames: ParsedFrame[] = [];

    let newlineIndex = this.indexOfLineEnd(this.buffer);
    while (newlineIndex.index !== -1) {
      const line = this.buffer.slice(0, newlineIndex.index);
      this.buffer = this.buffer.slice(newlineIndex.index + newlineIndex.length);

      if (line === "") {
        if (this.dataLines.length > 0) {
          frames.push({ data: this.dataLines.join("\n") });
          this.dataLines = [];
        }
      } else if (!line.startsWith(":")) {
        const colonIndex = line.indexOf(":");
        let field: string;
        let value: string;
        if (colonIndex === -1) {
          field = line;
          value = "";
        } else {
          field = line.slice(0, colonIndex);
          value = line.slice(colonIndex + 1);
          if (value.startsWith(" ")) {
            value = value.slice(1);
          }
        }
        if (field === "data") {
          this.dataLines.push(value);
        }
      }

      newlineIndex = this.indexOfLineEnd(this.buffer);
    }

    return frames;
  }

  public flush(): ParsedFrame[] {
    if (this.dataLines.length === 0) {
      return [];
    }
    const frame: ParsedFrame = { data: this.dataLines.join("\n") };
    this.dataLines = [];
    return [frame];
  }

  private indexOfLineEnd(input: string): { index: number; length: number } {
    const crlf = input.indexOf("\r\n");
    const lf = input.indexOf("\n");
    const cr = input.indexOf("\r");

    if (crlf !== -1 && (lf === -1 || crlf <= lf) && (cr === -1 || crlf <= cr)) {
      return { index: crlf, length: 2 };
    }
    if (lf !== -1 && (cr === -1 || lf < cr)) {
      return { index: lf, length: 1 };
    }
    if (cr !== -1) {
      return { index: cr, length: 1 };
    }
    return { index: -1, length: 0 };
  }
}

export function parseStreamEvent(data: string): StreamEvent | null {
  const trimmed = data.trim();
  if (trimmed === "" || trimmed === "[DONE]") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isStreamEvent(parsed)) {
    return null;
  }
  return parsed;
}

function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const type = record["type"];
  if (type === "chunk") {
    return typeof record["content"] === "string";
  }
  if (type === "done") {
    return (
      typeof record["inputTokens"] === "number" &&
      typeof record["outputTokens"] === "number" &&
      typeof record["totalTokens"] === "number" &&
      typeof record["cost"] === "number" &&
      typeof record["model"] === "string" &&
      typeof record["latencyMs"] === "number"
    );
  }
  if (type === "error") {
    return (
      typeof record["errorCode"] === "string" &&
      typeof record["message"] === "string"
    );
  }
  return false;
}

export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parser = new SseParser();

  const abortListener = (): void => {
    void reader.cancel().catch(() => {
      // Swallow cancel errors; the consumer already saw the abort.
    });
  };

  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", abortListener, { once: true });
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const tail = parser.flush();
        for (const frame of tail) {
          const event = parseStreamEvent(frame.data);
          if (event) {
            yield event;
          }
        }
        return;
      }
      const text = decoder.decode(value, { stream: true });
      const frames = parser.feed(text);
      for (const frame of frames) {
        const event = parseStreamEvent(frame.data);
        if (event) {
          yield event;
        }
      }
      if (signal?.aborted) {
        return;
      }
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abortListener);
    }
    reader.releaseLock();
  }
}
