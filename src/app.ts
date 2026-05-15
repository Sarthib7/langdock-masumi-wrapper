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
import { assertProductionReady } from "./services/readiness.js";

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

const SECURITY_HEADERS_HTML: Readonly<Record<string, string>> = {
  // Inline scripts/styles are still used by /setup; tighten with nonces later.
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=()",
};

const SECURITY_HEADERS_JSON: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/**
 * Creates a Fastify instance with MIP-003 routes and the given or default handler bundle.
 */
export async function buildApp(options?: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    // Trust Railway / proxy edge so request.ip reflects the real client.
    trustProxy: true,
    logger: {
      // Pino redaction keeps cookies and bearer tokens out of Railway logs.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-job-token"]',
          'req.headers["x-forwarded-for"]',
          "res.headers['set-cookie']",
          "*.password",
          "*.password_hash",
          "*.token",
          "*.apiKey",
          "*.api_key",
        ],
        censor: "[redacted]",
      },
    },
    bodyLimit: 256 * 1024,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const contentType = String(reply.getHeader("content-type") ?? "");
    const headers = contentType.includes("text/html")
      ? SECURITY_HEADERS_HTML
      : SECURITY_HEADERS_JSON;
    for (const [name, value] of Object.entries(headers)) {
      if (!reply.getHeader(name)) reply.header(name, value);
    }
    // HSTS only when the original connection is HTTPS (Railway terminates TLS).
    const proto =
      (request.headers["x-forwarded-proto"] as string | undefined) ??
      request.protocol;
    if (proto === "https" && !reply.getHeader("strict-transport-security")) {
      reply.header(
        "strict-transport-security",
        "max-age=63072000; includeSubDomains; preload",
      );
    }
    return payload;
  });

  const endpointHandler =
    options?.endpointHandler ?? createDefaultEndpointHandler();
  await registerRoutes(app, { endpointHandler });
  return app;
}

/** Reads `PORT` from env and listens on all interfaces. */
async function main(): Promise<void> {
  const config = loadConfig();
  assertProductionReady(config);
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
