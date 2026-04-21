/**
 * Environment-backed settings for Langdock, Masumi identity fields, and timing offsets.
 */

export type AppConfig = {
  port: number;
  langdockBaseUrl: string;
  langdockApiKey: string;
  langdockAgentId: string;
  agentIdentifier: string;
  sellerVKey: string;
  /** Seconds added to `now` for `payByTime` on `/start_job`. */
  payByOffsetSec: number;
  submitResultOffsetSec: number;
  unlockOffsetSec: number;
  externalDisputeUnlockOffsetSec: number;
};

/** Parses a numeric env var; invalid or missing values yield `fallback`. */
function numEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Values returned on `/start_job` for `agentIdentifier` and `sellerVKey`.
 * Uses `unregistered-agent` when `AGENT_IDENTIFIER` is empty.
 */
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

/** Loads configuration from `process.env` (see `.env.example`). */
export function loadConfig(): AppConfig {
  return {
    port: numEnv("PORT", 3000),
    langdockBaseUrl:
      process.env.LANGDOCK_BASE_URL?.replace(/\/$/, "") ||
      "https://api.langdock.com",
    langdockApiKey: process.env.LANGDOCK_API_KEY ?? "",
    langdockAgentId: process.env.LANGDOCK_AGENT_ID ?? "",
    agentIdentifier: process.env.AGENT_IDENTIFIER ?? "",
    sellerVKey: process.env.SELLER_VKEY ?? "",
    payByOffsetSec: numEnv("PAY_BY_OFFSET_SEC", 3600),
    submitResultOffsetSec: numEnv("SUBMIT_RESULT_OFFSET_SEC", 1800),
    unlockOffsetSec: numEnv("UNLOCK_OFFSET_SEC", 2700),
    externalDisputeUnlockOffsetSec: numEnv(
      "EXTERNAL_DISPUTE_UNLOCK_OFFSET_SEC",
      3600,
    ),
  };
}
