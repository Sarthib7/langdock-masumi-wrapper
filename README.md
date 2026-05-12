# Langdock → Masumi wrapper

Fastify service that exposes any Langdock agent (or any async AI workload) as a
MIP-003-compliant Masumi agent, ready to list on [Sokosumi](https://app.sokosumi.com).

It implements:

- `GET  /`            — minimal operator setup UI for posting Langdock and
  Masumi credentials into `.env` and the running process.
- `GET/POST /setup/config` — redacted setup status and persistent credential update.
- Setup login UI — authenticate with either an access hash (`SETUP_ACCESS_TOKEN`) or username/password (`SETUP_USERNAME` + `SETUP_PASSWORD`).
- `GET /setup/registry/status` — polls Payment Service registry records and saves
  `AGENT_IDENTIFIER` once the registration returns one.
- `POST /start_job`   — registers a sale on the Masumi Payment Service, returns
  `blockchainIdentifier` + payment timings, defers execution until funds are locked.
- `GET  /status`      — MIP-003 payload with `input_hash`, `output_hash`, result, timestamps, and HITL prompts when awaiting input.
- `POST /provide_input` — optional HITL chat continuation for Langdock agents; send follow-up input or `DONE` to finish.
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
| `HITL_CHAT_MODE` | Set `true` to keep paid Langdock jobs open as a chat. After each answer `/status` returns `awaiting_input`; `/provide_input` continues until the user sends `DONE`. |
| `INPUT_SCHEMA_PATH` / `INPUT_SCHEMA_JSON` | MIP-003 schema served at `/input_schema`. |
| `REQUIRE_PRODUCTION_CONFIG` | Set `true` to make startup fail until production env is complete. Also enforced automatically when `NODE_ENV=production` or `PAYMENT_MODE=masumi`. |
| `SETUP_ACCESS_TOKEN` | Optional shared token required by `POST /setup/config`. Set this before exposing the setup page beyond localhost. |
| `SETUP_USERNAME` / `SETUP_PASSWORD` | Alternative login using HTTP Basic auth. Takes precedence over `SETUP_ACCESS_TOKEN` when both are set. |
| `SETUP_ENV_PATH` | Optional path where `POST /setup/config` writes persistent env config. Defaults to `.env` in the current working directory. |

Full list in [.env.example](.env.example).

### Wiring Map

| Concern | File |
|---------|------|
| Env loading and auth-header selection | [src/config.ts](src/config.ts) |
| MIP-003 routes | [src/routes/index.ts](src/routes/index.ts) |
| HITL chat continuation | [src/routes/provideInput.ts](src/routes/provideInput.ts), [src/services/hitlChat.ts](src/services/hitlChat.ts) |
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

### Hosted setup UI

Run the service and open `http://localhost:3000/` to configure the wrapper from
a browser. The form posts Langdock and Masumi credentials to `POST /setup/config`;
the server writes them to `.env`, applies them to the current process, and
rebinds the default Langdock `start_job` handler immediately. Submitted secrets
are not returned by `GET /setup/config` or the UI status panel. Empty secret
fields keep their previous value so refreshing status or changing non-secret
settings does not erase credentials.

If the page is reachable by anyone except the operator, set either an access hash:

```bash
SETUP_ACCESS_TOKEN="change-me"
```

…or username/password auth:

```bash
SETUP_USERNAME="operator"
SETUP_PASSWORD="change-me"
```

The setup UI login section lets you toggle between the two methods. When both are
configured, either credential set is accepted.

The setup UI also includes **Agent slots** — up to four registration profiles saved
in your browser's localStorage. Click a slot, fill in the registration fields, and
use **Save current slot** to persist it locally. **Register agent** submits the
selected slot to the Masumi registry and auto-saves the profile afterwards.

#### Credential guide

| Field | What it is for | Where to get it |
|-------|----------------|-----------------|
| `SETUP_ACCESS_TOKEN` | Shared secret that protects the setup UI. This is not provided by a vendor; generate it yourself. | Run `openssl rand -hex 32`, then set it in Railway Variables. See [Railway variables](https://docs.railway.com/variables). |
| `LANGDOCK_API_KEY` | Server-side key used by this wrapper to call Langdock. | In Langdock workspace settings, create an API key, then share your agent with that key. See [Langdock: Sharing Agents with API Keys](https://docs.langdock.com/api-endpoints/agent/agent-api-guide). |
| `LANGDOCK_AGENT_ID` | The Langdock agent this wrapper calls. | Open the agent in Langdock and copy the ID from the URL, e.g. `https://app.langdock.com/agents/AGENT_ID/edit`. See the same [Langdock guide](https://docs.langdock.com/api-endpoints/agent/agent-api-guide). |
| `PAYMENT_SERVICE_URL` | Masumi Payment Service or Masumi SaaS API base URL used for payments and registry calls. | Use a URL ending in `/api/v1` for a direct payment node or `/pay/api/v1` for Masumi SaaS. See [Masumi API reference](https://docs.masumi.network/api-reference). |
| `PAYMENT_API_KEY` | API key for the Masumi Payment Service/SaaS. | Create or copy an API key from your Payment Service/SaaS admin surface. API calls authenticate with `token` or `x-api-key`. See [Payment Service API keys](https://docs.masumi.network/api-reference/payment-service/get-api-key). |
| `SELLER_VKEY` | Selling wallet verification key used when registering the agent and taking payment. | From the funded selling wallet in your Masumi Payment Service/admin setup. |
| `AGENT_IDENTIFIER` | On-chain Masumi registry identifier for this agent. | Generated by the setup UI's **Register agent** flow or registry API. Use **Refresh registry** until it appears. See [Sokosumi listing guide](https://docs.masumi.network/documentation/how-to-guides/list-agent-on-sokosumi). |
| `NETWORK` | Chooses Cardano `Preprod` or `Mainnet`. | Start with `Preprod`; switch to `Mainnet` only after end-to-end tests pass. |

The setup UI can also submit an on-chain registry request through the configured
Payment Service. Registration requires a funded selling wallet and uses
`POST {PAYMENT_SERVICE_URL}/registry/`. Preprod should be used first; on-chain
confirmation can take several minutes. Once the registry response includes an
`agentIdentifier`, the helper saves it to `.env` so `/start_job` can register
paid jobs with that identity. Sokosumi discovery depends on the registry NFT
being confirmed, the agent URL being public and healthy, and pricing using the
expected settlement token:

- Preprod: tUSDM `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d`
- Mainnet: USDCx `1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378`

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

# HITL chat mode only: continue a job that reports status=awaiting_input.
curl -s -X POST http://localhost:3000/provide_input \
  -H "Content-Type: application/json" \
  -d '{"job_id":"JOB_UUID","input_data":{"message":"Follow-up question"}}'

# Finish the HITL chat and submit the final transcript hash. The HITL schema also
# exposes a boolean `finish` control; default/off means continue.
curl -s -X POST http://localhost:3000/provide_input \
  -H "Content-Type: application/json" \
  -d '{"job_id":"JOB_UUID","input_data":{"message":"","finish":true}}'

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
