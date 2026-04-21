/**
 * Normalizes `POST /start_job` JSON so callers may use snake_case or camelCase keys.
 */

import { randomUUID } from "node:crypto";

/**
 * Reads purchaser id and input payload from alternate property names.
 * If no id is present, generates `sokosumi-{16 hex chars}`.
 */
export function normalizeStartJobBody(body: Record<string, unknown>): {
  identifierFromPurchaser: string;
  inputData: Record<string, unknown>;
} {
  const rawId = body.identifier_from_purchaser ?? body.identifierFromPurchaser;
  const identifierFromPurchaser =
    typeof rawId === "string" && rawId.trim().length > 0
      ? rawId.trim()
      : `sokosumi-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const inputData =
    (body.input_data as Record<string, unknown> | undefined) ??
    (body.inputData as Record<string, unknown> | undefined) ??
    (body.input as Record<string, unknown> | undefined) ??
    {};

  return { identifierFromPurchaser, inputData };
}
