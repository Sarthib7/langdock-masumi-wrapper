# Roadmap — langdock-masumi-wrapper

Last updated: **2026-05-15** (after `improvement/audit-auth-dashboard` commits 1–4)

This roadmap tracks the path from "working Preprod wrapper" → "production
Mainnet wrapper with admin-issued logins and a real ops dashboard."

The Preprod deployment at
`https://langdock-masumi-wrapper-production-f58a.up.railway.app` must keep
serving the four live agents (`lexi`, `emil-conrad`, `diddy-p`,
`food-co2-analyst`) through every milestone below. Nothing on this roadmap
changes the MIP-003 contract; behind-the-scenes work only.

## Milestones at a glance

| Phase | Theme | Status |
|-------|-------|--------|
| 0 | Audit + hardening (`improvement/audit-auth-dashboard` branch) | ✓ Code shipped, pending review/merge |
| 1 | Admin-issued login + Railway Postgres | ⚠ Adapter shipped, plugin not yet provisioned |
| 2 | Read-only admin dashboard | ✓ v1 shipped (`/admin`), polish remaining |
| 3 | Durable job store on Postgres | Planned |
| 4 | Mainnet enablement | Planned |
| 5 | Observability + on-call | Planned |
| 6 | Optional: multi-tenant logins | Aspirational |

---

## Phase 0 — Audit + hardening (this branch)

Source of truth: [AUDIT.md](AUDIT.md). All shipped in commits `0c8bef0`,
`3536020`, `7ebf0cb`, `51f4a47` on `improvement/audit-auth-dashboard`.

Done:
- [x] H1 trust proxy (`trustProxy: true` in `src/app.ts`).
- [x] H2 background poller crash safety (top-level try/catch in
      `runWithPayment` → `runWithPaymentLoop`).
- [x] H3 security headers (CSP, frame, sniff, referrer, conditional HSTS)
      via `onSend` hook. No new dep — kept the surface minimal.
- [x] H4 readiness *warning* for plaintext `SETUP_PASSWORD` in production
      (deliberate: keeps the `b21da27` decision). Added `npm run admin:hash`.
- [x] M1 rate-limit bucket sweep + 10k hard cap.
- [x] M2 cookie `SameSite=Lax`.
- [x] M5 pino redaction (cookies, authorization, tokens, password fields).
- [x] L1 escape `'` in `escSetupHtml`, `escHtml`, and the new dashboard `esc`.
- [x] L5 boot-time warning when an `AGENTS_JSON` entry is dropped.
- [x] Vitest coverage: `tests/securityHeaders.test.ts`,
      `tests/adminDashboard.test.ts`. 80/80 green.

Follow-ups deferred to a future PR (NOT blockers for merge):
- [ ] M3 explicit CORS allowlist (do this once the dashboard's allowed
      origins are pinned down).
- [ ] M4 rate-limit + audit log on the basic-auth `/dashboard` path.
- [ ] M6 Fastify JSON Schema validation on body routes — needs contract
      testing before changing error response shapes Sokosumi/Masumi may
      depend on.

Out of scope for Phase 0: any DB migration, any UI redesign, any new route.
(Phase 1 + Phase 2 partially shipped on the same branch — see below.)

## Phase 1 — Admin-issued login + Railway Postgres

Today the auth DB is `sql.js` reading and writing `data/auth.db` on the
Railway container. That works for one replica but the file is ephemeral on
Railway redeploys (no volume), which means **the admin DB resets on every
deploy.** Today this is masked because the admin login also falls through to
env-var credentials.

Done in commit `7ebf0cb`:
- [x] **Postgres adapter** behind the existing `database.ts` interface. The
      module is a thin dispatcher: `DATABASE_URL` set → `databasePg.ts`,
      otherwise `databaseSqlJs.ts`. Public exports
      (`createUser`, `findUserByUsername`, `createSession`, etc.) unchanged.
- [x] **Migration script** at `scripts/migrate-auth.mjs`. Run:
      `npm run db:migrate-auth` (schema only) or
      `npm run db:migrate-auth -- --copy-from-sqljs` to lift existing
      `data/auth.db` rows into Postgres. Idempotent.
- [x] **Admin-issues-credentials CLIs**:
      - `npm run admin:create-user -- --username alice --display "Alice"`
        prompts for a password, bcrypts (cost 12), inserts or rotates.
      - `npm run admin:hash` prints a bcrypt hash for `SETUP_PASSWORD_HASH`.

Still pending — needs your hands, not code:

1. **Provision the Railway Postgres plugin** on the project (one click).
   `DATABASE_URL` lands in env automatically.
2. **Run `npm run db:migrate-auth -- --copy-from-sqljs`** once locally (or
   from a one-off Railway run) pointed at the new DB to lift any users +
   sessions out of `data/auth.db`. Idempotent.
3. **Issue first admin login**:
   `npm run admin:create-user -- --username <you> --display "<name>"`.
4. **(Optional)** Replace plaintext `SETUP_PASSWORD` with
   `SETUP_PASSWORD_HASH` via `npm run admin:hash` to silence the production
   readiness warning.
5. **Setup page UI for listing admins** — read-only list of DB-backed admins
   with a "rotate password" hint pointing at the CLI. Deferred to a small
   follow-up commit; the CLI is already enough to operate.

Acceptance for "done":
- `psql $DATABASE_URL -c "select count(*) from users"` works.
- Logging in with a DB-issued user creates a session row in Postgres.
- Redeploying Railway does not log anyone out (session table survives).

Risk: Postgres outage takes the admin dashboard offline. The MIP-003 paid
path does not depend on the DB, so customer-facing functionality is
unaffected. Acceptable.

## Phase 2 — Read-only admin dashboard (`/admin`)

A new authenticated page at `/admin`, gated by the same session cookie. The
existing `/setup` keeps working for config + sale registration; `/admin` is
purely for *observing* live state.

v1 shipped in commit `51f4a47`:

- [x] **Agents** card — each configured agent: slug, name, description,
      `agentIdentifier`, `apiBaseUrl`, price tags. Handles the legacy
      single-agent case (no `AGENTS_JSON`) as well.
- [x] **Recent jobs** table — newest 50 from the in-memory store with
      status badges, agent slug, started/finished relative timestamps,
      job-id ellipsis on hover.
- [x] **Payment health** card — probe of
      `PAYMENT_SERVICE_URL/health` with a 30-second cache. Shows
      reachable/HTTP status/latency, with an error message when
      unreachable.
- [x] **Overview cards** — totals for jobs, awaiting_payment,
      awaiting_input, running, completed, failed/refunded.
- [x] **Session-gated** with a 401 from `/admin/api/state` and a redirect
      from `/admin`. Reuses the existing session cookie.
- [x] **5-second polling** on `/admin/api/state` for live updates.
- [x] **Style** matches the existing `/setup` palette and dark-mode rules.
      No bundler. Single Fastify HTML response with inline CSS + JS.

Out of scope for v1, deferred:
- [ ] **Job detail drawer.** Click a row → JSON modal showing the full
      `JobRecord`, with on-chain status and HITL history.
- [ ] **Audit log.** Last 50 admin actions (login, logout, sale
      registration, setup edits). Needs a new `audit_log` Postgres table
      (Phase 3 territory).
- [ ] **Refund / retry buttons.** Out of scope until the in-memory store is
      replaced (Phase 3).
- [ ] **`/availability` probe per agent** alongside the global payment
      health probe — currently only the payment service is probed.

Explicit non-goals (still):
- No write actions besides logout.
- No charts. Polling-based, no real-time push.

## Phase 3 — Durable job store on Postgres

After Phase 1 lands Postgres, the in-memory `jobs.ts` map is the last piece
that resets across deploys. The current flow can lose HITL state on redeploy
(see `tasks.md` line 91-93). Plan:

1. Add a `jobs` table mirroring the existing `JobRow` shape.
2. Replace `jobs.ts` `Map` with parameterized queries.
3. Keep the interface identical (`createJob`, `getJob`, `setJobStatus`) — no
   handler-level changes.
4. Migrate the in-memory `awaiting_input_*` fields to a JSONB column so the
   provide_input matcher continues to work.
5. Add a daily cron in the same Fastify process to delete jobs older than 30
   days that aren't `awaiting_input`. Configurable via `JOB_RETENTION_DAYS`.

Acceptance:
- Redeploying Railway preserves `awaiting_input` jobs end-to-end.
- After 30 days, a completed job no longer appears in `/admin` (assuming the
  cron has run).

After Phase 3, the wrapper is multi-replica safe **except for** the in-flight
`runWithPayment` poller. That stays single-replica for now; locking work is in
Phase 4.

## Phase 4 — Mainnet enablement

The current wiring uses `NETWORK=Preprod` and a Preprod Masumi node. To run
real money against Cardano Mainnet, the changes are mostly operational, not
code:

1. **Mainnet payment node.** Either:
   - Provision Masumi SaaS Mainnet credentials (preferred), or
   - Run a dedicated payment node connected to a Mainnet Cardano node.
   Either way, `PAYMENT_SERVICE_URL` and `PAYMENT_API_KEY` point at Mainnet.
2. **Mainnet wallet.** Real `SELLER_VKEY` + funded collection wallet.
   Operationally: cold-key the master, hot-key only the seller signing key,
   document recovery procedure.
3. **Mainnet asset units.** Replace Preprod tUSDM unit
   (`16a55b2a...0014df10745553444d`) with the Mainnet USDM unit. Price
   amounts in `AGENTS_JSON` change accordingly.
4. **Pricing review.** Each of the four live agents needs a sign-off on its
   real-money price. Document the per-agent price in `README.md`.
5. **`NETWORK=Mainnet` env flip.** `loadConfig` already validates this.
6. **Re-register on Masumi Mainnet registry**, not Preprod. Sokosumi Mainnet
   listing is a separate manual step.
7. **Re-verify the full create-job-pay-result loop on Mainnet** with a tiny
   internal job before publicising the new listings.
8. **Roll out per-agent** rather than all four at once. `lexi` first as the
   canary.

Pre-flight checklist (CI gate before allowing `NETWORK=Mainnet` to boot):
- Postgres-backed users + sessions (Phase 1 done).
- Postgres-backed jobs (Phase 3 done).
- `H1`–`H4` hardening fixes deployed and verified.
- Sentry / paging configured (Phase 5).
- A documented incident-response runbook.

Mainnet is **explicitly blocked** until Phase 1, 3, and 5 ship.

## Phase 5 — Observability + on-call

Once real funds are at stake:

1. **Structured logging.** Replace `console.log`s with the Fastify pino
   logger throughout. Redacted (per M5).
2. **Sentry** (or equivalent): unhandled rejections in `runWithPayment`, all
   `MasumiPaymentError`s, all 500s.
3. **Health probes** beyond `/availability`: a `/internal/health` that checks
   DB connectivity, payment-service reachability, and last poller heartbeat.
4. **Metrics.** Per-agent job counts, p50/p99 handler latency, Masumi
   error-rate per endpoint. Expose at `/internal/metrics` (Prometheus format
   if we use Grafana, JSON otherwise).
5. **Alerting.** "Any 5xx in last 5 min", "any unhandled rejection", "payment
   service returned non-2xx for 3 consecutive polls."
6. **Runbook.** A `RUNBOOK.md` covering common failures (Masumi node down,
   Langdock 429s, DB connection storms, leaked admin token rotation).

## Phase 6 — Optional: multi-tenant logins

Aspirational. If the wrapper ever serves multiple agent owners who each see
only their own agents/jobs:

- `users` gains an `org_id`. Same for `jobs`.
- Routes that read state filter by the session's org.
- Per-org agents controlled by an `agents` table, not `AGENTS_JSON`.

Not on the immediate path. Flag only if a real second tenant shows up.

---

## Non-goals (explicit)

- **Self-signup.** Admin issues credentials. No public registration form.
- **HA / multi-replica today.** Phase 3 unlocks read-replica safety but the
  payment poller stays single-replica.
- **Custom UI framework.** No React/Vue/Svelte. Plain HTML + inline JS keeps
  the build trivial and the security surface small.
- **Mobile app.** The dashboard is browser-only.
- **In-product payments.** Buyers pay on-chain through Masumi; the wrapper
  never handles fiat or wallet keys beyond the seller signing key in env.
