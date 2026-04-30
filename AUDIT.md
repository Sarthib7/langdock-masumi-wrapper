# Wiring Audit

Date: 2026-04-30

This audit checks the Langdock -> Masumi wrapper wiring against the Masumi SaaS /
payment-node contract used by the reference implementations.

## Result

Status: production-ready for a single-replica wrapper once real secrets are set.

Verified locally:

- `npm run build`
- `npm test`

`npm run check:production` is expected to fail on a developer machine until
`LANGDOCK_API_KEY`, `LANGDOCK_AGENT_ID`, and live Masumi credentials are set.

## Endpoint Wiring

| Surface | Implementation | Status |
|---------|----------------|--------|
| Public `POST /start_job` | [`src/routes/startJob.ts`](src/routes/startJob.ts) | Computes MIP-004 input hash, creates a Masumi payment request, stores the job, then starts payment-gated execution. |
| Public `GET /status` | [`src/routes/status.ts`](src/routes/status.ts) | Returns in-memory job state, hashes, result, timestamps, and blockchain identifier. |
| Public `GET /availability` | [`src/routes/availability.ts`](src/routes/availability.ts) | Health endpoint for marketplace checks. |
| Public `GET /input_schema` | [`src/routes/inputSchema.ts`](src/routes/inputSchema.ts) | Serves MIP-003 input schema from env/file/default. |
| Operator `GET /ready` | [`src/routes/readiness.ts`](src/routes/readiness.ts), [`src/services/readiness.ts`](src/services/readiness.ts) | Validates production env, payment windows, dynamic pricing syntax, and input schema. |
| Default Langdock handler | [`src/services/langdockStartJob.ts`](src/services/langdockStartJob.ts), [`src/services/langdock.ts`](src/services/langdock.ts) | Calls Langdock chat completions with server-side credentials. |
| Payment poller / runner | [`src/services/jobRunner.ts`](src/services/jobRunner.ts) | Waits for locked funds, runs the agent, computes output hash, submits result hash. |

## Masumi API Contract

`PAYMENT_SERVICE_URL` must include the API prefix:

- Masumi SaaS: `https://<host>/pay/api/v1`
- Direct payment node: `https://<host>/api/v1`

The payment client calls these paths relative to that base URL:

| Action | Method + path | Implementation |
|--------|---------------|----------------|
| Create payment request | `POST /payment` | [`MasumiPaymentClient.registerSale`](src/services/masumiPayment.ts) |
| Resolve payment by blockchain identifier | `POST /payment/resolve-blockchain-identifier` | [`MasumiPaymentClient.getPaymentStatus`](src/services/masumiPayment.ts) |
| Submit result hash | `POST /payment/submit-result` | [`MasumiPaymentClient.submitResult`](src/services/masumiPayment.ts) |

Authentication:

- Masumi SaaS uses `x-api-key`.
- Direct payment-node uses `token`.
- [`loadConfig`](src/config.ts) auto-selects `x-api-key` when the base URL contains `/pay/api/v1`; otherwise it defaults to `token`.
- `PAYMENT_API_AUTH_HEADER` can override this with `x-api-key` or `token`.

## Fixed During This Audit

- Rejected invalid `identifier_from_purchaser` values before calling Masumi in `PAYMENT_MODE=masumi`. The payment API requires lowercase hex, 14-26 chars.
- Added readiness errors for invalid `NETWORK`, invalid `PAYMENT_API_AUTH_HEADER`, and invalid non-empty `PRICE_AMOUNTS`.
- Added a readiness warning when `PAYMENT_SERVICE_URL` does not include `/pay/api/v1` or `/api/v1`.
- Confirmed the client does not send obsolete `paymentType` or `amounts` fields to `POST /payment`; optional dynamic pricing is sent as `RequestedFunds`.

## Residual Risks

- Jobs are stored in memory. Use one replica only, or replace [`src/services/jobs.ts`](src/services/jobs.ts) with Redis/Postgres before HA deployment.
- The wrapper cannot prove the Masumi admin-side agent registration is finalized. Confirm the agent is visible/registered before listing on Sokosumi.
- Direct mode is for development only. Production readiness blocks `PAYMENT_MODE=direct` when `NODE_ENV=production`.
