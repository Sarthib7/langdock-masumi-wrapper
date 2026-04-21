/**
 * `GET /status`: optional custom handler, else reads from the in-memory job store.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { BridgeContext } from "./bridgeContext.js";
import { getJob } from "../services/jobs.js";
import type { StatusResponseBody } from "../types/masumi.js";

/** Registers the `/status` route (`job_id` or `jobId` query). */
export function registerStatus(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  app.get<{
    Querystring: { job_id?: string; jobId?: string };
  }>("/status", async (request, reply) => {
    const jobId = request.query.job_id ?? request.query.jobId;
    if (!jobId || !jobId.trim()) {
      return reply.status(400).send({ error: "Missing job_id query parameter" });
    }

    const trimmed = jobId.trim();

    const custom = ctx.endpointHandler.getStatusHandler();
    if (custom) {
      try {
        const out = await custom(trimmed);
        return reply.status(200).send(out);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(500).send({ error: msg });
      }
    }

    const job = getJob(trimmed);
    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }

    const body: StatusResponseBody = {
      id: randomUUID(),
      status: job.status,
    };
    if (job.status === "completed" && job.result !== undefined) {
      body.result = job.result;
    }
    if (job.status === "failed" && job.error) {
      body.error = job.error;
    }

    return reply.status(200).send(body);
  });
}
