export type Environment = "production" | "development";

export interface ExecuteRequest {
  promptSlug?: string;
  promptId?: string;
  variables?: Record<string, string>;
  system?: string;
  user?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  environment?: Environment;
  timeoutMs?: number;
}

export interface ExecuteResponse {
  id: string;
  output: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  cost: number;
  timestamp: string;
}

export interface StreamChunkEvent {
  type: "chunk";
  content: string;
}

export interface StreamDoneEvent {
  type: "done";
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  model: string;
  latencyMs: number;
}

export interface StreamErrorEvent {
  type: "error";
  errorCode: string;
  message: string;
  requestId?: string;
}

export type StreamEvent = StreamChunkEvent | StreamDoneEvent | StreamErrorEvent;

/**
 * JSON error envelope returned by the PromptHelm API for non-2xx responses.
 * All five fields are always present on the wire; `message` may be a single
 * string or an array of validation messages.
 */
export interface ErrorEnvelope {
  statusCode: number;
  errorCode: string;
  message: string | string[];
  timestamp: string;
  requestId: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
}
