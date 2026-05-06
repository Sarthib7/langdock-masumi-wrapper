/**
 * Subset of Langdock Agent API types for `POST /agent/v1/chat/completions` (non-streaming).
 */

export type LangdockTextPart = {
  type: "text";
  text: string;
};

export type LangdockMessagePart =
  | LangdockTextPart
  | {
      type: string;
      [key: string]: unknown;
    };

export type LangdockUIMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: LangdockMessagePart[];
  content?: string;
  metadata?: Record<string, unknown>;
};

export type LangdockChatCompletionsRequest = {
  agentId: string;
  messages: LangdockUIMessage[];
  stream: boolean;
};

/** Parsed JSON from Langdock; may include `messages` and/or structured `output`. */
export type LangdockChatCompletionsResponse = {
  messages?: LangdockUIMessage[];
  id?: string;
  role?: "assistant";
  parts?: LangdockMessagePart[];
  output?: unknown;
  [key: string]: unknown;
};
