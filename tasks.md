# Tasks

## Date
- 2026-05-13

## Done
- Built multi-agent Langdock -> Masumi wrapper via `AGENTS_JSON`.
- Wired 4 agent routes on Railway:
  - `/agents/lexi`
  - `/agents/emil-conrad`
  - `/agents/diddy-p`
  - `/agents/food-co2-analyst`
- Switched live deploy -> `https://langdock-masumi-wrapper-production-f58a.up.railway.app`
- Registered 4 agents on Masumi Preprod.
- Listed 4 agents on Sokosumi Preprod.
- Verified `/availability` + `/input_schema` for all 4.
- Debugged Sokosumi "Failed to start job".
- Found bug: wrapper sent `RequestedFunds` for fixed-price agents -> Payment Service `400` -> `"For fixed pricing, RequestedFunds must be null"`.
- Fixed bug: removed per-agent runtime `priceAmounts` from `AGENTS_JSON`.
- Re-tested `POST /agents/<slug>/start_job` -> all 4 return `200`.
- Re-registered agents on Masumi Preprod for 5 tUSDM pricing:
  - `amount: "5000000"`
  - `unit: "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d"`
- Verified Masumi registry pricing supports simple amount/unit rows.
- Added setup regression coverage for explicit registry pricing rows:
  - 5 tUSDM
  - 5000000 lovelace
- Updated `/setup/registry/register` to pass explicit `pricing` arrays through unchanged.
- Installed Railway agent setup globally:
  - `railway setup agent -y`
- Added local test-agent tooling:
  - `npm run agents:test-json`
  - `npm run smoke:test-agents`
- Registered ngrok-backed `Test Agent 1..4` on Masumi Preprod.
- Started `Test Agent 1..4` jobs via Sokosumi Preprod API.
- Verified all 4 reached:
  - Sokosumi `input_required`
  - on-chain `FUNDS_LOCKED`
  - wrapper `awaiting_input`
- Found HITL submit bug:
  - Sokosumi posts to `/agents/<slug>/provide_input`
  - wrapper only had `/provide_input`
- Fixed routed HITL submit endpoint:
  - `POST /agents/:agentSlug/provide_input`
- Found Sokosumi submit payload behavior:
  - no `continuationToken`
  - sends `input_schema_hash`
- Added routed HITL auth fallback:
  - accept matching `input_schema_hash` for routed agent job
  - keep token check for global `/provide_input`
- Verified fresh Sokosumi job completed after fix:
  - job `019e22cb-eb17-76aa-8da9-954dae838d16`
  - agentJobId `0d4fbb05-8e59-4b60-9acb-26c8d62f83e9`
  - status `completed`
  - on-chain later showed `RESULT_SUBMITTED`

## Live status
- Lexi -> listed, start_job works
- Emil-Conrad -> listed, start_job works
- Diddy P. -> listed, start_job works
- Food CO2 Analyst -> listed, start_job works

## Live base URL
- `https://langdock-masumi-wrapper-production-f58a.up.railway.app`

## Rules learned
- One Railway deploy can host many Masumi agents.
- Need unique `apiBaseUrl` per agent.
- Pattern: one host + many `/agents/<slug>` routes.
- Fixed-price Masumi agent must not send dynamic `RequestedFunds` at runtime.
- Registry pricing should be passed as explicit Masumi rows when needed:
  - `[{ amount: "5000000", unit: "<tUSDM asset id>" }, { amount: "5000000", unit: "lovelace" }]`
- Do not convert registry pricing into Sokosumi credits during registration debugging.
- Sokosumi create-job API needs `inputSchema`, `inputData`, `maxCredits`; not `maxAcceptedCredits`.
- Sokosumi imports Masumi registry entries automatically after confirmation, but can lag minutes.
- Sokosumi HITL follow-up endpoint uses agent route:
  - `/agents/<slug>/provide_input`
- Sokosumi HITL follow-up payload uses:
  - `job_id`
  - `input_schema_hash`
  - `input_data`
- Sokosumi does not send wrapper `continuationToken` back on follow-up.
- `input_schema_hash` is SHA-256 over JCS-canonical input schema JSON.
- Wrapper job store is in-memory. Restart/redeploy kills active job state.
- After wrapper restart, old Sokosumi jobs can show failed submit because `agentJobId` no longer exists locally.
- Test-agent registrations made during ngrok smoke point to ngrok URL, not Railway URL. Do not use them as permanent Railway listings.

## Next
- Deploy routed HITL fix to Railway.
- Use fresh Sokosumi jobs after deploy; old jobs from before deploy can fail due lost in-memory state.
- Re-register production test agents or real agents with Railway public URL, not ngrok URL.
- Watch Railway logs during first live HITL submit.
- Add durable job store before relying on long HITL jobs across deploy/restart.
- Optional: custom per-agent input schemas.
- Optional: example outputs.
- Optional: save final agentIdentifiers in README/deploy note.

## Outcome
- 4 Langdock agents connected
- 4 Masumi Preprod regs working
- 4 Sokosumi Preprod listings visible
- start_job bug fixed
- Sokosumi API paid start path verified with ngrok test agents
- Sokosumi HITL submit path fixed locally and verified with fresh job
