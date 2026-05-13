/**
 * MIP-003-shaped HTTP payloads, MIP-003 `input_data` item shape, and in-memory job record.
 */

/** Statuses defined by MIP-003 (§2 /status). */
export type JobStatus =
  | "awaiting_payment"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "refunded"
  | "awaiting_input";

/** Single MIP-003 `input_data` entry: `key` is the schema field id, `value` is the user input. */
export type InputDataItem = {
  key: string;
  value: unknown;
};

export type StartJobRequestBody = {
  identifier_from_purchaser?: string;
  identifierFromPurchaser?: string;
  /** MIP-003 canonical form is an array of {key,value}; object form is also accepted. */
  input_data?: InputDataItem[] | Record<string, unknown>;
  inputData?: InputDataItem[] | Record<string, unknown>;
};

/**
 * JSON body for a successful `POST /start_job`. `input_hash` uses snake_case per MIP-003 spec.
 * Sokosumi expects payment deadline fields as Unix milliseconds.
 */
export type StartJobResponseBody = {
  id: string;
  job_id: string;
  blockchainIdentifier: string;
  agentIdentifier: string;
  sellerVKey: string;
  identifierFromPurchaser: string;
  input_hash: string;
  /** camelCase alias kept for legacy clients. */
  inputHash: string;
  payByTime: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
  status: JobStatus;
  amounts?: Array<{ amount: string; unit: string }>;
  /**
   * Opaque bearer token required by `/provide_input` for HITL continuations.
   * Present only when HITL chat mode is enabled.
   */
  continuationToken?: string;
};

/** JSON body for `GET /status` (MIP-003 §2). */
export type StatusResponseBody = {
  job_id: string;
  status: JobStatus;
  result?: unknown;
  /** Alias that some clients expect; mirrors `result`. */
  output?: unknown;
  input_hash?: string;
  output_hash?: string;
  input_schema?: unknown;
  error?: string;
  message?: string;
  /** Alias used by some MIP-003/HITL clients. */
  Message?: string;
  created_at?: string;
  completed_at?: string;
  failed_at?: string;
  payment_address?: string;
  amount_lovelace?: number;
  blockchain_identifier?: string;
};

/** JSON body for `GET /availability` (MIP-003 §3). */
export type AvailabilityResponseBody = {
  status: "available" | "unavailable";
  type: "masumi-agent";
  message: string;
  uptime_seconds?: number;
  current_load?: {
    active_jobs: number;
    queued_jobs: number;
    max_capacity?: number;
  };
};

/** In-process job row. */
export type JobRecord = {
  id: string;
  /** Configured multi-agent route slug, when the job was started via `/agents/:slug/start_job`. */
  agent_slug?: string;
  blockchainIdentifier: string;
  identifierFromPurchaser: string;
  input_hash: string;
  /** Canonical MIP-003 array form of the inputs (used by the runner). */
  input_data: InputDataItem[];
  status: JobStatus;
  result?: unknown;
  output_hash?: string;
  error?: string;
  continuation_token_hash?: string;
  awaiting_input_schema?: unknown;
  awaiting_input_message?: string;
  conversation?: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    parts: Array<{ type: string; [key: string]: unknown }>;
  }>;
  payByTime: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
  amounts: Array<{ amount: string; unit: string }>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  failedAt?: number;
};
