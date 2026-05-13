/**
 * Integration test for PAYMENT_MODE=masumi: /start_job should register a sale
 * on a mocked Masumi Payment Service, return blockchainIdentifier and timings
 * from the service, and the poller should run the handler once funds are
 * locked and submit the MIP-004 output hash on-chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentEndpointHandler } from "../src/agentEndpointHandler.js";
import { buildApp } from "../src/app.js";
import { __resetJobsForTests } from "../src/services/jobs.js";

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("waitUntil timed out"));
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe("POST /start_job in masumi mode with mocked Payment Service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetJobsForTests();
    process.env.PAYMENT_MODE = "masumi";
    process.env.AGENT_IDENTIFIER = "agent-xyz";
    process.env.SELLER_VKEY = "addr_test1xyz";
    process.env.PAYMENT_SERVICE_URL = "http://payment.test/api/v1";
    process.env.PAYMENT_API_KEY = "secret";
    process.env.LANGDOCK_API_KEY = "test-key";
    process.env.LANGDOCK_AGENT_ID = "test-agent";
    process.env.NETWORK = "Preprod";
    process.env.PAYMENT_POLL_INTERVAL_MS = "10";
    process.env.PAYMENT_POLL_TIMEOUT_MS = "2000";
    process.env.HITL_CHAT_MODE = "false";
    delete process.env.AGENTS_JSON;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    delete process.env.PAYMENT_MODE;
    delete process.env.AGENT_IDENTIFIER;
    delete process.env.SELLER_VKEY;
    delete process.env.PAYMENT_SERVICE_URL;
    delete process.env.PAYMENT_API_KEY;
    delete process.env.LANGDOCK_API_KEY;
    delete process.env.LANGDOCK_AGENT_ID;
    delete process.env.NETWORK;
    delete process.env.PAYMENT_POLL_INTERVAL_MS;
    delete process.env.PAYMENT_POLL_TIMEOUT_MS;
    delete process.env.HITL_CHAT_MODE;
    delete process.env.AGENTS_JSON;
  });

  it("registers sale, polls, runs handler, submits hash", async () => {
    let registerCalls = 0;
    let submitResultCalls = 0;
    let statusCalls = 0;

    const blockchainIdentifier = "block_test_123";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          url: string,
          init?: {
            method?: string;
            body?: string;
            headers?: Record<string, string>;
          },
        ) => {
          const method = init?.method ?? "GET";
          const u = typeof url === "string" ? url : String(url);

          if (u.endsWith("/api/v1/payment") && method === "POST") {
            registerCalls += 1;
            expect(init?.headers?.token).toBe("secret");
            const body = JSON.parse(init!.body!);
            expect(body.network).toBe("Preprod");
            expect(body.agentIdentifier).toBe("agent-xyz");
            expect(body.inputHash).toMatch(/^[0-9a-f]{64}$/);
            expect(body.paymentType).toBeUndefined();
            expect(body.amounts).toBeUndefined();
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  data: {
                    blockchainIdentifier,
                    payByTime: "1800000000",
                    submitResultTime: "1800001000",
                    unlockTime: "1800002000",
                    externalDisputeUnlockTime: "1800003000",
                  },
                }),
            };
          }

          if (
            u.endsWith("/api/v1/payment/resolve-blockchain-identifier") &&
            method === "POST"
          ) {
            statusCalls += 1;
            const body = JSON.parse(init!.body!);
            expect(body.network).toBe("Preprod");
            expect(body.blockchainIdentifier).toBe(blockchainIdentifier);
            // First two polls return "Initialized", then funds lock.
            const state = statusCalls < 2 ? "Initialized" : "FundsLocked";
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  data: { blockchainIdentifier, onChainState: state },
                }),
            };
          }

          if (u.endsWith("/api/v1/payment/submit-result") && method === "POST") {
            submitResultCalls += 1;
            const body = JSON.parse(init!.body!);
            expect(body.blockchainIdentifier).toBe(blockchainIdentifier);
            expect(body.submitResultHash).toMatch(/^[0-9a-f]{64}$/);
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ data: { ok: true } }),
            };
          }

          throw new Error(`Unexpected fetch: ${method} ${u}`);
        },
      ) as unknown as typeof fetch,
    );

    const handler = new AgentEndpointHandler();
    handler.setStartJobHandler(async (_id, input) => ({ input }));

    const app = await buildApp({ endpointHandler: handler });

    const res = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "aabbccddeeff0011",
        input_data: [{ key: "text", value: "hello" }],
      },
    });

    expect(res.statusCode, res.body).toBe(200);
    const json = res.json() as {
      blockchainIdentifier: string;
      status: string;
      agentIdentifier: string;
      sellerVKey: string;
      payByTime: number;
    };
    expect(json.blockchainIdentifier).toBe(blockchainIdentifier);
    expect(json.status).toBe("awaiting_payment");
    expect(json.agentIdentifier).toBe("agent-xyz");
    expect(json.sellerVKey).toBe("addr_test1xyz");
    expect(json.payByTime).toBe(1800000000000);
    expect(registerCalls).toBe(1);

    // Wait for the poller to see FundsLocked, run the handler, and submit.
    const { getJob } = await import("../src/services/jobs.js");
    const jobId = (res.json() as { id: string }).id;
    await waitUntil(() => getJob(jobId)?.status === "completed");

    const final = getJob(jobId);
    expect(final?.status).toBe("completed");
    expect(final?.output_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(submitResultCalls).toBe(1);

    await app.close();
  });

  it("uses per-agent Masumi identity and Langdock agent for /agents/:slug/start_job", async () => {
    delete process.env.AGENT_IDENTIFIER;
    delete process.env.LANGDOCK_AGENT_ID;
    process.env.AGENTS_JSON = JSON.stringify([
      {
        slug: "paid-agent",
        name: "Paid Agent",
        description: "Paid multi-agent route",
        langdockAgentId: "ld-paid-agent",
        agentIdentifier: "agent-paid-123",
        priceAmounts: [{ amount: "2000000", unit: "unit-test" }],
      },
    ]);

    let registerCalls = 0;
    let submitResultCalls = 0;
    const blockchainIdentifier = "block_paid_123";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          url: string,
          init?: {
            method?: string;
            body?: string;
            headers?: Record<string, string>;
          },
        ) => {
          const method = init?.method ?? "GET";
          const u = typeof url === "string" ? url : String(url);

          if (u.endsWith("/api/v1/payment") && method === "POST") {
            registerCalls += 1;
            const body = JSON.parse(init!.body!);
            expect(body.agentIdentifier).toBe("agent-paid-123");
            // Fixed pricing: wrapper must NOT send RequestedFunds
            expect(body.RequestedFunds).toBeUndefined();
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  data: {
                    blockchainIdentifier,
                    payByTime: "1800000000",
                    submitResultTime: "1800001000",
                    unlockTime: "1800002000",
                    externalDisputeUnlockTime: "1800003000",
                  },
                }),
            };
          }

          if (
            u.endsWith("/api/v1/payment/resolve-blockchain-identifier") &&
            method === "POST"
          ) {
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  data: { blockchainIdentifier, onChainState: "FundsLocked" },
                }),
            };
          }

          if (u.endsWith("/api/v1/payment/submit-result") && method === "POST") {
            submitResultCalls += 1;
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ data: { ok: true } }),
            };
          }

          if (u.endsWith("/agent/v1/chat/completions") && method === "POST") {
            const body = JSON.parse(init!.body!);
            expect(body.agentId).toBe("ld-paid-agent");
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  messages: [
                    {
                      id: "m1",
                      role: "assistant",
                      parts: [{ type: "text", text: "paid agent result" }],
                    },
                  ],
                }),
            };
          }

          throw new Error(`Unexpected fetch: ${method} ${u}`);
        },
      ) as unknown as typeof fetch,
    );

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/agents/paid-agent/start_job",
      payload: {
        identifier_from_purchaser: "aabbccddeeff0011",
        input_data: [{ key: "text", value: "hello" }],
      },
    });

    expect(res.statusCode, res.body).toBe(200);
    const json = res.json() as {
      id: string;
      agentIdentifier: string;
      amounts: Array<{ amount: string; unit: string }>;
    };
    expect(json.agentIdentifier).toBe("agent-paid-123");
    expect(json.amounts).toEqual([]);
    expect(registerCalls).toBe(1);

    const { getJob } = await import("../src/services/jobs.js");
    await waitUntil(() => getJob(json.id)?.status === "completed");
    expect(getJob(json.id)?.result).toBe("paid agent result");
    expect(submitResultCalls).toBe(1);

    await app.close();
  });

  it("returns 500 when AGENT_IDENTIFIER or SELLER_VKEY is missing", async () => {
    delete process.env.AGENT_IDENTIFIER;
    const handler = new AgentEndpointHandler();
    handler.setStartJobHandler(async () => ({}));
    const app = await buildApp({ endpointHandler: handler });

    const res = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "aabbccddeeff0011",
        input_data: [],
      },
    });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: string }).error).toBe("AGENT_NOT_REGISTERED");
    await app.close();
  });

  it("marks a job refunded when the payment datum is invalid", async () => {
    const blockchainIdentifier = "block_invalid_datum";

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (
          url: string,
          init?: {
            method?: string;
            body?: string;
            headers?: Record<string, string>;
          },
        ) => {
          const method = init?.method ?? "GET";
          const u = typeof url === "string" ? url : String(url);

          if (u.endsWith("/api/v1/payment") && method === "POST") {
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  data: {
                    blockchainIdentifier,
                    payByTime: "1800000000",
                    submitResultTime: "1800001000",
                    unlockTime: "1800002000",
                    externalDisputeUnlockTime: "1800003000",
                  },
                }),
            };
          }

          if (
            u.endsWith("/api/v1/payment/resolve-blockchain-identifier") &&
            method === "POST"
          ) {
            return {
              ok: true,
              status: 200,
              text: async () =>
                JSON.stringify({
                  data: {
                    blockchainIdentifier,
                    onChainState: "FundsOrDatumInvalid",
                  },
                }),
            };
          }

          throw new Error(`Unexpected fetch: ${method} ${u}`);
        },
      ) as unknown as typeof fetch,
    );

    const handler = new AgentEndpointHandler();
    const handlerSpy = vi.fn(async () => ({ should: "not run" }));
    handler.setStartJobHandler(handlerSpy);

    const app = await buildApp({ endpointHandler: handler });
    const res = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "aabbccddeeff0011",
        input_data: [{ key: "text", value: "hello" }],
      },
    });

    expect(res.statusCode, res.body).toBe(200);
    const jobId = (res.json() as { id: string }).id;

    const { getJob } = await import("../src/services/jobs.js");
    await waitUntil(() => getJob(jobId)?.status === "refunded");

    const final = getJob(jobId);
    expect(final?.status).toBe("refunded");
    expect(final?.error).toBe(
      "Payment terminated on-chain: FundsOrDatumInvalid",
    );
    expect(handlerSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects purchaser identifiers that the Masumi payment API cannot accept", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const handler = new AgentEndpointHandler();
    handler.setStartJobHandler(async () => ({}));
    const app = await buildApp({ endpointHandler: handler });

    const res = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "buyer-1",
        input_data: [],
      },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(
      "INVALID_IDENTIFIER_FROM_PURCHASER",
    );
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });
});
