/**
 * Maps Masumi `input_data` to the user message text sent to Langdock.
 */

/**
 * Uses `input_data.text` when it is a string; otherwise serializes the whole object.
 */
export function inputDataToPromptText(inputData: Record<string, unknown>): string {
  const t = inputData.text;
  if (typeof t === "string") return t;
  return JSON.stringify(inputData);
}
