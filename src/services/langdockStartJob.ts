/**
 * Default `start_job` implementation: single user UIMessage → Langdock completions.
 */

import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { StartJobHandler } from "../agentEndpointHandler.js";
import type { LangdockUIMessage } from "../types/langdock.js";
import { inputDataToPromptText } from "./inputMapping.js";
import {
  completeChat,
  extractAssistantContent,
  LangdockApiError,
} from "./langdock.js";

function assertLangdockEnv(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.langdockApiKey) missing.push("LANGDOCK_API_KEY");
  if (!config.langdockAgentId) missing.push("LANGDOCK_AGENT_ID");
  if (missing.length) {
    throw new Error(
      `Langdock start_job handler requires: ${missing.join(", ")}`,
    );
  }
}

/**
 * Returns a `StartJobHandler` that calls Langdock with env-based URL, key, and agent id.
 * Assistant reply text is parsed as JSON when it looks like JSON; otherwise returned as a string.
 */
export function createLangdockStartJobHandler(
  config: AppConfig,
): StartJobHandler {
  return async (
    identifierFromPurchaser: string,
    inputData: Record<string, unknown>,
  ): Promise<unknown> => {
    void identifierFromPurchaser;
    assertLangdockEnv(config);

    const userText = inputDataToPromptText(inputData);
    const messages: LangdockUIMessage[] = [
      {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", text: userText }],
      },
    ];

    const ldResponse = await completeChat({
      baseUrl: config.langdockBaseUrl,
      apiKey: config.langdockApiKey,
      agentId: config.langdockAgentId,
      messages,
    });
    const textOut = extractAssistantContent(ldResponse);
    if (textOut.trim().startsWith("{") || textOut.trim().startsWith("[")) {
      try {
        return JSON.parse(textOut) as unknown;
      } catch {
        return textOut;
      }
    }
    return textOut;
  };
}

export { LangdockApiError };
