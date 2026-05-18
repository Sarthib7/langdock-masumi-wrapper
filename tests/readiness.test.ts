/** Tests for centralized production-readiness validation. */
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  assertProductionReady,
  getReadinessReport,
} from "../src/services/readiness.js";
import {
  MAINNET_USDCX_UNIT,
  MAINNET_USDM_UNIT,
  PREPROD_TUSDM_UNIT,
} from "../src/services/sokosumiTokens.js";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NODE_ENV;
  delete process.env.REQUIRE_PRODUCTION_CONFIG;
  delete process.env.PAYMENT_MODE;
  delete process.env.LANGDOCK_API_KEY;
  delete process.env.LANGDOCK_AGENT_ID;
  delete process.env.PAYMENT_SERVICE_URL;
  delete process.env.PAYMENT_API_KEY;
  delete process.env.NETWORK;
  delete process.env.MASUMI_PAYMENT_SERVICE_URL;
  delete process.env.MASUMI_PAYMENT_SERVICE_TOKEN;
  delete process.env.MASUMI_NETWORK;
  delete process.env.AGENT_IDENTIFIER;
  delete process.env.SELLER_VKEY;
  delete process.env.AGENTS_JSON;
  delete process.env.PRICE_AMOUNTS;
  delete process.env.INPUT_SCHEMA_JSON;
  delete process.env.INPUT_SCHEMA_PATH;
  delete process.env.SETUP_USERNAME;
  delete process.env.SETUP_PASSWORD_HASH;
  delete process.env.SETUP_PASSWORD;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_SSL;
  delete process.env.DB_PATH;
  delete process.env.REGISTRY_AGENT_API_BASE_URL;
}

function setAdminEnv(): void {
  process.env.SETUP_USERNAME = "admin";
  process.env.SETUP_PASSWORD_HASH = "$2b$12$abcdefghijklmnopqrstuuK7r2cFOP7JPrbMV7xYUq/xp1n0JRXD6";
}

function setPlainAdminEnv(): void {
  process.env.SETUP_USERNAME = "admin";
  process.env.SETUP_PASSWORD = "admin-password-123";
}

describe("getReadinessReport", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports missing Langdock secrets", () => {
    resetEnv();
    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("not_ready");
    expect(report.issues.map((issue) => issue.env?.[0])).toContain(
      "LANGDOCK_API_KEY",
    );
    expect(report.issues.map((issue) => issue.env?.[0])).toContain(
      "LANGDOCK_AGENT_ID",
    );
  });

  it("accepts a complete direct-mode development config", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "direct";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
  });

  it("accepts direct-mode routed agents without a global Langdock agent id", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "direct";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.AGENTS_JSON = JSON.stringify([
      {
        slug: "agent-one",
        name: "Agent One",
        apiBaseUrl: "https://wrapper.example.com/agents/agent-one",
        langdockAgentId: "langdock-agent-one",
      },
      {
        slug: "agent-two",
        name: "Agent Two",
        apiBaseUrl: "https://wrapper.example.com/agents/agent-two",
        langdockAgentId: "langdock-agent-two",
      },
    ]);
    setAdminEnv();
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ env: expect.arrayContaining(["LANGDOCK_AGENT_ID"]) }),
    );
  });

  it("accepts username and plaintext password setup without readiness warnings", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "direct";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setPlainAdminEnv();
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).toEqual([]);
  });

  it("accepts database-backed admin auth configuration with an explicit warning", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "direct";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    process.env.DATABASE_URL = "postgres://user:pass@example.com:5432/app";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "database_admin_user_unverified",
      }),
    );
  });

  it("requires Masumi identity and payment-service credentials in masumi mode", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("not_ready");
    expect(
      report.issues
        .filter((issue) => issue.severity === "error")
        .flatMap((issue) => issue.env ?? []),
    ).toEqual(
      expect.arrayContaining([
        "AGENT_IDENTIFIER",
        "SELLER_VKEY",
        "PAYMENT_SERVICE_URL",
        "PAYMENT_API_KEY",
      ]),
    );
  });

  it("accepts masumi-mode routed agents with per-agent identifiers", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.AGENTS_JSON = JSON.stringify([
      {
        slug: "agent-one",
        name: "Agent One",
        apiBaseUrl: "https://wrapper.example.com/agents/agent-one",
        langdockAgentId: "langdock-agent-one",
        agentIdentifier: "agent-identifier-one",
      },
      {
        slug: "agent-two",
        name: "Agent Two",
        apiBaseUrl: "https://wrapper.example.com/agents/agent-two",
        langdockAgentId: "langdock-agent-two",
        agentIdentifier: "agent-identifier-two",
      },
    ]);
    setAdminEnv();
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ env: expect.arrayContaining(["AGENT_IDENTIFIER"]) }),
    );
  });

  it("requires per-agent identifiers for routed agents in masumi mode", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.AGENTS_JSON = JSON.stringify([
      {
        slug: "agent-one",
        langdockAgentId: "langdock-agent-one",
      },
    ]);
    setAdminEnv();
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("not_ready");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "missing_agent_profile_identifier",
        message:
          "Agent profile \"agent-one\" needs agentIdentifier before /agents/agent-one/start_job can run in masumi mode.",
      }),
    );
  });

  it("allows the dev server to start before runtime setup credentials are posted", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";

    expect(() => assertProductionReady(loadConfig())).not.toThrow();
  });

  it("does not enforce readiness while building the HTTP app in production", async () => {
    resetEnv();
    process.env.NODE_ENV = "production";
    process.env.PAYMENT_MODE = "direct";
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it("still blocks startup when explicit production config enforcement is enabled", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.REQUIRE_PRODUCTION_CONFIG = "true";

    expect(() => assertProductionReady(loadConfig())).toThrow(
      "Production configuration is not ready",
    );
  });

  it("keeps the configured SaaS base URL and auto-selects x-api-key auth", () => {
    resetEnv();
    process.env.PAYMENT_SERVICE_URL = "https://saas.example.com/pay/api/v1";

    const config = loadConfig();
    expect(config.paymentMode).toBe("masumi");
    expect(config.paymentServiceUrl).toBe("https://saas.example.com/pay/api/v1");
    expect(config.paymentApiAuthHeader).toBe("x-api-key");
  });

  it("keeps the configured payment-node base URL and defaults to token auth", () => {
    resetEnv();
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";

    const config = loadConfig();
    expect(config.paymentMode).toBe("masumi");
    expect(config.paymentServiceUrl).toBe("https://payment.example.com/api/v1");
    expect(config.paymentApiAuthHeader).toBe("token");
  });

  it("reports invalid Masumi wiring env instead of silently falling back", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://saas.example.com";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.NETWORK = "mainnet";
    process.env.PAYMENT_API_AUTH_HEADER = "bearer";
    process.env.PRICE_AMOUNTS = "not json";

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("not_ready");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_network" }),
        expect.objectContaining({ code: "invalid_payment_api_auth_header" }),
        expect.objectContaining({ code: "invalid_price_amounts_json" }),
        expect.objectContaining({ code: "payment_api_base_path_missing" }),
      ]),
    );
  });

  it("accepts USDCx as the expected mainnet settlement token", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Mainnet";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: MAINNET_USDCX_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.networkDetails).toMatchObject({
      settlementToken: "USDCx",
      settlementUnit: MAINNET_USDCX_UNIT,
      registryPolicyId: "6323eccc89e311315a59f511e45c85fe48a7d14da743030707d42adf",
      paymentContractAddress: "addr1wyv9sc853kpurfdqv5f02tmmlscez20ks0p5p6aj76j0xac365skm",
    });
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ code: "non_sokosumi_settlement_unit" }),
    );
  });

  it("accepts the Mainnet USDM asset id still referenced by the Sokosumi listing guide", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Mainnet";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: MAINNET_USDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ code: "non_sokosumi_settlement_unit" }),
    );
  });

  it("warns when mainnet pricing is not a known Mainnet settlement unit", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Mainnet";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "non_sokosumi_settlement_unit",
        message:
          "Mainnet pricing should use a known Masumi settlement asset id. Current token docs identify USDCx as active; the Sokosumi listing guide also references the legacy USDM asset id. Do not use lovelace for stablecoin pricing.",
      }),
    );
  });

  it("rejects Mainnet direct mode even outside production", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "direct";
    process.env.NETWORK = "Mainnet";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: MAINNET_USDCX_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("not_ready");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "mainnet_requires_masumi_mode",
      }),
    );
  });

  it("rejects localhost public URLs in Mainnet mode", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Mainnet";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "http://localhost:3001/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.REGISTRY_AGENT_API_BASE_URL = "https://localhost/agents/mainnet";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: MAINNET_USDCX_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("not_ready");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "mainnet_local_url",
        env: ["PAYMENT_SERVICE_URL"],
      }),
    );
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "mainnet_local_url",
        env: ["REGISTRY_AGENT_API_BASE_URL"],
      }),
    );
  });

  it("rejects plaintext admin passwords for production Mainnet", () => {
    resetEnv();
    process.env.NODE_ENV = "production";
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Mainnet";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setPlainAdminEnv();
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: MAINNET_USDCX_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("not_ready");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "mainnet_plaintext_admin_password",
      }),
    );
  });

  it("warns when Preprod pricing uses lovelace instead of the tUSDM asset id", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Preprod";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: "lovelace" },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "non_sokosumi_settlement_unit",
        message:
          "Sokosumi Preprod listings are expected to settle in tUSDM; use the full tUSDM asset id as unit, not lovelace.",
      }),
    );
  });
});

describe("GET /ready", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 503 with readiness issues when config is incomplete", async () => {
    resetEnv();
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { status: string }).status).toBe("not_ready");

    await app.close();
  });

  it("returns 200 when config is ready", async () => {
    resetEnv();
    process.env.PAYMENT_MODE = "direct";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
    setAdminEnv();
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe("ready");

    await app.close();
  });
});
