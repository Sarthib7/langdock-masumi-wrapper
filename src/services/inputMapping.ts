/**
 * Maps MIP-003 `input_data` (array of `{key,value}` or legacy record form)
 * to the user-message text sent to Langdock.
 *
 * Prefers the `text` field. Otherwise, concatenates string values and falls
 * back to a canonical JSON serialisation so no payload is silently dropped.
 */

import type { InputDataItem } from "../types/masumi.js";
import { inputDataToRecord } from "../utils/startJobBody.js";

export function inputDataToPromptText(
  inputData: InputDataItem[] | Record<string, unknown>,
): string {
  const record = Array.isArray(inputData)
    ? inputDataToRecord(inputData)
    : inputData;

  const text = record.text;
  if (typeof text === "string" && text.trim().length > 0) return text;

  const stringParts: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim().length > 0) {
      stringParts.push(`${key}: ${value}`);
    }
  }
  if (stringParts.length > 0) return stringParts.join("\n");

  try {
    return JSON.stringify(record);
  } catch {
    return String(record);
  }
}
