/** Integration coverage for the hosted runtime setup UI and auth. */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { __resetJobsForTests } from "../src/services/jobs.js";
import { resetDb } from "../src/services/database.js";
import { __resetRateLimitsForTests } from "../src/services/rateLimit.js";

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
  delete process.env.AGENTS_JSON;
  delete process.env.PRICE_AMOUNTS;
  delete process.env.SETUP_ACCESS_TOKEN;
  delete process.env.SETUP_USERNAME;
  delete process.env.SETUP_PASSWORD;
  delete process.env.SETUP_ENV_PATH;
  delete process.env.DB_PATH;
  delete process.env.REGISTRY_AGENT_NAME;
  delete process.env.REGISTRY_AGENT_DESCRIPTION;
  delete process.env.REGISTRY_AGENT_API_BASE_URL;
  delete process.env.REGISTRY_CAPABILITY_NAME;
  delete process.env.REGISTRY_CAPABILITY_VERSION;
  delete process.env.REGISTRY_AUTHOR_NAME;
  delete process.env.REGISTRY_AUTHOR_CONTACT_EMAIL;
  delete process.env.REGISTRY_AUTHOR_CONTACT_OTHER;
  delete process.env.REGISTRY_AUTHOR_ORGANIZATION;
  delete process.env.REGISTRY_TAGS;
  delete process.env.REGISTRY_PRICING_AMOUNT;
  delete process.env.REGISTRY_PRICING_UNIT;
  delete process.env.REGISTRY_EXAMPLE_OUTPUTS;
  delete process.env.REGISTRY_LEGAL_PRIVACY_POLICY;
  delete process.env.REGISTRY_LEGAL_TERMS;
  delete process.env.REGISTRY_LEGAL_OTHER;
}

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin-password-123";
const PREPROD_TUSDM_UNIT =
  "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";

/** Log in with configured admin credentials and return the session cookie. */
async function loginAndGetCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  username = ADMIN_USERNAME,
  password = ADMIN_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth",
    payload: { mode: "login", username, password },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers["set-cookie"];
  expect(setCookie).toBeTruthy();
  const match = String(setCookie).match(/session=([^;]+)/);
  expect(match).toBeTruthy();
  return `session=${match![1]}`;
}

/** Build a cookie header with a valid session. */
async function sessionCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  username?: string,
  password?: string,
): Promise<string> {
  return loginAndGetCookie(app, username, password);
}

describe("setup UI", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    resetEnv();
    tempDir = await mkdtemp(path.join(tmpdir(), "langdock-setup-test-"));
    process.env.SETUP_ENV_PATH = path.join(tempDir, ".env");
    process.env.DB_PATH = path.join(tempDir, "test.db");
    process.env.SETUP_USERNAME = ADMIN_USERNAME;
    process.env.SETUP_PASSWORD = ADMIN_PASSWORD;
    __resetJobsForTests();
    __resetRateLimitsForTests();
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
    expect(loginRes.body).not.toContain("Create account");

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
    expect(res.body).toContain("SETUP_PASSWORD_HASH");
    expect(res.body).toContain(
      "https://docs.langdock.com/api-endpoints/agent/agent-api-guide",
    );
    // User badge should show
    expect(res.body).toContain(ADMIN_USERNAME);
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

  it("logs in with configured admin credentials and returns a session cookie", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: {
        mode: "login",
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.user.username).toBe(ADMIN_USERNAME);
    // Token is set via Set-Cookie header, not in body
    expect(res.headers["set-cookie"]).toContain("session=");
    expect(res.headers["set-cookie"]).toContain("HttpOnly");

    await app.close();
  });

  it("rejects browser registration", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "register", username: "newuser", password: "other-pass-123" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "REGISTRATION_DISABLED" });

    await app.close();
  });

  it("rejects login when admin credentials are not configured", async () => {
    const app = await buildApp();
    delete process.env.SETUP_USERNAME;
    delete process.env.SETUP_PASSWORD;

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "login", username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "LOGIN_FAILED" });

    await app.close();
  });

  it("rejects wrong password on login", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "login", username: ADMIN_USERNAME, password: "wrong-password" },
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
        description: "Agent for Langdock test jobs",
        apiBaseUrl: "https://agent.example.com",
        Author: {
          name: "Test Author",
          contactEmail: "author@example.com",
          contactOther: "https://example.com/contact",
          organization: "Example Org",
        },
        Capability: { name: "langdock-agent", version: "1.0.0" },
        ExampleOutputs: [
          {
            name: "Sample answer",
            url: "https://agent.example.com/sample.json",
            mimeType: "application/json",
          },
        ],
        Legal: {
          privacyPolicy: "https://example.com/privacy",
          terms: "https://example.com/terms",
          other: "No extra terms.",
        },
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
        authorContactEmail: "author@example.com",
        authorContactOther: "https://example.com/contact",
        authorOrganization: "Example Org",
        tags: "langdock,masumi",
        pricingAmount: "1000000",
        pricingUnit:
          "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d",
        exampleOutputs: JSON.stringify([
          {
            name: "Sample answer",
            url: "https://agent.example.com/sample.json",
            mimeType: "application/json",
          },
        ]),
        legalPrivacyPolicy: "https://example.com/privacy",
        legalTerms: "https://example.com/terms",
        legalOther: "No extra terms.",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      agentIdentifier: "asset_identifier_123",
      state: "RegistrationRequested",
    });
    const env = await readFile(process.env.SETUP_ENV_PATH!, "utf8");
    expect(env).toContain("REGISTRY_AGENT_NAME=\"Langdock Agent\"");
    expect(env).toContain("REGISTRY_AUTHOR_CONTACT_OTHER=https://example.com/contact");
    expect(env).toContain("REGISTRY_EXAMPLE_OUTPUTS=");
    expect(env).toContain("REGISTRY_LEGAL_TERMS=https://example.com/terms");
    expect(env).toContain("AGENT_IDENTIFIER=asset_identifier_123");

    await app.close();
  });

  it("registers a routed agent profile and persists its identifier in AGENTS_JSON", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://payment.example.com/api/v1/registry/");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        network: "Preprod",
        sellingWalletVkey: "seller-vkey",
        name: "Research Agent",
        description: "Agent for research jobs",
        apiBaseUrl: "https://agent.example.com/agents/research",
      });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: {
              state: "RegistrationRequested",
              agentIdentifier: "asset_research_identifier_123",
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
        agentSlug: "research",
        langdockAgentId: "langdock-research-agent",
        agentName: "Research Agent",
        agentDescription: "Agent for research jobs",
        agentApiBaseUrl: "https://agent.example.com/agents/research",
        capabilityName: "langdock-agent",
        capabilityVersion: "1.0.0",
        authorName: "Test Author",
        tags: "research,langdock",
        pricingAmount: "1000000",
        pricingUnit:
          "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d",
      },
    });

    expect(res.statusCode).toBe(200);
    const profiles = JSON.parse(process.env.AGENTS_JSON ?? "[]") as Array<{
      slug: string;
      langdockAgentId: string;
      agentIdentifier: string;
      priceAmounts: Array<{ amount: string; unit: string }>;
    }>;
    expect(profiles).toEqual([
      expect.objectContaining({
        slug: "research",
        langdockAgentId: "langdock-research-agent",
        agentIdentifier: "asset_research_identifier_123",
        // Fixed pricing: priceAmounts is intentionally empty at the profile level
        priceAmounts: [],
      }),
    ]);
    const env = await readFile(process.env.SETUP_ENV_PATH!, "utf8");
    expect(env).toContain("AGENTS_JSON=");
    expect(env).not.toContain("AGENT_IDENTIFIER=asset_research_identifier_123");

    await app.close();
  });

  it("passes explicit Masumi registry pricing rows through unchanged", async () => {
    const expectedPricing = [
      { amount: "5000000", unit: PREPROD_TUSDM_UNIT },
      { amount: "5000000", unit: "lovelace" },
    ];
    const fetchMock = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        AgentPricing?: { Pricing?: unknown };
      };
      expect(body.AgentPricing?.Pricing).toEqual(expectedPricing);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: {
              state: "RegistrationRequested",
              agentIdentifier: "asset_priced_identifier_123",
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
        pricing: expectedPricing,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    await app.close();
  });

  it("rejects invalid explicit Masumi registry pricing before calling Masumi", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-admin-key";
    process.env.SELLER_VKEY = "seller-vkey";

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
        pricing: [{ amount: "0", unit: "lovelace" }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "REGISTRY_REGISTRATION_FAILED",
      message:
        "Pricing row 1 amount must be a positive integer raw token amount.",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await app.close();
  });

  it("rejects invalid registry example output JSON before calling Masumi", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-admin-key";
    process.env.SELLER_VKEY = "seller-vkey";

    const app = await buildApp();
    const cookie = await sessionCookie(app);

    const res = await app.inject({
      method: "POST",
      url: "/setup/registry/register",
      headers: { cookie },
      payload: {
        agentName: "Custom Agent",
        agentDescription: "A custom listing.",
        agentApiBaseUrl: "https://agent.example.com",
        capabilityName: "custom-capability",
        capabilityVersion: "1.0.0",
        authorName: "Test Author",
        tags: "custom,agent",
        pricingAmount: "1000000",
        exampleOutputs: "not-json",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "REGISTRY_REGISTRATION_FAILED",
    });
    expect(fetchMock).not.toHaveBeenCalled();

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
