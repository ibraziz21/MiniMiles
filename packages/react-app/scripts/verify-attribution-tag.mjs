#!/usr/bin/env node
// Confirms a Celo mainnet tx actually carries MiniMiles' assigned attribution
// code on-chain. Run after any change to lib/celoAttribution.ts or its call
// sites — decoding is the only way to catch a suffix that got dropped,
// truncated, or bundled in the wrong order.
//
// Usage: node scripts/verify-attribution-tag.mjs <txHash>

import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import { verifyTx } from "@celo/attribution-tags";

const ASSIGNED_CODE = "celo_u7gkqc3b";

const hash = process.argv[2];
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
  console.error("Usage: node scripts/verify-attribution-tag.mjs <txHash>");
  process.exit(1);
}

const client = createPublicClient({ chain: celo, transport: http("https://forno.celo.org") });

const result = await verifyTx({ client, hash });

if (!result) {
  console.error(`FAIL: no attribution tag found on ${hash}`);
  process.exit(1);
}

console.log(`Decoded codes: ${result.codes.join(", ")} (schemaId ${result.schemaId})`);

if (!result.codes.includes(ASSIGNED_CODE)) {
  console.error(`FAIL: assigned code "${ASSIGNED_CODE}" is missing from ${hash}`);
  process.exit(1);
}

console.log(`PASS: ${hash} carries the assigned code "${ASSIGNED_CODE}"`);
