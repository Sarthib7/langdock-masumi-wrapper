/** HTTP integration tests for /start_job & /status in `direct` mode (no Masumi node). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEndpointHandler } from "../src/agentEndpointHandler.js";
import { buildApp } from "../src/app.js";
import { __resetJobsForTests } from "../src/services/jobs.js";

describe("POST /start_job in direct mode with mocked Langdock", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetJobsForTests();
    delete process.env.PAYMENT_MODE;
    delete process.env.PAYMENT_SERVICE_URL;
    delete process.env.PAYMENT_API_KEY;
    delete process.env.NETWORK;
    delete process.env.MASUMI_PAYMENT_SERVICE_URL;
    delete process.env.MASUMI_PAYMENT_SERVICE_TOKEN;
    delete process.env.NODE_ENV;
    delete process.env.AGENTS_JSON;

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
    delete process.env.NODE_ENV;
    delete process.env.LANGDOCK_API_KEY;
    delete process.env.LANGDOCK_AGENT_ID;
    delete process.env.PAYMENT_MODE;
    delete process.env.AGENTS_JSON;
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
        input_data: [{ key: "text", value: "ping" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      id: string;
      job_id: string;
      input_hash: string;
      inputHash: string;
      status: string;
      blockchainIdentifier: string;
    };
    expect(json.id).toBeDefined();
    expect(json.id).toBe(json.job_id);
    expect(json.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.inputHash).toBe(json.input_hash);
    expect(json.status).toBe("awaiting_payment");
    expect(json.blockchainIdentifier).toMatch(/^direct_/);

    const st = await app.inject({
      method: "GET",
      url: `/status?job_id=${json.id}`,
    });
    expect(st.statusCode).toBe(200);
    const sj = st.json() as {
      status: string;
      result: string;
      input_hash: string;
      output_hash: string;
      job_id: string;
    };
    expect(sj.status).toBe("completed");
    expect(sj.result).toBe("hello from mock");
    expect(sj.input_hash).toBe(json.input_hash);
    expect(sj.output_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sj.job_id).toBe(json.id);

    await app.close();
  });

  it("accepts legacy object-form input_data and exposes it as an array to handlers", async () => {
    delete process.env.LANGDOCK_API_KEY;
    delete process.env.LANGDOCK_AGENT_ID;
    process.env.LANGDOCK_API_KEY = "custom-test-key";
    process.env.LANGDOCK_AGENT_ID = "custom-test-agent";

    const endpointHandler = new AgentEndpointHandler();
    endpointHandler.setStartJobHandler(async (_id, input) => ({
      receivedArray: Array.isArray(input),
      items: input,
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
    const body = st.json() as {
      result: { receivedArray: boolean; items: Array<{ key: string; value: unknown }> };
    };
    expect(body.result.receivedArray).toBe(true);
    expect(body.result.items).toEqual([{ key: "foo", value: 1 }]);

    await app.close();
  });

  it("routes /agents/:slug/start_job to the configured Langdock agent", async () => {
    process.env.LANGDOCK_API_KEY = "test-key";
    process.env.AGENTS_JSON = JSON.stringify([
      {
        slug: "agent-one",
        name: "Agent One",
        description: "First test agent",
        langdockAgentId: "langdock-agent-one",
        agentIdentifier: "",
        priceAmounts: [],
      },
      {
        slug: "agent-two",
        name: "Agent Two",
        description: "Second test agent",
        langdockAgentId: "langdock-agent-two",
        agentIdentifier: "",
        priceAmounts: [],
      },
    ]);

    const seenAgentIds: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? "{}") as { agentId: string };
        seenAgentIds.push(body.agentId);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              messages: [
                {
                  id: "m1",
                  role: "assistant",
                  parts: [{ type: "text", text: `hello from ${body.agentId}` }],
                },
              ],
            }),
        };
      }) as unknown as typeof fetch,
    );

    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/agents/agent-two/start_job",
      payload: {
        identifier_from_purchaser: "job-2",
        input_data: [{ key: "text", value: "ping" }],
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as { id: string };
    const status = await app.inject({
      method: "GET",
      url: `/agents/agent-two/status?job_id=${json.id}`,
    });
    expect(status.statusCode).toBe(200);
    expect((status.json() as { result: string }).result).toBe(
      "hello from langdock-agent-two",
    );
    expect(seenAgentIds).toEqual(["langdock-agent-two"]);

    const wrongAgentStatus = await app.inject({
      method: "GET",
      url: `/agents/agent-one/status?job_id=${json.id}`,
    });
    expect(wrongAgentStatus.statusCode).toBe(404);

    await app.close();
  });

  it("serves per-agent availability and input schema", async () => {
    process.env.AGENTS_JSON = JSON.stringify([
      {
        slug: "agent-one",
        name: "Agent One",
        description: "First test agent",
        langdockAgentId: "langdock-agent-one",
        inputSchema: [
          {
            id: "brief",
            type: "string",
            name: "Brief",
          },
        ],
      },
    ]);

    const app = await buildApp({ endpointHandler: new AgentEndpointHandler() });

    const availability = await app.inject({
      method: "GET",
      url: "/agents/agent-one/availability",
    });
    expect(availability.statusCode).toBe(200);
    expect((availability.json() as { message: string }).message).toBe(
      "Agent One is ready.",
    );

    const schema = await app.inject({
      method: "GET",
      url: "/agents/agent-one/input_schema",
    });
    expect(schema.statusCode).toBe(200);
    expect(
      (schema.json() as { input_data: Array<{ id: string }> }).input_data[0].id,
    ).toBe("brief");

    const missing = await app.inject({
      method: "GET",
      url: "/agents/missing/input_schema",
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it("blocks direct mode job execution in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.PAYMENT_MODE = "direct";
    process.env.LANGDOCK_API_KEY = "test-key";
    process.env.LANGDOCK_AGENT_ID = "test-agent";
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "job-1",
        input_data: [{ key: "text", value: "ping" }],
      },
    });

    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: string }).error).toBe("DIRECT_MODE_DISABLED");

    await app.close();
  });
});

describe("GET /input_schema", () => {
  it("returns the default text field by default", async () => {
    delete process.env.INPUT_SCHEMA_PATH;
    delete process.env.INPUT_SCHEMA_JSON;
    const app = await buildApp({ endpointHandler: new AgentEndpointHandler() });
    const res = await app.inject({ method: "GET", url: "/input_schema" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      input_data: Array<{ id: string; type: string }>;
    };
    expect(body.input_data[0].id).toBe("text");
    expect(body.input_data[0].type).toBe("string");
    await app.close();
  });
});

describe("/status error cases", () => {
  it("400 when job_id missing", async () => {
    const app = await buildApp({ endpointHandler: new AgentEndpointHandler() });
    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 for unknown job_id", async () => {
    const app = await buildApp({ endpointHandler: new AgentEndpointHandler() });
    const res = await app.inject({ method: "GET", url: "/status?job_id=nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
