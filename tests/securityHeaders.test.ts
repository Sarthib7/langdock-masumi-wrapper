/** Regression coverage for the hardening pass on improvement/audit-auth-dashboard. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { __resetJobsForTests } from "../src/services/jobs.js";
import { resetDb } from "../src/services/database.js";
import { __resetRateLimitsForTests, checkRateLimit } from "../src/services/rateLimit.js";

const ORIGINAL_ENV = { ...process.env };

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin-password-123";

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.SETUP_USERNAME = ADMIN_USERNAME;
  process.env.SETUP_PASSWORD = ADMIN_PASSWORD;
  delete process.env.DB_PATH;
  __resetJobsForTests();
  __resetRateLimitsForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetDb();
});

describe("security headers", () => {
  it("attaches CSP and anti-clickjacking headers to HTML responses", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("same-origin");
    await app.close();
  });

  it("attaches anti-sniff headers to JSON responses without CSP overhead", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/availability" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    // CSP is HTML-only.
    expect(res.headers["content-security-policy"]).toBeUndefined();
    await app.close();
  });

  it("adds Strict-Transport-Security when behind an HTTPS proxy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/availability",
      headers: { "x-forwarded-proto": "https" },
    });
    expect(res.headers["strict-transport-security"]).toContain("max-age=");
    expect(res.headers["strict-transport-security"]).toContain("includeSubDomains");
    await app.close();
  });

  it("omits Strict-Transport-Security on plain HTTP", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/availability",
      headers: { "x-forwarded-proto": "http" },
    });
    expect(res.headers["strict-transport-security"]).toBeUndefined();
    await app.close();
  });
});

describe("session cookie", () => {
  it("issues SameSite=Lax HttpOnly session cookies", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "login", username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"] ?? "");
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("SameSite=Strict");
    await app.close();
  });

  it("clears the cookie with SameSite=Lax on logout", async () => {
    const app = await buildApp();
    const login = await app.inject({
      method: "POST",
      url: "/auth",
      payload: { mode: "login", username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    const cookie =
      String(login.headers["set-cookie"]).match(/session=[^;]+/)?.[0] ?? "";
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers["set-cookie"] ?? "");
    expect(setCookie).toContain("max-age=0");
    expect(setCookie).toContain("SameSite=Lax");
    await app.close();
  });
});

describe("rate limit bucket hygiene", () => {
  // The 30s sweep interval is hard to exercise deterministically in unit
  // tests without exposing internals; the sweep is verified by reading the
  // code in src/services/rateLimit.ts. This case just confirms that
  // mass-inserting unique keys does not throw or stall the counter.
  it("handles many unique identifiers without throwing", () => {
    __resetRateLimitsForTests();
    for (let i = 0; i < 2_000; i += 1) {
      const result = checkRateLimit({
        scope: "test",
        identifier: `client-${i}`,
        limit: 5,
        windowMs: 60_000,
      });
      expect(result.allowed).toBe(true);
    }
  });
});
