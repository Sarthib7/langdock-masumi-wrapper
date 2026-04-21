/**
 * In-memory job store (single process; not durable across restarts).
 */

import type { JobRecord, JobStatus } from "../types/masumi.js";

const jobs = new Map<string, JobRecord>();

/** Inserts a new job and returns the stored record with timestamps. */
export function createJob(
  partial: Omit<JobRecord, "createdAt" | "updatedAt">,
): JobRecord {
  const now = Date.now();
  const record: JobRecord = {
    ...partial,
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

/** Merges `patch` into the job and refreshes `updatedAt`. */
export function updateJob(
  jobId: string,
  patch: Partial<Pick<JobRecord, "status" | "result" | "error">>,
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

/** Sets `status` and optional `result` / `error` in one update. */
export function setJobStatus(
  jobId: string,
  status: JobStatus,
  extras?: Partial<Pick<JobRecord, "result" | "error">>,
): JobRecord | undefined {
  return updateJob(jobId, { status, ...extras });
}

/** Clears all jobs (tests only). */
export function __resetJobsForTests(): void {
  jobs.clear();
}
