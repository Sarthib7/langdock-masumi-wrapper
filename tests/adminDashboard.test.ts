/** Integration coverage for the read-only /admin operator dashboard. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { __resetJobsForTests, createJob, setJobStatus } from "../src/services/jobs.js";
import { resetDb } from "../src/services/database.js";
import { __resetRateLimitsForTests } from "../src/services/rateLimit.js";

const ORIGINAL_ENV = { ...process.env };
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin-password-123";

let tempDir: string | undefined;

async function loginAndGetCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/auth",
    payload: { mode: "login", username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = String(res.headers["set-cookie"] ?? "");
  const match = setCookie.match(/session=[^;]+/);
  expect(match).toBeTruthy();
  return match![0];
}

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  tempDir = await mkdtemp(path.join(tmpdir(), "langdock-admin-test-"));
  process.env.DB_PATH = path.join(tempDir, "test.db");
  process.env.SETUP_USERNAME = ADMIN_USERNAME;
  process.env.SETUP_PASSWORD = ADMIN_PASSWORD;
  // Pin payment service to an unroutable address so the health probe fails
  // fast and the dashboard renders without hanging on network.
  process.env.PAYMENT_SERVICE_URL = "http://127.0.0.1:1/pay/api/v1";
  __resetJobsForTests();
  __resetRateLimitsForTests();
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  resetDb();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("admin dashboard", () => {
  it("redirects to / when not authenticated", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/admin" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/");
    await app.close();
  });

  it("renders the dashboard for authenticated users", async () => {
    const app = await buildApp();
    const cookie = await loginAndGetCookie(app);
    const res = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Operator console");
    expect(res.body).toContain("Langdock Masumi");
    expect(res.body).toContain("Recent jobs");
    expect(res.body).toContain("Payment service health");
    expect(res.body).toContain(ADMIN_USERNAME);
    // Security headers should still attach to the dashboard HTML.
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    await app.close();
  });

  it("returns 401 from /admin/api/state without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/admin/api/state" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "UNAUTHORIZED" });
    await app.close();
  });

  it("reflects in-memory jobs in /admin/api/state", async () => {
    const app = await buildApp();
    const cookie = await loginAndGetCookie(app);

    createJob({
      id: "job-aaa",
      blockchainIdentifier: "bc-aaa",
      identifierFromPurchaser: "1234567890abcd",
      input_hash: "hash-1",
      input_data: [],
      status: "awaiting_payment",
      payByTime: 0,
      submitResultTime: 0,
      unlockTime: 0,
      externalDisputeUnlockTime: 0,
      amounts: [{ amount: "5000000", unit: "lovelace" }],
      agent_slug: "lexi",
    });
    setJobStatus("job-aaa", "completed", {
      output_hash: "out-1",
      completedAt: Date.now(),
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/api/state",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.username).toBe(ADMIN_USERNAME);
    expect(body.stats.totalJobs).toBe(1);
    expect(body.stats.completed).toBe(1);
    expect(body.jobs[0].id).toBe("job-aaa");
    expect(body.jobs[0].status).toBe("completed");
    expect(body.paymentHealth.reachable).toBe(false); // unroutable URL
    await app.close();
  });
});
