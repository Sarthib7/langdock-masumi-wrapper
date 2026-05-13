import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  computeCanonicalJsonHash,
  computeInputHash,
} from "../src/services/hashing.js";
import { createJob, __resetJobsForTests } from "../src/services/jobs.js";
import { hitlInputSchema } from "../src/services/hitlChat.js";
import { hashOpaqueToken } from "../src/services/opaqueTokens.js";

const originalEnv = { ...process.env };
const HITL_TOKEN = "test-hitl-token";

describe("POST /provide_input", () => {
  beforeEach(() => {
    __resetJobsForTests();
    process.env = { ...originalEnv };
    process.env.PAYMENT_MODE = "direct";
    process.env.HITL_CHAT_MODE = "true";
  });

  afterEach(() => {
    __resetJobsForTests();
    process.env = { ...originalEnv };
  });

  it("completes an awaiting_input HITL chat when user sends DONE", async () => {
    createJob({
      id: "job-hitl-1",
      blockchainIdentifier: "direct_job-hitl-1",
      identifierFromPurchaser: "aabbccddeeff0011",
      input_hash: "0".repeat(64),
      input_data: [{ key: "text", value: "hello" }],
      status: "awaiting_input",
      payByTime: 1,
      submitResultTime: 2,
      unlockTime: 3,
      externalDisputeUnlockTime: 4,
      amounts: [],
      continuation_token_hash: hashOpaqueToken(HITL_TOKEN),
    });

    const { setJobStatus } = await import("../src/services/jobs.js");
    setJobStatus("job-hitl-1", "awaiting_input", {
      awaiting_input_schema: hitlInputSchema(),
      awaiting_input_message: "Reply or type DONE.",
      conversation: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hi" }] },
      ],
      result: "hi",
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/provide_input",
      payload: {
        jobId: "job-hitl-1",
        inputToken: HITL_TOKEN,
        inputData: { message: "", finish: true },
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      status: string;
      input_hash: string;
      output_hash: string;
      result: string;
    };
    expect(json.status).toBe("completed");
    expect(json.input_hash).toBe(
      computeInputHash("aabbccddeeff0011", { message: "", finish: true }),
    );
    expect(json.output_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json.result).toContain("User: hello");
    expect(json.result).toContain("Lexi: hi");

    await app.close();
  });

  it("accepts routed HITL continuation with matching input schema hash", async () => {
    process.env.AGENTS_JSON = JSON.stringify([
      {
        slug: "test-agent",
        name: "Test Agent",
        description: "Routed HITL test agent",
        langdockAgentId: "ld-test-agent",
        agentIdentifier: "agent-test",
      },
    ]);
    createJob({
      id: "job-hitl-routed",
      blockchainIdentifier: "direct_job-hitl-routed",
      identifierFromPurchaser: "aabbccddeeff0014",
      input_hash: "3".repeat(64),
      input_data: [{ key: "text", value: "hello" }],
      status: "awaiting_input",
      payByTime: 1,
      submitResultTime: 2,
      unlockTime: 3,
      externalDisputeUnlockTime: 4,
      amounts: [],
      agent_slug: "test-agent",
      continuation_token_hash: hashOpaqueToken(HITL_TOKEN),
    });

    const { setJobStatus } = await import("../src/services/jobs.js");
    setJobStatus("job-hitl-routed", "awaiting_input", {
      awaiting_input_schema: hitlInputSchema(),
      awaiting_input_message: "Reply or type DONE.",
      conversation: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hi" }] },
      ],
      result: "hi",
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/agents/test-agent/provide_input",
      payload: {
        jobId: "job-hitl-routed",
        inputSchemaHash: computeCanonicalJsonHash(hitlInputSchema()),
        inputData: { message: "", finish: true },
      },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("completed");

    await app.close();
  });

  it("rejects HITL continuation without the job continuation token", async () => {
    createJob({
      id: "job-hitl-token",
      blockchainIdentifier: "direct_job-hitl-token",
      identifierFromPurchaser: "aabbccddeeff0013",
      input_hash: "2".repeat(64),
      input_data: [{ key: "text", value: "hello" }],
      status: "awaiting_input",
      payByTime: 1,
      submitResultTime: 2,
      unlockTime: 3,
      externalDisputeUnlockTime: 4,
      amounts: [],
      continuation_token_hash: hashOpaqueToken(HITL_TOKEN),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/provide_input",
      payload: {
        jobId: "job-hitl-token",
        inputData: { message: "continue" },
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "HITL_TOKEN_REQUIRED" });

    await app.close();
  });

  it("exposes HITL schema and message from /status", async () => {
    createJob({
      id: "job-hitl-2",
      blockchainIdentifier: "direct_job-hitl-2",
      identifierFromPurchaser: "aabbccddeeff0012",
      input_hash: "1".repeat(64),
      input_data: [{ key: "text", value: "hello" }],
      status: "awaiting_input",
      payByTime: 1,
      submitResultTime: 2,
      unlockTime: 3,
      externalDisputeUnlockTime: 4,
      amounts: [],
    });

    const { setJobStatus } = await import("../src/services/jobs.js");
    setJobStatus("job-hitl-2", "awaiting_input", {
      awaiting_input_schema: hitlInputSchema(),
      awaiting_input_message: "Reply or type DONE.",
      result: "hi",
    });

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/status?job_id=job-hitl-2" });
    expect(res.statusCode).toBe(200);
    const json = res.json() as { status: string; input_schema: unknown; message: string };
    expect(json.status).toBe("awaiting_input");
    expect(json.input_schema).toEqual(hitlInputSchema());
    expect(JSON.stringify(json.input_schema)).toContain('"id":"finish"');
    expect(json.message).toBe("Reply or type DONE.");

    await app.close();
  });
});
