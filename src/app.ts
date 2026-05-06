/**
 * Fastify application factory and CLI entry when executed directly.
 */

import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentEndpointHandler } from "./agentEndpointHandler.js";
import { loadConfig } from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { createLangdockStartJobHandler } from "./services/langdockStartJob.js";

export type BuildAppOptions = {
  /** When omitted, registers the default Langdock `start_job` handler. */
  endpointHandler?: AgentEndpointHandler;
};

/**
 * Builds an `AgentEndpointHandler` with Langdock chat completions as `start_job`.
 */
export function createDefaultEndpointHandler(): AgentEndpointHandler {
  const handler = new AgentEndpointHandler();
  const config = loadConfig();
  handler.setStartJobHandler(createLangdockStartJobHandler(config));
  return handler;
}

/**
 * Creates a Fastify instance with MIP-003 routes and the given or default handler bundle.
 */
export async function buildApp(options?: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  });
  const endpointHandler =
    options?.endpointHandler ?? createDefaultEndpointHandler();
  await registerRoutes(app, { endpointHandler });
  return app;
}

/** Reads `PORT` from env and listens on all interfaces. */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp();
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

const entryFile = path.resolve(fileURLToPath(import.meta.url));
const invokedDirectly =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]!) === entryFile;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
