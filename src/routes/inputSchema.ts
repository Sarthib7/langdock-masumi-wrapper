/**
 * `GET /input_schema` (MIP-003 §4). Returns the schema expected by `/start_job`.
 * Loaded from `INPUT_SCHEMA_PATH` or `INPUT_SCHEMA_JSON` at startup, with a
 * sensible `text` default.
 */

import type { FastifyInstance } from "fastify";
import { loadConfig } from "../config.js";

export function registerInputSchema(app: FastifyInstance): void {
  app.get("/input_schema", async (_request, reply) => {
    const config = loadConfig();
    return reply.status(200).send({ input_data: config.inputSchema });
  });
}
