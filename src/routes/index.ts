/**
 * Registers MIP-003 routes on a Fastify instance.
 */

import type { FastifyInstance } from "fastify";
import type { BridgeContext } from "./bridgeContext.js";
import { registerAdminDashboard } from "./adminDashboard.js";
import { registerAvailability } from "./availability.js";
import { registerInputSchema } from "./inputSchema.js";
import { registerProvideInput } from "./provideInput.js";
import { registerReadiness } from "./readiness.js";
import { registerStartJob } from "./startJob.js";
import { registerStatus } from "./status.js";
import { registerSetup } from "./setup.js";

/** Attaches MIP-003 routes plus operator readiness. */
export function registerRoutes(
  app: FastifyInstance,
  ctx: BridgeContext,
): void {
  registerSetup(app, ctx);
  registerAdminDashboard(app);
  registerAvailability(app, ctx);
  registerStatus(app, ctx);
  registerStartJob(app, ctx);
  registerProvideInput(app);
  registerInputSchema(app);
  registerReadiness(app);
}
