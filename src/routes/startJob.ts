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

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import type { BridgeContext } from "./bridgeContext.js";
import {
  configForAgentProfile,
  findAgentProfile,
  loadConfig,
  resolveAgentDisplayIdentity,
  type AgentProfileConfig,
} from "../config.js";
import { computeInputHash } from "../services/hashing.js";
import { createLangdockStartJobHandler } from "../services/langdockStartJob.js";
import { createJob } from "../services/jobs.js";
import { runDirect, runWithPayment } from "../services/jobRunner.js";
import { generateOpaqueToken, hashOpaqueToken } from "../services/opaqueTokens.js";
import { checkRateLimit } from "../services/rateLimit.js";
import {
  MasumiPaymentClient,
  MasumiPaymentError,
} from "../services/masumiPayment.js";
import type { StartJobResponseBody } from "../types/masumi.js";
import {
  isValidIdentifierFromPurchaser,
  normalizeStartJobBody,
} from "../utils/startJobBody.js";

type StartJobParams = {
  agentSlug?: string;
};

export function registerStartJob(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  async function handleStartJob(
    request: FastifyRequest,
    reply: FastifyReply,
    routeAgentSlug?: string,
  ) {
    const rateLimit = checkRateLimit({
      scope: "start-job",
      identifier: routeAgentSlug ? `${request.ip}:${routeAgentSlug}` : request.ip,
      limit: 60,
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
          message: "Too many jobs submitted. Try again later.",
        });
    }

    const baseConfig = loadConfig();
    let routeAgent: AgentProfileConfig | undefined;
    const requestedAgentSlug = routeAgentSlug?.trim();
    if (requestedAgentSlug) {
      routeAgent = findAgentProfile(baseConfig, requestedAgentSlug);
      if (!routeAgent) {
        return reply.status(404).send({
          error: "AGENT_NOT_FOUND",
          message: `No agent is configured for slug: ${requestedAgentSlug}`,
        });
      }
    }
    const config = routeAgent
      ? configForAgentProfile(baseConfig, routeAgent)
      : baseConfig;

    const body =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};

    const { identifierFromPurchaser, inputData } = normalizeStartJobBody(body);

    const startHandler = routeAgent
      ? createLangdockStartJobHandler(config)
      : ctx.endpointHandler.getStartJobHandler();
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
    if (process.env.NODE_ENV === "production" && config.paymentMode === "direct") {
      return reply.status(503).send({
        error: "DIRECT_MODE_DISABLED",
        message: "Production deployments must use PAYMENT_MODE=masumi.",
      });
    }
    if (!config.langdockApiKey || !config.langdockAgentId) {
      return reply.status(503).send({
        error: "LANGDOCK_NOT_CONFIGURED",
        message:
          "LANGDOCK_API_KEY and a Langdock agent id are required before starting paid jobs.",
      });
    }
    const { agentIdentifier, sellerVKey } = resolveAgentDisplayIdentity(config);
    const continuationToken = config.hitlChatMode ? generateOpaqueToken(32) : undefined;
    const continuationTokenHash = continuationToken
      ? hashOpaqueToken(continuationToken)
      : undefined;

    const nowSec = Math.floor(Date.now() / 1000);
    let payByTime = nowSec + config.payByOffsetSec;
    let submitResultTime = nowSec + config.submitResultOffsetSec;
    let unlockTime = nowSec + config.unlockOffsetSec;
    let externalDisputeUnlockTime = nowSec + config.externalDisputeUnlockOffsetSec;
    let blockchainIdentifier = `direct_${jobId}`;

    if (config.paymentMode === "masumi") {
      if (!isValidIdentifierFromPurchaser(identifierFromPurchaser)) {
        return reply.status(400).send({
          error: "INVALID_IDENTIFIER_FROM_PURCHASER",
          message:
            "identifier_from_purchaser must be lowercase hex and 14-26 characters when PAYMENT_MODE=masumi",
        });
      }
      if (agentIdentifier === "unregistered-agent" || !sellerVKey) {
        return reply.status(500).send({
          error: "AGENT_NOT_REGISTERED",
          message:
            "AGENT_IDENTIFIER and SELLER_VKEY must be set when PAYMENT_MODE=masumi",
        });
      }
      if (!config.paymentServiceUrl || !config.paymentApiKey) {
        return reply.status(500).send({
          error: "PAYMENT_SERVICE_NOT_CONFIGURED",
          message:
            "PAYMENT_SERVICE_URL and PAYMENT_API_KEY are required",
        });
      }

      const client = new MasumiPaymentClient({
        baseUrl: config.paymentServiceUrl,
        apiKey: config.paymentApiKey,
        authHeader: config.paymentApiAuthHeader,
        network: config.masumiNetwork,
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
          requestedFunds: config.priceAmounts,
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
        agent_slug: routeAgent?.slug,
        continuation_token_hash: continuationTokenHash,
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
        agent_slug: routeAgent?.slug,
        continuation_token_hash: continuationTokenHash,
      });

      await runDirect({
        jobId,
        identifierFromPurchaser,
        inputData,
        handler: startHandler,
      });
    }

    const toUnixMs = (unixSeconds: number): number => unixSeconds * 1000;

    const resBody: StartJobResponseBody = {
      id: jobId,
      job_id: jobId,
      blockchainIdentifier,
      agentIdentifier,
      sellerVKey,
      identifierFromPurchaser,
      input_hash,
      inputHash: input_hash,
      payByTime: toUnixMs(payByTime),
      submitResultTime: toUnixMs(submitResultTime),
      unlockTime: toUnixMs(unlockTime),
      externalDisputeUnlockTime: toUnixMs(externalDisputeUnlockTime),
      status: "awaiting_payment",
      amounts: config.priceAmounts,
      continuationToken,
    };

    return reply.status(200).send(resBody);
  }

  app.post("/start_job", async (request, reply) => {
    return handleStartJob(request, reply);
  });

  app.post<{ Params: StartJobParams }>(
    "/agents/:agentSlug/start_job",
    async (request, reply) => {
      return handleStartJob(request, reply, request.params.agentSlug);
    },
  );
}
