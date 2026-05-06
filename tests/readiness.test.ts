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
  delete process.env.PRICE_AMOUNTS;
  delete process.env.INPUT_SCHEMA_JSON;
  delete process.env.INPUT_SCHEMA_PATH;
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
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: PREPROD_TUSDM_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
  });

  it("requires Masumi identity and payment-service credentials in masumi mode", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
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
    process.env.AGENT_IDENTIFIER = "agent-id-on-chain";
    process.env.SELLER_VKEY = "seller-vkey";
    process.env.PAYMENT_SERVICE_URL = "https://payment.example.com/api/v1";
    process.env.PAYMENT_API_KEY = "payment-token";
    process.env.PRICE_AMOUNTS = JSON.stringify([
      { amount: "1000000", unit: MAINNET_USDCX_UNIT },
    ]);

    const report = getReadinessReport(loadConfig());
    expect(report.status).toBe("ready");
    expect(report.issues).not.toContainEqual(
      expect.objectContaining({ code: "non_sokosumi_settlement_unit" }),
    );
  });

  it("warns when mainnet pricing is not USDCx", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Mainnet";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
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
          "Sokosumi mainnet listings are expected to settle in USDCx; use the full USDCx asset id as unit, not lovelace.",
      }),
    );
  });

  it("warns when Preprod pricing uses lovelace instead of the tUSDM asset id", () => {
    resetEnv();
    process.env.PAYMENT_MODE = "masumi";
    process.env.NETWORK = "Preprod";
    process.env.LANGDOCK_API_KEY = "ld-key";
    process.env.LANGDOCK_AGENT_ID = "agent-id";
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
