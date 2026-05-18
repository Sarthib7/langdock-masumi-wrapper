/** Token units expected by Sokosumi listings. */

export const PREPROD_TUSDM_UNIT =
  "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d";

export const MAINNET_USDCX_UNIT =
  "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378";

export const MAINNET_USDM_UNIT =
  "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d";

export const MAINNET_SETTLEMENT_UNITS = [
  MAINNET_USDCX_UNIT,
  MAINNET_USDM_UNIT,
] as const;

export const MASUMI_NETWORK_DETAILS = {
  Preprod: {
    settlementToken: "tUSDM",
    settlementUnit: PREPROD_TUSDM_UNIT,
    acceptedSettlementUnits: [PREPROD_TUSDM_UNIT],
    registryPolicyId:
      "dcdf2c533510e865e3d7e0f0e5537c7a176dd4dc1df69e83a703976b",
    paymentContractAddress:
      "addr_test1wqv9sc853kpurfdqv5f02tmmlscez20ks0p5p6aj76j0xac2jqve7",
    explorerBaseUrl: "https://preprod.cardanoscan.io",
    sokosumiAgentsUrl: "https://preprod.sokosumi.com/agents",
  },
  Mainnet: {
    settlementToken: "USDCx",
    settlementUnit: MAINNET_USDCX_UNIT,
    acceptedSettlementUnits: MAINNET_SETTLEMENT_UNITS,
    registryPolicyId:
      "6323eccc89e311315a59f511e45c85fe48a7d14da743030707d42adf",
    paymentContractAddress:
      "addr1wyv9sc853kpurfdqv5f02tmmlscez20ks0p5p6aj76j0xac365skm",
    explorerBaseUrl: "https://cardanoscan.io",
    sokosumiAgentsUrl: "https://sokosumi.com/agents",
  },
} as const;

export type MasumiNetworkDetails =
  (typeof MASUMI_NETWORK_DETAILS)[keyof typeof MASUMI_NETWORK_DETAILS];

export function masumiNetworkDetails(
  network: keyof typeof MASUMI_NETWORK_DETAILS,
): MasumiNetworkDetails {
  return MASUMI_NETWORK_DETAILS[network];
}
