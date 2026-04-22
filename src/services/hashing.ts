/**
 * MIP-004 input/output hashing.
 *
 * Input hash = SHA-256(UTF-8(`identifier_from_purchaser` + ";" + JCS(input_data))).
 * Output hash = SHA-256(UTF-8(`identifier_from_purchaser` + ";" + output_text)).
 *
 * `input_data` is canonicalised in its MIP-003 array-of-`{key,value}` form so
 * buyer and seller agree on the pre-image regardless of JSON key order.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { InputDataItem } from "../types/masumi.js";

const require = createRequire(import.meta.url);
// CJS `canonicalize` package; `require` avoids NodeNext default-import quirks.
const canonicalize = require("canonicalize") as (
  input: unknown,
) => string | undefined;

function toCanonicalisable(
  input: InputDataItem[] | Record<string, unknown>,
): unknown {
  if (Array.isArray(input)) {
    // Preserve insertion order of items; JCS sorts keys within each object.
    return input.map((item) => ({ key: item.key, value: item.value }));
  }
  return input;
}

/** MIP-004 input hash, hex-encoded (64 chars). */
export function computeInputHash(
  identifierFromPurchaser: string,
  inputData: InputDataItem[] | Record<string, unknown>,
): string {
  const canonicalJson = canonicalize(toCanonicalisable(inputData));
  if (canonicalJson === undefined) {
    throw new Error("input_data could not be canonicalized (JCS)");
  }
  const preimage = `${identifierFromPurchaser};${canonicalJson}`;
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}

/** MIP-004 output hash, hex-encoded (64 chars). */
export function computeOutputHash(
  identifierFromPurchaser: string,
  outputUtf8: string,
): string {
  const preimage = `${identifierFromPurchaser};${outputUtf8}`;
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}

/** Stable stringifier for a handler result before hashing. */
export function stringifyForHash(value: unknown): string {
  if (typeof value === "string") return value;
  const canonical = canonicalize(value);
  return canonical ?? String(value);
}
