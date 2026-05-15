/**
 * Background job runner.
 *
 * In `masumi` mode: polls the Payment Service until funds are locked, then
 * invokes the registered `start_job` handler, computes the MIP-004 output
 * hash, and submits it on-chain.
 *
 * In `direct` mode: runs the handler immediately (used for local dev).
 */

import type { AppConfig } from "../config.js";
import type { StartJobHandler } from "../agentEndpointHandler.js";
import type { InputDataItem } from "../types/masumi.js";
import { setJobStatus } from "./jobs.js";
import { computeOutputHash, stringifyForHash } from "./hashing.js";
import { startHitlChatJob } from "./hitlChat.js";
import { LangdockApiError } from "./langdock.js";
import {
  MasumiPaymentClient,
  MasumiPaymentError,
  paymentIsLocked,
  paymentIsTerminal,
} from "./masumiPayment.js";

type RunContext = {
  jobId: string;
  identifierFromPurchaser: string;
  inputData: InputDataItem[];
  handler: StartJobHandler;
};

function handlerErrorMessage(e: unknown): string {
  if (e instanceof LangdockApiError) {
    return `Langdock HTTP ${e.status}: ${e.bodySnippet}`;
  }
  if (e instanceof MasumiPaymentError) {
    return `Masumi Payment HTTP ${e.status}: ${e.bodySnippet}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

async function runHandlerAndRecord(ctx: RunContext): Promise<void> {
  try {
    const result = await ctx.handler(
      ctx.identifierFromPurchaser,
      ctx.inputData,
    );
    const outputHash = computeOutputHash(
      ctx.identifierFromPurchaser,
      stringifyForHash(result),
    );
    setJobStatus(ctx.jobId, "completed", {
      result,
      output_hash: outputHash,
      completedAt: Date.now(),
    });
  } catch (e) {
    setJobStatus(ctx.jobId, "failed", {
      error: handlerErrorMessage(e),
      failedAt: Date.now(),
    });
  }
}

async function submitResultHash(
  client: MasumiPaymentClient,
  blockchainIdentifier: string,
  outputHash: string,
): Promise<string | undefined> {
  try {
    await client.submitResult({ blockchainIdentifier, submitResultHash: outputHash });
    return undefined;
  } catch (e) {
    return handlerErrorMessage(e);
  }
}

/** Runs the handler immediately (dev mode, no Masumi node). Awaitable. */
export async function runDirect(ctx: RunContext): Promise<void> {
  setJobStatus(ctx.jobId, "running");
  await runHandlerAndRecord(ctx);
}

/** Polls the Masumi Payment Service, then runs the handler and submits the hash. */
export function runWithPayment(
  ctx: RunContext & {
    blockchainIdentifier: string;
    client: MasumiPaymentClient;
    config: AppConfig;
  },
): void {
  void (async () => {
    try {
      await runWithPaymentLoop(ctx);
    } catch (e) {
      // Last-ditch safety net so an unexpected throw in the poller never leaves
      // the job stuck in "awaiting_payment" forever.
      try {
        setJobStatus(ctx.jobId, "failed", {
          error: `Payment poller crashed: ${handlerErrorMessage(e)}`,
          failedAt: Date.now(),
        });
      } catch {
        /* swallowed — job store unreachable */
      }
    }
  })();
}

async function runWithPaymentLoop(
  ctx: RunContext & {
    blockchainIdentifier: string;
    client: MasumiPaymentClient;
    config: AppConfig;
  },
): Promise<void> {
    const started = Date.now();
    const { client, blockchainIdentifier } = ctx;

    while (Date.now() - started < ctx.config.paymentPollTimeoutMs) {
      try {
        const { onChainState } = await client.getPaymentStatus(blockchainIdentifier);
        if (paymentIsTerminal(onChainState)) {
          setJobStatus(ctx.jobId, "refunded", {
            error: `Payment terminated on-chain: ${onChainState}`,
            failedAt: Date.now(),
          });
          return;
        }
        if (paymentIsLocked(onChainState)) {
          break;
        }
      } catch (e) {
        // Transient Payment Service error — log via job but keep polling.
        setJobStatus(ctx.jobId, "awaiting_payment", {
          error: `Payment poll error: ${handlerErrorMessage(e)}`,
        });
      }
      await new Promise((r) => setTimeout(r, ctx.config.paymentPollIntervalMs));
    }

    // Re-check one final time before giving up.
    let finalState: string | null = null;
    try {
      finalState = (await client.getPaymentStatus(blockchainIdentifier)).onChainState;
    } catch {
      finalState = null;
    }
    if (!paymentIsLocked(finalState)) {
      setJobStatus(ctx.jobId, "failed", {
        error: `Timed out waiting for payment (last state: ${finalState ?? "unknown"})`,
        failedAt: Date.now(),
      });
      return;
    }

    if (ctx.config.hitlChatMode) {
      await startHitlChatJob({
        jobId: ctx.jobId,
        inputData: ctx.inputData,
        config: ctx.config,
      });
      return;
    }

    setJobStatus(ctx.jobId, "running");
    await runHandlerAndRecord(ctx);

    // Submit output hash so the buyer can unlock funds.
    const updated = (await import("./jobs.js")).getJob(ctx.jobId);
    if (updated?.status === "completed" && updated.output_hash) {
      const err = await submitResultHash(
        client,
        blockchainIdentifier,
        updated.output_hash,
      );
      if (err) {
        setJobStatus(ctx.jobId, "failed", {
          error: `Failed to submit result hash on-chain: ${err}`,
          failedAt: Date.now(),
        });
      }
    }
}
