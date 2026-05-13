/**
 * `GET /status` (MIP-003 §2). Supports `job_id` and `jobId` query aliases.
 * Returns `input_hash`, `output_hash`, result, timestamps, and payment info.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { BridgeContext } from "./bridgeContext.js";
import { findAgentProfile, loadConfig } from "../config.js";
import { getJob } from "../services/jobs.js";
import type { StatusResponseBody } from "../types/masumi.js";

function toIsoSeconds(msOrNumber: number | undefined): string | undefined {
  if (msOrNumber === undefined) return undefined;
  // `createdAt` is ms since epoch; Unix-second fields are much smaller.
  const ms = msOrNumber > 1e12 ? msOrNumber : msOrNumber * 1000;
  return new Date(ms).toISOString();
}

export function registerStatus(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  async function handleStatus(
    reply: FastifyReply,
    jobId: string | undefined,
    agentSlug?: string,
  ) {
    let normalizedAgentSlug: string | undefined;
    if (agentSlug) {
      const config = loadConfig();
      const agent = findAgentProfile(config, agentSlug);
      if (!agent) {
        return reply.status(404).send({
          error: "AGENT_NOT_FOUND",
          message: `No agent is configured for slug: ${agentSlug}`,
        });
      }
      normalizedAgentSlug = agent.slug;
    }

    if (!jobId || !jobId.trim()) {
      return reply.status(400).send({
        error: "INVALID_INPUT",
        message: "Missing job_id query parameter",
      });
    }

    const trimmed = jobId.trim();

    const custom = ctx.endpointHandler.getStatusHandler();
    if (custom) {
      try {
        const out = await custom(trimmed);
        return reply.status(200).send(out);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(500).send({
          error: "STATUS_HANDLER_ERROR",
          message: msg,
        });
      }
    }

    const job = getJob(trimmed);
    if (!job) {
      return reply.status(404).send({
        error: "JOB_NOT_FOUND",
        message: `No job exists with ID: ${trimmed}`,
      });
    }
    if (normalizedAgentSlug && job.agent_slug !== normalizedAgentSlug) {
      return reply.status(404).send({
        error: "JOB_NOT_FOUND",
        message: `No job exists with ID: ${trimmed}`,
      });
    }

    const body: StatusResponseBody = {
      job_id: job.id,
      status: job.status,
      input_hash: job.input_hash,
      blockchain_identifier: job.blockchainIdentifier,
      created_at: toIsoSeconds(job.createdAt),
    };
    if (job.result !== undefined) {
      body.result = job.result;
      body.output = job.result;
    }
    if (job.output_hash) body.output_hash = job.output_hash;
    if (job.status === "awaiting_input") {
      body.input_schema = job.awaiting_input_schema;
      if (job.awaiting_input_message) {
        body.message = job.awaiting_input_message;
        body.Message = job.awaiting_input_message;
      }
    }
    if (job.error) {
      body.error = job.error;
      body.message = job.error;
    }
    if (job.completedAt) body.completed_at = toIsoSeconds(job.completedAt);
    if (job.failedAt) body.failed_at = toIsoSeconds(job.failedAt);

    return reply.status(200).send(body);
  }

  app.get<{
    Querystring: { job_id?: string; jobId?: string };
  }>("/status", async (request, reply) => {
    return handleStatus(reply, request.query.job_id ?? request.query.jobId);
  });

  app.get<{
    Params: { agentSlug: string };
    Querystring: { job_id?: string; jobId?: string };
  }>("/agents/:agentSlug/status", async (request, reply) => {
    return handleStatus(
      reply,
      request.query.job_id ?? request.query.jobId,
      request.params.agentSlug,
    );
  });
}
