/** Tests for `normalizeStartJobBody` alias handling. */
import { describe, expect, it } from "vitest";
import { normalizeStartJobBody } from "../src/utils/startJobBody.js";

describe("normalizeStartJobBody", () => {
  it("accepts snake_case and camelCase aliases", () => {
    const a = normalizeStartJobBody({
      identifier_from_purchaser: "p1",
      input_data: { text: "hi" },
    });
    const b = normalizeStartJobBody({
      identifierFromPurchaser: "p1",
      inputData: { text: "hi" },
    });
    expect(a).toEqual({ identifierFromPurchaser: "p1", inputData: { text: "hi" } });
    expect(b).toEqual({ identifierFromPurchaser: "p1", inputData: { text: "hi" } });
  });

  it("generates a default identifier when omitted", () => {
    const out = normalizeStartJobBody({});
    expect(out.identifierFromPurchaser).toMatch(/^sokosumi-[0-9a-f]{16}$/);
    expect(out.inputData).toEqual({});
  });
});
