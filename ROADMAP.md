# Roadmap — langdock-masumi-wrapper

Last updated: **2026-05-15**

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
| 0 | Audit + hardening (`improvement/audit-auth-dashboard` branch) | In progress |
| 1 | Admin-issued login + Railway Postgres | Planned |
| 2 | Read-only admin dashboard | Planned |
| 3 | Durable job store on Postgres | Planned |
| 4 | Mainnet enablement | Planned |
| 5 | Observability + on-call | Planned |
| 6 | Optional: multi-tenant logins | Aspirational |

---

## Phase 0 — Audit + hardening (this branch)

Source of truth: [AUDIT.md](AUDIT.md).

Ship before merging:

- [ ] H1 trust proxy fix (`trustProxy: true`, doc the Railway assumption)
- [ ] H2 background poller crash safety (top-level try/catch in
      `runWithPayment`)
- [ ] H3 security headers via `@fastify/helmet`
- [ ] H4 refuse plaintext `SETUP_PASSWORD` in production, add `admin:hash`
      script
- [ ] M1 rate-limit bucket sweep / LRU
- [ ] M2 cookie `SameSite=Lax`
- [ ] M3 explicit CORS
- [ ] M4 rate-limit basic-auth path
- [ ] M5 pino redaction
- [ ] M6 JSON Schema validation on body routes
- [ ] L1 escape `'` in `escSetupHtml`
- [ ] L5 reject empty normalized slugs
- [ ] Vitest cases for each fix that is testable in CI

Out of scope for Phase 0: any DB migration, any UI redesign, any new route.

## Phase 1 — Admin-issued login + Railway Postgres

Today the auth DB is `sql.js` reading and writing `data/auth.db` on the
Railway container. That works for one replica but the file is ephemeral on
Railway redeploys (no volume), which means **the admin DB resets on every
deploy.** Today this is masked because the admin login also falls through to
env-var credentials.

Plan:

1. **Provision Railway Postgres plugin.** One click in the Railway project,
   `DATABASE_URL` is injected automatically.
2. **Add Postgres adapter** behind the existing `database.ts` interface. When
   `DATABASE_URL` is set, use `pg`. Otherwise keep `sql.js` for local dev.
   This is the boundary; no other code changes.
3. **Migration script** (`scripts/migrate-auth.mjs`):
   - On first run, create `users` + `sessions` tables.
   - If `data/auth.db` exists locally, copy its rows over so dev → prod is
     painless.
4. **Admin issues credentials**, no self-signup:
   - `npm run admin:create-user -- --username alice --display "Alice"`
     prompts for a password, bcrypts it, inserts a row.
   - Setup page shows the list of admins (read-only) and a "rotate password"
     button that opens a CLI hint, not a form.
5. **Keep the env-var `SETUP_USERNAME` / `SETUP_PASSWORD_HASH` as a
   break-glass admin** — useful if the DB is empty after a fresh deploy. Plain
   `SETUP_PASSWORD` rejected in production (per H4).

Acceptance:
- `psql $DATABASE_URL -c "select count(*) from users"` works.
- Logging in with a DB-issued user creates a session row in Postgres.
- Redeploying Railway does not log anyone out (session table survives).

Risk: Postgres outage takes the dashboard offline. The MIP-003 paid path does
not depend on the DB, so customer-facing functionality is unaffected. This is
acceptable.

## Phase 2 — Read-only admin dashboard (`/admin`)

A new authenticated page at `/admin`, gated by the same session cookie. The
existing `/setup` keeps working for config + sale registration; `/admin` is
purely for *observing* live state.

Initial widgets:
- **Agents.** Each configured agent: slug, agentIdentifier, sellerVKey,
  current pricing, "available" indicator (calls `/availability` internally).
- **Recent jobs.** Last 50 from the in-memory store (Phase 3 promotes to
  Postgres). Show: job_id, agent slug, status, on-chain state,
  `awaiting_input` flag, age. Click a row → JSON detail drawer.
- **Payment health.** One probe per minute against
  `paymentServiceUrl/health` (or `/balance`), shown as a green/red dot.
- **Audit log.** Last 50 admin actions (login, logout, sale registration,
  setup edits). Sourced from Postgres `audit_log` table (new in Phase 1).

Explicitly not in scope for v1:
- No write actions besides logout. Restarting jobs, refunding, etc., come
  later or stay CLI-only.
- No charts. Single-page dashboard, no real-time push, polls on a 5-second
  interval.

Style:
- Same dark/light theme already in `/setup`.
- No bundler. The page is one HTML response with inline `<style>` and
  inline `<script>` (Fastify renders strings — no build step needed).
- Use the `@fastify/static` plugin only if we need to ship icons.

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
