/**
 * HTTP client for Langdock Agent chat completions and response parsing.
 */

import type {
  LangdockChatCompletionsRequest,
  LangdockChatCompletionsResponse,
  LangdockMessagePart,
  LangdockUIMessage,
} from "../types/langdock.js";

/** Concatenates `text` parts from a UIMessage `parts` array. */
function joinTextParts(parts: LangdockMessagePart[] | undefined): string {
  if (!parts?.length) return "";
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function assistantText(message: LangdockUIMessage | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string" && message.content.length > 0) {
    return message.content;
  }
  return joinTextParts(message.parts);
}

/**
 * Reads assistant text from a non-streaming completions response:
 * prefers `output`, else the last assistant `messages` entry.
 */
export function extractAssistantContent(
  data: LangdockChatCompletionsResponse,
): string {
  if (data.output !== undefined && data.output !== null) {
    if (typeof data.output === "string") return data.output;
    try {
      return JSON.stringify(data.output);
    } catch {
      return String(data.output);
    }
  }

  const rootPartsText = joinTextParts(data.parts);
  if (rootPartsText) return rootPartsText;

  const messages = data.messages;
  if (!messages?.length) return "";

  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const last =
    assistantMessages[assistantMessages.length - 1] ?? messages[messages.length - 1];
  return assistantText(last);
}

/** Arguments for `completeChat`. */
export type CompleteChatParams = {
  baseUrl: string;
  apiKey: string;
  agentId: string;
  messages: LangdockUIMessage[];
};

/** Thrown when the HTTP status is not OK or the body is not JSON. */
export class LangdockApiError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(status: number, bodySnippet: string) {
    super(`Langdock API error: HTTP ${status}`);
    this.name = "LangdockApiError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

/**
 * `POST {baseUrl}/agent/v1/chat/completions` with Bearer auth and `stream: false`.
 */
export async function completeChat(
  params: CompleteChatParams,
): Promise<LangdockChatCompletionsResponse> {
  const url = `${params.baseUrl.replace(/\/$/, "")}/agent/v1/chat/completions`;
  const body: LangdockChatCompletionsRequest = {
    agentId: params.agentId,
    messages: params.messages,
    stream: false,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: LangdockChatCompletionsResponse;
  try {
    json = JSON.parse(text) as LangdockChatCompletionsResponse;
  } catch {
    throw new LangdockApiError(res.status, text.slice(0, 500));
  }

  if (!res.ok) {
    throw new LangdockApiError(res.status, text.slice(0, 500));
  }

  return json;
}
