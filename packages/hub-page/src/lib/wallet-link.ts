/**
 * Verified wallet linking — challenge message + signature verification
 * (production-readiness-security-spec.md §3.2).
 *
 * The signed statement binds domain/environment, the authenticated Hub
 * user, the normalized address, ecosystem/chain, a random nonce, and an
 * expiry — so a signature can't be replayed against a different user,
 * domain, or purpose.
 */

import { createHash, randomBytes } from "crypto";
import { recoverMessageAddress } from "viem";
import { getServerEnv } from "@/lib/env.server";

export const CHALLENGE_TTL_SECONDS = 5 * 60;

export const ECOSYSTEM_CHAIN_IDS: Record<"minipay" | "base", number[]> = {
  minipay: [42220, 44787], // Celo mainnet, Alfajores testnet
  base: [8453, 84532], // Base mainnet, Base Sepolia testnet
};

export type Ecosystem = keyof typeof ECOSYSTEM_CHAIN_IDS;

export function isValidEcosystem(value: unknown): value is Ecosystem {
  return value === "minipay" || value === "base";
}

export function isValidChainIdForEcosystem(ecosystem: Ecosystem, chainId: number): boolean {
  return ECOSYSTEM_CHAIN_IDS[ecosystem].includes(chainId);
}

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

export function hashChallengeSecret(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/** One-way opaque binding of the challenge to the Hub user, safe to put in a client-visible signed message. */
export function opaqueUserBinding(hubUserId: string): string {
  return createHash("sha256").update(`hub-user:${hubUserId}`).digest("hex").slice(0, 16);
}

export type ChallengeMessageInput = {
  domain: string;
  hubUserId: string;
  address: string;
  ecosystem: Ecosystem;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
};

export function buildChallengeMessage(input: ChallengeMessageInput): string {
  const { domain, hubUserId, address, ecosystem, chainId, nonce, issuedAt, expiresAt } = input;
  return [
    "Akiba Hub wallet link",
    `Domain: ${domain}`,
    `Hub user: ${opaqueUserBinding(hubUserId)}`,
    `Wallet: ${address}`,
    `Ecosystem: ${ecosystem}`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued at: ${issuedAt.toISOString()}`,
    `Expires at: ${expiresAt.toISOString()}`,
    "Purpose: link_wallet",
  ].join("\n");
}

export function expectedDomain(): string {
  const env = getServerEnv();
  try {
    return new URL(env.siteUrl).host;
  } catch {
    return env.siteUrl;
  }
}

/**
 * Recovers the signer of `message` and reports whether it matches
 * `expectedAddress` (already normalized). Never throws — a malformed
 * signature is just a verification failure, not a server error.
 */
export async function verifySignedMessage(
  message: string,
  signature: string,
  expectedAddress: string
): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
    return normalizeAddress(recovered) === expectedAddress;
  } catch {
    return false;
  }
}
