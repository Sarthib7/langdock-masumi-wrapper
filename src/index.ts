/**
 * Package public API: handler types, app factory, config, Langdock handler factory,
 * and the Masumi Payment Service client.
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
export {
  configForAgentProfile,
  findAgentProfile,
  loadConfig,
  normalizeAgentSlug,
  resolveAgentDisplayIdentity,
  type AgentProfileConfig,
  type AppConfig,
  type InputSchemaField,
  type MasumiNetwork,
  type PaymentMode,
  type PriceAmount,
} from "./config.js";
export { createLangdockStartJobHandler } from "./services/langdockStartJob.js";
export { inputDataToRecord } from "./utils/startJobBody.js";
export {
  MasumiPaymentClient,
  MasumiPaymentError,
  paymentIsLocked,
  paymentIsTerminal,
  type MasumiPaymentClientConfig,
  type PaymentOnchainState,
  type PaymentStatus,
  type RegisterSaleArgs,
  type RegisterSaleResult,
} from "./services/masumiPayment.js";
export {
  computeInputHash,
  computeOutputHash,
  stringifyForHash,
} from "./services/hashing.js";
export {
  assertProductionReady,
  getReadinessReport,
  productionRequiredEnv,
  shouldEnforceProductionReadiness,
  type ReadinessIssue,
  type ReadinessReport,
  type ReadinessSeverity,
} from "./services/readiness.js";
export {
  MAINNET_USDCX_UNIT,
  PREPROD_TUSDM_UNIT,
} from "./services/sokosumiTokens.js";
export type {
  InputDataItem,
  JobRecord,
  JobStatus,
  StartJobRequestBody,
  StartJobResponseBody,
  StatusResponseBody,
  AvailabilityResponseBody,
} from "./types/masumi.js";
