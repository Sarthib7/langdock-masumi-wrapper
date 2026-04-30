/**
 * `GET /ready`: operator-facing readiness check for deploy health checks.
 *
 * This is separate from MIP-003 `/availability`; `/ready` reports missing
 * secrets/configuration before the service is exposed to paid marketplace jobs.
 */

import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config.js";
import { getReadinessReport } from "../services/readiness.js";

export function registerReadiness(app: FastifyInstance): void {
  app.get("/ready", async (_request, reply) => {
    const report = getReadinessReport(loadConfig());
    return reply.status(report.status === "ready" ? 200 : 503).send(report);
  });
}
