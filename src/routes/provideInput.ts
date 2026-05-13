/**
 * `POST /provide_input` (MIP-003 HITL).
 *
 * In Langdock HITL chat mode this accepts the next user message for a job in
 * `awaiting_input`, calls Langdock with the accumulated conversation, and moves
 * the job back to `awaiting_input` with the latest answer. Sending DONE completes
 * the job and submits the final transcript hash to Masumi.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { findAgentProfile, loadConfig } from "../config.js";
import {
  computeCanonicalJsonHash,
  computeInputHash,
} from "../services/hashing.js";
import {
  continueHitlChatJob,
  inputObjectToMessage,
} from "../services/hitlChat.js";
import { getJob } from "../services/jobs.js";
import { verifyOpaqueToken } from "../services/opaqueTokens.js";
import { checkRateLimit } from "../services/rateLimit.js";

export type ProvideInputBody = {
  job_id?: unknown;
  jobId?: unknown;
  id?: unknown;
  status_id?: unknown;
  statusId?: unknown;
  input_token?: unknown;
  inputToken?: unknown;
  continuationToken?: unknown;
  input_schema_hash?: unknown;
  inputSchemaHash?: unknown;
  input_data?: unknown;
  inputData?: unknown;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeInputData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const item of value) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { key?: unknown }).key === "string"
      ) {
        out[(item as { key: string }).key] = (item as { value?: unknown }).value;
      }
    }
    return out;
  }
  return value as Record<string, unknown>;
}

export function registerProvideInput(app: FastifyInstance): void {
  async function handleProvideInput(
    request: FastifyRequest,
    reply: FastifyReply,
    routeAgentSlug?: string,
  ) {
    const body =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as ProvideInputBody)
        : {};

    const jobId = str(body.job_id) ?? str(body.jobId) ?? str(body.id);
    if (!jobId) {
      return reply.status(400).send({
        error: "INVALID_INPUT",
        message: "job_id is required",
      });
    }

    const rateLimit = checkRateLimit({
      scope: "provide-input",
      identifier: `${request.ip}:${jobId}`,
      limit: 20,
      windowMs: 60 * 1000,
    });
    reply.header("x-ratelimit-limit", String(rateLimit.limit));
    reply.header("x-ratelimit-remaining", String(rateLimit.remaining));
    reply.header("x-ratelimit-reset", String(Math.ceil(rateLimit.resetAt / 1000)));
    if (!rateLimit.allowed) {
      return reply
        .header("retry-after", String(rateLimit.retryAfterSeconds))
        .status(429)
        .send({
          error: "RATE_LIMITED",
          message: "Too many HITL continuation requests. Try again later.",
        });
    }

    const inputData = normalizeInputData(
      body.input_data !== undefined ? body.input_data : body.inputData,
    );
    if (!inputData) {
      return reply.status(400).send({
        error: "INVALID_INPUT",
        message: "input_data must be an object or an array of {key,value} items",
      });
    }

    const job = getJob(jobId);
    if (!job) {
      return reply.status(404).send({
        error: "JOB_NOT_FOUND",
        message: `No job exists with ID: ${jobId}`,
      });
    }
    if (routeAgentSlug) {
      const config = loadConfig();
      const agent = findAgentProfile(config, routeAgentSlug);
      if (!agent) {
        return reply.status(404).send({
          error: "AGENT_NOT_FOUND",
          message: `No agent is configured for slug: ${routeAgentSlug}`,
        });
      }
      if (job.agent_slug !== agent.slug) {
        return reply.status(404).send({
          error: "JOB_NOT_FOUND",
          message: `No job exists with ID: ${jobId}`,
        });
      }
    }

    const headerToken = request.headers["x-job-token"];
    const providedToken =
      str(body.input_token) ??
      str(body.inputToken) ??
      str(body.continuationToken) ??
      (typeof headerToken === "string" ? headerToken : undefined);
    const hasValidToken = Boolean(
      job.continuation_token_hash &&
        providedToken &&
        verifyOpaqueToken(providedToken, job.continuation_token_hash),
    );
    const providedInputSchemaHash =
      str(body.input_schema_hash) ?? str(body.inputSchemaHash);
    const hasMatchingRoutedSchemaHash = Boolean(
      routeAgentSlug &&
        providedInputSchemaHash &&
        job.awaiting_input_schema &&
        computeCanonicalJsonHash(job.awaiting_input_schema) ===
          providedInputSchemaHash,
    );
    if (
      !hasValidToken &&
      !hasMatchingRoutedSchemaHash
    ) {
      return reply.status(403).send({
        error: "HITL_TOKEN_REQUIRED",
        message:
          "A valid HITL continuation token or matching routed input_schema_hash is required.",
      });
    }

    if (job.status !== "awaiting_input") {
      return reply.status(400).send({
        error: "JOB_NOT_AWAITING_INPUT",
        message: `job is not awaiting input (status=${job.status})`,
      });
    }

    const config = loadConfig();
    if (!config.hitlChatMode) {
      return reply.status(501).send({
        error: "HITL_CHAT_DISABLED",
        message: "Set HITL_CHAT_MODE=true to enable /provide_input chat continuations.",
      });
    }

    let input_hash: string;
    try {
      input_hash = computeInputHash(job.identifierFromPurchaser, inputData);
    } catch (e) {
      return reply.status(400).send({
        error: "INVALID_INPUT",
        message: e instanceof Error ? e.message : String(e),
      });
    }

    const message = inputObjectToMessage(inputData);
    if (message.length > 16_000) {
      return reply.status(413).send({
        error: "INPUT_TOO_LARGE",
        message: "HITL messages must be 16000 characters or fewer.",
      });
    }
    const updated = await continueHitlChatJob({ job, message, config });

    return reply.status(200).send({
      input_hash,
      inputHash: input_hash,
      signature: "",
      status: updated?.status ?? "failed",
      job_id: jobId,
      result: updated?.result,
      output_hash: updated?.output_hash,
      error: updated?.error,
    });
  }

  app.post("/provide_input", async (request, reply) => {
    return handleProvideInput(request, reply);
  });

  app.post<{ Params: { agentSlug: string } }>(
    "/agents/:agentSlug/provide_input",
    async (request, reply) => {
      return handleProvideInput(request, reply, request.params.agentSlug);
    },
  );
}
