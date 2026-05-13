const DEFAULT_PUBLIC_BASE_URL = "http://127.0.0.1:3000";

export const TEST_AGENT_SPECS = [
  {
    slug: "test-agent-1",
    name: "Test Agent 1",
    sourceSlug: "lexi",
    langdockEnv: "TEST_AGENT_1_LANGDOCK_AGENT_ID",
    identifierEnv: "TEST_AGENT_1_AGENT_IDENTIFIER",
  },
  {
    slug: "test-agent-2",
    name: "Test Agent 2",
    sourceSlug: "emil-conrad",
    langdockEnv: "TEST_AGENT_2_LANGDOCK_AGENT_ID",
    identifierEnv: "TEST_AGENT_2_AGENT_IDENTIFIER",
  },
  {
    slug: "test-agent-3",
    name: "Test Agent 3",
    sourceSlug: "diddy-p",
    langdockEnv: "TEST_AGENT_3_LANGDOCK_AGENT_ID",
    identifierEnv: "TEST_AGENT_3_AGENT_IDENTIFIER",
  },
  {
    slug: "test-agent-4",
    name: "Test Agent 4",
    sourceSlug: "food-co2-analyst",
    langdockEnv: "TEST_AGENT_4_LANGDOCK_AGENT_ID",
    identifierEnv: "TEST_AGENT_4_AGENT_IDENTIFIER",
  },
];

export function parseProfiles(raw) {
  if (!raw?.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("AGENTS_JSON must be a JSON array.");
  }
  return parsed;
}

export function buildTestAgentProfiles({
  existingProfiles = [],
  publicBaseUrl = process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
  env = process.env,
  localIdentifiers = false,
} = {}) {
  const baseUrl = publicBaseUrl.replace(/\/$/, "");
  const bySlug = new Map(
    existingProfiles
      .filter((profile) => profile && typeof profile === "object")
      .map((profile) => [profile.slug, profile]),
  );

  return TEST_AGENT_SPECS.map((spec, index) => {
    const current = bySlug.get(spec.slug);
    const source = bySlug.get(spec.sourceSlug);
    const langdockAgentId =
      normalize(current?.langdockAgentId) ||
      normalize(source?.langdockAgentId) ||
      normalize(env[spec.langdockEnv]) ||
      `local-${spec.slug}`;
    const agentIdentifier =
      normalize(env[spec.identifierEnv]) ||
      normalize(current?.agentIdentifier) ||
      (localIdentifiers ? `local-agent-identifier-${index + 1}` : "");

    return {
      slug: spec.slug,
      name: spec.name,
      description: `Preprod smoke test agent ${index + 1} for Langdock Masumi wrapper verification.`,
      apiBaseUrl: `${baseUrl}/agents/${spec.slug}`,
      langdockAgentId,
      agentIdentifier,
      priceAmounts: [],
    };
  });
}

export function mergeProfiles(existingProfiles, testProfiles) {
  const nextBySlug = new Map(
    existingProfiles
      .filter((profile) => profile && typeof profile === "object")
      .map((profile) => [profile.slug, profile]),
  );

  for (const profile of testProfiles) {
    nextBySlug.set(profile.slug, {
      ...nextBySlug.get(profile.slug),
      ...profile,
    });
  }

  return [...nextBySlug.values()];
}

function normalize(value) {
  return typeof value === "string" ? value.trim() : "";
}
