
/**
 * `GET /availability`: optional custom handler, else returns a fixed healthy JSON body.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { BridgeContext } from "./bridgeContext.js";
import { findAgentProfile, loadConfig } from "../config.js";
import type { AvailabilityResponseBody } from "../types/masumi.js";

/** Registers the `/availability` route. */
export function registerAvailability(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  async function handleAvailability(
    reply: FastifyReply,
    agentSlug?: string,
  ) {
    if (agentSlug) {
      const config = loadConfig();
      const agent = findAgentProfile(config, agentSlug);
      if (!agent) {
        return reply.status(404).send({
          error: "AGENT_NOT_FOUND",
          message: `No agent is configured for slug: ${agentSlug}`,
        });
      }

      const body: AvailabilityResponseBody = {
        status: "available",
        type: "masumi-agent",
        message: `${agent.name || agent.slug} is ready.`,
      };
      return reply.status(200).send(body);
    }

    const custom = ctx.endpointHandler.getAvailabilityHandler();
    if (custom) {
      try {
        const out = await custom();
        return reply.status(200).send(out);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(500).send({ error: msg });
      }
    }

    const body: AvailabilityResponseBody = {
      status: "available",
      type: "masumi-agent",
      message: "Langdock–Masumi wrapper service is ready.",
    };
    return reply.status(200).send(body);
  }

  app.get("/availability", async (_request, reply) => {
    return handleAvailability(reply);
  });

  app.get<{ Params: { agentSlug: string } }>(
    "/agents/:agentSlug/availability",
    async (request, reply) => {
      return handleAvailability(reply, request.params.agentSlug);
    },
  );
}
