/**
 * Langdock-backed continuous HITL chat support for MIP-003 `/provide_input`.
 *
 * A paid job can stay in `awaiting_input` after each assistant answer. Sokosumi
 * can then call `/provide_input` with the next user message. The job only
 * becomes `completed` and submits the final MIP-004 result hash when the user
 * sends `DONE`.
 */

import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { InputDataItem, JobRecord } from "../types/masumi.js";
import type { LangdockUIMessage } from "../types/langdock.js";
import { computeOutputHash, stringifyForHash } from "./hashing.js";
import { inputDataToPromptText } from "./inputMapping.js";
import { setJobStatus } from "./jobs.js";
import { completeChat, extractAssistantContent } from "./langdock.js";
import { MasumiPaymentClient } from "./masumiPayment.js";

const HITL_INPUT_SCHEMA = {
  input_data: [
    {
      id: "message",
      type: "string",
      name: "Reply",
      data: {
        description:
          "Continue the chat with Lexi. Use the action below, or type DONE when you want to finish and submit the final transcript.",
        placeholder: "Ask a follow-up...",
      },
    },
    {
      id: "finish",
      type: "boolean",
      name: "Finish conversation",
      data: {
        description: "Turn this on only when you are done. Default/off means continue the chat.",
      },
      validations: [{ validation: "optional", value: "true" }],
    },
  ],
};

export function hitlInputSchema(): typeof HITL_INPUT_SCHEMA {
  return HITL_INPUT_SCHEMA;
}

export function isDoneMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return normalized === "done" || normalized === "finish" || normalized === "submit";
}

function assertLangdockEnv(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.langdockApiKey) missing.push("LANGDOCK_API_KEY");
  if (!config.langdockAgentId) missing.push("LANGDOCK_AGENT_ID");
  if (missing.length) {
    throw new Error(`Langdock HITL chat requires: ${missing.join(", ")}`);
  }
}

function textMessage(
  role: "user" | "assistant" | "system",
  text: string,
): LangdockUIMessage {
  return {
    id: randomUUID(),
    role,
    parts: [{ type: "text", text }],
  };
}

function messageText(message: LangdockUIMessage): string {
  if (typeof message.content === "string" && message.content.length > 0) {
    return message.content;
  }
  return message.parts
    .filter((part): part is { type: string; text: string } => typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

export function formatConversationTranscript(messages: LangdockUIMessage[]): string {
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => `${message.role === "user" ? "User" : "Lexi"}: ${messageText(message)}`)
    .join("\n\n");
}

export function inputObjectToMessage(inputData: Record<string, unknown>): string {
  for (const key of ["finish", "done", "submit", "action"]) {
    const value = inputData[key];
    if (value === true) return "DONE";
    if (typeof value === "string" && isDoneMessage(value)) return "DONE";
  }

  for (const key of ["message", "text", "query", "answer", "prompt"]) {
    const value = inputData[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  for (const value of Object.values(inputData)) {
    if (value === true) return "DONE";
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return stringifyForHash(inputData);
}

async function callLangdockChat(
  config: AppConfig,
  messages: LangdockUIMessage[],
): Promise<{ assistantText: string; messages: LangdockUIMessage[] }> {
  assertLangdockEnv(config);
  const response = await completeChat({
    baseUrl: config.langdockBaseUrl,
    apiKey: config.langdockApiKey,
    agentId: config.langdockAgentId,
    messages,
  });
  const assistantText = extractAssistantContent(response);
  return {
    assistantText,
    messages: [...messages, textMessage("assistant", assistantText)],
  };
}

export async function startHitlChatJob(args: {
  jobId: string;
  inputData: InputDataItem[];
  config: AppConfig;
}): Promise<void> {
  setJobStatus(args.jobId, "running", { error: undefined });
  try {
    const firstUserMessage = inputDataToPromptText(args.inputData);
    const { assistantText, messages } = await callLangdockChat(args.config, [
      textMessage("user", firstUserMessage),
    ]);
    setJobStatus(args.jobId, "awaiting_input", {
      result: assistantText,
      conversation: messages,
      awaiting_input_schema: HITL_INPUT_SCHEMA,
      awaiting_input_message:
        "Reply to continue chatting with Lexi, or type DONE to finish and submit the transcript.",
      error: undefined,
    });
  } catch (e) {
    setJobStatus(args.jobId, "failed", {
      error: e instanceof Error ? e.message : String(e),
      failedAt: Date.now(),
    });
  }
}

export async function continueHitlChatJob(args: {
  job: JobRecord;
  message: string;
  config: AppConfig;
}): Promise<JobRecord | undefined> {
  const existingMessages = (args.job.conversation ?? []) as LangdockUIMessage[];

  if (isDoneMessage(args.message)) {
    const transcript = formatConversationTranscript(existingMessages);
    const outputHash = computeOutputHash(
      args.job.identifierFromPurchaser,
      stringifyForHash(transcript),
    );

    const completed = setJobStatus(args.job.id, "completed", {
      result: transcript,
      output_hash: outputHash,
      completedAt: Date.now(),
      awaiting_input_message: undefined,
      error: undefined,
    });

    if (args.config.paymentMode === "masumi") {
      const client = new MasumiPaymentClient({
        baseUrl: args.config.paymentServiceUrl,
        apiKey: args.config.paymentApiKey,
        authHeader: args.config.paymentApiAuthHeader,
        network: args.config.masumiNetwork,
      });
      try {
        await client.submitResult({
          blockchainIdentifier: args.job.blockchainIdentifier,
          submitResultHash: outputHash,
        });
      } catch (e) {
        return setJobStatus(args.job.id, "failed", {
          error: `Failed to submit result hash on-chain: ${
            e instanceof Error ? e.message : String(e)
          }`,
          failedAt: Date.now(),
        });
      }
    }

    return completed;
  }

  setJobStatus(args.job.id, "running", { error: undefined });
  try {
    const messages = [...existingMessages, textMessage("user", args.message)];
    const { assistantText, messages: updatedMessages } = await callLangdockChat(
      args.config,
      messages,
    );
    return setJobStatus(args.job.id, "awaiting_input", {
      result: assistantText,
      conversation: updatedMessages,
      awaiting_input_schema: HITL_INPUT_SCHEMA,
      awaiting_input_message:
        "Reply to continue chatting with Lexi, or type DONE to finish and submit the transcript.",
      error: undefined,
    });
  } catch (e) {
    return setJobStatus(args.job.id, "failed", {
      error: e instanceof Error ? e.message : String(e),
      failedAt: Date.now(),
    });
  }
}
