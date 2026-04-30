# Langdock → Masumi wrapper

Fastify service that exposes any Langdock agent (or any async AI workload) as a
MIP-003-compliant Masumi agent, ready to list on [Sokosumi](https://app.sokosumi.com).

It implements:

- `POST /start_job`   — registers a sale on the Masumi Payment Service, returns
  `blockchainIdentifier` + payment timings, defers execution until funds are locked.
- `GET  /status`      — MIP-003 payload with `input_hash`, `output_hash`, result, timestamps.
- `GET  /availability` — health for load balancers / marketplace checks.
- `GET  /input_schema` — schema shown to buyers on Sokosumi.
- `GET  /ready` — operator readiness report for missing production secrets/config.

MIP-004 hashing (JCS + SHA-256) is applied to both `input_data` and the handler's output,
and the output hash is submitted on-chain via the Payment Service so buyers can unlock
payment.

See [STATUS.md](STATUS.md) for the production-readiness checklist and
[AUDIT.md](AUDIT.md) for the route/env/payment wiring audit.

## Architecture

```
┌──────────┐  POST /start_job  ┌────────────────────┐  POST /payment              ┌────────────────────────┐
│  Buyer   │ ────────────────▶ │ Wrapper (this app) │ ──────────────────────────▶ │ Masumi SaaS / Payment  │
└──────────┘                   │                    │ ◀── blockchainIdentifier ── │        Service         │
                               │   poller loop      │                             └─────────┬──────────────┘
                               │                    │ POST /payment/resolve-                │ on-chain escrow
                               │                    │      blockchain-identifier            │
                               │   FundsLocked?     │ ──────────────────────────▶            ▼
                               │                    │                             ┌────────────────────────┐
                               │   run handler      │                             │   Cardano Preprod /    │
                               │   compute hash     │                             │        Mainnet         │
                               │                    │ POST /payment/             └────────────────────────┘
                               │                    │      submit-result
                               └────────────────────┘
                                        │
                                        │ POST /agent/v1/chat/completions
                                        ▼
                               ┌────────────────────┐
                               │   Langdock API     │
                               └────────────────────┘
```

## Install

```bash
npm install
cp .env.example .env
# fill in the values below
```

### Environment

| Var | Purpose |
|-----|---------|
| `LANGDOCK_API_KEY` | Server-side Langdock API key. Never expose to the browser. |
| `LANGDOCK_AGENT_ID` | Target Langdock agent ID. |
| `AGENT_IDENTIFIER` | Masumi NFT-backed agent identifier (from the Payment Service registry). |
| `SELLER_VKEY` | Selling wallet verification key (from the Payment Service admin UI). |
| `PAYMENT_MODE` | `masumi` (default when URL is set — production) or `direct` (local dev, skips escrow). |
| `PAYMENT_SERVICE_URL` | API base URL. Use Masumi SaaS `/pay/api/v1` or direct payment-node `/api/v1`. |
| `PAYMENT_API_KEY` | Masumi SaaS API key or direct Payment Service token. |
| `PAYMENT_API_AUTH_HEADER` | Optional override: `x-api-key` for SaaS, `token` for direct node. Auto-detected from the URL. |
| `NETWORK` | `Preprod` or `Mainnet`. |
| `PRICE_AMOUNTS` | Optional dynamic `RequestedFunds` JSON array. Leave empty for fixed pricing configured in Masumi SaaS/admin. |
| `INPUT_SCHEMA_PATH` / `INPUT_SCHEMA_JSON` | MIP-003 schema served at `/input_schema`. |
| `REQUIRE_PRODUCTION_CONFIG` | Set `true` to make startup fail until production env is complete. Also enforced automatically when `NODE_ENV=production` or `PAYMENT_MODE=masumi`. |

Full list in [.env.example](.env.example).

### Wiring Map

| Concern | File |
|---------|------|
| Env loading and auth-header selection | [src/config.ts](src/config.ts) |
| MIP-003 routes | [src/routes/index.ts](src/routes/index.ts) |
| Payment API client | [src/services/masumiPayment.ts](src/services/masumiPayment.ts) |
| Payment-gated job runner | [src/services/jobRunner.ts](src/services/jobRunner.ts) |
| Production readiness checks | [src/services/readiness.ts](src/services/readiness.ts) |

The Masumi client expects `PAYMENT_SERVICE_URL` to include the API prefix:
`/pay/api/v1` for Masumi SaaS or `/api/v1` for a direct payment node. It then
calls `POST /payment`, `POST /payment/resolve-blockchain-identifier`, and
`POST /payment/submit-result`.

Before exposing the service publicly, build and run the readiness check:

```bash
npm run build
npm run check:production
curl -s http://localhost:3000/ready
```

The check fails on missing Langdock credentials, missing Masumi identity/payment
credentials in `masumi` mode, invalid payment windows, invalid dynamic pricing,
or an empty/duplicate input schema.

## Handlers

Plug in async functions for `start_job` (and optionally `status` / `availability`). The
default `start_job` implementation calls Langdock chat completions. The API mirrors the
handler registration used by [`pip-masumi`](https://github.com/masumi-network/pip-masumi).

```ts
import {
  AgentEndpointHandler,
  buildApp,
  inputDataToRecord,
} from "langdock-masumi-wrapper";

const endpointHandler = new AgentEndpointHandler();
endpointHandler.setStartJobHandler(async (identifier, inputData) => {
  // inputData is the canonical MIP-003 array [{key,value}]
  const fields = inputDataToRecord(inputData);
  return { ok: true, text: fields.text };
});

const app = await buildApp({ endpointHandler });
await app.listen({ port: 3000, host: "0.0.0.0" });
```

## Examples

```bash
# /start_job accepts the MIP-003 array form (preferred) and legacy object form.
curl -s -X POST http://localhost:3000/start_job \
  -H "Content-Type: application/json" \
  -d '{"identifier_from_purchaser":"abc123def4567890","input_data":[{"key":"text","value":"Hello"}]}'

curl -s "http://localhost:3000/status?job_id=JOB_UUID"
curl -s http://localhost:3000/availability
curl -s http://localhost:3000/input_schema
curl -s http://localhost:3000/ready
```

Field names in the request may be snake_case or camelCase
(`identifierFromPurchaser`, `inputData`, etc.). If `identifier_from_purchaser` is
omitted, a hex identifier in the Payment Service's required 14–26 char range is
auto-generated. In `PAYMENT_MODE=masumi`, a provided identifier must already be
lowercase hex and 14–26 characters; invalid values are rejected before any Masumi
API call is made.

## Modes

- **`PAYMENT_MODE=direct`** — local dev. Skips escrow; the handler runs immediately,
  `/status` returns `completed` on the next tick. Useful while wiring up Langdock without
  a Masumi node.
- **`PAYMENT_MODE=masumi`** — production. `/start_job` registers the sale on the Masumi
  Payment Service, returns `awaiting_payment` with real on-chain times, a background
  poller waits for `FundsLocked`, runs the handler, and submits the MIP-004 output hash
  back to the Payment Service.

Mode auto-detection: if `PAYMENT_SERVICE_URL` is set, `masumi` is the default;
otherwise `direct`. `MASUMI_PAYMENT_SERVICE_URL`, `MASUMI_PAYMENT_SERVICE_TOKEN`,
and `MASUMI_NETWORK` remain supported as legacy aliases. Override explicitly with
`PAYMENT_MODE=...`.

## Scripts

| Script | Command |
|--------|---------|
| Develop | `npm run dev` |
| Build | `npm run build` |
| Run | `npm start` |
| Production config check | `npm run check:production` |
| Test | `npm test` |

## Spec compliance

- **MIP-003** — Agentic Service API. See [STATUS.md](STATUS.md) for the endpoint-by-endpoint checklist.
- **MIP-004** — Decision Logging. Canonical JCS + SHA-256 over `identifier;payload` for
  both `input_hash` and `output_hash`. Handled in [src/services/hashing.ts](src/services/hashing.ts).

## Repository layout

```
src/
  app.ts                       Fastify factory + CLI entry
  config.ts                    Env-backed settings (Langdock, Masumi, pricing, schema)
  agentEndpointHandler.ts      Pluggable handler registration
  routes/                      start_job, status, availability, input_schema
  services/
    langdock.ts                Langdock chat completions client
    langdockStartJob.ts        Default start_job → Langdock adapter
    masumiPayment.ts           Masumi Payment Service client (register, poll, submit)
    jobRunner.ts               Background payment poller + job executor
    hashing.ts                 MIP-004 input / output hashes
    inputMapping.ts            MIP-003 input_data → Langdock prompt text
    jobs.ts                    In-memory job store (swap for Redis/Postgres for HA)
    readiness.ts               Central production config/readiness checks
  utils/
    startJobBody.ts            Request normalisation (MIP-003 array form + aliases)
  types/                       Typed payloads for MIP-003 and Langdock
tests/                         vitest suites
```
