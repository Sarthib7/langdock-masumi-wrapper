/**
 * Environment-backed settings: Langdock, Masumi Payment Service, agent identity,
 * pricing, timing offsets, and optional MIP-003 `/input_schema` payload.
 */

import { readFileSync } from "node:fs";

export type PaymentMode = "masumi" | "direct";
export type MasumiNetwork = "Preprod" | "Mainnet";
export type PaymentApiAuthHeader = "token" | "x-api-key";

export type InputSchemaField = {
  id: string;
  type: "string" | "number" | "boolean" | "option" | "none";
  name?: string;
  data?: Record<string, unknown>;
};

export type PriceAmount = {
  amount: string;
  unit: string;
};

export type AppConfig = {
  port: number;

  langdockBaseUrl: string;
  langdockApiKey: string;
  langdockAgentId: string;

  agentIdentifier: string;
  sellerVKey: string;

  paymentMode: PaymentMode;
  paymentServiceUrl: string;
  paymentApiKey: string;
  paymentApiAuthHeader: PaymentApiAuthHeader;
  /** Deprecated alias; use paymentServiceUrl / PAYMENT_SERVICE_URL. */
  masumiPaymentServiceUrl: string;
  /** Deprecated alias; use paymentApiKey / PAYMENT_API_KEY. */
  masumiPaymentServiceToken: string;
  masumiNetwork: MasumiNetwork;
  paymentPollIntervalMs: number;
  paymentPollTimeoutMs: number;

  priceAmounts: PriceAmount[];

  /** Seconds added to `now` for payment window fields when running in `direct` mode. */
  payByOffsetSec: number;
  submitResultOffsetSec: number;
  unlockOffsetSec: number;
  externalDisputeUnlockOffsetSec: number;

  inputSchema: InputSchemaField[];

  /** When true, Langdock jobs stay open for repeated /provide_input turns until user sends DONE. */
  hitlChatMode: boolean;
};

function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function strEnv(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined ? fallback : v;
}

function boolEnv(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function parseNetwork(raw: string | undefined): MasumiNetwork {
  const v = (raw ?? "Preprod").trim();
  return v === "Mainnet" ? "Mainnet" : "Preprod";
}

function parsePriceAmounts(raw: string | undefined): PriceAmount[] {
  if (!raw || !raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const out: PriceAmount[] = [];
      for (const item of parsed) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { amount?: unknown }).amount === "string" &&
          typeof (item as { unit?: unknown }).unit === "string"
        ) {
          out.push({
            amount: (item as PriceAmount).amount,
            unit: (item as PriceAmount).unit,
          });
        }
      }
      if (out.length > 0) return out;
    }
  } catch {
    // fall through
  }
  return [];
}

function parsePaymentApiAuthHeader(
  raw: string | undefined,
  paymentServiceUrl: string,
): PaymentApiAuthHeader {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "x-api-key") return "x-api-key";
  if (normalized === "token") return "token";
  return paymentServiceUrl.toLowerCase().includes("/pay/api/v1")
    ? "x-api-key"
    : "token";
}

function loadInputSchema(): InputSchemaField[] {
  const path = process.env.INPUT_SCHEMA_PATH;
  if (path && path.trim()) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as InputSchemaField[];
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { input_data?: unknown }).input_data)
      ) {
        return (parsed as { input_data: InputSchemaField[] }).input_data;
      }
    } catch {
      // fall through to default
    }
  }

  const inline = process.env.INPUT_SCHEMA_JSON;
  if (inline && inline.trim()) {
    try {
      const parsed = JSON.parse(inline) as unknown;
      if (Array.isArray(parsed)) return parsed as InputSchemaField[];
    } catch {
      // fall through to default
    }
  }

  return [
    {
      id: "text",
      type: "string",
      name: "Input text",
      data: {
        description: "Prompt text sent to the Langdock agent.",
        placeholder: "Describe your task...",
      },
    },
  ];
}

export function resolveAgentDisplayIdentity(config: AppConfig): {
  agentIdentifier: string;
  sellerVKey: string;
} {
  const agentIdentifier =
    config.agentIdentifier.trim() || "unregistered-agent";
  return {
    agentIdentifier,
    sellerVKey: config.sellerVKey.trim(),
  };
}

export function loadConfig(): AppConfig {
  const paymentServiceUrl = strEnv(
    "PAYMENT_SERVICE_URL",
    strEnv("MASUMI_PAYMENT_SERVICE_URL"),
  ).replace(/\/$/, "");
  const paymentApiKey = strEnv(
    "PAYMENT_API_KEY",
    strEnv("MASUMI_PAYMENT_SERVICE_TOKEN"),
  );
  const paymentApiAuthHeader = parsePaymentApiAuthHeader(
    process.env.PAYMENT_API_AUTH_HEADER,
    paymentServiceUrl,
  );
  const explicitMode = strEnv("PAYMENT_MODE").toLowerCase();
  const paymentMode: PaymentMode =
    explicitMode === "masumi"
      ? "masumi"
      : explicitMode === "direct"
        ? "direct"
        : paymentServiceUrl
          ? "masumi"
          : "direct";

  return {
    port: numEnv("PORT", 3000),

    langdockBaseUrl:
      strEnv("LANGDOCK_BASE_URL").replace(/\/$/, "") ||
      "https://api.langdock.com",
    langdockApiKey: strEnv("LANGDOCK_API_KEY"),
    langdockAgentId: strEnv("LANGDOCK_AGENT_ID"),

    agentIdentifier: strEnv("AGENT_IDENTIFIER"),
    sellerVKey: strEnv("SELLER_VKEY"),

    paymentMode,
    paymentServiceUrl,
    paymentApiKey,
    paymentApiAuthHeader,
    masumiPaymentServiceUrl: paymentServiceUrl,
    masumiPaymentServiceToken: paymentApiKey,
    masumiNetwork: parseNetwork(process.env.NETWORK ?? process.env.MASUMI_NETWORK),
    paymentPollIntervalMs: numEnv("PAYMENT_POLL_INTERVAL_MS", 5000),
    paymentPollTimeoutMs: numEnv("PAYMENT_POLL_TIMEOUT_MS", 30 * 60 * 1000),

    priceAmounts: parsePriceAmounts(process.env.PRICE_AMOUNTS),

    // Monotonic by default: payByTime < submitResultTime < unlockTime < externalDisputeUnlockTime.
    // Payment Service rejects <5 min gap between payByTime and submitResultTime.
    payByOffsetSec: numEnv("PAY_BY_OFFSET_SEC", 900), // 15 min
    submitResultOffsetSec: numEnv("SUBMIT_RESULT_OFFSET_SEC", 2700), // 45 min
    unlockOffsetSec: numEnv("UNLOCK_OFFSET_SEC", 3600), // 60 min
    externalDisputeUnlockOffsetSec: numEnv(
      "EXTERNAL_DISPUTE_UNLOCK_OFFSET_SEC",
      5400, // 90 min
    ),

    inputSchema: loadInputSchema(),
    hitlChatMode: boolEnv("HITL_CHAT_MODE") || boolEnv("LANGDOCK_HITL_CHAT_MODE"),
  };
}
