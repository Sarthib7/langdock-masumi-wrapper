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
    process.env.NETWORK = "Preprod";
    process.env.PAYMENT_POLL_INTERVAL_MS = "10";
    process.env.PAYMENT_POLL_TIMEOUT_MS = "2000";
    process.env.HITL_CHAT_MODE = "false";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    delete process.env.PAYMENT_MODE;
    delete process.env.AGENT_IDENTIFIER;
    delete process.env.SELLER_VKEY;
    delete process.env.PAYMENT_SERVICE_URL;
    delete process.env.PAYMENT_API_KEY;
    delete process.env.NETWORK;
    delete process.env.PAYMENT_POLL_INTERVAL_MS;
    delete process.env.PAYMENT_POLL_TIMEOUT_MS;
    delete process.env.HITL_CHAT_MODE;
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

    expect(res.statusCode).toBe(200);
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
