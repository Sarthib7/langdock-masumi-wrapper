/**
 * `POST /start_job` (MIP-003 §1).
 *
 * 1. Normalise body → canonical MIP-003 `input_data` array.
 * 2. Compute MIP-004 `input_hash`.
 * 3. In `masumi` mode: register a sale on the Payment Service → receive
 *    `blockchainIdentifier` and authoritative payment timings, return
 *    `status: "awaiting_payment"`, then run the handler asynchronously once
 *    funds are locked on-chain.
 * 4. In `direct` mode: fabricate timings, return `status: "awaiting_payment"`
 *    (immediately transitions to `running`/`completed`), run the handler
 *    asynchronously for local development.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { BridgeContext } from "./bridgeContext.js";
import { loadConfig, resolveAgentDisplayIdentity } from "../config.js";
import { computeInputHash } from "../services/hashing.js";
import { createJob } from "../services/jobs.js";
import { runDirect, runWithPayment } from "../services/jobRunner.js";
import {
  MasumiPaymentClient,
  MasumiPaymentError,
} from "../services/masumiPayment.js";
import type { StartJobResponseBody } from "../types/masumi.js";
import { normalizeStartJobBody } from "../utils/startJobBody.js";

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
        error: "START_JOB_HANDLER_MISSING",
        message: "No start_job handler is configured",
      });
    }

    let input_hash: string;
    try {
      input_hash = computeInputHash(identifierFromPurchaser, inputData);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({
        error: "INVALID_INPUT",
        message: `Could not hash input_data: ${msg}`,
      });
    }

    const jobId = randomUUID();
    const config = loadConfig();
    const { agentIdentifier, sellerVKey } = resolveAgentDisplayIdentity(config);

    const nowSec = Math.floor(Date.now() / 1000);
    let payByTime = nowSec + config.payByOffsetSec;
    let submitResultTime = nowSec + config.submitResultOffsetSec;
    let unlockTime = nowSec + config.unlockOffsetSec;
    let externalDisputeUnlockTime = nowSec + config.externalDisputeUnlockOffsetSec;
    let blockchainIdentifier = `direct_${jobId}`;

    if (config.paymentMode === "masumi") {
      if (agentIdentifier === "unregistered-agent" || !sellerVKey) {
        return reply.status(500).send({
          error: "AGENT_NOT_REGISTERED",
          message:
            "AGENT_IDENTIFIER and SELLER_VKEY must be set when PAYMENT_MODE=masumi",
        });
      }
      if (!config.masumiPaymentServiceUrl || !config.masumiPaymentServiceToken) {
        return reply.status(500).send({
          error: "PAYMENT_SERVICE_NOT_CONFIGURED",
          message:
            "MASUMI_PAYMENT_SERVICE_URL and MASUMI_PAYMENT_SERVICE_TOKEN are required",
        });
      }

      const client = new MasumiPaymentClient({
        baseUrl: config.masumiPaymentServiceUrl,
        token: config.masumiPaymentServiceToken,
        network: config.masumiNetwork,
        paymentType: config.masumiPaymentType,
      });

      try {
        const sale = await client.registerSale({
          agentIdentifier,
          inputHash: input_hash,
          identifierFromPurchaser,
          payByTime,
          submitResultTime,
          unlockTime,
          externalDisputeUnlockTime,
          amounts: config.priceAmounts,
        });
        blockchainIdentifier = sale.blockchainIdentifier;
        payByTime = sale.payByTime;
        submitResultTime = sale.submitResultTime;
        unlockTime = sale.unlockTime;
        externalDisputeUnlockTime = sale.externalDisputeUnlockTime;
      } catch (e) {
        const status = e instanceof MasumiPaymentError ? 502 : 500;
        const msg =
          e instanceof MasumiPaymentError
            ? `Masumi Payment Service HTTP ${e.status}: ${e.bodySnippet}`
            : e instanceof Error
              ? e.message
              : String(e);
        return reply.status(status).send({
          error: "PAYMENT_REGISTRATION_FAILED",
          message: msg,
        });
      }

      createJob({
        id: jobId,
        blockchainIdentifier,
        identifierFromPurchaser,
        input_hash,
        input_data: inputData,
        status: "awaiting_payment",
        payByTime,
        submitResultTime,
        unlockTime,
        externalDisputeUnlockTime,
        amounts: config.priceAmounts,
      });

      runWithPayment({
        jobId,
        identifierFromPurchaser,
        inputData,
        handler: startHandler,
        blockchainIdentifier,
        client,
        config,
      });
    } else {
      createJob({
        id: jobId,
        blockchainIdentifier,
        identifierFromPurchaser,
        input_hash,
        input_data: inputData,
        status: "awaiting_payment",
        payByTime,
        submitResultTime,
        unlockTime,
        externalDisputeUnlockTime,
        amounts: config.priceAmounts,
      });

      await runDirect({
        jobId,
        identifierFromPurchaser,
        inputData,
        handler: startHandler,
      });
    }

    const resBody: StartJobResponseBody = {
      id: jobId,
      job_id: jobId,
      blockchainIdentifier,
      agentIdentifier,
      sellerVKey,
      identifierFromPurchaser,
      input_hash,
      inputHash: input_hash,
      payByTime,
      submitResultTime,
      unlockTime,
      externalDisputeUnlockTime,
      status: "awaiting_payment",
      amounts: config.priceAmounts,
    };

    return reply.status(200).send(resBody);
  });
}
