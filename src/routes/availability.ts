
/**
 * `GET /availability`: optional custom handler, else returns a fixed healthy JSON body.
 */

import type { FastifyInstance } from "fastify";
import type { BridgeContext } from "./bridgeContext.js";
import type { AvailabilityResponseBody } from "../types/masumi.js";

/** Registers the `/availability` route. */
export function registerAvailability(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  app.get("/availability", async (_request, reply) => {
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
  });
}
