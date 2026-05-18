/**
 * Central production-readiness checks for the Langdock -> Masumi wrapper.
 *
 * The route layer and startup entry point both use this module so deployment
 * safety is enforced in one place instead of scattered across request handlers.
 */

import type {
  AgentProfileConfig,
  AppConfig,
  InputSchemaField,
  PriceAmount,
} from "../config.js";
import {
  MAINNET_USDCX_UNIT,
  MAINNET_USDM_UNIT,
  PREPROD_TUSDM_UNIT,
  masumiNetworkDetails,
  type MasumiNetworkDetails,
} from "./sokosumiTokens.js";

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
  networkDetails: MasumiNetworkDetails;
  issues: ReadinessIssue[];
  requiredEnv: string[];
  optionalEnv: string[];
};

function hasValue(value: string): boolean {
  return value.trim().length > 0;
}

function rawEnv(name: string): string {
  return process.env[name] ?? "";
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

function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function validateHttpsUnlessLocal(
  value: string,
  env: string[],
  issues: ReadinessIssue[],
): void {
  if (!hasValue(value) || !isHttpUrl(value)) return;
  const url = new URL(value);
  if (url.protocol === "https:" || isLocalHttpUrl(value)) return;

  issues.push({
    severity: "error",
    code: "insecure_http_url",
    env,
    message: `${env.join(" or ")} must use HTTPS unless it points at localhost.`,
  });
}

function setupAdminCredentialsConfigured(): boolean {
  return Boolean(
    hasValue(rawEnv("SETUP_USERNAME")) &&
      (hasValue(rawEnv("SETUP_PASSWORD_HASH")) ||
        hasValue(rawEnv("SETUP_PASSWORD"))),
  );
}

function databaseAdminStoreConfigured(): boolean {
  return hasValue(rawEnv("DATABASE_URL")) || hasValue(rawEnv("DB_PATH"));
}

function validateSetupAccessToken(issues: ReadinessIssue[]): void {
  const token = rawEnv("SETUP_ACCESS_TOKEN").trim();
  if (!token || token.length >= 32) return;
  issues.push({
    severity: "warning",
    code: "weak_setup_access_token",
    env: ["SETUP_ACCESS_TOKEN"],
    message:
      "SETUP_ACCESS_TOKEN should be at least 32 random characters if enabled.",
  });
}

function validateMainnetSafety(
  config: AppConfig,
  issues: ReadinessIssue[],
): void {
  if (config.masumiNetwork !== "Mainnet") return;

  if (config.paymentMode !== "masumi") {
    issues.push({
      severity: "error",
      code: "mainnet_requires_masumi_mode",
      env: ["NETWORK", "PAYMENT_MODE"],
      message: "NETWORK=Mainnet requires PAYMENT_MODE=masumi.",
    });
  }

  if (
    process.env.NODE_ENV === "production" &&
    !hasValue(rawEnv("SETUP_PASSWORD_HASH")) &&
    hasValue(rawEnv("SETUP_PASSWORD"))
  ) {
    issues.push({
      severity: "error",
      code: "mainnet_plaintext_admin_password",
      env: ["SETUP_PASSWORD", "SETUP_PASSWORD_HASH"],
      message:
        "Mainnet production deployments must use SETUP_PASSWORD_HASH instead of plaintext SETUP_PASSWORD.",
    });
  }

  const publicUrls: Array<{ env: string[]; value: string }> = [
    { env: ["LANGDOCK_BASE_URL"], value: config.langdockBaseUrl },
    { env: ["PAYMENT_SERVICE_URL"], value: config.paymentServiceUrl },
    {
      env: ["REGISTRY_AGENT_API_BASE_URL"],
      value: rawEnv("REGISTRY_AGENT_API_BASE_URL"),
    },
    ...config.agents.map((agent) => ({
      env: ["AGENTS_JSON"],
      value: agent.apiBaseUrl,
    })),
  ];

  for (const item of publicUrls) {
    if (!hasValue(item.value) || !isHttpUrl(item.value) || !isLocalUrl(item.value)) {
      continue;
    }
    issues.push({
      severity: "error",
      code: "mainnet_local_url",
      env: item.env,
      message: `${item.env.join(" or ")} must not point at localhost when NETWORK=Mainnet.`,
    });
  }

  if (
    process.env.REQUIRE_PRODUCTION_CONFIG !== "true" &&
    process.env.NODE_ENV === "production"
  ) {
    issues.push({
      severity: "warning",
      code: "mainnet_startup_check_not_enforced",
      env: ["REQUIRE_PRODUCTION_CONFIG"],
      message:
        "Set REQUIRE_PRODUCTION_CONFIG=true for Mainnet so startup refuses incomplete paid-job configuration.",
    });
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

function validateMasumiEnvSyntax(
  config: AppConfig,
  issues: ReadinessIssue[],
): void {
  const rawNetwork = rawEnv("NETWORK") || rawEnv("MASUMI_NETWORK");
  if (
    hasValue(rawNetwork) &&
    rawNetwork.trim() !== "Preprod" &&
    rawNetwork.trim() !== "Mainnet"
  ) {
    issues.push({
      severity: "error",
      code: "invalid_network",
      env: rawEnv("NETWORK") ? ["NETWORK"] : ["MASUMI_NETWORK"],
      message: "Network must be exactly Preprod or Mainnet.",
    });
  }

  const rawAuthHeader = rawEnv("PAYMENT_API_AUTH_HEADER");
  if (
    hasValue(rawAuthHeader) &&
    rawAuthHeader.trim() !== "token" &&
    rawAuthHeader.trim() !== "x-api-key"
  ) {
    issues.push({
      severity: "error",
      code: "invalid_payment_api_auth_header",
      env: ["PAYMENT_API_AUTH_HEADER"],
      message: "PAYMENT_API_AUTH_HEADER must be token or x-api-key.",
    });
  }

  if (hasValue(config.paymentServiceUrl)) {
    try {
      const url = new URL(config.paymentServiceUrl);
      if (
        config.paymentMode === "masumi" &&
        !url.pathname.endsWith("/api/v1") &&
        !url.pathname.endsWith("/pay/api/v1")
      ) {
        issues.push({
          severity: "warning",
          code: "payment_api_base_path_missing",
          env: ["PAYMENT_SERVICE_URL"],
          message:
            "PAYMENT_SERVICE_URL should include the API prefix: /pay/api/v1 for Masumi SaaS or /api/v1 for a direct payment node.",
        });
      }
    } catch {
      // URL shape is validated separately.
    }
  }
}

function validatePriceAmounts(
  amounts: PriceAmount[],
  network: AppConfig["masumiNetwork"],
  issues: ReadinessIssue[],
): void {
  if (amounts.length === 0) {
    if (hasValue(rawEnv("PRICE_AMOUNTS"))) {
      issues.push({
        severity: "error",
        code: "invalid_price_amounts_json",
        env: ["PRICE_AMOUNTS"],
        message:
          "PRICE_AMOUNTS is set but could not be parsed as a non-empty JSON array of {amount, unit}. Leave it empty for fixed registered pricing.",
      });
    }
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

  const expectedUnits =
    network === "Mainnet"
      ? [MAINNET_USDCX_UNIT, MAINNET_USDM_UNIT]
      : [PREPROD_TUSDM_UNIT];
  const hasSokosumiUnit = amounts.some((amount) =>
    expectedUnits.includes(amount.unit),
  );
  if (!hasSokosumiUnit) {
    issues.push({
      severity: "warning",
      code: "non_sokosumi_settlement_unit",
      env: ["PRICE_AMOUNTS"],
      message:
        network === "Mainnet"
          ? "Mainnet pricing should use a known Masumi settlement asset id. Current token docs identify USDCx as active; the Sokosumi listing guide also references the legacy USDM asset id. Do not use lovelace for stablecoin pricing."
          : "Sokosumi Preprod listings are expected to settle in tUSDM; use the full tUSDM asset id as unit, not lovelace.",
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

function validateAgentProfiles(
  config: AppConfig,
  issues: ReadinessIssue[],
): void {
  if (hasValue(rawEnv("AGENTS_JSON")) && config.agents.length === 0) {
    issues.push({
      severity: "error",
      code: "invalid_agents_json",
      env: ["AGENTS_JSON"],
      message:
        "AGENTS_JSON is set but no valid agent profiles were loaded. Each profile needs a slug or name and langdockAgentId.",
    });
    return;
  }

  const seenApiBaseUrls = new Set<string>();
  for (const agent of config.agents) {
    if (!hasValue(agent.apiBaseUrl)) continue;

    if (!isHttpUrl(agent.apiBaseUrl)) {
      issues.push({
        severity: "error",
        code: "invalid_agent_profile_url",
        env: ["AGENTS_JSON"],
        message: `Agent profile "${agent.slug}" apiBaseUrl must be an http(s) URL.`,
      });
    } else {
      validateHttpsUnlessLocal(agent.apiBaseUrl, ["AGENTS_JSON"], issues);
    }

    if (seenApiBaseUrls.has(agent.apiBaseUrl)) {
      issues.push({
        severity: "warning",
        code: "duplicate_agent_profile_url",
        env: ["AGENTS_JSON"],
        message: `Multiple agent profiles use apiBaseUrl ${agent.apiBaseUrl}; each Masumi registration should normally use a unique /agents/<slug> URL.`,
      });
    }
    seenApiBaseUrls.add(agent.apiBaseUrl);
  }
}

function missingMasumiIdentifiers(
  agents: AgentProfileConfig[],
): AgentProfileConfig[] {
  return agents.filter((agent) => !hasValue(agent.agentIdentifier));
}

export function productionRequiredEnv(config: AppConfig): string[] {
  const required = [
    "LANGDOCK_API_KEY",
    "LANGDOCK_AGENT_ID or AGENTS_JSON[].langdockAgentId",
    "PAYMENT_MODE",
    "SETUP_USERNAME + SETUP_PASSWORD_HASH or database admin user",
    "INPUT_SCHEMA_JSON or INPUT_SCHEMA_PATH",
  ];
  if (config.paymentMode === "masumi") {
    required.push(
      "AGENT_IDENTIFIER or AGENTS_JSON[].agentIdentifier",
      "SELLER_VKEY",
      "PAYMENT_SERVICE_URL",
      "PAYMENT_API_KEY",
      "NETWORK",
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
  validateAgentProfiles(config, issues);

  if (!hasValue(config.langdockAgentId) && config.agents.length === 0) {
    pushMissing(
      issues,
      ["LANGDOCK_AGENT_ID", "AGENTS_JSON"],
      "A Langdock agent id is required via LANGDOCK_AGENT_ID or at least one AGENTS_JSON profile before this wrapper can run paid jobs.",
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
  validateHttpsUnlessLocal(config.langdockBaseUrl, ["LANGDOCK_BASE_URL"], issues);

  if (!setupAdminCredentialsConfigured() && !databaseAdminStoreConfigured()) {
    pushMissing(
      issues,
      ["SETUP_USERNAME", "SETUP_PASSWORD_HASH or SETUP_PASSWORD", "DATABASE_URL"],
      "Admin login must be configured on the server. Set SETUP_USERNAME with SETUP_PASSWORD_HASH, or create a database admin user with `npm run admin:create-user` and configure DATABASE_URL.",
    );
  } else if (!setupAdminCredentialsConfigured() && databaseAdminStoreConfigured()) {
    issues.push({
      severity: "warning",
      code: "database_admin_user_unverified",
      env: ["DATABASE_URL", "DB_PATH"],
      message:
        "Readiness sees a database-backed auth store but cannot verify synchronously that an admin user exists. Run `npm run admin:create-user` before launch.",
    });
  } else if (
    process.env.NODE_ENV === "production" &&
    config.masumiNetwork !== "Mainnet" &&
    !hasValue(rawEnv("SETUP_PASSWORD_HASH")) &&
    hasValue(rawEnv("SETUP_PASSWORD"))
  ) {
    issues.push({
      severity: "warning",
      code: "plaintext_admin_password",
      env: ["SETUP_PASSWORD", "SETUP_PASSWORD_HASH"],
      message:
        "Production deployment is using a plaintext SETUP_PASSWORD. Generate a bcrypt hash with `npm run admin:hash` and set SETUP_PASSWORD_HASH instead so the env var does not show plaintext in logs or Railway settings.",
    });
  }

  validateSetupAccessToken(issues);

  if (config.paymentMode === "direct" && process.env.NODE_ENV === "production") {
    issues.push({
      severity: "error",
      code: "direct_mode_in_production",
      env: ["PAYMENT_MODE"],
      message: "Production deployments must use PAYMENT_MODE=masumi.",
    });
  }

  if (config.paymentMode === "masumi") {
    const missingProfileIdentifiers = missingMasumiIdentifiers(config.agents);
    for (const agent of missingProfileIdentifiers) {
      issues.push({
        severity: "error",
        code: "missing_agent_profile_identifier",
        env: ["AGENTS_JSON"],
        message: `Agent profile "${agent.slug}" needs agentIdentifier before /agents/${agent.slug}/start_job can run in masumi mode.`,
      });
    }

    if (config.agents.length === 0 && !hasValue(config.agentIdentifier)) {
      pushMissing(
        issues,
        ["AGENT_IDENTIFIER", "AGENTS_JSON"],
        "Masumi mode requires AGENT_IDENTIFIER for the legacy endpoint or agentIdentifier on each AGENTS_JSON profile.",
      );
    }
    if (!hasValue(config.sellerVKey)) {
      pushMissing(
        issues,
        ["SELLER_VKEY"],
        "Masumi mode requires the selling wallet verification key.",
      );
    }
    if (!hasValue(config.paymentServiceUrl)) {
      pushMissing(
        issues,
        ["PAYMENT_SERVICE_URL"],
        "Masumi mode requires a reachable Payment Service or Masumi SaaS API base URL.",
      );
    } else if (!isHttpUrl(config.paymentServiceUrl)) {
      issues.push({
        severity: "error",
        code: "invalid_url",
        env: ["PAYMENT_SERVICE_URL"],
        message: "PAYMENT_SERVICE_URL must be an http(s) URL.",
      });
    }
    validateHttpsUnlessLocal(
      config.paymentServiceUrl,
      ["PAYMENT_SERVICE_URL"],
      issues,
    );
    if (!hasValue(config.paymentApiKey)) {
      pushMissing(
        issues,
        ["PAYMENT_API_KEY"],
        "Masumi mode requires a Payment Service token or Masumi SaaS API key.",
      );
    }
  }

  validateMasumiEnvSyntax(config, issues);
  validateMainnetSafety(config, issues);
  validatePaymentWindows(config, issues);
  validatePriceAmounts(config.priceAmounts, config.masumiNetwork, issues);
  validateInputSchema(config.inputSchema, issues);

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    status: hasErrors ? "not_ready" : "ready",
    mode: config.paymentMode,
    network: config.masumiNetwork,
    networkDetails: masumiNetworkDetails(config.masumiNetwork),
    issues,
    requiredEnv: productionRequiredEnv(config),
    optionalEnv: [
      "LANGDOCK_BASE_URL",
      "PAYMENT_POLL_INTERVAL_MS",
      "PAYMENT_POLL_TIMEOUT_MS",
      "PAYMENT_API_AUTH_HEADER",
      "PRICE_AMOUNTS",
      "AGENTS_JSON",
      "MASUMI_PAYMENT_SERVICE_URL (legacy alias)",
      "MASUMI_PAYMENT_SERVICE_TOKEN (legacy alias)",
      "MASUMI_NETWORK (legacy alias)",
    ],
  };
}

export function shouldEnforceProductionReadiness(config: AppConfig): boolean {
  void config;
  return process.env.REQUIRE_PRODUCTION_CONFIG === "true";
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
