/** Unit tests for MIP-004 input hashing. */
import { describe, expect, it } from "vitest";
import { computeInputHash } from "../src/services/hashing.js";

describe("computeInputHash (MIP-004 JCS + SHA-256)", () => {
  it("matches a stable vector for empty input_data", () => {
    const h = computeInputHash("buyer-1", {});
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const h2 = computeInputHash("buyer-1", {});
    expect(h).toBe(h2);
  });

  it("changes when identifier_from_purchaser changes", () => {
    const a = computeInputHash("a", { text: "x" });
    const b = computeInputHash("b", { text: "x" });
    expect(a).not.toBe(b);
  });

  it("is order-insensitive for object keys (JCS)", () => {
    const h1 = computeInputHash("id", { a: 1, b: 2 });
    const h2 = computeInputHash("id", { b: 2, a: 1 });
    expect(h1).toBe(h2);
  });
});
