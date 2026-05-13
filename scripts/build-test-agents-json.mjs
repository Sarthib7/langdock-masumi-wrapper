#!/usr/bin/env node

import "dotenv/config";
import {
  buildTestAgentProfiles,
  mergeProfiles,
  parseProfiles,
} from "./test-agent-profiles.mjs";

const existingProfiles = parseProfiles(process.env.AGENTS_JSON || "[]");
const testProfiles = buildTestAgentProfiles({ existingProfiles });
const nextProfiles = mergeProfiles(existingProfiles, testProfiles);

const pretty = process.argv.includes("--pretty");
process.stdout.write(JSON.stringify(nextProfiles, null, pretty ? 2 : 0));
process.stdout.write("\n");

const missingLangdockIds = testProfiles
  .filter((profile) => profile.langdockAgentId.startsWith("local-"))
  .map((profile) => profile.slug);

if (missingLangdockIds.length > 0) {
  process.stderr.write(
    `Warning: using local placeholder Langdock ids for ${missingLangdockIds.join(", ")}. ` +
      "Set AGENTS_JSON with source profiles or TEST_AGENT_N_LANGDOCK_AGENT_ID for deployable output.\n",
  );
}
