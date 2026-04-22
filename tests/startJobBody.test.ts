/** Tests for `normalizeStartJobBody` alias + shape handling. */
import { describe, expect, it } from "vitest";
import {
  inputDataToRecord,
  normalizeStartJobBody,
} from "../src/utils/startJobBody.js";

describe("normalizeStartJobBody", () => {
  it("accepts snake_case and camelCase aliases for the id", () => {
    const a = normalizeStartJobBody({
      identifier_from_purchaser: "p1",
      input_data: [{ key: "text", value: "hi" }],
    });
    const b = normalizeStartJobBody({
      identifierFromPurchaser: "p1",
      inputData: [{ key: "text", value: "hi" }],
    });
    expect(a.identifierFromPurchaser).toBe("p1");
    expect(b.identifierFromPurchaser).toBe("p1");
    expect(a.inputData).toEqual([{ key: "text", value: "hi" }]);
    expect(b.inputData).toEqual([{ key: "text", value: "hi" }]);
  });

  it("converts legacy object-form input_data to a sorted array of {key,value}", () => {
    const out = normalizeStartJobBody({
      identifier_from_purchaser: "p1",
      input_data: { b: 2, a: 1 },
    });
    expect(out.inputData).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
  });

  it("drops malformed array items and preserves well-formed ones", () => {
    const out = normalizeStartJobBody({
      identifier_from_purchaser: "p1",
      input_data: [
        { key: "ok", value: 1 },
        { value: "no key" },
        null,
        { key: "also-ok", value: null },
      ] as unknown as Array<Record<string, unknown>>,
    });
    expect(out.inputData).toEqual([
      { key: "ok", value: 1 },
      { key: "also-ok", value: null },
    ]);
  });

  it("generates a hex identifier that satisfies the Payment Service regex (14..26 chars)", () => {
    const out = normalizeStartJobBody({});
    expect(out.identifierFromPurchaser).toMatch(/^[0-9a-f]+$/);
    expect(out.identifierFromPurchaser.length).toBeGreaterThanOrEqual(14);
    expect(out.identifierFromPurchaser.length).toBeLessThanOrEqual(26);
    expect(out.inputData).toEqual([]);
  });
});

describe("inputDataToRecord", () => {
  it("converts array form to a record, last write wins", () => {
    expect(
      inputDataToRecord([
        { key: "a", value: 1 },
        { key: "a", value: 2 },
        { key: "b", value: "x" },
      ]),
    ).toEqual({ a: 2, b: "x" });
  });
});
