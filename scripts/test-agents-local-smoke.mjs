#!/usr/bin/env node

import "dotenv/config";
import {
  buildTestAgentProfiles,
  mergeProfiles,
  parseProfiles,
} from "./test-agent-profiles.mjs";

const existingProfiles = parseProfiles(process.env.AGENTS_JSON || "[]");
const testProfiles = buildTestAgentProfiles({
  existingProfiles,
  localIdentifiers: true,
});

process.env.PAYMENT_MODE = "direct";
process.env.LANGDOCK_BASE_URL = "https://langdock.local";
process.env.LANGDOCK_API_KEY = process.env.LANGDOCK_API_KEY || "local-test-key";
process.env.LANGDOCK_AGENT_ID = process.env.LANGDOCK_AGENT_ID || "local-default-agent";
process.env.AGENTS_JSON = JSON.stringify(mergeProfiles(existingProfiles, testProfiles));
process.env.HITL_CHAT_MODE = "false";

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = typeof url === "string" ? url : String(url);
  if (target.endsWith("/agent/v1/chat/completions")) {
    const body = JSON.parse(String(init.body || "{}"));
    return jsonResponse({
      messages: [
        {
          id: "local-smoke-message",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `OK ${body.agentId}`,
            },
          ],
        },
      ],
    });
  }

  throw new Error(`Unexpected external fetch in local smoke: ${target}`);
};

try {
  const { buildApp } = await import("../dist/app.js");
  const { getJob } = await import("../dist/services/jobs.js");
  const app = await buildApp();
  const results = [];

  try {
    for (const profile of testProfiles) {
      const availability = await app.inject({
        method: "GET",
        url: `/agents/${profile.slug}/availability`,
      });
      assertStatus(availability, 200, `${profile.slug} availability`);

      const inputSchema = await app.inject({
        method: "GET",
        url: `/agents/${profile.slug}/input_schema`,
      });
      assertStatus(inputSchema, 200, `${profile.slug} input_schema`);

      const start = await app.inject({
        method: "POST",
        url: `/agents/${profile.slug}/start_job`,
        payload: {
          identifier_from_purchaser: `aabbccddeeff00${profile.slug.slice(-1)}`,
          input_data: [{ key: "text", value: `Local smoke for ${profile.name}` }],
        },
      });
      assertStatus(start, 200, `${profile.slug} start_job`);

      const startBody = start.json();
      await waitUntil(() => getJob(startBody.id)?.status === "completed");

      const status = await app.inject({
        method: "GET",
        url: `/agents/${profile.slug}/status?job_id=${startBody.id}`,
      });
      assertStatus(status, 200, `${profile.slug} status`);
      const statusBody = status.json();
      if (statusBody.status !== "completed") {
        throw new Error(`${profile.slug} did not complete: ${JSON.stringify(statusBody)}`);
      }

      results.push({
        slug: profile.slug,
        langdockAgentId: profile.langdockAgentId,
        jobId: startBody.id,
        status: statusBody.status,
        result: statusBody.result,
      });
    }
  } finally {
    await app.close();
  }

  process.stdout.write(JSON.stringify({ ok: true, results }, null, 2));
  process.stdout.write("\n");
} finally {
  globalThis.fetch = originalFetch;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function assertStatus(response, expected, label) {
  if (response.statusCode !== expected) {
    throw new Error(`${label} expected HTTP ${expected}, got ${response.statusCode}: ${response.body}`);
  }
}

function waitUntil(predicate, timeoutMs = 2000, intervalMs = 20) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for local smoke job completion."));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
