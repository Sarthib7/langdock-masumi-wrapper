/**
 * Passed to route registrars when the app is built; one handler bundle for all requests.
 */

import type { AgentEndpointHandler } from "../agentEndpointHandler.js";

/** Shared handler bundle for `/start_job`, `/status`, and `/availability`. */
export type BridgeContext = {
  endpointHandler: AgentEndpointHandler;
};
