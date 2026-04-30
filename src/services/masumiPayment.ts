/**
 * HTTP client for Masumi payment APIs.
 *
 * Endpoints used:
 *   POST /payment                               — register a sale (seller side)
 *   POST /payment/resolve-blockchain-identifier — read payment status
 *   POST /payment/submit-result                 — submit MIP-004 output hash
 *
 * Configure baseUrl as the API prefix, for example:
 *   - Masumi SaaS: https://app.example.com/pay/api/v1 with x-api-key auth
 *   - Payment node: https://node.example.com/api/v1 with token auth
 */

import type {
  MasumiNetwork,
  PaymentApiAuthHeader,
  PriceAmount,
} from "../config.js";

export type PaymentOnchainState =
  | "FundsLocked"
  | "FundsOrDatumInvalid"
  | "ResultSubmitted"
  | "ResultGenerated"
  | "RefundRequested"
  | "Disputed"
  | "Withdrawn"
  | "RefundWithdrawn"
  | "DisputedWithdrawn"
  | string;

export class MasumiPaymentError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(status: number, bodySnippet: string, message?: string) {
    super(message ?? `Masumi Payment Service error: HTTP ${status}`);
    this.name = "MasumiPaymentError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export type MasumiPaymentClientConfig = {
  baseUrl: string;
  apiKey: string;
  authHeader: PaymentApiAuthHeader;
  network: MasumiNetwork;
};

export type RegisterSaleArgs = {
  agentIdentifier: string;
  inputHash: string;
  identifierFromPurchaser: string;
  payByTime: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
  requestedFunds?: PriceAmount[];
};

export type RegisterSaleResult = {
  blockchainIdentifier: string;
  payByTime: number;
  submitResultTime: number;
  unlockTime: number;
  externalDisputeUnlockTime: number;
  raw: Record<string, unknown>;
};

export type PaymentStatus = {
  onChainState: PaymentOnchainState | null;
  raw: Record<string, unknown>;
};

export class MasumiPaymentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly authHeader: PaymentApiAuthHeader;
  private readonly network: MasumiNetwork;

  constructor(config: MasumiPaymentClientConfig) {
    if (!config.baseUrl) {
      throw new Error("PAYMENT_SERVICE_URL is required");
    }
    if (!config.apiKey) {
      throw new Error("PAYMENT_API_KEY is required");
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.authHeader = config.authHeader;
    this.network = config.network;
  }

  private async request<T = unknown>(
    method: "GET" | "POST",
    path: string,
    init?: { body?: unknown; query?: Record<string, string | number | undefined> },
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (init?.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== null && `${v}`.length > 0) {
          params.set(k, String(v));
        }
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

    const res = await fetch(url, {
      method,
      headers: {
        [this.authHeader]: this.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new MasumiPaymentError(res.status, text.slice(0, 500));
    }
    if (!res.ok) {
      const message =
        (json as { message?: string }).message ??
        (json as { error?: string }).error;
      throw new MasumiPaymentError(res.status, text.slice(0, 500), message);
    }
    return json as T;
  }

  /** POST /payment — registers a sale and returns `blockchainIdentifier` + timings.
   *
   * Time fields are submitted as ISO-8601 datetime strings (with offset) per the Payment
   * Service zod schema; `RegisterSaleArgs` uses Unix seconds (matching MIP-003 response
   * fields), so we convert here.
   */
  async registerSale(args: RegisterSaleArgs): Promise<RegisterSaleResult> {
    const toIso = (unixSeconds: number): string =>
      new Date(unixSeconds * 1000).toISOString();
    const body = {
      network: this.network,
      agentIdentifier: args.agentIdentifier,
      inputHash: args.inputHash,
      identifierFromPurchaser: args.identifierFromPurchaser,
      payByTime: toIso(args.payByTime),
      submitResultTime: toIso(args.submitResultTime),
      unlockTime: toIso(args.unlockTime),
      externalDisputeUnlockTime: toIso(args.externalDisputeUnlockTime),
      ...(args.requestedFunds?.length
        ? { RequestedFunds: args.requestedFunds }
        : {}),
    };

    const resp = await this.request<{ data?: Record<string, unknown> } | Record<string, unknown>>(
      "POST",
      "/payment",
      { body },
    );

    const data = ((resp as { data?: Record<string, unknown> }).data ??
      (resp as Record<string, unknown>)) as Record<string, unknown>;
    const blockchainIdentifier = (data.blockchainIdentifier ?? data.blockchain_identifier) as
      | string
      | undefined;
    if (!blockchainIdentifier) {
      throw new MasumiPaymentError(
        500,
        JSON.stringify(resp).slice(0, 500),
        "Masumi Payment Service did not return blockchainIdentifier",
      );
    }

    // Response may return ISO strings, ms, or seconds; normalise back to Unix seconds
    // for MIP-003 parity with the /start_job response shape.
    const toSeconds = (v: unknown, fallbackSeconds: number): number => {
      if (typeof v === "string") {
        const asDate = Date.parse(v);
        if (Number.isFinite(asDate)) return Math.floor(asDate / 1000);
        const n = Number(v);
        if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : n;
      }
      if (typeof v === "number" && Number.isFinite(v)) {
        return v > 1e12 ? Math.floor(v / 1000) : v;
      }
      return fallbackSeconds;
    };

    return {
      blockchainIdentifier,
      payByTime: toSeconds(data.payByTime, args.payByTime),
      submitResultTime: toSeconds(data.submitResultTime, args.submitResultTime),
      unlockTime: toSeconds(data.unlockTime, args.unlockTime),
      externalDisputeUnlockTime: toSeconds(
        data.externalDisputeUnlockTime,
        args.externalDisputeUnlockTime,
      ),
      raw: data,
    };
  }

  /** POST /payment/resolve-blockchain-identifier — returns current state for one sale. */
  async getPaymentStatus(blockchainIdentifier: string): Promise<PaymentStatus> {
    const resp = await this.request<Record<string, unknown>>(
      "POST",
      "/payment/resolve-blockchain-identifier",
      {
        body: {
          network: this.network,
          blockchainIdentifier,
        },
      },
    );

    const data = ((resp as { data?: unknown }).data ?? resp) as
      | Record<string, unknown>
      | Array<Record<string, unknown>>;

    let entry: Record<string, unknown> | undefined;
    if (Array.isArray(data)) {
      entry =
        data.find(
          (d) =>
            (d as { blockchainIdentifier?: string }).blockchainIdentifier ===
            blockchainIdentifier,
        ) ?? data[0];
    } else if (data && typeof data === "object") {
      const maybeArr = (data as { Payments?: unknown; payments?: unknown });
      const arr = (maybeArr.Payments ?? maybeArr.payments) as
        | Array<Record<string, unknown>>
        | undefined;
      if (Array.isArray(arr)) {
        entry =
          arr.find(
            (d) =>
              (d as { blockchainIdentifier?: string }).blockchainIdentifier ===
              blockchainIdentifier,
          ) ?? arr[0];
      } else {
        entry = data as Record<string, unknown>;
      }
    }

    const onChainState =
      (entry?.onChainState as string | undefined) ??
      (entry?.state as string | undefined) ??
      null;

    return { onChainState, raw: entry ?? {} };
  }

  /** POST /payment/submit-result — submits MIP-004 output hash on-chain. */
  async submitResult(args: {
    blockchainIdentifier: string;
    submitResultHash: string;
  }): Promise<Record<string, unknown>> {
    const body = {
      network: this.network,
      blockchainIdentifier: args.blockchainIdentifier,
      submitResultHash: args.submitResultHash,
    };
    const resp = await this.request<Record<string, unknown>>(
      "POST",
      "/payment/submit-result",
      { body },
    );
    return resp;
  }
}

/** Returns `true` for states in which the seller is authorised to run the job. */
export function paymentIsLocked(state: PaymentOnchainState | null): boolean {
  if (!state) return false;
  return (
    state === "FundsLocked" ||
    state === "ResultGenerated" ||
    state === "ResultSubmitted"
  );
}

/** Returns `true` for states that terminate the job as cancelled / failed. */
export function paymentIsTerminal(state: PaymentOnchainState | null): boolean {
  if (!state) return false;
  return (
    state === "FundsOrDatumInvalid" ||
    state === "RefundRequested" ||
    state === "Disputed" ||
    state === "RefundWithdrawn" ||
    state === "DisputedWithdrawn"
  );
}
