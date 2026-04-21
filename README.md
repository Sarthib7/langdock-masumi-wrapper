# Langdock–Masumi wrapper

Fastify service exposing **`POST /start_job`**, **`GET /status`**, and **`GET /availability`** in the MIP-003 shape. It calls Langdock’s agent API with a server-side API key and `agentId`. Keep Langdock credentials on the server only.

## Handlers

You can plug in async functions for `start_job` (and optionally `status` / `availability`). The default `start_job` implementation calls Langdock chat completions. The API is similar to the handler registration used in [`pip-masumi`](https://github.com/masumi-network/pip-masumi).

```ts
import { AgentEndpointHandler, buildApp } from "langdock-masumi-wrapper";

const endpointHandler = new AgentEndpointHandler();
endpointHandler.setStartJobHandler(async (_id, input) => ({ ok: true, input }));

const app = await buildApp({ endpointHandler });
await app.listen({ port: 3000, host: "0.0.0.0" });
```

## Environment

Copy [`.env.example`](.env.example) to `.env`. For the default Langdock handler, set **`LANGDOCK_API_KEY`** and **`LANGDOCK_AGENT_ID`**. **`AGENT_IDENTIFIER`** and **`SELLER_VKEY`** are returned on `/start_job`; if `AGENT_IDENTIFIER` is unset, a placeholder value is used.

## Examples

```bash
curl -s -X POST http://localhost:3000/start_job \
  -H "Content-Type: application/json" \
  -d '{"identifier_from_purchaser":"demo-1","input_data":{"text":"Hello"}}'

curl -s "http://localhost:3000/status?job_id=JOB_UUID"
curl -s http://localhost:3000/availability
```

Request bodies may use **snake_case or camelCase** field names (`identifierFromPurchaser`, `inputData`, etc.).

## Scripts

| Script | Command |
|--------|---------|
| Develop | `npm run dev` |
| Build | `npm run build` |
| Run | `npm start` |
| Test | `npm test` |

## MIP-004

Input hashing follows [MIP-004](https://docs.masumi.network/mips/_mip-004) (JCS + SHA-256). `/start_job` responses include **`inputHash`** in camelCase.
