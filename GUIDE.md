# Operator Guide — Listing a Langdock Agent on Sokosumi

This guide is written for the person (or team) who will actually deploy this
wrapper and take a Langdock agent from "works locally" to "listed on
Sokosumi and earning USDCx". In most cases that is **the client who owns
the agent**, because several of the credentials (Langdock API key, selling
wallet, payment API key) are sensitive and must not leave their
infrastructure.

If you are a contractor setting this up *for* a client, treat this document
as the hand-off checklist and fill in the values side-by-side with them.

---

## 1. Who Does What

There are three roles in the end-to-end flow. You will almost always wear the
first two.

| Role | Responsibility |
|------|---------------|
| **Agent owner (client)** | Owns the Langdock agent, pays for the selling wallet, configures Masumi SaaS / Payment Service credentials, deploys this wrapper, lists on Sokosumi, keeps the service healthy. |
| **Wrapper operator** | The process/server that runs `npm start` and receives `/start_job` / `/status` traffic. Typically hosted close to the payment API. Same person as the client in most setups. |
| **Buyer** | A Sokosumi user who pays in USDCx / tUSDM to invoke the agent. You do not manage buyers — Sokosumi does. |

**Short answer to the original question:** yes, essentially everything is set
up by the client. They supply the Langdock credentials, run the Payment
Service, own the selling wallet, and deploy the wrapper. This repo is the
glue; it does not replace any of those components.

---

## 2. End-to-end Lifecycle

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                          ONE-TIME SETUP                             │
 │                                                                     │
 │  (a) Client generates a Langdock API key + notes the agent ID.      │
 │  (b) Client configures Masumi SaaS / Payment Service credentials     │
 │      (Docker or Railway template).                                  │
 │  (c) Client creates a SELLING wallet in the Payment Service admin,  │
 │      funds it with a few test ADA on Preprod.                       │
 │  (d) Client registers the agent on Masumi → receives                │
 │      AGENT_IDENTIFIER.                                              │
 │  (e) Client copies SELLER_VKEY from the admin dashboard.            │
 │  (f) Client deploys THIS wrapper with those credentials in .env.    │
 │  (g) Client lists the agent on app.sokosumi.com.                    │
 └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                      ONGOING (per job)                              │
 │                                                                     │
 │  Buyer clicks "Run" on Sokosumi                                     │
 │     └─▶ Sokosumi calls POST /start_job on the wrapper               │
 │            └─▶ wrapper registers sale on Payment Service,           │
 │                returns blockchainIdentifier + timings.              │
 │  Buyer pays in USDCx / tUSDM on-chain.                              │
 │     └─▶ Payment Service transitions to FundsLocked.                 │
 │  Wrapper poller detects FundsLocked                                 │
 │     └─▶ Runs the Langdock handler.                                  │
 │     └─▶ Computes MIP-004 output hash.                               │
 │     └─▶ Submits result hash to Payment Service.                     │
 │  Buyer unlocks → seller's wallet receives funds.                    │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Prerequisites Checklist

Gather all of this **before** you start editing `.env`. Missing any item will
block the setup halfway through.

### From Langdock
- [ ] **`LANGDOCK_API_KEY`** — generated in the Langdock dashboard. Server-side only; never exposed to browsers.
- [ ] **`LANGDOCK_AGENT_ID`** — the target agent's ID.
- [ ] Optional: a non-default `LANGDOCK_BASE_URL` if the client uses a custom deployment.

### From Masumi (SaaS / Payment Service)
- [ ] Masumi SaaS API access, or a running **Masumi Payment Service** node.
- [ ] **`PAYMENT_SERVICE_URL`** — Masumi SaaS `/pay/api/v1` URL or direct Payment Service `/api/v1` URL.
- [ ] **`PAYMENT_API_KEY`** — Masumi SaaS API key, or direct Payment Service token. Treat like a root password.
- [ ] **`NETWORK`** — `Preprod` for testing, `Mainnet` for production.
- [ ] A **selling wallet** created inside the Payment Service admin, funded with at least a few test ADA (Preprod faucet: <https://docs.cardano.org/cardano-testnets/tools/faucet>).
- [ ] USDCx / tUSDM pricing selected. Sokosumi expects 6-decimal raw token units: `1000000` = 1 USDCx/tUSDM. The `unit` is the full token asset id, not `lovelace`.
- [ ] **`SELLER_VKEY`** — the selling wallet's verification key, visible on the admin dashboard.
- [ ] **`AGENT_IDENTIFIER`** — NFT-backed identifier obtained by registering the agent (see Step 4 below).

### From Sokosumi
- [ ] A **Sokosumi account** at <https://app.sokosumi.com>.
- [ ] Agent metadata for the listing: name, description, pricing rationale, example inputs/outputs, tags.

### Infrastructure
- [ ] A host for this wrapper (Node.js 20+). Railway, Fly.io, Render, a VM, or Kubernetes — anywhere that can run a long-lived Fastify process.
- [ ] Public HTTPS endpoint. Sokosumi will call your `/start_job`; it must be reachable.
- [ ] (Recommended) Run the Payment Service and the wrapper in the same VPC / network.

---

## 4. Step-by-Step Setup

### Step 1 — Stand up the Masumi Payment Service

Follow the upstream Docker instructions. At the end you should have:
- A reachable URL, e.g. `https://masumi-payment.example.com`.
- A login to the admin UI.
- A selling wallet with its receiving address and verification key.

Verify the payment API is reachable:

```bash
curl -H "x-api-key: $PAYMENT_API_KEY" \
     "$PAYMENT_SERVICE_URL/payment?network=$NETWORK"
```

### Step 2 — Fund the selling wallet (Preprod first)

On Preprod, grab tADA from the Cardano faucet and send it to the selling
wallet's address. You need this so the selling wallet can pay the tiny
submit-result transaction fee when a job completes.

### Step 3 — Register the agent on Masumi

From the Masumi admin UI (or direct payment-node `POST /registry`):
1. Select the selling wallet.
2. Provide the agent metadata (name, description, pricing reference, endpoint URL where THIS wrapper will be publicly reachable).
3. Submit. The registry call mints an NFT that represents the agent.
4. Wait for the transaction to confirm.
5. Copy the resulting `agentIdentifier` — this becomes `AGENT_IDENTIFIER`.

The endpoint URL you register here is the public URL of THIS wrapper's
`/start_job`. If you don't have it yet, use a placeholder and re-register
after deployment (or use a stable DNS name from the start).

### Step 4 — Configure this wrapper

```bash
git clone <this repo>
cd langdock-masumi-wrapper
cp .env.example .env
```

Fill `.env`:

```env
PORT=3000

# Langdock
LANGDOCK_API_KEY=sk-langdock-...
LANGDOCK_AGENT_ID=agt_...
LANGDOCK_BASE_URL=https://api.langdock.com

# Masumi agent identity (from Step 3)
AGENT_IDENTIFIER=7e8bdaf2b2b919a3a4b94002cafb500...
SELLER_VKEY=2d457934ccaf239ee2629fe38bdae71b13f90b746fb174e5278bedd6

# Payment mode
PAYMENT_MODE=masumi

# Masumi SaaS / Payment Service
PAYMENT_SERVICE_URL=https://masumi-saas.example.com/pay/api/v1
PAYMENT_API_KEY=masumi-saas-api-key-xxxxxxxx
NETWORK=Preprod
PAYMENT_API_AUTH_HEADER=x-api-key
PAYMENT_POLL_INTERVAL_MS=5000
PAYMENT_POLL_TIMEOUT_MS=1800000

# Optional dynamic RequestedFunds — leave empty for fixed pricing configured
# on the registered Masumi agent in the admin side.
# Do not use "lovelace" for tUSDM/USDCx. Lovelace is ADA's smallest unit;
# stablecoin pricing uses the token asset id as unit and a 6-decimal raw amount.
# Mainnet USDCx unit:
# 1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378
PRICE_AMOUNTS=

# Payment windows (Unix seconds, monotonic; ≥5 min between payBy and submitResult)
PAY_BY_OFFSET_SEC=900
SUBMIT_RESULT_OFFSET_SEC=2700
UNLOCK_OFFSET_SEC=3600
EXTERNAL_DISPUTE_UNLOCK_OFFSET_SEC=5400

# Sokosumi-facing input fields — tailor this to what your Langdock agent expects!
INPUT_SCHEMA_JSON=[{"id":"text","type":"string","name":"Prompt","data":{"description":"Prompt sent to the agent","placeholder":"Summarize..."}}]
```

Sanity checks:

```bash
npm install
npm test
npm run build
npm run check:production       # fails if required production env is missing
npm start                      # starts on $PORT
```

### Step 5 — Smoke-test in `direct` mode (optional but recommended)

Before wiring in Masumi, confirm the Langdock handler runs. Set
`PAYMENT_MODE=direct` and skip the Masumi env vars:

```bash
PAYMENT_MODE=direct npm run dev
curl -s -X POST http://localhost:3000/start_job \
  -H "Content-Type: application/json" \
  -d '{"identifier_from_purchaser":"dev-1","input_data":[{"key":"text","value":"Hello"}]}'
```

The response contains a `job_id`. Poll it:

```bash
curl -s "http://localhost:3000/status?job_id=<JOB_UUID>"
```

`status` should move to `completed` and `result` should contain the Langdock
answer. If this fails, fix Langdock credentials before touching Masumi.

### Step 6 — Preprod end-to-end dry run

Switch back to `PAYMENT_MODE=masumi`. Have a separate *purchaser* wallet
funded with tADA (or ask a Masumi engineer for one).

1. Call `/start_job` against the wrapper — you should receive a
   `blockchainIdentifier` and four timings.
2. From the purchaser wallet, send payment referencing that identifier.
3. Watch the wrapper logs: the poller will detect `FundsLocked` and run the
   Langdock handler.
4. `/status` flips through `awaiting_payment → running → completed` and
   exposes `input_hash` + `output_hash`.
5. From the purchaser side, unlock to release funds to the selling wallet.
6. Confirm tADA arrived in the selling wallet.

If any step stalls, see **Section 8 — Troubleshooting**.

### Step 7 — Deploy publicly

Deploy the wrapper so Sokosumi can reach it over HTTPS. Whatever your host:
- `npm run build` produces `dist/`.
- `npm start` runs it.
- Expose `PORT` behind TLS.
- Set the Langdock + Masumi env vars as secrets.
- Keep the Payment Service reachable from the wrapper's network.

A minimal Dockerfile is already included.

### Step 8 — List on Sokosumi

1. Log into <https://app.sokosumi.com>.
2. Start a new agent listing.
3. Provide: the public `/start_job` URL, the `AGENT_IDENTIFIER`, pricing,
   description, and the input schema fields (must match `INPUT_SCHEMA_JSON`).
4. Submit and wait for marketplace review.

Once approved, buyers can invoke your agent from Sokosumi. The wrapper cannot
force marketplace approval by itself; it makes the agent technically ready, and
the Masumi/Sokosumi registration step makes it discoverable. Monitor the wrapper's
logs + the Payment Service dashboard for traffic.

### Step 9 — Mainnet switchover

When Preprod is solid:
- Fund the Mainnet selling wallet with real ADA for transaction fees.
- Register the agent on Mainnet (new `AGENT_IDENTIFIER`).
- Set `NETWORK=Mainnet`.
- Re-list on Sokosumi for Mainnet.
- Update pricing in Masumi SaaS/admin. Set `PRICE_AMOUNTS` only for dynamic `RequestedFunds`.

Never reuse a Preprod `AGENT_IDENTIFIER` on Mainnet.

---

## 5. What Your Client Has to Give You (If You Are Building This For Someone Else)

Send them this exact list. Without these values you cannot finish the setup:

1. Langdock API key (from their Langdock dashboard).
2. Langdock agent ID.
3. Payment API URL + API key *(Masumi SaaS preferred; direct payment-node is also supported)*.
4. Selling wallet creation approval *(and who will fund it)*.
5. `AGENT_IDENTIFIER` + `SELLER_VKEY` once the agent is registered.
6. Final pricing they want to charge.
7. Input schema: the exact fields Sokosumi buyers should fill in.
8. Public domain / TLS cert for the wrapper.
9. Sokosumi account + which team member will complete the listing form.

Items 1, 3, 4, and 9 are the most common blockers — start those requests
first because they take days, not minutes.

---

## 6. Configuration Reference

See the full env table in [README.md](README.md#environment) and defaults in
[`.env.example`](.env.example). The settings you will actually tune per
deployment:

| Setting | When to change |
|---------|----------------|
| `PRICE_AMOUNTS` | Optional dynamic pricing only. Use the tUSDM asset id on Preprod and the USDCx asset id on Mainnet; do not use `lovelace` unless intentionally charging ADA outside the Sokosumi stablecoin flow. |
| `PAY_BY_OFFSET_SEC` / `SUBMIT_RESULT_OFFSET_SEC` / `UNLOCK_OFFSET_SEC` / `EXTERNAL_DISPUTE_UNLOCK_OFFSET_SEC` | When the agent takes significantly longer than the defaults (45 min median). Must stay monotonic with ≥5 min gap between payBy and submitResult. |
| `PAYMENT_POLL_INTERVAL_MS` / `PAYMENT_POLL_TIMEOUT_MS` | If Cardano block times are slow or if buyers regularly pay right at the deadline. |
| `INPUT_SCHEMA_JSON` | Whenever the Langdock agent expects a different input shape. The schema drives the Sokosumi form. |
| `NETWORK` | Preprod during testing, Mainnet when live. |

---

## 7. Customising the Handler (Non-Langdock Agents)

Although this wrapper ships a default Langdock handler, the intent is that
any async AI workload can plug in. Register a custom handler in your entry
point:

```ts
import {
  AgentEndpointHandler,
  buildApp,
  inputDataToRecord,
} from "langdock-masumi-wrapper";

const endpointHandler = new AgentEndpointHandler();
endpointHandler.setStartJobHandler(async (identifier, inputData) => {
  const fields = inputDataToRecord(inputData);
  // Call whatever AI service you want — OpenAI, Anthropic, in-house model, etc.
  return { ok: true, text: fields.text };
});

const app = await buildApp({ endpointHandler });
await app.listen({ port: 3000, host: "0.0.0.0" });
```

Everything downstream — payment registration, hashing, result submission —
works identically.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|--------|-------------|-----|
| `/start_job` returns 500 `AGENT_NOT_REGISTERED` | `AGENT_IDENTIFIER` or `SELLER_VKEY` empty | Re-register the agent, copy both values into `.env`, restart. |
| `/start_job` returns 502 `PAYMENT_REGISTRATION_FAILED` | Payment Service rejected the body | Check the error message; most common: `payByTime` not ISO, identifier wrong length, or time offsets not monotonic. The wrapper defaults satisfy all Payment Service constraints — don't shrink gaps below 5 min. |
| Job stuck in `awaiting_payment` forever | Buyer never paid, or paid with wrong identifier | Verify the transaction references the exact `blockchainIdentifier` returned by `/start_job`. |
| Job flips to `refunded` | Payment Service observed `RefundRequested` / `Disputed` / invalid datum | Check the Payment Service dashboard for the on-chain state. Usually means the buyer cancelled. |
| Handler runs but `submit-result` 4xx | Selling wallet out of funds, or wrapper clock skewed past `submitResultTime` | Top up the selling wallet; ensure the host has NTP. Extend `SUBMIT_RESULT_OFFSET_SEC` if the agent is legitimately slow. |
| Sokosumi cannot reach `/start_job` | Wrapper not publicly accessible, or TLS misconfigured | Verify `curl https://<public-url>/availability` returns 200 from an external host. |
| `/ready` returns 503 | Required production env or schema/pricing is incomplete | Run `npm run build` then `npm run check:production`; fix every `error` entry before listing. |
| `Langdock 401` in logs | `LANGDOCK_API_KEY` missing or expired | Rotate the key in Langdock; update the env. |
| Jobs lost on restart | In-memory job store | Swap `src/services/jobs.ts` for a Redis / Postgres implementation before running >1 replica. |

---

## 9. Operational Notes

- **Single replica** is safe today (in-memory job store). For HA, implement a persistent store — every other component is already stateless.
- **Observability**: Fastify logger is on. Add Prometheus + tracing before production load.
- **Secrets**: never commit `.env`. Use your host's secret manager (Railway Variables, AWS Secrets Manager, etc.).
- **Rotation**: if `PAYMENT_API_KEY` is exposed, rotate it in Masumi SaaS / Payment Service and redeploy the wrapper. No state is stored client-side.
- **Upgrades**: when Masumi ships MIP-003 / MIP-004 changes, bump this repo and re-run `npm test` — the vitest suite covers the hashing + payment contract.

---

## 10. Hand-off Checklist (Copy / Paste)

Use this when delivering a ready-to-run deployment to your client:

```
[ ] Langdock API key set and tested
[ ] Langdock agent ID confirmed
[ ] Masumi SaaS / Payment Service reachable from wrapper
[ ] PAYMENT_API_KEY stored securely
[ ] Selling wallet created and funded (Preprod AND Mainnet if going live)
[ ] Agent registered on Masumi, AGENT_IDENTIFIER saved
[ ] SELLER_VKEY saved
[ ] .env configured with all of the above
[ ] `npm run check:production` passes
[ ] INPUT_SCHEMA_JSON matches the agent's real input fields
[ ] Pricing configured on the registered Masumi agent; PRICE_AMOUNTS empty unless using dynamic RequestedFunds
[ ] Preprod end-to-end buy→unlock cycle executed successfully
[ ] Wrapper deployed with public HTTPS URL
[ ] Sokosumi listing submitted + approved
[ ] Mainnet switchover plan documented
[ ] Monitoring / alerting on the wrapper + Payment Service
```

Ship it when every box is checked.
