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

## Next
- Wait for new Masumi registry identifiers to confirm before updating Railway `AGENTS_JSON`.
- Run 1 full Sokosumi paid flow per agent after confirmed identifiers sync.
- Watch Railway logs during first live runs.
- Optional: custom per-agent input schemas.
- Optional: example outputs.
- Optional: save final agentIdentifiers in README/deploy note.

## Outcome
- 4 Langdock agents connected
- 4 Masumi Preprod regs working
- 4 Sokosumi Preprod listings visible
- start_job bug fixed
