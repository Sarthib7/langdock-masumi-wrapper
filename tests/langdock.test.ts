/** Tests for documented Langdock Agent response shapes. */
import { describe, expect, it } from "vitest";
import { extractAssistantContent } from "../src/services/langdock.js";

describe("extractAssistantContent", () => {
  it("prefers structured output when Langdock returns output", () => {
    expect(
      extractAssistantContent({
        id: "msg_1",
        role: "assistant",
        parts: [{ type: "text", text: "ignored" }],
        output: { ok: true },
      }),
    ).toBe('{"ok":true}');
  });

  it("reads a root UIMessage parts response", () => {
    expect(
      extractAssistantContent({
        id: "msg_1",
        role: "assistant",
        parts: [{ type: "text", text: "hello from parts" }],
      }),
    ).toBe("hello from parts");
  });

  it("reads documented messages content response examples", () => {
    expect(
      extractAssistantContent({
        messages: [
          {
            id: "msg_1",
            role: "assistant",
            content: "hello from content",
            parts: [],
          },
        ],
      }),
    ).toBe("hello from content");
  });
});
