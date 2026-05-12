/**
 * Minimal operator UI for runtime Langdock + Masumi configuration.
 *
 * Credentials submitted here are saved to .env and applied to the running
 * process. Configure SETUP_USERNAME plus SETUP_PASSWORD_HASH or SETUP_PASSWORD
 * before exposing this app beyond localhost.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MasumiNetwork,
  PaymentApiAuthHeader,
  PaymentMode,
} from "../config.js";
import { loadConfig } from "../config.js";
import type { BridgeContext } from "./bridgeContext.js";
import { createLangdockStartJobHandler } from "../services/langdockStartJob.js";
import {
  completeChat,
  extractAssistantContent,
  LangdockApiError,
} from "../services/langdock.js";
import {
  MasumiPaymentClient,
  MasumiPaymentError,
  type RegistryAgent,
} from "../services/masumiPayment.js";
import { getReadinessReport } from "../services/readiness.js";
import {
  adminCredentialsConfigured,
  loginAdmin,
  logoutUser,
  verifyAdminCredentials,
  verifyToken,
  type AuthenticatedUser,
} from "../services/auth.js";
import { constantTimeEqual } from "../services/opaqueTokens.js";
import { checkRateLimit } from "../services/rateLimit.js";
import { loginHtml } from "./loginHtml.js";
import { MAINNET_USDCX_UNIT, PREPROD_TUSDM_UNIT } from "../services/sokosumiTokens.js";

type SetupConfigBody = {
  langdockBaseUrl?: unknown;
  langdockApiKey?: unknown;
  langdockAgentId?: unknown;
  paymentMode?: unknown;
  paymentServiceUrl?: unknown;
  paymentApiKey?: unknown;
  paymentApiAuthHeader?: unknown;
  network?: unknown;
  agentIdentifier?: unknown;
  sellerVKey?: unknown;
  priceAmounts?: unknown;
};

type LangdockTestBody = {
  prompt?: unknown;
};

type RegistrySetupBody = {
  agentName?: unknown;
  agentDescription?: unknown;
  agentApiBaseUrl?: unknown;
  capabilityName?: unknown;
  capabilityVersion?: unknown;
  authorName?: unknown;
  authorContactEmail?: unknown;
  authorContactOther?: unknown;
  authorOrganization?: unknown;
  tags?: unknown;
  pricingAmount?: unknown;
  pricingUnit?: unknown;
  legalPrivacyPolicy?: unknown;
  legalTerms?: unknown;
  legalOther?: unknown;
};

type EnvPatch = {
  updates: Map<string, string>;
  deletes: Set<string>;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizePaymentMode(value: unknown): PaymentMode | undefined {
  const raw = str(value)?.toLowerCase();
  if (raw === undefined || raw === "") return undefined;
  if (raw === "direct" || raw === "masumi") return raw;
  throw new Error("PAYMENT_MODE must be direct or masumi.");
}

function normalizeNetwork(value: unknown): MasumiNetwork | undefined {
  const raw = str(value);
  if (raw === undefined || raw === "") return undefined;
  if (raw === "Preprod" || raw === "Mainnet") return raw;
  throw new Error("NETWORK must be exactly Preprod or Mainnet.");
}

function normalizeAuthHeader(
  value: unknown,
): PaymentApiAuthHeader | undefined {
  const raw = str(value);
  if (raw === undefined || raw === "") return undefined;
  if (raw === "token" || raw === "x-api-key") return raw;
  throw new Error("PAYMENT_API_AUTH_HEADER must be token or x-api-key.");
}

function normalizeJsonEnv(value: unknown, envName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return JSON.stringify(value);
  const raw = str(value);
  if (raw === undefined || raw === "") return undefined;
  try {
    JSON.parse(raw) as unknown;
    return raw;
  } catch {
    throw new Error(`${envName} must be valid JSON.`);
  }
}

function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return (str(value) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireString(value: unknown, label: string): string {
  const normalized = str(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function defaultPricingUnit(network: MasumiNetwork): string {
  return network === "Mainnet" ? MAINNET_USDCX_UNIT : PREPROD_TUSDM_UNIT;
}

function configuredPaymentClient(): MasumiPaymentClient {
  const config = loadConfig();
  return new MasumiPaymentClient({
    baseUrl: config.paymentServiceUrl,
    apiKey: config.paymentApiKey,
    authHeader: config.paymentApiAuthHeader,
    network: config.masumiNetwork,
  });
}

function setupEnvPath(): string {
  return path.resolve(process.env.SETUP_ENV_PATH || path.join(process.cwd(), ".env"));
}

function setPatchValue(
  patch: EnvPatch,
  envName: string,
  value: string | undefined,
): void {
  if (value === undefined) return;
  if (value === "") return;
  patch.deletes.delete(envName);
  patch.updates.set(envName, value);
}

function quoteEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function isNotFoundError(e: unknown): boolean {
  return e instanceof Error && "code" in e && e.code === "ENOENT";
}

async function persistEnvPatch(patch: EnvPatch): Promise<void> {
  const envPath = setupEnvPath();
  let raw = "";
  try {
    raw = await readFile(envPath, "utf8");
  } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }

  const seen = new Set<string>();
  const lines = raw ? raw.split(/\r?\n/) : [];
  const output: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) {
      output.push(line);
      continue;
    }

    const key = match[1]!;
    if (patch.deletes.has(key)) {
      seen.add(key);
      continue;
    }
    if (patch.updates.has(key)) {
      seen.add(key);
      output.push(`${key}=${quoteEnvValue(patch.updates.get(key)!)}`);
      continue;
    }
    output.push(line);
  }

  for (const [key, value] of patch.updates) {
    if (!seen.has(key)) output.push(`${key}=${quoteEnvValue(value)}`);
  }

  while (output.length > 1 && output[output.length - 1] === "") {
    output.pop();
  }

  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, `${output.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(envPath, 0o600);
}

function applyEnvPatch(patch: EnvPatch): void {
  for (const key of patch.deletes) {
    delete process.env[key];
  }
  for (const [key, value] of patch.updates) {
    process.env[key] = value;
  }
}

function tokenFromRequest(request: FastifyRequest): string {
  const headerToken = request.headers["x-setup-token"];
  if (typeof headerToken === "string") return headerToken;

  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return "";
}

function basicCredentialsFromRequest(request: FastifyRequest): {
  username: string;
  password: string;
} | undefined {
  const headerUsername = request.headers["x-setup-username"];
  const headerPassword = request.headers["x-setup-password"];
  if (typeof headerUsername === "string" && typeof headerPassword === "string") {
    return { username: headerUsername, password: headerPassword };
  }

  const auth = request.headers.authorization;
  if (!auth?.startsWith("Basic ")) return undefined;
  try {
    const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return undefined;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return undefined;
  }
}

function setupAccessConfigured(): boolean {
  return Boolean(
    process.env.SETUP_ACCESS_TOKEN?.trim() ||
      adminCredentialsConfigured(),
  );
}

async function requestCanConfigure(request: FastifyRequest): Promise<boolean> {
  const expectedToken = process.env.SETUP_ACCESS_TOKEN?.trim();
  if (expectedToken && constantTimeEqual(tokenFromRequest(request), expectedToken)) {
    return true;
  }

  const credentials = basicCredentialsFromRequest(request);
  if (credentials && await verifyAdminCredentials(credentials.username, credentials.password)) {
    return true;
  }

  return false;
}

function clientIdentifier(request: FastifyRequest, suffix = ""): string {
  return suffix ? `${request.ip}:${suffix}` : request.ip;
}

function applyRateLimit(
  reply: import("fastify").FastifyReply,
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number,
): boolean {
  const result = checkRateLimit({ scope, identifier, limit, windowMs });
  reply.header("x-ratelimit-limit", String(result.limit));
  reply.header("x-ratelimit-remaining", String(result.remaining));
  reply.header("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));

  if (result.allowed) return true;

  reply.header("retry-after", String(result.retryAfterSeconds));
  void reply.status(429).send({
    error: "RATE_LIMITED",
    message: "Too many requests. Try again later.",
  });
  return false;
}

function requestOriginAllowed(request: FastifyRequest): boolean {
  const secFetchSite = request.headers["sec-fetch-site"];
  if (secFetchSite === "cross-site") return false;

  const origin = request.headers.origin;
  if (!origin) return true;

  const host = request.headers.host;
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function rejectCrossOriginPost(
  request: FastifyRequest,
  reply: import("fastify").FastifyReply,
): boolean {
  if (requestOriginAllowed(request)) return false;
  void reply.status(403).send({
    error: "INVALID_ORIGIN",
    message: "Cross-origin state-changing requests are not allowed.",
  });
  return true;
}

function redactConfigState(): Record<string, unknown> {
  const config = loadConfig();
  const report = getReadinessReport(config);
  return {
    ready: report.status === "ready",
    report,
    setupAccessRequired: setupAccessConfigured(),
    accessMethods: {
      hash: Boolean(process.env.SETUP_ACCESS_TOKEN?.trim()),
      password: adminCredentialsConfigured(),
    },
    configured: {
      langdockBaseUrl: config.langdockBaseUrl,
      langdockApiKey: config.langdockApiKey.length > 0,
      langdockAgentId: config.langdockAgentId.length > 0,
      paymentMode: config.paymentMode,
      paymentServiceUrl: config.paymentServiceUrl,
      paymentApiKey: config.paymentApiKey.length > 0,
      paymentApiAuthHeader: config.paymentApiAuthHeader,
      network: config.masumiNetwork,
      agentIdentifier: config.agentIdentifier.length > 0,
      sellerVKey: config.sellerVKey.length > 0,
      priceAmountsCount: config.priceAmounts.length,
      setupEnvPath: setupEnvPath(),
    },
  };
}

function buildEnvPatch(body: SetupConfigBody): EnvPatch {
  const paymentMode = normalizePaymentMode(body.paymentMode);
  const network = normalizeNetwork(body.network);
  const rawAuthHeader = str(body.paymentApiAuthHeader);
  const authHeader = normalizeAuthHeader(body.paymentApiAuthHeader);
  const rawPriceAmounts = str(body.priceAmounts);
  const priceAmounts = normalizeJsonEnv(body.priceAmounts, "PRICE_AMOUNTS");
  const patch: EnvPatch = { updates: new Map(), deletes: new Set() };

  setPatchValue(patch, "LANGDOCK_BASE_URL", str(body.langdockBaseUrl));
  setPatchValue(patch, "LANGDOCK_API_KEY", str(body.langdockApiKey));
  setPatchValue(patch, "LANGDOCK_AGENT_ID", str(body.langdockAgentId));
  setPatchValue(patch, "PAYMENT_MODE", paymentMode);
  setPatchValue(patch, "PAYMENT_SERVICE_URL", str(body.paymentServiceUrl));
  setPatchValue(patch, "PAYMENT_API_KEY", str(body.paymentApiKey));
  if (rawAuthHeader === "") patch.deletes.add("PAYMENT_API_AUTH_HEADER");
  else setPatchValue(patch, "PAYMENT_API_AUTH_HEADER", authHeader);
  setPatchValue(patch, "NETWORK", network);
  setPatchValue(patch, "AGENT_IDENTIFIER", str(body.agentIdentifier));
  setPatchValue(patch, "SELLER_VKEY", str(body.sellerVKey));
  if (rawPriceAmounts === "") patch.deletes.add("PRICE_AMOUNTS");
  else setPatchValue(patch, "PRICE_AMOUNTS", priceAmounts);

  return patch;
}

function registryEnvPatch(body: RegistrySetupBody): EnvPatch {
  const patch: EnvPatch = { updates: new Map(), deletes: new Set() };
  setPatchValue(patch, "REGISTRY_AGENT_NAME", str(body.agentName));
  setPatchValue(patch, "REGISTRY_AGENT_DESCRIPTION", str(body.agentDescription));
  setPatchValue(patch, "REGISTRY_AGENT_API_BASE_URL", str(body.agentApiBaseUrl));
  setPatchValue(patch, "REGISTRY_CAPABILITY_NAME", str(body.capabilityName));
  setPatchValue(patch, "REGISTRY_CAPABILITY_VERSION", str(body.capabilityVersion));
  setPatchValue(patch, "REGISTRY_AUTHOR_NAME", str(body.authorName));
  setPatchValue(patch, "REGISTRY_AUTHOR_CONTACT_EMAIL", str(body.authorContactEmail));
  setPatchValue(patch, "REGISTRY_AUTHOR_CONTACT_OTHER", str(body.authorContactOther));
  setPatchValue(patch, "REGISTRY_AUTHOR_ORGANIZATION", str(body.authorOrganization));
  setPatchValue(patch, "REGISTRY_TAGS", splitCsv(body.tags).join(","));
  setPatchValue(patch, "REGISTRY_PRICING_AMOUNT", str(body.pricingAmount));
  setPatchValue(patch, "REGISTRY_PRICING_UNIT", str(body.pricingUnit));
  setPatchValue(patch, "REGISTRY_LEGAL_PRIVACY_POLICY", str(body.legalPrivacyPolicy));
  setPatchValue(patch, "REGISTRY_LEGAL_TERMS", str(body.legalTerms));
  setPatchValue(patch, "REGISTRY_LEGAL_OTHER", str(body.legalOther));
  return patch;
}

function matchRegisteredAgent(assets: RegistryAgent[]): RegistryAgent | undefined {
  const identifier = process.env.AGENT_IDENTIFIER?.trim();
  const name = process.env.REGISTRY_AGENT_NAME?.trim();
  const apiBaseUrl = process.env.REGISTRY_AGENT_API_BASE_URL?.trim();

  return assets.find((asset) => {
    if (identifier && asset.agentIdentifier === identifier) return true;
    if (name && apiBaseUrl) {
      return asset.name === name && asset.apiBaseUrl === apiBaseUrl;
    }
    if (name) return asset.name === name;
    return false;
  });
}

async function persistAgentIdentifier(agentIdentifier: string): Promise<void> {
  const patch: EnvPatch = {
    updates: new Map([["AGENT_IDENTIFIER", agentIdentifier]]),
    deletes: new Set(),
  };
  await persistEnvPatch(patch);
  applyEnvPatch(patch);
}

function setupHtml(user?: AuthenticatedUser | null): string {
  const userBadge = user
    ? `<div class="user-badge">
        <span class="user-avatar" aria-hidden="true">${escSetupHtml((user.displayName || user.username).charAt(0).toUpperCase())}</span>
        <span class="user-name">${escSetupHtml(user.displayName || user.username)}</span>
        <form action="/auth/logout" method="post" style="display:inline">
          <button type="submit" class="logout-btn secondary">Sign out</button>
        </form>
      </div>`
    : '';
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Langdock Masumi Setup</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7f5;
      --panel: #ffffff;
      --text: #1c1c1a;
      --muted: #5f625d;
      --border: #d8dad4;
      --accent: #0f6a5f;
      --accent-text: #ffffff;
      --danger: #a63636;
      --ok: #1f7a4d;
      --warn: #8a5d00;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #151512;
        --panel: #20201c;
        --text: #eeeeea;
        --muted: #b9bbb3;
        --border: #3a3b35;
        --accent: #38b7a6;
        --accent-text: #08221e;
        --danger: #f07d7d;
        --ok: #74d59f;
        --warn: #e0b54b;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: clamp(28px, 4vw, 44px);
      line-height: 1.05;
      letter-spacing: 0;
    }
    h2, h3, p { margin-top: 0; }
    p { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.8fr);
      gap: 16px;
      align-items: start;
    }
    section, aside {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 8px;
      padding: 20px;
    }
    form, fieldset, .stack {
      display: grid;
      gap: 16px;
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 0;
    }
    legend {
      width: 100%;
      font-weight: 700;
      margin-bottom: 4px;
    }
    label {
      display: grid;
      gap: 6px;
      font-size: 14px;
      font-weight: 650;
    }
    input, select, textarea, button {
      font: inherit;
      border-radius: 6px;
    }
    input, select, textarea {
      width: 100%;
      min-height: 44px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      padding: 10px 12px;
    }
    textarea {
      min-height: 92px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 13px;
    }
    input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--accent), transparent 35%);
      outline-offset: 2px;
    }
    button {
      min-height: 44px;
      border: 1px solid transparent;
      padding: 10px 14px;
      background: var(--accent);
      color: var(--accent-text);
      font-weight: 700;
      cursor: pointer;
    }
    button.secondary {
      background: transparent;
      color: var(--text);
      border-color: var(--border);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }
    .row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .segmented {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .segmented label {
      min-height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 750;
    }
    .segmented input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
      width: 1px;
      height: 1px;
    }
    .segmented label:has(input:checked) {
      background: var(--accent);
      color: var(--accent-text);
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
      font-weight: 500;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .auth-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .hidden { display: none !important; }
    .agent-slots {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .slot-card {
      min-height: auto;
      display: grid;
      gap: 4px;
      padding: 10px;
      text-align: left;
      background: transparent;
      color: var(--text);
      border-color: var(--border);
      font-weight: 650;
    }
    .slot-card[aria-pressed="true"] {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent), transparent 75%);
    }
    .slot-card small {
      color: var(--muted);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      border-radius: 999px;
      border: 1px solid var(--border);
      padding: 4px 10px;
      font-size: 13px;
      font-weight: 750;
      white-space: nowrap;
    }
    .status.ready { color: var(--ok); }
    .status.not-ready { color: var(--danger); }
    .banner {
      border-left: 4px solid var(--warn);
      padding: 10px 12px;
      background: color-mix(in srgb, var(--warn), transparent 88%);
      border-radius: 6px;
      color: var(--text);
      font-size: 14px;
    }
    .help {
      display: grid;
      gap: 12px;
      margin-bottom: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      background: color-mix(in srgb, var(--panel), var(--bg) 35%);
    }
    .help h3 {
      margin: 0;
      font-size: 16px;
    }
    .help dl {
      display: grid;
      gap: 10px;
      margin: 0;
    }
    .help dt {
      font-size: 13px;
      font-weight: 800;
    }
    .help dd {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    .help a {
      color: var(--accent);
      font-weight: 750;
      text-decoration-thickness: 1px;
      text-underline-offset: 3px;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .error {
      color: var(--danger);
      font-size: 14px;
      font-weight: 650;
    }
    .success {
      color: var(--ok);
      font-size: 14px;
      font-weight: 650;
    }
    pre {
      overflow: auto;
      min-height: 96px;
      max-height: 420px;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel), var(--bg) 45%);
      font-size: 12px;
      line-height: 1.45;
    }
    ul {
      padding-left: 20px;
      color: var(--muted);
    }
    li + li { margin-top: 6px; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .user-badge {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--accent);
      color: var(--accent-text);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
    }
    .user-name {
      font-size: 14px;
      font-weight: 650;
    }
    .logout-btn {
      font-size: 12px;
      padding: 6px 10px;
      min-height: 32px;
    }
    @media (max-width: 820px) {
      main { width: min(100% - 24px, 720px); padding-top: 20px; }
      header, .grid, .row, .auth-grid, .agent-slots { grid-template-columns: 1fr; display: grid; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Langdock Masumi Setup</h1>
        <p>Configure this running wrapper with your Langdock API and Masumi payment credentials.</p>
      </div>
      <span id="readyBadge" class="status">Checking</span>
    </header>
    ${userBadge}

    <div class="grid">
      <section aria-labelledby="configTitle">
        <h2 id="configTitle">Runtime config</h2>
        <p class="banner">Credentials are saved to <code>.env</code>, applied to this process, and never shown again. Configure <code>SETUP_USERNAME</code> plus <code>SETUP_PASSWORD_HASH</code> before exposing this page publicly.</p>
        <div class="help" aria-labelledby="credentialGuideTitle">
          <h3 id="credentialGuideTitle">Credential guide</h3>
          <dl>
            <div>
              <dt>Admin login</dt>
              <dd>Protects this setup page. Set <code>SETUP_USERNAME</code> and preferably a bcrypt <code>SETUP_PASSWORD_HASH</code>; <code>SETUP_PASSWORD</code> is accepted when your deployment secret store is private. <a href="https://docs.railway.com/variables" target="_blank" rel="noreferrer">Railway variables</a></dd>
            </div>
            <div>
              <dt>Langdock API key and Agent ID</dt>
              <dd>Create an API key in Langdock workspace settings, share the agent with that API key, then copy the agent ID from the agent URL. <a href="https://docs.langdock.com/api-endpoints/agent/agent-api-guide" target="_blank" rel="noreferrer">Langdock guide</a></dd>
            </div>
            <div>
              <dt>Payment Service URL and API key</dt>
              <dd>Use a Masumi Payment Service base URL ending in <code>/api/v1</code> or Masumi SaaS ending in <code>/pay/api/v1</code>. API keys authenticate with <code>token</code> or <code>x-api-key</code>. <a href="https://docs.masumi.network/api-reference" target="_blank" rel="noreferrer">Masumi API reference</a></dd>
            </div>
            <div>
              <dt>Seller VKey and Agent Identifier</dt>
              <dd>The seller VKey identifies the funded selling wallet. The agent identifier is created by Masumi registry registration; use Register agent, then Refresh registry until it appears. <a href="https://docs.masumi.network/documentation/how-to-guides/list-agent-on-sokosumi" target="_blank" rel="noreferrer">Sokosumi listing guide</a></dd>
            </div>
          </dl>
        </div>
          <form id="configForm" novalidate>
          <fieldset>
            <legend>Langdock</legend>
            <label>
              Base URL
              <input name="langdockBaseUrl" type="url" inputmode="url" autocomplete="url" value="https://api.langdock.com" required />
              <span class="hint">The wrapper calls {baseUrl}/agent/v1/chat/completions.</span>
            </label>
            <div class="row">
              <label>
                API key
                <input name="langdockApiKey" type="password" autocomplete="new-password" spellcheck="false" required />
              </label>
              <label>
                Agent ID
                <input name="langdockAgentId" type="text" autocomplete="off" spellcheck="false" required />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Masumi</legend>
            <div class="row">
              <label>
                Payment mode
                <select name="paymentMode">
                  <option value="masumi">masumi</option>
                  <option value="direct">direct</option>
                </select>
              </label>
              <label>
                Network
                <span class="segmented" role="radiogroup" aria-label="Masumi network">
                  <label><input type="radio" name="network" value="Preprod" checked /> Preprod</label>
                  <label><input type="radio" name="network" value="Mainnet" /> Mainnet</label>
                </span>
              </label>
            </div>
            <label>
              Payment Service URL
              <input name="paymentServiceUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://.../pay/api/v1" />
              <span class="hint">Use /pay/api/v1 for Masumi SaaS or /api/v1 for a direct payment node.</span>
            </label>
            <div class="row">
              <label>
                Payment API key
                <input name="paymentApiKey" type="password" autocomplete="new-password" spellcheck="false" />
              </label>
              <label>
                Auth header
                <select name="paymentApiAuthHeader">
                  <option value="">Auto</option>
                  <option value="x-api-key">x-api-key</option>
                  <option value="token">token</option>
                </select>
              </label>
            </div>
            <div class="row">
              <label>
                Agent identifier
                <input name="agentIdentifier" type="text" autocomplete="off" spellcheck="false" />
              </label>
              <label>
                Seller VKey
                <input name="sellerVKey" type="password" autocomplete="new-password" spellcheck="false" />
              </label>
            </div>
            <label>
              Price amounts JSON
              <textarea name="priceAmounts" spellcheck="false" placeholder='[{"amount":"1000000","unit":"..."}]'></textarea>
              <span class="hint">Optional. Leave empty to use fixed pricing configured in Masumi.</span>
            </label>
          </fieldset>

          <div class="actions">
            <button id="saveConfig" type="submit">Apply config</button>
            <button id="refreshState" class="secondary" type="button">Refresh status</button>
            <span id="configMessage" role="status" aria-live="polite"></span>
          </div>
        </form>
      </section>

      <aside class="stack" aria-labelledby="statusTitle">
        <div>
          <h2 id="statusTitle">Readiness</h2>
          <p id="emptyState">No status loaded yet.</p>
          <ul id="issues"></ul>
        </div>
        <pre id="stateOutput" aria-label="Redacted configuration state">{}</pre>

        <div class="stack" aria-labelledby="agentSlotsTitle">
          <div>
            <h3 id="agentSlotsTitle">Agent slots</h3>
            <p class="hint">Save up to four registration profiles locally in this browser, then register each one.</p>
          </div>
          <div id="agentSlots" class="agent-slots" role="list" aria-label="Agent registration slots"></div>
          <div class="actions">
            <button id="saveAgentSlot" class="secondary" type="button">Save current slot</button>
            <button id="clearAgentSlot" class="secondary" type="button">Clear slot</button>
          </div>
        </div>

        <form id="registryForm" class="stack">
          <h3>Register on Masumi</h3>
          <label>
            Public agent URL
            <input name="agentApiBaseUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://your-agent.example.com" />
            <span class="hint">Must be public and serve /availability, /input_schema, /start_job, and /status.</span>
          </label>
          <label>
            Agent name
            <input name="agentName" type="text" autocomplete="off" maxlength="250" />
          </label>
          <label>
            Description
            <textarea name="agentDescription" maxlength="250" placeholder="What this agent does"></textarea>
          </label>
          <div class="row">
            <label>
              Capability
              <input name="capabilityName" type="text" autocomplete="off" value="langdock-agent" />
            </label>
            <label>
              Version
              <input name="capabilityVersion" type="text" autocomplete="off" value="1.0.0" />
            </label>
          </div>
          <div class="row">
            <label>
              Price amount
              <input name="pricingAmount" type="text" inputmode="numeric" pattern="[0-9]*" value="1000000" />
              <span class="hint">Raw units. 1000000 = 1 tUSDM/USDCx.</span>
            </label>
            <label>
              Price unit
              <input name="pricingUnit" type="text" autocomplete="off" spellcheck="false" />
            </label>
          </div>
          <label>
            Tags
            <input name="tags" type="text" autocomplete="off" value="langdock,masumi" />
            <span class="hint">Comma-separated, 1-15 tags.</span>
          </label>
          <div class="row">
            <label>
              Author name
              <input name="authorName" type="text" autocomplete="name" />
            </label>
            <label>
              Author email
              <input name="authorContactEmail" type="email" autocomplete="email" spellcheck="false" />
            </label>
          </div>
          <label>
            Organization
            <input name="authorOrganization" type="text" autocomplete="organization" />
          </label>
          <div class="actions">
            <button id="registerAgent" type="submit">Register agent</button>
            <button id="refreshRegistry" class="secondary" type="button">Refresh registry</button>
            <span id="registryMessage" role="status" aria-live="polite"></span>
          </div>
        </form>
        <pre id="registryOutput" aria-label="Registry response">Register or refresh to see registry status.</pre>

        <form id="startJobForm" class="stack">
          <h3>Call /start_job</h3>
          <label>
            Identifier from purchaser
            <input name="identifier_from_purchaser" type="text" autocomplete="off" spellcheck="false" placeholder="ab12cd34ef56ab" />
            <span class="hint">Masumi mode requires lowercase hex, 14-26 characters. Leave empty in direct mode.</span>
          </label>
          <label>
            Prompt
            <textarea name="text" required>Say hello in one sentence.</textarea>
          </label>
          <div class="actions">
            <button id="testLangdock" class="secondary" type="button">Test Langdock</button>
            <button id="runJob" type="submit">Run job</button>
            <span id="jobMessage" role="status" aria-live="polite"></span>
          </div>
        </form>
        <pre id="jobOutput" aria-label="Job response">Submit a job to see the response.</pre>
      </aside>
    </div>
  </main>

  <script>
    const PREPROD_TUSDM_UNIT = '${PREPROD_TUSDM_UNIT}';
    const MAINNET_USDCX_UNIT = '${MAINNET_USDCX_UNIT}';
    const configForm = document.getElementById('configForm');
    const registryForm = document.getElementById('registryForm');
    const startJobForm = document.getElementById('startJobForm');
    const readyBadge = document.getElementById('readyBadge');
    const issues = document.getElementById('issues');
    const stateOutput = document.getElementById('stateOutput');
    const jobOutput = document.getElementById('jobOutput');
    const registryOutput = document.getElementById('registryOutput');
    const configMessage = document.getElementById('configMessage');
    const registryMessage = document.getElementById('registryMessage');
    const jobMessage = document.getElementById('jobMessage');
    const emptyState = document.getElementById('emptyState');
    const saveConfig = document.getElementById('saveConfig');
    const runJob = document.getElementById('runJob');
    const registerAgent = document.getElementById('registerAgent');
    const testLangdock = document.getElementById('testLangdock');
    const agentSlots = document.getElementById('agentSlots');
    const saveAgentSlot = document.getElementById('saveAgentSlot');
    const clearAgentSlot = document.getElementById('clearAgentSlot');
    const slotStorageKey = 'langdock-masumi-wrapper.agentSlots.v1';
    let selectedAgentSlot = 0;

    function formValue(form, name) {
      const field = form.elements[name];
      return field && 'value' in field ? field.value.trim() : '';
    }

    function setupHeaders() {
      return { };
    }

    function blankAgentSlot() {
      return {
        agentApiBaseUrl: '',
        agentName: '',
        agentDescription: '',
        capabilityName: 'langdock-agent',
        capabilityVersion: '1.0.0',
        authorName: '',
        authorContactEmail: '',
        authorOrganization: '',
        tags: 'langdock,masumi',
        pricingAmount: '1000000',
        pricingUnit: ''
      };
    }

    function loadAgentSlots() {
      try {
        const parsed = JSON.parse(localStorage.getItem(slotStorageKey) || '[]');
        if (Array.isArray(parsed)) {
          return Array.from({ length: 4 }, (_, index) => Object.assign(blankAgentSlot(), parsed[index] || {}));
        }
      } catch {
        // Ignore corrupt local storage and reset below.
      }
      return Array.from({ length: 4 }, blankAgentSlot);
    }

    function saveAgentSlots(slots) {
      localStorage.setItem(slotStorageKey, JSON.stringify(slots.slice(0, 4)));
    }

    function currentRegistryPayload() {
      return {
        agentApiBaseUrl: formValue(registryForm, 'agentApiBaseUrl'),
        agentName: formValue(registryForm, 'agentName'),
        agentDescription: formValue(registryForm, 'agentDescription'),
        capabilityName: formValue(registryForm, 'capabilityName'),
        capabilityVersion: formValue(registryForm, 'capabilityVersion'),
        authorName: formValue(registryForm, 'authorName'),
        authorContactEmail: formValue(registryForm, 'authorContactEmail'),
        authorOrganization: formValue(registryForm, 'authorOrganization'),
        tags: formValue(registryForm, 'tags'),
        pricingAmount: formValue(registryForm, 'pricingAmount'),
        pricingUnit: formValue(registryForm, 'pricingUnit')
      };
    }

    function applyAgentSlot(slot) {
      const data = Object.assign(blankAgentSlot(), slot || {});
      for (const [key, value] of Object.entries(data)) {
        if (registryForm.elements[key]) registryForm.elements[key].value = value;
      }
      syncPricingUnit();
    }

    function renderAgentSlots() {
      const slots = loadAgentSlots();
      agentSlots.innerHTML = '';
      slots.forEach((slot, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'slot-card';
        button.setAttribute('role', 'listitem');
        button.setAttribute('aria-pressed', String(index === selectedAgentSlot));
        const title = document.createElement('span');
        title.textContent = 'Agent ' + (index + 1) + ': ' + (slot.agentName || 'Empty agent');
        const subtitle = document.createElement('small');
        subtitle.textContent = slot.agentApiBaseUrl || 'No public URL saved';
        button.append(title, subtitle);
        button.addEventListener('click', () => {
          selectedAgentSlot = index;
          applyAgentSlot(slots[index]);
          renderAgentSlots();
        });
        agentSlots.appendChild(button);
      });
    }

    function saveCurrentAgentSlot() {
      const slots = loadAgentSlots();
      slots[selectedAgentSlot] = currentRegistryPayload();
      saveAgentSlots(slots);
      renderAgentSlots();
      setMessage(registryMessage, 'Saved agent ' + (selectedAgentSlot + 1) + ' locally.', 'success');
    }

    function clearCurrentAgentSlot() {
      const slots = loadAgentSlots();
      slots[selectedAgentSlot] = blankAgentSlot();
      saveAgentSlots(slots);
      applyAgentSlot(slots[selectedAgentSlot]);
      renderAgentSlots();
      setMessage(registryMessage, 'Cleared agent ' + (selectedAgentSlot + 1) + '.', 'success');
    }

    function setMessage(node, text, kind) {
      node.textContent = text;
      node.className = kind || '';
    }

    function selectedNetwork() {
      return formValue(configForm, 'network') || 'Preprod';
    }

    function syncPricingUnit() {
      const field = registryForm.elements.pricingUnit;
      if (!field.value.trim()) {
        field.value = selectedNetwork() === 'Mainnet' ? MAINNET_USDCX_UNIT : PREPROD_TUSDM_UNIT;
      }
    }

    function renderState(data) {
      const report = data.report || {};
      const ready = report.status === 'ready';
      readyBadge.textContent = ready ? 'Ready' : 'Not ready';
      readyBadge.className = ready ? 'status ready' : 'status not-ready';

      issues.innerHTML = '';
      const issueList = Array.isArray(report.issues) ? report.issues : [];
      emptyState.hidden = issueList.length > 0;
      for (const issue of issueList) {
        const item = document.createElement('li');
        item.textContent = issue.severity + ': ' + issue.message;
        issues.appendChild(item);
      }
      stateOutput.textContent = JSON.stringify(data, null, 2);
    }

    async function refreshState() {
      setMessage(configMessage, 'Loading status...', '');
      try {
        const res = await fetch('/setup/config');
        const data = await res.json();
        renderState(data);
        setMessage(configMessage, 'Status refreshed.', 'success');
      } catch (err) {
        setMessage(configMessage, 'Could not load status. Try again.', 'error');
      }
    }

    configForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      saveConfig.disabled = true;
      configForm.setAttribute('aria-busy', 'true');
      setMessage(configMessage, 'Applying config...', '');
      const payload = {
        langdockBaseUrl: formValue(configForm, 'langdockBaseUrl'),
        langdockApiKey: formValue(configForm, 'langdockApiKey'),
        langdockAgentId: formValue(configForm, 'langdockAgentId'),
        paymentMode: formValue(configForm, 'paymentMode'),
        paymentServiceUrl: formValue(configForm, 'paymentServiceUrl'),
        paymentApiKey: formValue(configForm, 'paymentApiKey'),
        paymentApiAuthHeader: formValue(configForm, 'paymentApiAuthHeader'),
        network: formValue(configForm, 'network'),
        agentIdentifier: formValue(configForm, 'agentIdentifier'),
        sellerVKey: formValue(configForm, 'sellerVKey'),
        priceAmounts: formValue(configForm, 'priceAmounts')
      };
      try {
        const res = await fetch('/setup/config', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, setupHeaders()),
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Config was rejected.');
        renderState(data);
        configForm.reset();
        configForm.elements.langdockBaseUrl.value = payload.langdockBaseUrl || 'https://api.langdock.com';
        configForm.elements.paymentMode.value = payload.paymentMode || 'masumi';
        const networkField = configForm.querySelector('input[name="network"][value="' + (payload.network || 'Preprod') + '"]');
        if (networkField) networkField.checked = true;
        syncPricingUnit();
        setMessage(configMessage, 'Config saved to .env and applied.', 'success');
      } catch (err) {
        setMessage(configMessage, err instanceof Error ? err.message : 'Could not apply config.', 'error');
      } finally {
        saveConfig.disabled = false;
        configForm.removeAttribute('aria-busy');
      }
    });

    document.getElementById('refreshState').addEventListener('click', refreshState);
    saveAgentSlot.addEventListener('click', saveCurrentAgentSlot);
    clearAgentSlot.addEventListener('click', clearCurrentAgentSlot);
    configForm.addEventListener('change', (event) => {
      if (event.target && event.target.name === 'network') {
        registryForm.elements.pricingUnit.value = selectedNetwork() === 'Mainnet' ? MAINNET_USDCX_UNIT : PREPROD_TUSDM_UNIT;
      }
    });

    async function refreshRegistryStatus() {
      setMessage(registryMessage, 'Loading registry...', '');
      try {
        const res = await fetch('/setup/registry/status', {
          headers: setupHeaders()
        });
        const data = await res.json();
        registryOutput.textContent = JSON.stringify(data, null, 2);
        if (!res.ok) throw new Error(data.message || 'Could not load registry.');
        setMessage(registryMessage, data.agentIdentifier ? 'Agent identifier saved.' : 'Registry status loaded.', 'success');
        await refreshState();
      } catch (err) {
        setMessage(registryMessage, err instanceof Error ? err.message : 'Could not load registry.', 'error');
      }
    }

    document.getElementById('refreshRegistry').addEventListener('click', refreshRegistryStatus);

    registryForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      registerAgent.disabled = true;
      registryForm.setAttribute('aria-busy', 'true');
      syncPricingUnit();
      setMessage(registryMessage, 'Submitting registration...', '');
      const payload = {
        agentApiBaseUrl: formValue(registryForm, 'agentApiBaseUrl'),
        agentName: formValue(registryForm, 'agentName'),
        agentDescription: formValue(registryForm, 'agentDescription'),
        capabilityName: formValue(registryForm, 'capabilityName'),
        capabilityVersion: formValue(registryForm, 'capabilityVersion'),
        authorName: formValue(registryForm, 'authorName'),
        authorContactEmail: formValue(registryForm, 'authorContactEmail'),
        authorOrganization: formValue(registryForm, 'authorOrganization'),
        tags: formValue(registryForm, 'tags'),
        pricingAmount: formValue(registryForm, 'pricingAmount'),
        pricingUnit: formValue(registryForm, 'pricingUnit')
      };
      try {
        const res = await fetch('/setup/registry/register', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, setupHeaders()),
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        registryOutput.textContent = JSON.stringify(data, null, 2);
        if (!res.ok) throw new Error(data.message || 'Registration failed.');
        saveCurrentAgentSlot();
        setMessage(registryMessage, 'Registration submitted for agent ' + (selectedAgentSlot + 1) + '. Confirmation can take several minutes.', 'success');
        await refreshState();
      } catch (err) {
        setMessage(registryMessage, err instanceof Error ? err.message : 'Could not register agent.', 'error');
      } finally {
        registerAgent.disabled = false;
        registryForm.removeAttribute('aria-busy');
      }
    });

    testLangdock.addEventListener('click', async () => {
      testLangdock.disabled = true;
      setMessage(jobMessage, 'Calling Langdock...', '');
      try {
        const res = await fetch('/setup/langdock/test', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, setupHeaders()),
          body: JSON.stringify({ prompt: formValue(startJobForm, 'text') })
        });
        const data = await res.json();
        jobOutput.textContent = JSON.stringify(data, null, 2);
        if (!res.ok) throw new Error(data.message || 'Langdock test failed.');
        setMessage(jobMessage, 'Langdock responded.', 'success');
      } catch (err) {
        setMessage(jobMessage, err instanceof Error ? err.message : 'Could not call Langdock.', 'error');
      } finally {
        testLangdock.disabled = false;
      }
    });

    startJobForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      runJob.disabled = true;
      startJobForm.setAttribute('aria-busy', 'true');
      setMessage(jobMessage, 'Submitting job...', '');
      const identifier = formValue(startJobForm, 'identifier_from_purchaser');
      const payload = {
        input_data: [{ key: 'text', value: formValue(startJobForm, 'text') }]
      };
      if (identifier) payload.identifier_from_purchaser = identifier;
      try {
        const res = await fetch('/start_job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        jobOutput.textContent = JSON.stringify(data, null, 2);
        if (!res.ok) throw new Error(data.message || 'Job was rejected.');
        setMessage(jobMessage, 'Job submitted.', 'success');
      } catch (err) {
        setMessage(jobMessage, err instanceof Error ? err.message : 'Could not submit job.', 'error');
      } finally {
        runJob.disabled = false;
        startJobForm.removeAttribute('aria-busy');
      }
    });

    renderAgentSlots();
    applyAgentSlot(loadAgentSlots()[selectedAgentSlot]);
    syncPricingUnit();
    refreshState();
  </script>
</body>
</html>`;
}

function sessionTokenFromRequest(request: FastifyRequest): string {
  const cookie = request.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)session=([^;]*)/);
  if (match) {
    try { return decodeURIComponent(match[1]); } catch { return ""; }
  }
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return "";
}

function setSessionCookie(reply: import("fastify").FastifyReply, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header(
    "set-cookie",
    `session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Strict; HttpOnly${secure}`,
  );
}

async function getSessionUser(request: FastifyRequest): Promise<AuthenticatedUser | null> {
  const token = sessionTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

async function requestHasSetupAccess(request: FastifyRequest): Promise<boolean> {
  // Session-based auth
  const user = await getSessionUser(request);
  if (user) return true;
  // Legacy token/basic auth only when explicitly configured
  if (setupAccessConfigured()) {
    return requestCanConfigure(request);
  }
  return false;
}

function escSetupHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function registerSetup(app: FastifyInstance, ctx: BridgeContext): void {
  // ── Auth routes ─────────────────────────────────────────────────────

  app.get("/", async (request, reply) => {
    const user = await getSessionUser(request);
    if (user) {
      return reply.redirect("/dashboard");
    }
    return reply.type("text/html; charset=utf-8").send(loginHtml());
  });

  app.get("/dashboard", async (request, reply) => {
    const user = await getSessionUser(request);
    if (!user) {
      // Allow legacy token auth for API users but only when explicitly configured
      if (!setupAccessConfigured() || !(await requestCanConfigure(request))) {
        return reply.redirect("/");
      }
    }
    return reply.type("text/html; charset=utf-8").send(setupHtml(user));
  });

  app.post("/auth", async (request, reply) => {
    if (rejectCrossOriginPost(request, reply)) return;

    const body =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as Record<string, string | undefined>)
        : {};
    const mode = (body.mode || "login").trim().toLowerCase();
    const username = (body.username || "").trim();
    const password = body.password || "";

    if (
      !applyRateLimit(
        reply,
        "setup-auth",
        clientIdentifier(request, username.toLowerCase() || "missing"),
        5,
        15 * 60 * 1000,
      )
    ) {
      return;
    }

    if (!username || !password) {
      return reply.status(400).send({ error: "MISSING_FIELDS", message: "Username and password are required." });
    }

    if (mode === "register") {
      return reply.status(403).send({
        error: "REGISTRATION_DISABLED",
        message: "Registration is disabled. Configure the admin login on the server.",
      });
    }

    const loginResult = await loginAdmin(username, password);
    if ("error" in loginResult) {
      return reply.status(adminCredentialsConfigured() ? 401 : 503).send({
        error: "LOGIN_FAILED",
        message: loginResult.error,
      });
    }
    setSessionCookie(reply, loginResult.token);
    return reply.status(200).send({ ok: true, user: loginResult.user });
  });

  app.post("/auth/logout", async (request, reply) => {
    if (rejectCrossOriginPost(request, reply)) return;
    const token = sessionTokenFromRequest(request);
    if (token) await logoutUser(token);
    return reply
      .header("set-cookie", "session=; path=/; max-age=0; SameSite=Strict")
      .send({ ok: true });
  });

  // ── Setup API routes ───────────────────────────────────────────────

  app.get("/setup/config", async (request, reply) => {
    if (!await requestHasSetupAccess(request)) {
      return reply.status(401).send({
        error: "SETUP_ACCESS_DENIED",
        message: "Authentication required.",
      });
    }
    if (
      !applyRateLimit(
        reply,
        "setup-read",
        clientIdentifier(request),
        120,
        60 * 1000,
      )
    ) {
      return;
    }
    return reply.status(200).send(redactConfigState());
  });

  app.post("/setup/config", async (request, reply) => {
    if (rejectCrossOriginPost(request, reply)) return;
    if (!await requestHasSetupAccess(request)) {
      return reply.status(401).send({
        error: "SETUP_ACCESS_DENIED",
        message: "Authentication required.",
      });
    }
    if (
      !applyRateLimit(
        reply,
        "setup-write",
        clientIdentifier(request),
        30,
        60 * 1000,
      )
    ) {
      return;
    }

    const body =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as SetupConfigBody)
        : {};

    try {
      const patch = buildEnvPatch(body);
      await persistEnvPatch(patch);
      applyEnvPatch(patch);
      const config = loadConfig();
      ctx.endpointHandler.setStartJobHandler(
        createLangdockStartJobHandler(config),
      );
      return reply.status(200).send(redactConfigState());
    } catch (e) {
      return reply.status(400).send({
        error: "INVALID_SETUP_CONFIG",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.post("/setup/langdock/test", async (request, reply) => {
    if (rejectCrossOriginPost(request, reply)) return;
    if (!await requestHasSetupAccess(request)) {
      return reply.status(401).send({
        error: "SETUP_ACCESS_DENIED",
        message: "Authentication required.",
      });
    }
    if (
      !applyRateLimit(
        reply,
        "setup-langdock-test",
        clientIdentifier(request),
        20,
        60 * 1000,
      )
    ) {
      return;
    }

    const config = loadConfig();
    if (!config.langdockApiKey || !config.langdockAgentId) {
      return reply.status(400).send({
        error: "LANGDOCK_NOT_CONFIGURED",
        message:
          "Apply LANGDOCK_API_KEY and LANGDOCK_AGENT_ID before testing Langdock.",
      });
    }

    const body =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as LangdockTestBody)
        : {};
    const prompt = str(body.prompt) || "Say hello in one sentence.";

    try {
      const response = await completeChat({
        baseUrl: config.langdockBaseUrl,
        apiKey: config.langdockApiKey,
        agentId: config.langdockAgentId,
        messages: [
          {
            id: randomUUID(),
            role: "user",
            parts: [{ type: "text", text: prompt }],
          },
        ],
      });

      return reply.status(200).send({
        ok: true,
        output: extractAssistantContent(response),
        raw: response,
      });
    } catch (e) {
      const status = e instanceof LangdockApiError ? e.status : 500;
      return reply.status(status >= 400 && status < 600 ? status : 500).send({
        error: "LANGDOCK_TEST_FAILED",
        message:
          e instanceof LangdockApiError
            ? `Langdock HTTP ${e.status}: ${e.bodySnippet}`
            : e instanceof Error
              ? e.message
              : String(e),
      });
    }
  });

  app.post("/setup/registry/register", async (request, reply) => {
    if (rejectCrossOriginPost(request, reply)) return;
    if (!await requestHasSetupAccess(request)) {
      return reply.status(401).send({
        error: "SETUP_ACCESS_DENIED",
        message: "Authentication required.",
      });
    }
    if (
      !applyRateLimit(
        reply,
        "setup-registry-register",
        clientIdentifier(request),
        10,
        60 * 1000,
      )
    ) {
      return;
    }

    const body =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? (request.body as RegistrySetupBody)
        : {};

    try {
      const config = loadConfig();
      if (!config.paymentServiceUrl || !config.paymentApiKey) {
        return reply.status(400).send({
          error: "PAYMENT_SERVICE_NOT_CONFIGURED",
          message:
            "Apply PAYMENT_SERVICE_URL and PAYMENT_API_KEY before registering an agent.",
        });
      }
      if (!config.sellerVKey) {
        return reply.status(400).send({
          error: "SELLER_VKEY_NOT_CONFIGURED",
          message: "Apply SELLER_VKEY before registering an agent.",
        });
      }

      const tags = splitCsv(body.tags);
      if (tags.length === 0) {
        throw new Error("At least one tag is required.");
      }
      if (tags.length > 15) {
        throw new Error("Masumi registry accepts at most 15 tags.");
      }

      const pricingAmount = requireString(body.pricingAmount, "Price amount");
      if (!/^[0-9]+$/.test(pricingAmount) || BigInt(pricingAmount) <= 0n) {
        throw new Error("Price amount must be a positive integer raw token amount.");
      }

      const agentName = requireString(body.agentName, "Agent name");
      const agentDescription = requireString(body.agentDescription, "Description");
      const agentApiBaseUrl = requireString(body.agentApiBaseUrl, "Public agent URL");
      const capabilityName = requireString(body.capabilityName, "Capability");
      const capabilityVersion = requireString(
        body.capabilityVersion,
        "Capability version",
      );
      const authorName = requireString(body.authorName, "Author name");
      const registryPatch = registryEnvPatch(body);
      await persistEnvPatch(registryPatch);
      applyEnvPatch(registryPatch);

      const client = configuredPaymentClient();
      const result = await client.registerAgent({
        network: config.masumiNetwork,
        sellingWalletVkey: config.sellerVKey,
        name: agentName,
        description: agentDescription,
        apiBaseUrl: agentApiBaseUrl,
        capabilityName,
        capabilityVersion,
        authorName,
        authorContactEmail: str(body.authorContactEmail),
        authorContactOther: str(body.authorContactOther),
        authorOrganization: str(body.authorOrganization),
        tags,
        pricing: [
          {
            amount: pricingAmount,
            unit: str(body.pricingUnit) || defaultPricingUnit(config.masumiNetwork),
          },
        ],
      });

      if (result.agentIdentifier) {
        await persistAgentIdentifier(result.agentIdentifier);
      }

      return reply.status(200).send({
        status: "submitted",
        state: result.state,
        agentIdentifier: result.agentIdentifier,
        message:
          result.agentIdentifier
            ? "Agent identifier returned and saved."
            : "Registration submitted. Poll registry status until agentIdentifier appears.",
        raw: result.raw,
      });
    } catch (e) {
      const status = e instanceof MasumiPaymentError ? e.status : 400;
      return reply.status(status >= 400 && status < 600 ? status : 400).send({
        error: "REGISTRY_REGISTRATION_FAILED",
        message:
          e instanceof MasumiPaymentError
            ? `Masumi Payment HTTP ${e.status}: ${e.bodySnippet}`
            : e instanceof Error
              ? e.message
              : String(e),
      });
    }
  });

  app.get("/setup/registry/status", async (request, reply) => {
    if (!await requestHasSetupAccess(request)) {
      return reply.status(401).send({
        error: "SETUP_ACCESS_DENIED",
        message: "Authentication required.",
      });
    }
    if (
      !applyRateLimit(
        reply,
        "setup-registry-status",
        clientIdentifier(request),
        30,
        60 * 1000,
      )
    ) {
      return;
    }

    try {
      const client = configuredPaymentClient();
      const assets = await client.listRegistry();
      const match = matchRegisteredAgent(assets);
      const agentIdentifier =
        typeof match?.agentIdentifier === "string" ? match.agentIdentifier : undefined;
      if (agentIdentifier) {
        await persistAgentIdentifier(agentIdentifier);
      }

      return reply.status(200).send({
        agentIdentifier,
        state: typeof match?.state === "string" ? match.state : undefined,
        matchedAgent: match,
        assets,
        sokosumi:
          loadConfig().masumiNetwork === "Mainnet"
            ? "https://sokosumi.com/agents"
            : "https://preprod.sokosumi.com/agents",
      });
    } catch (e) {
      const status = e instanceof MasumiPaymentError ? e.status : 400;
      return reply.status(status >= 400 && status < 600 ? status : 400).send({
        error: "REGISTRY_STATUS_FAILED",
        message:
          e instanceof MasumiPaymentError
            ? `Masumi Payment HTTP ${e.status}: ${e.bodySnippet}`
            : e instanceof Error
              ? e.message
              : String(e),
      });
    }
  });
}
