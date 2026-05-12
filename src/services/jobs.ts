/**
 * In-memory job store (single process; not durable across restarts).
 *
 * Tracks MIP-003 job lifecycle statuses and MIP-004 hashes. Swap this for
 * Redis/Postgres when you need multi-replica durability.
 */

import type { InputDataItem, JobRecord, JobStatus } from "../types/masumi.js";

const jobs = new Map<string, JobRecord>();

export type NewJobInput = {
  id: string;
  blockchainIdentifier: string;
  identifierFromPurchaser: string;
  input_hash: string;
  input_data: InputDataItem[];
  status: JobStatus;
  payByTime: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
  amounts: Array<{ amount: string; unit: string }>;
};

/** Inserts a new job and returns the stored record with timestamps. */
export function createJob(input: NewJobInput): JobRecord {
  const now = Date.now();
  const record: JobRecord = {
    ...input,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(record.id, record);
  return record;
}

/** Returns a job by id, or `undefined` if missing. */
export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId);
}

export function listJobs(): JobRecord[] {
  return Array.from(jobs.values());
}

/** Merges `patch` into the job and refreshes `updatedAt`. */
export function updateJob(
  jobId: string,
  patch: Partial<
    Pick<
      JobRecord,
      | "status"
      | "result"
      | "output_hash"
      | "error"
      | "awaiting_input_schema"
      | "awaiting_input_message"
      | "conversation"
      | "completedAt"
      | "failedAt"
    >
  >,
): JobRecord | undefined {
  const existing = jobs.get(jobId);
  if (!existing) return undefined;
  const updated: JobRecord = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  jobs.set(jobId, updated);
  return updated;
}

/** Sets `status` and optional extras in one update. */
export function setJobStatus(
  jobId: string,
  status: JobStatus,
  extras?: Partial<
    Pick<
      JobRecord,
      | "result"
      | "output_hash"
      | "error"
      | "awaiting_input_schema"
      | "awaiting_input_message"
      | "conversation"
      | "completedAt"
      | "failedAt"
    >
  >,
): JobRecord | undefined {
  return updateJob(jobId, { status, ...extras });
}

/** Clears all jobs (tests only). */
export function __resetJobsForTests(): void {
  jobs.clear();
}
