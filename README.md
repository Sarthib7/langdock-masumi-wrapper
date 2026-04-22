# Langdock → Masumi wrapper

Fastify service that exposes any Langdock agent (or any async AI workload) as a
MIP-003-compliant Masumi agent, ready to list on [Sokosumi](https://app.sokosumi.com).

It implements:

- `POST /start_job`   — registers a sale on the Masumi Payment Service, returns
  `blockchainIdentifier` + payment timings, defers execution until funds are locked.
- `GET  /status`      — MIP-003 payload with `input_hash`, `output_hash`, result, timestamps.
- `GET  /availability` — health for load balancers / marketplace checks.
- `GET  /input_schema` — schema shown to buyers on Sokosumi.

MIP-004 hashing (JCS + SHA-256) is applied to both `input_data` and the handler's output,
and the output hash is submitted on-chain via the Payment Service so buyers can unlock
payment.

See [STATUS.md](STATUS.md) for the full production-readiness checklist.

## Architecture

```
┌──────────┐  POST /start_job  ┌────────────────────┐  POST /api/v1/payment/      ┌────────────────────────┐
│  Buyer   │ ────────────────▶ │ Wrapper (this app) │ ──────────────────────────▶ │ Masumi Payment Service │
└──────────┘                   │                    │ ◀── blockchainIdentifier ── │   (self-hosted node)   │
                               │   poller loop      │                             └─────────┬──────────────┘
                               │                    │ GET  /api/v1/payment/                 │ on-chain escrow
                               │   FundsLocked?     │ ──────────────────────────▶            ▼
                               │                    │                             ┌────────────────────────┐
                               │   run handler      │                             │   Cardano Preprod /    │
                               │   compute hash     │                             │        Mainnet         │
                               │                    │ POST /api/v1/payment/       └────────────────────────┘
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
| `MASUMI_PAYMENT_SERVICE_URL` | Base URL of your Masumi node. Trailing `/api/v1` is stripped automatically. |
| `MASUMI_PAYMENT_SERVICE_TOKEN` | Admin `token` from the Payment Service. |
| `MASUMI_NETWORK` | `Preprod` or `Mainnet`. |
| `PRICE_AMOUNTS` | JSON array of `{amount, unit}`. Default: 10 ADA. |
| `INPUT_SCHEMA_PATH` / `INPUT_SCHEMA_JSON` | MIP-003 schema served at `/input_schema`. |

Full list in [.env.example](.env.example).

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
```

Field names in the request may be snake_case or camelCase
(`identifierFromPurchaser`, `inputData`, etc.). If `identifier_from_purchaser` is
omitted, a hex identifier in the Payment Service's required 14–26 char range is
auto-generated.

## Modes

- **`PAYMENT_MODE=direct`** — local dev. Skips escrow; the handler runs immediately,
  `/status` returns `completed` on the next tick. Useful while wiring up Langdock without
  a Masumi node.
- **`PAYMENT_MODE=masumi`** — production. `/start_job` registers the sale on the Masumi
  Payment Service, returns `awaiting_payment` with real on-chain times, a background
  poller waits for `FundsLocked`, runs the handler, and submits the MIP-004 output hash
  back to the Payment Service.

Mode auto-detection: if `MASUMI_PAYMENT_SERVICE_URL` is set, `masumi` is the default;
otherwise `direct`. Override explicitly with `PAYMENT_MODE=...`.

## Scripts

| Script | Command |
|--------|---------|
| Develop | `npm run dev` |
| Build | `npm run build` |
| Run | `npm start` |
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
  utils/
    startJobBody.ts            Request normalisation (MIP-003 array form + aliases)
  types/                       Typed payloads for MIP-003 and Langdock
tests/                         vitest suites
```
