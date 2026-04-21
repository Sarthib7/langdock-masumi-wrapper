/** HTTP integration tests with mocked `fetch` or custom handlers. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEndpointHandler } from "../src/agentEndpointHandler.js";
import { buildApp } from "../src/app.js";

describe("POST /start_job with mocked Langdock", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            messages: [
              {
                id: "m1",
                role: "assistant",
                parts: [{ type: "text", text: "hello from mock" }],
              },
            ],
          }),
      })) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("returns 200 and stores result for default Langdock handler", async () => {
    process.env.LANGDOCK_API_KEY = "test-key";
    process.env.LANGDOCK_AGENT_ID = "test-agent";
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "job-1",
        input_data: { text: "ping" },
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as { id: string; inputHash: string };
    expect(json.id).toBeDefined();
    expect(json.inputHash).toMatch(/^[0-9a-f]{64}$/);

    const st = await app.inject({
      method: "GET",
      url: `/status?job_id=${json.id}`,
    });
    expect(st.statusCode).toBe(200);
    const sj = st.json() as { status: string; result: string };
    expect(sj.status).toBe("completed");
    expect(sj.result).toBe("hello from mock");

    await app.close();
  });

  it("uses a custom start_job handler when provided", async () => {
    delete process.env.LANGDOCK_API_KEY;
    delete process.env.LANGDOCK_AGENT_ID;

    const endpointHandler = new AgentEndpointHandler();
    endpointHandler.setStartJobHandler(async (_id, input) => ({
      echo: input,
    }));

    const app = await buildApp({ endpointHandler });

    const res = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "x",
        input_data: { foo: 1 },
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as { id: string };
    const st = await app.inject({
      method: "GET",
      url: `/status?job_id=${json.id}`,
    });
    const body = st.json() as { result: { echo: { foo: number } } };
    expect(body.result.echo.foo).toBe(1);

    await app.close();
  });
});
