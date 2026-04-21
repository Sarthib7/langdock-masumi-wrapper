/**
 * Package public API: handler types, app factory, config, and Langdock `start_job` factory.
 */

export {
  AgentEndpointHandler,
  type AvailabilityHandler,
  type StartJobHandler,
  type StatusHandler,
} from "./agentEndpointHandler.js";
export {
  buildApp,
  createDefaultEndpointHandler,
  type BuildAppOptions,
} from "./app.js";
export { loadConfig, resolveAgentDisplayIdentity, type AppConfig } from "./config.js";
export { createLangdockStartJobHandler } from "./services/langdockStartJob.js";
