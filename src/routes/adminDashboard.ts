/**
 * Read-only operator dashboard at `/admin`.
 *
 * Session-gated (same cookie as `/setup`). Shows agents, recent jobs, and
 * payment-service health. No write actions live here; mutations stay on
 * `/setup` until those flows are also rebuilt.
 *
 * `/admin/api/state` returns the same data as JSON, polled by the page every
 * 5 seconds.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { loadConfig } from "../config.js";
import { listJobs } from "../services/jobs.js";
import { verifyToken } from "../services/auth.js";
import type { AuthenticatedUser } from "../services/auth.js";
import { renderAdminDashboardHtml } from "./adminDashboardHtml.js";

type PaymentHealth = {
  reachable: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  checkedAt: number;
  error: string | null;
};

let cachedPaymentHealth: PaymentHealth | null = null;
let lastHealthProbeAt = 0;
const HEALTH_TTL_MS = 30_000;

function sessionTokenFromCookie(request: FastifyRequest): string {
  const raw = request.headers.cookie;
  if (!raw || typeof raw !== "string") return "";
  for (const part of raw.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === "session") {
      return decodeURIComponent(value.join("="));
    }
  }
  return "";
}

async function getDashboardUser(
  request: FastifyRequest,
): Promise<AuthenticatedUser | null> {
  const token = sessionTokenFromCookie(request);
  if (!token) return null;
  return verifyToken(token);
}

async function probePaymentService(): Promise<PaymentHealth> {
  const now = Date.now();
  if (cachedPaymentHealth && now - lastHealthProbeAt < HEALTH_TTL_MS) {
    return cachedPaymentHealth;
  }
  lastHealthProbeAt = now;
  const config = loadConfig();
  const baseUrl = config.paymentServiceUrl?.trim();
  if (!baseUrl) {
    cachedPaymentHealth = {
      reachable: false,
      latencyMs: null,
      statusCode: null,
      checkedAt: now,
      error: "PAYMENT_SERVICE_URL is not configured",
    };
    return cachedPaymentHealth;
  }

  // The Masumi node + SaaS gateway both respond to the base /payment path
  // even without auth (4xx response is enough to know the host is reachable).
  const probeUrl = baseUrl.replace(/\/$/, "") + "/health";
  const started = performance.now();
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 4_000);
    const res = await fetch(probeUrl, {
      method: "GET",
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timeout);
    const latency = Math.round(performance.now() - started);
    cachedPaymentHealth = {
      reachable: true,
      latencyMs: latency,
      statusCode: res.status,
      checkedAt: now,
      error: null,
    };
  } catch (err) {
    cachedPaymentHealth = {
      reachable: false,
      latencyMs: null,
      statusCode: null,
      checkedAt: now,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return cachedPaymentHealth;
}

function buildState(user: AuthenticatedUser, health: PaymentHealth) {
  const config = loadConfig();
  const agents = config.agents.length
    ? config.agents.map((agent) => ({
        slug: agent.slug,
        name: agent.name || agent.slug,
        description: agent.description || "",
        agentIdentifier: agent.agentIdentifier || "(unregistered)",
        apiBaseUrl: agent.apiBaseUrl || "",
        priceAmounts: agent.priceAmounts,
      }))
    : [
        {
          slug: "(default)",
          name: "Default agent",
          description:
            "Single-agent mode — AGENTS_JSON is empty. Routes live at /start_job, /status, etc.",
          agentIdentifier: config.agentIdentifier || "(unregistered)",
          apiBaseUrl: "",
          priceAmounts: config.priceAmounts,
        },
      ];

  const jobsAll = listJobs().sort((a, b) => b.createdAt - a.createdAt);
  const jobs = jobsAll.slice(0, 50).map((job) => ({
    id: job.id,
    agentSlug: job.agent_slug ?? null,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
    failedAt: job.failedAt ?? null,
    blockchainIdentifier: job.blockchainIdentifier,
    error: job.error ?? null,
    awaitingInput: job.status === "awaiting_input",
  }));

  const stats = {
    totalJobs: jobsAll.length,
    awaitingPayment: jobsAll.filter((j) => j.status === "awaiting_payment").length,
    awaitingInput: jobsAll.filter((j) => j.status === "awaiting_input").length,
    running: jobsAll.filter((j) => j.status === "running").length,
    completed: jobsAll.filter((j) => j.status === "completed").length,
    failed: jobsAll.filter(
      (j) => j.status === "failed" || j.status === "refunded",
    ).length,
  };

  return {
    user: { username: user.username, displayName: user.displayName },
    network: config.masumiNetwork,
    paymentMode: config.paymentMode,
    paymentHealth: health,
    agents,
    jobs,
    stats,
    serverTime: Date.now(),
  };
}

async function denyUnauthenticated(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthenticatedUser | null> {
  const user = await getDashboardUser(request);
  if (!user) {
    reply.redirect("/");
    return null;
  }
  return user;
}

export function registerAdminDashboard(app: FastifyInstance): void {
  app.get("/admin", async (request, reply) => {
    const user = await denyUnauthenticated(request, reply);
    if (!user) return;
    const health = await probePaymentService();
    const state = buildState(user, health);
    return reply
      .type("text/html; charset=utf-8")
      .send(renderAdminDashboardHtml(state));
  });

  app.get("/admin/api/state", async (request, reply) => {
    const user = await getDashboardUser(request);
    if (!user) {
      return reply.status(401).send({ error: "UNAUTHORIZED" });
    }
    const health = await probePaymentService();
    const state = buildState(user, health);
    return reply.status(200).send(state);
  });
}
