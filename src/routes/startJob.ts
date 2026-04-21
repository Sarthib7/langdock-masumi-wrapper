/**
 * `POST /start_job`: MIP-004 hash, job row, invokes registered `start_job` handler, returns payment-shaped fields.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { BridgeContext } from "./bridgeContext.js";
import { loadConfig, resolveAgentDisplayIdentity } from "../config.js";
import { computeInputHash } from "../services/hashing.js";
import { setJobStatus, createJob } from "../services/jobs.js";
import { LangdockApiError } from "../services/langdock.js";
import type { StartJobResponseBody } from "../types/masumi.js";
import { normalizeStartJobBody } from "../utils/startJobBody.js";

/** Registers the `/start_job` route. */
export function registerStartJob(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  app.post("/start_job", async (request, reply) => {
    const body =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};

    const { identifierFromPurchaser, inputData } = normalizeStartJobBody(body);

    const startHandler = ctx.endpointHandler.getStartJobHandler();
    if (!startHandler) {
      return reply.status(500).send({
        error: "Start job handler not configured",
      });
    }

    let input_hash: string;
    try {
      input_hash = computeInputHash(identifierFromPurchaser, inputData);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: `input_hash: ${msg}` });
    }

    const jobId = randomUUID();
    const blockchainIdentifier = `block_${jobId}`;
    const config = loadConfig();
    const { agentIdentifier, sellerVKey } = resolveAgentDisplayIdentity(config);

    createJob({
      id: jobId,
      blockchainIdentifier,
      identifierFromPurchaser,
      input_hash,
      status: "running",
    });

    try {
      const result = await startHandler(identifierFromPurchaser, inputData);
      setJobStatus(jobId, "completed", { result });
    } catch (e) {
      const errMsg =
        e instanceof LangdockApiError
          ? `Langdock HTTP ${e.status}: ${e.bodySnippet}`
          : e instanceof Error
            ? e.message
            : String(e);
      setJobStatus(jobId, "failed", { error: errMsg });

      const statusCode = e instanceof LangdockApiError ? 502 : 500;
      return reply.status(statusCode).send({
        error: "Agent execution failed",
        id: jobId,
        inputHash: input_hash,
      });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const resBody: StartJobResponseBody = {
      id: jobId,
      blockchainIdentifier,
      agentIdentifier,
      sellerVKey,
      identifierFromPurchaser,
      inputHash: input_hash,
      payByTime: nowSec + config.payByOffsetSec,
      submitResultTime: nowSec + config.submitResultOffsetSec,
      unlockTime: nowSec + config.unlockOffsetSec,
      externalDisputeUnlockTime:
        nowSec + config.externalDisputeUnlockOffsetSec,
    };

    return reply.status(200).send(resBody);
  });
}
