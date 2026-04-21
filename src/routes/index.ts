/**
 * Registers MIP-003 routes on a Fastify instance.
 */

import type { FastifyInstance } from "fastify";
import type { BridgeContext } from "./bridgeContext.js";
import { registerAvailability } from "./availability.js";
import { registerStartJob } from "./startJob.js";
import { registerStatus } from "./status.js";

/** Attaches `availability`, `status`, and `start_job` handlers using `ctx`. */
export function registerRoutes(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  registerAvailability(app, ctx);
  registerStatus(app, ctx);
  registerStartJob(app, ctx);
}
