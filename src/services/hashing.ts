/**
 * MIP-004 input and output hashing (JCS for input, UTF-8 string for output).
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// CJS `canonicalize` package; `require` avoids NodeNext default-import quirks.
const canonicalize = require("canonicalize") as (
  input: unknown,
) => string | undefined;

/**
 * MIP-004 input hash: SHA-256 hex of UTF-8 `identifier_from_purchaser + ";" + JCS(input_data)`.
 */
export function computeInputHash(
  identifierFromPurchaser: string,
  inputData: Record<string, unknown>,
): string {
  const canonicalJson = canonicalize(inputData);
  if (canonicalJson === undefined) {
    throw new Error("input_data could not be canonicalized (JCS)");
  }
  const preimage = `${identifierFromPurchaser};${canonicalJson}`;
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}

/**
 * MIP-004 output hash: SHA-256 hex of UTF-8 `identifier_from_purchaser + ";" + output`.
 */
export function computeOutputHash(
  identifierFromPurchaser: string,
  outputUtf8: string,
): string {
  const preimage = `${identifierFromPurchaser};${outputUtf8}`;
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}
