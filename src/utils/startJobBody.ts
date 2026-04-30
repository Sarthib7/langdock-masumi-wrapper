/**
 * Normalizes `POST /start_job` JSON into MIP-003 canonical form.
 *
 * Accepts both snake_case and camelCase keys, and both array-form (MIP-003)
 * and object-form `input_data`. Always returns the array form — this is what
 * MIP-004 hashes and what Sokosumi validators expect.
 */

import { randomBytes } from "node:crypto";
import type { InputDataItem } from "../types/masumi.js";

/**
 * The Masumi Payment Service requires `identifierFromPurchaser` to be a
 * lowercase hex string of length 14..26 chars. Generate one that fits.
 */
function generateHexIdentifier(): string {
  return randomBytes(12).toString("hex");
}

export function isValidIdentifierFromPurchaser(value: string): boolean {
  return /^[0-9a-f]+$/.test(value) && value.length >= 14 && value.length <= 26;
}

function toInputDataArray(raw: unknown): InputDataItem[] {
  if (raw === undefined || raw === null) return [];

  if (Array.isArray(raw)) {
    const out: InputDataItem[] = [];
    for (const item of raw) {
      if (item && typeof item === "object" && "key" in item) {
        const key = (item as { key: unknown }).key;
        if (typeof key !== "string") continue;
        out.push({
          key,
          value: (item as { value?: unknown }).value,
        });
      }
    }
    return out;
  }

  if (typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .map((key) => ({ key, value: record[key] }));
  }

  return [];
}

/**
 * Reads purchaser id and input payload (any accepted shape) and returns
 * the canonical array form. When no id is present, generates `sokosumi-{16 hex}`.
 */
export function normalizeStartJobBody(body: Record<string, unknown>): {
  identifierFromPurchaser: string;
  inputData: InputDataItem[];
} {
  const rawId = body.identifier_from_purchaser ?? body.identifierFromPurchaser;
  const identifierFromPurchaser =
    typeof rawId === "string" && rawId.trim().length > 0
      ? rawId.trim()
      : generateHexIdentifier();

  const rawInput =
    body.input_data ??
    body.inputData ??
    body.input ??
    undefined;

  return {
    identifierFromPurchaser,
    inputData: toInputDataArray(rawInput),
  };
}

/** Convenience: array form → `{key: value}` object, last write wins on duplicate keys. */
export function inputDataToRecord(
  input: InputDataItem[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { key, value } of input) out[key] = value;
  return out;
}
