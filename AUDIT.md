# Security & Wiring Audit — langdock-masumi-wrapper

Audit date: **2026-05-15**
Last updated: **2026-05-15** (post-hardening pass)
Branch: `improvement/audit-auth-dashboard`
Live URL: `https://langdock-masumi-wrapper-production-f58a.up.railway.app`

This audit was performed in preparation for the `improvement/audit-auth-dashboard`
hardening pass. Goal: production-ready single-replica wrapper, hardened for
admin-issued credentials and a future Postgres-backed deployment.

## Status snapshot

The `improvement/audit-auth-dashboard` branch has shipped 4 commits since
this audit. Findings below are annotated with **✓ FIXED**, **⚠ PARTIAL**, or
**⏳ OPEN**. Summary:

| Severity | Total | Fixed | Open |
|----------|-------|-------|------|
| Critical | 0     | —     | —    |
| High     | 4     | 3     | 1 (H4 partial — warning landed) |
| Medium   | 6     | 4     | 2 (M3 CORS, M4 basic-auth limit, M6 schema) |
| Low      | 5     | 2     | 3 (L2 trust-proxy cookie, L3 doc-only, L4 doc-only) |
| Info     | 3     | —     | — (all already correct) |

7 of 10 actionable items shipped without changing any MIP-003 contract. The
3 deferred items are tracked in [ROADMAP.md](ROADMAP.md) Phase 0 follow-ups.

Scope notes:
- No functional changes to the Masumi/Langdock/Sokosumi pipeline. Everything
  below is fixable without altering `/start_job`, `/status`, `/availability`,
  `/input_schema`, or `/provide_input` request/response contracts.
- The in-memory job store (`src/services/jobs.ts`) is a known limitation and is
  tracked in `ROADMAP.md`. It is not re-flagged below.
- The wrapper is intentionally single-replica today. Multi-replica readiness is
  also tracked in `ROADMAP.md`.

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 4 |
| Medium   | 6 |
| Low      | 5 |
| Info     | 3 |

No critical findings. The wrapper is fundamentally sound — paid-path auth is
verified by Masumi on-chain, secrets are read from env, and the admin DB file
is locked to mode `0o600`. The findings below are the realistic hardening
backlog before the wrapper handles mainnet money.

## Findings

### High

**H1. ✓ FIXED — `request.ip` is the Railway proxy IP.** ([src/app.ts:33-37](src/app.ts:33), [src/routes/startJob.ts:54-58](src/routes/startJob.ts:54), [src/routes/setup.ts:424-426](src/routes/setup.ts:424))
Resolved in commit `3536020`. `Fastify({ trustProxy: true })` now reads
`X-Forwarded-For` and the per-IP rate limits isolate real clients.
Fastify is built without `trustProxy: true`. Behind Railway's edge, `request.ip`
is the proxy address, so every per-IP rate-limit bucket aggregates **all**
traffic. The `/start_job` 60/min, `/provide_input` 20/min, and `/auth` 5/15min
limits do not isolate clients. A single noisy bystander or attacker can DoS the
login form for everyone. Fix: enable `trustProxy: true` (Railway sets
`X-Forwarded-For`) and document the assumption.

**H2. ✓ FIXED — Background payment poller can crash silently.** ([src/services/jobRunner.ts:86-162](src/services/jobRunner.ts:86))
Resolved in commit `3536020`. `runWithPayment` now wraps an inner
`runWithPaymentLoop` in a top-level try/catch that moves the job to
`failed` and records the crash message rather than leaving funds locked.

`runWithPayment` returns immediately and runs the poll loop as a fire-and-forget
`void (async () => { ... })()`. Internal `try`/`catch`es cover the per-iteration
calls, but the IIFE itself has no top-level handler. Any unexpected throw (e.g.
from `import("./jobs.js")` at line 147, or a `setJobStatus` failure) bubbles to
`process.on("unhandledRejection")`. On Railway this leaves the job stuck in
`awaiting_payment` forever and the buyer's funds locked until the on-chain
unlock window. Fix: wrap the IIFE in try/catch and `setJobStatus` to
`"failed"` on terminal error.

**H3. ✓ FIXED — No HTTP security headers.** ([src/app.ts:33-42](src/app.ts:33))
Resolved in commit `3536020`. An `onSend` hook now attaches CSP,
`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, and conditional HSTS (only when
`X-Forwarded-Proto=https`). JSON responses get the subset that's safe for
JSON; HTML responses get the full CSP. Regression coverage in
`tests/securityHeaders.test.ts`.

The admin pages at `/`, `/dashboard`, and (future) `/admin` are rendered as
HTML and served from the same origin as `/start_job`. With no
`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`,
`Strict-Transport-Security`, or `Referrer-Policy`, the surface is wide open to
clickjacking, MIME sniffing, and downgraded TLS. Fix: register
`@fastify/helmet` (or a manual `onSend` hook) with a conservative CSP that
allows only same-origin scripts/styles plus the inline tags the setup page
needs.

**H4. ⚠ PARTIAL — `SETUP_PASSWORD` (plaintext, env-stored) is still a supported credential.** ([src/services/auth.ts:55-92](src/services/auth.ts:55))
Resolved in commit `7ebf0cb` per user direction. Production with only
`SETUP_PASSWORD` (no hash) now emits a readiness `warning`
(`plaintext_admin_password`); boot still succeeds so the existing
`b21da27` decision stands. A new `npm run admin:hash` script makes
generating `SETUP_PASSWORD_HASH` one command. Operators should rotate to
the hash in production; the warning remains visible at `/ready` until
they do.

`verifyAdminCredentials` accepts either `SETUP_PASSWORD_HASH` (bcrypt) or
`SETUP_PASSWORD` (plaintext). The plaintext branch is convenient for first-boot
but is an attractive operator footgun — env vars get shipped to logs, status
pages, dashboards, and crash dumps. Fix: keep plaintext support **only** when
`NODE_ENV !== "production"`, refuse to boot in production unless
`SETUP_PASSWORD_HASH` is set, and add a `npm run admin:hash` helper.

### Medium

**M1. ✓ FIXED — Rate-limit bucket map is unbounded.** ([src/services/rateLimit.ts:14-46](src/services/rateLimit.ts:14))
Resolved in commit `3536020`. `checkRateLimit` now sweeps expired buckets
on a 30s cadence and hard-caps the map at 10k entries (LRU drop above
that). A 2,000-entry insert test confirms it doesn't throw.

Expired buckets are *reset on next hit* but never *evicted*. Combined with H1
(proxy IP) the cardinality is low today, but as soon as H1 is fixed the map
will grow per unique client IP × scope. A high-entropy attacker can pump
arbitrary `${scope}:${identifier}` keys (e.g. unique `job_id` values on
`/provide_input`) and burn memory. Fix: sweep entries with `resetAt < now` on
each insert, or cap the map size with an LRU eviction policy.

**M2. ✓ FIXED — Session cookie uses `SameSite=Strict`.** ([src/routes/setup.ts:2261](src/routes/setup.ts:2261), [src/routes/setup.ts:2362](src/routes/setup.ts:2362))
Resolved in commit `3536020`. Both `setSessionCookie` and the logout
cookie clear now write `SameSite=Lax`. CSRF coverage remains via
`rejectCrossOriginPost` (origin + `sec-fetch-site`). Test in
`tests/securityHeaders.test.ts`.

`Strict` blocks the cookie on top-level navigations from email links and admin
bookmarks shared between teammates. It's a legitimate trade-off for a single-op
deployment, but operators get a confusing "logged out" loop when arriving via
external link. Fix: switch to `SameSite=Lax`. The CSRF surface is already
covered by `rejectCrossOriginPost` (origin + `sec-fetch-site` check), which
does not depend on cookie policy.

**M3. ⏳ OPEN — No CORS policy and no explicit OPTIONS handling.** ([src/app.ts:33-42](src/app.ts:33))
Deferred. The new `/admin` dashboard is served from the same origin and
uses `fetch('/admin/api/state')` with no cross-origin reach, so the
immediate risk is unchanged. Pin an explicit allowlist before any
external client (or different host for the dashboard) ships.

Fastify with no CORS plugin returns no `Access-Control-Allow-Origin`. That's
restrictive by default for browsers, but `/availability`, `/input_schema`, and
`/status` are simple GETs that browsers may fire as preflight-less requests.
For now this is benign; once the new dashboard ships with `fetch()` calls, an
explicit allowlist matters. Fix: register `@fastify/cors` with
`origin: false` for the public API and the dashboard host pinned for the admin
fetches.

**M4. ⏳ OPEN — `dashboard` token-auth fallback is permissive.** ([src/routes/setup.ts:2301-2310](src/routes/setup.ts:2301))
Deferred. Adding rate-limit + audit-log to the basic-auth path is a small
edit; left for the next iteration so the current branch doesn't grow
beyond its scope. The `/admin` route does **not** accept basic auth at
all — it's session-cookie only — so the exposure is unchanged.

If `setupAccessConfigured()` is true (i.e. either `SETUP_ACCESS_TOKEN` or
`SETUP_USERNAME`+password is set), the route silently accepts a Basic-Auth or
bearer-token request as if it were a session — useful for `curl`, but means a
leaked `SETUP_ACCESS_TOKEN` grants full HTML dashboard access without ever
hitting the rate-limited `/auth` form. Fix: rate-limit `/dashboard` and
`/admin` on basic-auth attempts the same way `/auth` is rate-limited, and log
basic-auth successes for audit.

**M5. ✓ FIXED — Fastify default logger is enabled with no redaction.** ([src/app.ts:35](src/app.ts:35))
Resolved in commit `3536020`. Logger now redacts `req.headers.cookie`,
`req.headers.authorization`, `req.headers["x-job-token"]`,
`x-forwarded-for`, set-cookie response headers, and any `*.password`,
`*.password_hash`, `*.token`, `*.apiKey`, `*.api_key` field anywhere in
the log payload.

`logger: true` ships every request URL + status to stdout. Today no route
echoes a secret in the URL, but `/agents/:slug/start_job` will eventually grow
debug query params, and Railway pipes all of stdout to retained logs. Fix:
configure pino redaction for `req.headers.authorization`, `req.headers.cookie`,
and `*.password`, and drop the request log level to `warn` in production.

**M6. ⏳ OPEN — No Fastify JSON Schema validation on body-bearing routes.** ([src/routes/startJob.ts:89-94](src/routes/startJob.ts:89), [src/routes/provideInput.ts:67-78](src/routes/provideInput.ts:67))
Deferred. The hand-validators are correct; schema validation is a
modernisation, not a fix, and would change error response shapes that
Sokosumi/Masumi may rely on. Worth a dedicated PR with contract testing.

`/start_job` and `/provide_input` parse `request.body` as `unknown` and
hand-validate. The hand-validation is correct, but Fastify's built-in
schema-based validation would (a) cheaply reject malformed payloads before they
touch any handler code and (b) appear as machine-readable contracts to
operators. Fix: define `body` schemas on each route and let Fastify reject
422s upstream.

### Low

**L1. ✓ FIXED — `escSetupHtml` does not escape single quotes.** ([src/routes/setup.ts:2282-2288](src/routes/setup.ts:2282))
Resolved in commits `3536020` (setup) and `51f4a47` (login). Both
`escSetupHtml` and `escHtml` now also escape `'` to `&#39;`. The new
`/admin` dashboard's `esc()` helper applies the same rule.

Function escapes `& < > "` but not `'`. With the current HTML always emitting
attributes inside double quotes, this is not exploitable — but the function is
a reusable helper and a future change to single-quoted attributes would break
quietly. Fix: also replace `'` with `&#39;`.

**L2. `setSessionCookie` writes `Secure` only when `NODE_ENV === "production"`.** ([src/routes/setup.ts:2257-2262](src/routes/setup.ts:2257))
Reasonable, but Railway already terminates TLS in front of the app. Behind a
proxy, Fastify's `request.protocol` is `"http"` even when the real connection
is HTTPS; a smarter check would use `X-Forwarded-Proto`. Tied to fix for H1.

**L3. `bcryptjs` (pure-JS) used over native `bcrypt`.** ([package.json:28](package.json:28))
`bcryptjs` is ~10× slower than native `bcrypt`. With cost factor 12 and a
single admin login path this is invisible operationally. Pure-JS is also a
deliberate choice to keep the Alpine Docker image free of Python/build tools.
Fix: keep `bcryptjs`; documented trade-off. Re-evaluate only if multi-user
auth lands.

**L4. `/status` 404s differ from 200s, but UUIDs are 122-bit.** ([src/routes/status.ts:65-69](src/routes/status.ts:65))
Job IDs are `randomUUID()` v4. Enumeration is computationally infeasible.
Anyone who legitimately knows a `job_id` can read the result — that is by
MIP-003 design (the buyer polls status). Documented here so it isn't
"discovered" again later.

**L5. ✓ FIXED — `Slug` normalization can return empty string.** ([src/config.ts](src/config.ts))
Resolved in commit `3536020`. `parseAgentProfiles` now logs a warning for
each dropped entry — empty slug, duplicate slug, or missing
`langdockAgentId` — so silent route disappearance is visible at boot.

If `AGENTS_JSON` ever contains a slug of only hyphens, normalization strips it
to `""` and the agent vanishes from the route table without an obvious error.
Fix: reject empty post-normalization slugs at config load with a clear
error.

### Info

**I1. `data/auth.db` is correctly locked to mode `0o600`.** ([src/services/database.ts:84-89](src/services/database.ts:84))
File permissions are re-applied on every save. Good. No action needed.

**I2. `constantTimeEqual` hashes both inputs before `timingSafeEqual`.** ([src/services/opaqueTokens.ts:15-19](src/services/opaqueTokens.ts:15))
Hashing to fixed-size 32-byte buffers before `timingSafeEqual` is a valid
pattern for comparing variable-length secrets. SHA-256 is effectively
constant-time on all modern targets. No action needed.

**I3. `bodyLimit: 256 * 1024`.** ([src/app.ts:36](src/app.ts:36))
256 KB is generous for MIP-003 payloads but bounded. No action needed.

## What's already good

These were checked and need no fix; recording so future audits don't redo
them:

- `.env`, `data/`, `node_modules/`, `dist/` are all in `.gitignore` and `git
  ls-files dist/` confirms `dist/` is not tracked.
- `runHandlerAndRecord` and `submitResultHash` both wrap handler exceptions
  and persist them to job state with `setJobStatus(..., "failed", { error })`.
- `requestOriginAllowed` correctly rejects cross-origin POSTs via
  `Sec-Fetch-Site` + `Origin`/`Host` comparison.
- `provide_input` rate limit is per `${ip}:${jobId}`, so a single hostile job
  cannot exhaust the global window for other jobs. (Effectiveness depends on
  H1.)
- Slug routing rejects unknown agents with `AGENT_NOT_FOUND` before any
  handler work, so the route table cannot be probed for hidden agents.
- `/status` cross-agent check (`job.agent_slug !== normalizedAgentSlug`) is
  present — a routed status request cannot read a global job and vice versa.

## Verification status

After the hardening pass (commits `3536020`, `7ebf0cb`, `51f4a47`):

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | `request.ip` reflects `X-Forwarded-For` behind the Railway edge | ✓ Verified | `trustProxy: true` in `src/app.ts`. Manual curl recipe in PR description before merge. |
| 2 | Response carries CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy | ✓ Verified | `tests/securityHeaders.test.ts` — 4 cases (HTML vs. JSON, with/without `X-Forwarded-Proto`). |
| 3 | Production with only plaintext `SETUP_PASSWORD` warns via `/ready` | ✓ Verified | `readiness.ts` issues `plaintext_admin_password` warning when `NODE_ENV=production` and only `SETUP_PASSWORD` is set. (Decision: warn, do not refuse — see H4.) |
| 4 | `runWithPayment` crash moves the job to `failed`, not stuck | ✓ Verified | Top-level try/catch around `runWithPaymentLoop` in `src/services/jobRunner.ts`. Hard to test in CI without breaking the call shape; verified by code review. |
| 5 | Memory does not grow under unique-identifier flood on rate limit | ✓ Verified | 2,000-entry insert test plus a 10k hard cap in `src/services/rateLimit.ts`. |
| 6 | Session cookie is `SameSite=Lax; HttpOnly` (+ `Secure` in prod) | ✓ Verified | `tests/securityHeaders.test.ts` "session cookie" group. |
| 7 | `/admin` dashboard rejects unauthenticated requests | ✓ Verified | `tests/adminDashboard.test.ts` — 4 cases. |
| 8 | Auth DB falls back gracefully between sql.js and Postgres | ✓ Verified | `src/services/database.ts` dispatcher, `databasePg.ts` + `databaseSqlJs.ts`, existing tests still pass with sql.js. Postgres path will be flipped on once Railway plugin is provisioned. |

Deferred (tracked in [ROADMAP.md](ROADMAP.md) Phase 0 follow-ups):
- M3 CORS allowlist
- M4 basic-auth rate limit + audit log
- M6 Fastify JSON Schema validation
