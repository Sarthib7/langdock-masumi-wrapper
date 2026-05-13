/**
 * `GET /input_schema` (MIP-003 §4). Returns the schema expected by `/start_job`.
 * Loaded from `INPUT_SCHEMA_PATH` or `INPUT_SCHEMA_JSON` at startup, with a
 * sensible `text` default.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { configForAgentProfile, findAgentProfile, loadConfig } from "../config.js";

export function registerInputSchema(app: FastifyInstance): void {
  async function handleInputSchema(reply: FastifyReply, agentSlug?: string) {
    const baseConfig = loadConfig();
    const agent = agentSlug ? findAgentProfile(baseConfig, agentSlug) : undefined;
    if (agentSlug && !agent) {
      return reply.status(404).send({
        error: "AGENT_NOT_FOUND",
        message: `No agent is configured for slug: ${agentSlug}`,
      });
    }
    const config = agent ? configForAgentProfile(baseConfig, agent) : baseConfig;
    return reply.status(200).send({ input_data: config.inputSchema });
  }

  app.get("/input_schema", async (_request, reply) => {
    return handleInputSchema(reply);
  });

  app.get<{ Params: { agentSlug: string } }>(
    "/agents/:agentSlug/input_schema",
    async (request, reply) => {
      return handleInputSchema(reply, request.params.agentSlug);
    },
  );
}
