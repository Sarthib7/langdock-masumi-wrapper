/**
 * Central production-readiness checks for the Langdock -> Masumi wrapper.
 *
 * The route layer and startup entry point both use this module so deployment
 * safety is enforced in one place instead of scattered across request handlers.
 */

import type { AppConfig, InputSchemaField, PriceAmount } from "../config.js";
import { MAINNET_USDCX_UNIT, PREPROD_TUSDM_UNIT } from "./sokosumiTokens.js";

export type ReadinessSeverity = "error" | "warning";

export type ReadinessIssue = {
  severity: ReadinessSeverity;
  code: string;
  message: string;
  env?: string[];
};

export type ReadinessReport = {
  status: "ready" | "not_ready";
  mode: AppConfig["paymentMode"];
  network: AppConfig["masumiNetwork"];
  issues: ReadinessIssue[];
  requiredEnv: string[];
  optionalEnv: string[];
};

function hasValue(value: string): boolean {
  return value.trim().length > 0;
}

function pushMissing(
  issues: ReadinessIssue[],
  env: string[],
  message: string,
): void {
  issues.push({
    severity: "error",
    code: "missing_env",
    env,
    message,
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validatePaymentWindows(
  config: AppConfig,
  issues: ReadinessIssue[],
): void {
  const windows = [
    ["PAY_BY_OFFSET_SEC", config.payByOffsetSec],
    ["SUBMIT_RESULT_OFFSET_SEC", config.submitResultOffsetSec],
    ["UNLOCK_OFFSET_SEC", config.unlockOffsetSec],
    [
      "EXTERNAL_DISPUTE_UNLOCK_OFFSET_SEC",
      config.externalDisputeUnlockOffsetSec,
    ],
  ] as const;

  for (const [name, value] of windows) {
    if (!Number.isInteger(value) || value <= 0) {
      issues.push({
        severity: "error",
        code: "invalid_payment_window",
        env: [name],
        message: `${name} must be a positive integer number of seconds.`,
      });
    }
  }

  if (
    !(
      config.payByOffsetSec < config.submitResultOffsetSec &&
      config.submitResultOffsetSec < config.unlockOffsetSec &&
      config.unlockOffsetSec < config.externalDisputeUnlockOffsetSec
    )
  ) {
    issues.push({
      severity: "error",
      code: "non_monotonic_payment_windows",
      env: [
        "PAY_BY_OFFSET_SEC",
        "SUBMIT_RESULT_OFFSET_SEC",
        "UNLOCK_OFFSET_SEC",
        "EXTERNAL_DISPUTE_UNLOCK_OFFSET_SEC",
      ],
      message:
        "Payment windows must be monotonic: payBy < submitResult < unlock < externalDisputeUnlock.",
    });
  }

  if (config.submitResultOffsetSec - config.payByOffsetSec < 300) {
    issues.push({
      severity: "error",
      code: "payment_window_too_short",
      env: ["PAY_BY_OFFSET_SEC", "SUBMIT_RESULT_OFFSET_SEC"],
      message:
        "Masumi Payment Service requires at least 5 minutes between payByTime and submitResultTime.",
    });
  }
}

function validatePriceAmounts(
  amounts: PriceAmount[],
  network: AppConfig["masumiNetwork"],
  issues: ReadinessIssue[],
): void {
  if (amounts.length === 0) {
    issues.push({
      severity: "error",
      code: "missing_price",
      env: ["PRICE_AMOUNTS"],
      message: "PRICE_AMOUNTS must contain at least one payment amount.",
    });
    return;
  }

  for (const amount of amounts) {
    if (!/^[0-9]+$/.test(amount.amount) || BigInt(amount.amount) <= 0n) {
      issues.push({
        severity: "error",
        code: "invalid_price_amount",
        env: ["PRICE_AMOUNTS"],
        message:
          "Every PRICE_AMOUNTS entry must use a positive integer raw token amount.",
      });
      break;
    }
    if (!hasValue(amount.unit)) {
      issues.push({
        severity: "error",
        code: "invalid_price_unit",
        env: ["PRICE_AMOUNTS"],
        message: "Every PRICE_AMOUNTS entry must include a token unit.",
      });
      break;
    }
  }

  const expectedUnit =
    network === "Mainnet" ? MAINNET_USDCX_UNIT : PREPROD_TUSDM_UNIT;
  const hasSokosumiUnit = amounts.some((amount) => amount.unit === expectedUnit);
  if (!hasSokosumiUnit) {
    issues.push({
      severity: "warning",
      code: "non_sokosumi_settlement_unit",
      env: ["PRICE_AMOUNTS"],
      message:
        network === "Mainnet"
          ? "Sokosumi mainnet listings are expected to settle in USDCx."
          : "Sokosumi Preprod listings are expected to settle in tUSDM.",
    });
  }
}

function validateInputSchema(
  inputSchema: InputSchemaField[],
  issues: ReadinessIssue[],
): void {
  if (inputSchema.length === 0) {
    issues.push({
      severity: "error",
      code: "empty_input_schema",
      env: ["INPUT_SCHEMA_PATH", "INPUT_SCHEMA_JSON"],
      message: "/input_schema must expose at least one input field.",
    });
    return;
  }

  const ids = new Set<string>();
  for (const field of inputSchema) {
    if (!hasValue(field.id)) {
      issues.push({
        severity: "error",
        code: "invalid_input_schema",
        env: ["INPUT_SCHEMA_PATH", "INPUT_SCHEMA_JSON"],
        message: "Every input schema field must have a non-empty id.",
      });
      return;
    }
    if (ids.has(field.id)) {
      issues.push({
        severity: "error",
        code: "duplicate_input_schema_id",
        env: ["INPUT_SCHEMA_PATH", "INPUT_SCHEMA_JSON"],
        message: `Input schema field ids must be unique; duplicate: ${field.id}.`,
      });
      return;
    }
    ids.add(field.id);
  }
}

export function productionRequiredEnv(config: AppConfig): string[] {
  const required = [
    "LANGDOCK_API_KEY",
    "LANGDOCK_AGENT_ID",
    "PAYMENT_MODE",
    "PRICE_AMOUNTS",
    "INPUT_SCHEMA_JSON or INPUT_SCHEMA_PATH",
  ];
  if (config.paymentMode === "masumi") {
    required.push(
      "AGENT_IDENTIFIER",
      "SELLER_VKEY",
      "MASUMI_PAYMENT_SERVICE_URL",
      "MASUMI_PAYMENT_SERVICE_TOKEN",
      "MASUMI_NETWORK",
    );
  }
  return required;
}

export function getReadinessReport(config: AppConfig): ReadinessReport {
  const issues: ReadinessIssue[] = [];

  if (!hasValue(config.langdockApiKey)) {
    pushMissing(
      issues,
      ["LANGDOCK_API_KEY"],
      "Langdock API key is required before this wrapper can run paid jobs.",
    );
  }
  if (!hasValue(config.langdockAgentId)) {
    pushMissing(
      issues,
      ["LANGDOCK_AGENT_ID"],
      "Langdock agent id is required before this wrapper can run paid jobs.",
    );
  }
  if (!isHttpUrl(config.langdockBaseUrl)) {
    issues.push({
      severity: "error",
      code: "invalid_url",
      env: ["LANGDOCK_BASE_URL"],
      message: "LANGDOCK_BASE_URL must be an http(s) URL.",
    });
  }

  if (config.paymentMode === "direct" && process.env.NODE_ENV === "production") {
    issues.push({
      severity: "error",
      code: "direct_mode_in_production",
      env: ["PAYMENT_MODE"],
      message: "Production deployments must use PAYMENT_MODE=masumi.",
    });
  }

  if (config.paymentMode === "masumi") {
    if (!hasValue(config.agentIdentifier)) {
      pushMissing(
        issues,
        ["AGENT_IDENTIFIER"],
        "Masumi mode requires the agent identifier from the registry/admin dashboard.",
      );
    }
    if (!hasValue(config.sellerVKey)) {
      pushMissing(
        issues,
        ["SELLER_VKEY"],
        "Masumi mode requires the selling wallet verification key.",
      );
    }
    if (!hasValue(config.masumiPaymentServiceUrl)) {
      pushMissing(
        issues,
        ["MASUMI_PAYMENT_SERVICE_URL"],
        "Masumi mode requires a reachable Payment Service base URL.",
      );
    } else if (!isHttpUrl(config.masumiPaymentServiceUrl)) {
      issues.push({
        severity: "error",
        code: "invalid_url",
        env: ["MASUMI_PAYMENT_SERVICE_URL"],
        message: "MASUMI_PAYMENT_SERVICE_URL must be an http(s) URL.",
      });
    }
    if (!hasValue(config.masumiPaymentServiceToken)) {
      pushMissing(
        issues,
        ["MASUMI_PAYMENT_SERVICE_TOKEN"],
        "Masumi mode requires a Payment Service API token.",
      );
    }
  }

  validatePaymentWindows(config, issues);
  validatePriceAmounts(config.priceAmounts, config.masumiNetwork, issues);
  validateInputSchema(config.inputSchema, issues);

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    status: hasErrors ? "not_ready" : "ready",
    mode: config.paymentMode,
    network: config.masumiNetwork,
    issues,
    requiredEnv: productionRequiredEnv(config),
    optionalEnv: [
      "LANGDOCK_BASE_URL",
      "PAYMENT_POLL_INTERVAL_MS",
      "PAYMENT_POLL_TIMEOUT_MS",
      "MASUMI_PAYMENT_TYPE",
    ],
  };
}

export function shouldEnforceProductionReadiness(config: AppConfig): boolean {
  return (
    process.env.REQUIRE_PRODUCTION_CONFIG === "true" ||
    process.env.NODE_ENV === "production" ||
    config.paymentMode === "masumi"
  );
}

export function assertProductionReady(config: AppConfig): void {
  if (!shouldEnforceProductionReadiness(config)) return;

  const report = getReadinessReport(config);
  const errors = report.issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) return;

  const lines = errors.map((issue) => {
    const env = issue.env?.length ? ` (${issue.env.join(", ")})` : "";
    return `- ${issue.code}${env}: ${issue.message}`;
  });
  throw new Error(`Production configuration is not ready:\n${lines.join("\n")}`);
}
