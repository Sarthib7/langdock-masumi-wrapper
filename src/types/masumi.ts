/**
 * Types for MIP-003-shaped HTTP payloads and the in-memory job record.
 */

export type JobStatus = "running" | "completed" | "failed";

export type StartJobRequestBody = {
  identifier_from_purchaser: string;
  input_data?: Record<string, unknown>;
};

/** JSON body for a successful `POST /start_job` (camelCase `inputHash`). */
export type StartJobResponseBody = {
  id: string;
  blockchainIdentifier: string;
  agentIdentifier: string;
  sellerVKey: string;
  identifierFromPurchaser: string;
  inputHash: string;
  payByTime: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
};

/** JSON body for `GET /status` when using the default handler. */
export type StatusResponseBody = {
  id?: string;
  status: JobStatus;
  result?: unknown;
  error?: string;
};

/** JSON body for `GET /availability` default branch. */
export type AvailabilityResponseBody = {
  status: "available";
  type: "masumi-agent";
  message: string;
};

/** Single job row in the process-local store (`input_hash` uses snake_case internally). */
export type JobRecord = {
  id: string;
  blockchainIdentifier: string;
  identifierFromPurchaser: string;
  input_hash: string;
  status: JobStatus;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
};
