# Production Readiness Status

Snapshot of the Langdock → Masumi wrapper's compliance with MIP-003
(Agentic Service API), MIP-004 (Decision Logging hashes), and the
Sokosumi marketplace listing requirements.

## Summary

| Area | Status | Notes |
|------|:------:|-------|
| MIP-003 `/start_job` | Done | Registers a sale, returns `blockchainIdentifier`, `agentIdentifier`, `sellerVKey`, `input_hash`, `payByTime`, `submitResultTime`, `unlockTime`, `externalDisputeUnlockTime`, `status`, `amounts`. |
| MIP-003 `/status` | Done | Returns `job_id`, `status`, `result`/`output`, `input_hash`, `output_hash`, `blockchain_identifier`, ISO timestamps. |
| MIP-003 `/availability` | Done | Returns `{status, type, message}`. Custom handler supported. |
| Operator `/ready` | Done | Central readiness report for required Langdock/Masumi env, pricing, schema, and payment windows. |
| MIP-003 `/input_schema` | Done | Served from `INPUT_SCHEMA_PATH` / `INPUT_SCHEMA_JSON` or a default `text` field. |
| MIP-003 `/provide_input` (HITL) | Not started | Out of scope for initial listing — add when an agent actually needs human-in-loop. |
| MIP-004 input hashing | Done | JCS + SHA-256 over the canonical `{key, value}` array form. |
| MIP-004 output hashing | Done | Computed in the runner after the handler returns. |
| Masumi Payment Service integration | Done | `MasumiPaymentClient` registers the sale, polls status, submits the result hash. |
| Payment-gated execution | Done | Handler only runs once `onChainState === FundsLocked`. |
| Agent registration on Masumi | Manual | Operator still registers the agent via the Payment Service admin UI / API to obtain `AGENT_IDENTIFIER` + `SELLER_VKEY`. |
| Sokosumi listing | Manual | Operator performs the listing once the registry transaction is confirmed. |
| Dev ("direct") mode | Done | `PAYMENT_MODE=direct` bypasses Masumi for local iteration. |
| Tests | Done | Vitest suites cover hashing, body normalisation, direct-mode flow, masumi-mode flow with mocked Payment Service, and readiness validation. |

## MIP-003 Endpoint Checklist

### `POST /start_job` — [src/routes/startJob.ts](src/routes/startJob.ts)
- [x] Accepts both `identifier_from_purchaser` / `identifierFromPurchaser`.
- [x] Accepts MIP-003 array form `[{key, value}]` **and** legacy object form.
- [x] Computes `input_hash` via MIP-004.
- [x] Registers a sale on the Masumi Payment Service (when `PAYMENT_MODE=masumi`).
- [x] Returns payment timing fields from the Payment Service response.
- [x] Echoes `agentIdentifier`, `sellerVKey`, `identifierFromPurchaser`.
- [x] Returns `status: "awaiting_payment"` per spec.
- [x] Fails fast (500/502) when agent not registered or Payment Service unreachable.

### `GET /status` — [src/routes/status.ts](src/routes/status.ts)
- [x] Reports MIP-003 statuses: `awaiting_payment`, `pending`, `running`, `completed`, `failed`, `refunded`.
- [x] Includes `input_hash` + `output_hash` when available.
- [x] 400 on missing `job_id`, 404 on unknown `job_id`.
- [x] Result mirrored as both `result` and `output` for client convenience.

### `GET /availability` — [src/routes/availability.ts](src/routes/availability.ts)
- [x] Always 200 with `{status: "available", type: "masumi-agent", message}`.
- [x] Custom handler override supported.

### `GET /input_schema` — [src/routes/inputSchema.ts](src/routes/inputSchema.ts)
- [x] Returns `{input_data: [...]}`.
- [x] Configurable via `INPUT_SCHEMA_PATH` or `INPUT_SCHEMA_JSON`.
- [x] Default schema exposes a single `text` string field.

### `GET /ready` — [src/routes/readiness.ts](src/routes/readiness.ts)
- [x] Returns 200 when production-critical config is ready.
- [x] Returns 503 with structured issues when required env, pricing, schema, or payment windows are invalid.
- [x] Uses the same validation module as startup enforcement and `npm run check:production`.

## MIP-004 Decision Logging

- Input hash: `SHA-256(UTF-8("identifier;" + JCS(input_data_array)))` — [src/services/hashing.ts](src/services/hashing.ts).
- Output hash: `SHA-256(UTF-8("identifier;" + outputAsString))` — computed after the handler resolves.
- Result hash is submitted on-chain via the Payment Service `submit-result` endpoint.

## Payment Flow

```
/start_job
    └─▶ MasumiPaymentClient.registerSale
            └─▶ POST /api/v1/payment/
                returns blockchainIdentifier + timings

   (HTTP 200 returned to buyer: status=awaiting_payment)

Background poller (src/services/jobRunner.ts)
    └─▶ GET /api/v1/payment/  every PAYMENT_POLL_INTERVAL_MS
         ├─ FundsLocked       → run handler
         ├─ RefundRequested / Disputed / Invalid → mark refunded
         └─ timeout (PAYMENT_POLL_TIMEOUT_MS)     → mark failed

Handler resolves
    └─▶ computeOutputHash
    └─▶ POST /api/v1/payment/submit-result
         └─ buyer can now unlock payment
```

## Remaining Work Before Going Live

1. **Register the agent on Masumi.** From the admin dashboard, create the selling wallet
   and call `POST /api/v1/registry/` to mint the agent NFT. Copy the resulting
   `agentIdentifier` and `sellerVKey` into `AGENT_IDENTIFIER` / `SELLER_VKEY`.
2. **Set real pricing.** Update `PRICE_AMOUNTS` to the tUSDM / USDCx amount your client wants to charge. Sokosumi expects 6-decimal raw token amounts with the token asset id as `unit`, not `lovelace`.
3. **Provide a real `INPUT_SCHEMA_JSON`** that matches what the Langdock agent expects — this is
   what Sokosumi shows buyers.
4. **Run the Masumi Payment Service node** alongside the wrapper (separate process, shared env).
5. **Preprod dry run.** Fund the purchasing wallet via the faucet, execute a real end-to-end
   buy → result → unlock cycle before switching `MASUMI_NETWORK` to `Mainnet`.
6. **Durable job store.** Current implementation is in-memory — fine for single-replica, but
   for HA swap `src/services/jobs.ts` for Redis or Postgres.
7. **Optional: `/provide_input`** for agents that expose HITL steps.
8. **Observability.** Fastify logger is on; add Prometheus metrics + tracing once this is
   deployed behind a real ingress.

## How to Test Locally

```bash
# Direct mode — no Masumi node, Langdock only.
cp .env.example .env
# fill in LANGDOCK_API_KEY, LANGDOCK_AGENT_ID
npm run dev

curl -X POST http://localhost:3000/start_job \
  -H "Content-Type: application/json" \
  -d '{"identifier_from_purchaser":"demo-1","input_data":[{"key":"text","value":"Hello"}]}'

curl "http://localhost:3000/status?job_id=<JOB_UUID>"
curl http://localhost:3000/availability
curl http://localhost:3000/input_schema
curl http://localhost:3000/ready
```

```bash
# Masumi mode — requires masumi-payment-service running on localhost:3001.
PAYMENT_MODE=masumi \
MASUMI_PAYMENT_SERVICE_URL=http://localhost:3001 \
MASUMI_PAYMENT_SERVICE_TOKEN=... \
AGENT_IDENTIFIER=... \
SELLER_VKEY=... \
npm run dev
```
