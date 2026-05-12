/** Integration coverage for the hosted runtime setup UI and auth. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { __resetJobsForTests } from "../src/services/jobs.js";
import { resetDb } from "../src/services/database.js";

const ORIGINAL_ENV = { ...process.env };
let tempDir: string | undefined;

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LANGDOCK_BASE_URL;
  delete process.env.LANGDOCK_API_KEY;
  delete process.env.LANGDOCK_AGENT_ID;
  delete process.env.PAYMENT_MODE;
  delete process.env.PAYMENT_SERVICE_URL;
  delete process.env.PAYMENT_API_KEY;
  delete process.env.PAYMENT_API_AUTH_HEADER;
  delete process.env.NETWORK;
  delete process.env.MASUMI_PAYMENT_SERVICE_URL;
  delete process.env.MASUMI_PAYMENT_SERVICE_TOKEN;
  delete process.env.MASUMI_NETWORK;
  delete process.env.AGENT_IDENTIFIER;
  delete process.env.SELLER_VKEY;
  delete process.env.PRICE_AMOUNTS;
  delete process.env.SETUP_ACCESS_TOKEN;
  delete process.env.SETUP_USERNAME;
  delete process.env.SETUP_PASSWORD;
  delete process.env.SETUP_ENV_PATH;
  delete process.env.DB_PATH;
}

/** Register a user and return the session token. */
async function registerAndGetToken(
  app: Awaited<ReturnType<typeof buildApp>>,
  username = "testuser",
  password = "test-password-123",
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth",
    payload: { mode: "register", username, password },
  });
  expect(res.statusCode).toBe(200);
  return res.json().token;
}

/** Build a cookie header with a valid session token. */
async function sessionCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  username?: string,
  password?: string,
): Promise<string> {
  const token = await registerAndGetToken(app, username, password);
  return `session=${encodeURIComponent(token)}`;
}

describe("setup UI", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    resetEnv();
    tempDir = await mkdtemp(path.join(tmpdir(), "langdock-setup-test-"));
    process.env.SETUP_ENV_PATH = path.join(tempDir, ".env");
    process.env.DB_PATH = path.join(tempDir, "test.db");
    __resetJobsForTests();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    process.env = { ...ORIGINAL_ENV };
    resetDb();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("serves login page at / and redirects authenticated users to /dashboard", async () => {
    const app = await buildApp();

    const loginRes = await app.inject({ method: "GET", url: "/" });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.headers["content-type"]).toContain("text/html");
    expect(loginRes.body).toContain("Sign in");
    expect(loginRes.body).toContain("Create account");

    const cookie = await sessionCookie(app);
    const dashRes = await app.inject({
      method: "GET",
      url: "/",
      headers: { cookie },
    });
    expect(dashRes.statusCode).toBe(302);
    expect(dashRes.headers.location).toBe("/dashboard");

    await app.close();
  });

  it("serves dashboard at /dashboard for authenticated users", async () => {
    const app = await buildApp();
    const cookie = await sessionCookie(app);

    const res = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Langdock Masumi Setup");
    expect(res.body).toContain("Credential guide");
    expect(res.body).toContain("Agent slots");
    expect(res.body).toContain("openssl rand -hex 32");
    expect(res.body).toContain(
      "https://docs.langdock.com/api-endpoints/agent/agent-api-guide",
    );
    // User badge should show
    expect(res.body).toContain("testuser");
    expect(res.body).toContain("Sign out");

    await app.close();
  });

  it("redirects /dashboard to / when not authenticated", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/dashboard" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");

    await app.close();
  });

  it("registers a new user and returns a session token", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: {
        mode: "register",
        username: "newuser",
        password: "secure-pass-123",
        email: "new@example.com",
        displayName: "New User",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe("newuser");
    expect(body.user.displayName).toBe("New User");

    await app.close();
  });

  it("rejects duplicate username on registration", async () => {
    const app = await buildApp();

    await registerAndGetToken(app, "dupuser");

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "register", username: "dupuser", password: "other-pass-123" },
    });
    expect(res.statusCode).toBe(409);

    await app.close();
  });

  it("logs in an existing user and returns a session token", async () => {
    const app = await buildApp();
    await registerAndGetToken(app, "loginuser", "my-password-123");

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "login", username: "loginuser", password: "my-password-123" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user.username).toBe("loginuser");

    await app.close();
  });

  it("rejects wrong password on login", async () => {
    const app = await buildApp();
    await registerAndGetToken(app, "wrongpwuser", "correct-password");

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "login", username: "wrongpwuser", password: "wrong-password" },
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("applies runtime credentials and rebinds the Langdock start_job handler", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://langdock.example.com/agent/v1/chat/completions",
      );
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer runtime-langdock-key",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        agentId: "runtime-agent",
        stream: false,
      });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            messages: [
              {
                role: "assistant",
                parts: [{ type: "text", text: "runtime response" }],
              },
            ],
          }),
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const app = await buildApp();
    const cookie = await sessionCookie(app);

    const configRes = await app.inject({
      method: "POST",
      url: "/setup/config",
      headers: { cookie },
      payload: {
        langdockBaseUrl: "https://langdock.example.com",
        langdockApiKey: "runtime-langdock-key",
        langdockAgentId: "runtime-agent",
        paymentMode: "direct",
      },
    });

    expect(configRes.statusCode).toBe(200);
    expect(configRes.json()).toMatchObject({
      configured: {
        langdockApiKey: true,
        langdockAgentId: true,
        paymentMode: "direct",
      },
    });
    expect(configRes.body).not.toContain("runtime-langdock-key");
    await expect(readFile(process.env.SETUP_ENV_PATH!, "utf8")).resolves.toContain(
      "LANGDOCK_API_KEY=runtime-langdock-key",
    );

    const startRes = await app.inject({
      method: "POST",
      url: "/start_job",
      payload: {
        identifier_from_purchaser: "runtime-job",
        input_data: [{ key: "text", value: "ping" }],
      },
    });

    expect(startRes.statusCode).toBe(200);
    const startBody = startRes.json() as { id: string };
    const statusRes = await app.inject({
      method: "GET",
      url: `/status?job_id=${startBody.id}`,
    });
    expect(statusRes.json()).toMatchObject({
      status: "completed",
      result: "runtime response",
    });

    await app.close();
  });

  it("requires authentication on setup routes", async () => {
    const app = await buildApp();

    const denied = await app.inject({
      method: "POST",
      url: "/setup/config",
      payload: { langdockApiKey: "nope" },
    });
    expect(denied.statusCode).toBe(401);

    const cookie = await sessionCookie(app);
    const allowed = await app.inject({
      method: "POST",
      url: "/setup/config",
      headers: { cookie },
      payload: {
        langdockApiKey: "runtime-secret",
        langdockAgentId: "agent",
        paymentMode: "direct",
      },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).not.toContain("runtime-secret");
    await expect(readFile(process.env.SETUP_ENV_PATH!, "utf8")).resolves.toContain(
      "LANGDOCK_API_KEY=runtime-secret",
    );

    await app.close();
  });

  it("still accepts legacy SETUP_ACCESS_TOKEN for setup routes", async () => {
    process.env.SETUP_ACCESS_TOKEN = "legacy-secret";
    const app = await buildApp();

    const denied = await app.inject({
      method: "POST",
      url: "/setup/config",
      headers: { "x-setup-token": "wrong" },
      payload: { paymentMode: "direct" },
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "POST",
      url: "/setup/config",
      headers: { "x-setup-token": "legacy-secret" },
      payload: { paymentMode: "direct" },
    });
    expect(allowed.statusCode).toBe(200);

    await app.close();
  });

  it("still accepts legacy username/password for setup routes", async () => {
    process.env.SETUP_USERNAME = "operator";
    process.env.SETUP_PASSWORD = "local-password";
    const app = await buildApp();

    const denied = await app.inject({
      method: "POST",
      url: "/setup/config",
      headers: {
        authorization: `Basic ${Buffer.from("operator:wrong").toString("base64")}`,
      },
      payload: { paymentMode: "direct" },
    });
    expect(denied.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "POST",
      url: "/setup/config",
      headers: {
        authorization: `Basic ${Buffer.from("operator:local-password").toString("base64")}`,
      },
      payload: { paymentMode: "direct" },
    });
    expect(allowed.statusCode).toBe(200);

    await app.close();
  });

  it("keeps previously persisted secrets when later setup posts leave secret fields blank", async () => {
    await writeFile(
      process.env.SETUP_ENV_PATH!,
      [
        "LANGDOCK_API_KEY=existing-langdock-secret",
        "PAYMENT_API_KEY=existing-payment-secret",
      ].join("\n"),
      "utf8",
    );
    process.env.LANGDOCK_API_KEY = "existing-langdock-secret";
    process.env.PAYMENT_API_KEY = "existing-payment-secret";

    const app = await buildApp();
    const cookie = await sessionCookie(app);

    const res = await app.inject({
      method: "POST",
      url: "/setup/config",
      headers: { cookie },
      payload: {
        langdockApiKey: "",
        langdockAgentId: "agent",
        paymentApiKey: "",
        paymentMode: "direct",
      },
    });

    expect(res.statusCode).toBe(200);
    const env = await readFile(process.env.SETUP_ENV_PATH!, "utf8");
    expect(env).toContain("LANGDOCK_API_KEY=existing-langdock-secret");
    expect(env).toContain("PAYMENT_API_KEY=existing-payment-secret");

    await app.close();
  });

  it("tests Langdock directly from the backend using runtime credentials", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          id: "msg_1",
          role: "assistant",
          parts: [{ type: "text", text: "direct langdock response" }],
        }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    process.env.LANGDOCK_BASE_URL = "https://api.langdock.com";
    process.env.LANGDOCK_API_KEY = "runtime-langdock-key";
    process.env.LANGDOCK_AGENT_ID = "runtime-agent";

    const app = await buildApp();
    const cookie = await sessionCookie(app);

    const res = await app.inject({
      method: "POST",
      url: "/setup/langdock/test",
      headers: { cookie },
      payload: { prompt: "ping" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      output: "direct langdock response",
    });
    expect(res.body).not.toContain("runtime-langdock-key");

    await app.close();
  });

  it("registers an agent through the Masumi registry API and persists returned identifier", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://payment.example.com/api/v1/registry/");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ token: "payment-admin-key" });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        network: "Preprod",
        sellingWalletVkey: "seller-vkey",
        name: "Langdock Agent",
        apiBaseUrl: "https://agent.example.com",
        Capability: { name: "langdock-agent", version: "1.0.0" },
        AgentPricing: {
          pricingType: "Fixed",
          Pricing: [
            {
              amount: "1000000",
            },
          ],
        },
      });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: {
              state: "RegistrationRequested",
              agentIdentifier: "asset_identifier_123",
            },
          }),
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-admin-key";
    process.env.PAYMENT_API_AUTH_HEADER = "token";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.NETWORK = "Preprod";

    const app = await buildApp();
    const cookie = await sessionCookie(app);

    const res = await app.inject({
      method: "POST",
      url: "/setup/registry/register",
      headers: { cookie },
      payload: {
        agentName: "Langdock Agent",
        agentDescription: "Agent for Langdock test jobs",
        agentApiBaseUrl: "https://agent.example.com",
        capabilityName: "langdock-agent",
        capabilityVersion: "1.0.0",
        authorName: "Test Author",
        tags: "langdock,masumi",
        pricingAmount: "1000000",
        pricingUnit:
          "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      agentIdentifier: "asset_identifier_123",
      state: "RegistrationRequested",
    });
    const env = await readFile(process.env.SETUP_ENV_PATH!, "utf8");
    expect(env).toContain("REGISTRY_AGENT_NAME=\"Langdock Agent\"");
    expect(env).toContain("AGENT_IDENTIFIER=asset_identifier_123");

    await app.close();
  });

  it("refreshes registry status and persists a matched agent identifier", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe(
        "https://payment.example.com/api/v1/registry/?network=Preprod",
      );
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: {
              Assets: [
                {
                  name: "Langdock Agent",
                  apiBaseUrl: "https://agent.example.com",
                  state: "RegistrationConfirmed",
                  agentIdentifier: "confirmed_identifier_123",
                },
              ],
            },
          }),
      };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-admin-key";
    process.env.PAYMENT_API_AUTH_HEADER = "token";
    process.env.NETWORK = "Preprod";
    process.env.REGISTRY_AGENT_NAME = "Langdock Agent";
    process.env.REGISTRY_AGENT_API_BASE_URL = "https://agent.example.com";

    const app = await buildApp();
    const cookie = await sessionCookie(app);

    const res = await app.inject({
      method: "GET",
      url: "/setup/registry/status",
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      agentIdentifier: "confirmed_identifier_123",
      state: "RegistrationConfirmed",
    });
    const env = await readFile(process.env.SETUP_ENV_PATH!, "utf8");
    expect(env).toContain("AGENT_IDENTIFIER=confirmed_identifier_123");

    await app.close();
  });
});
