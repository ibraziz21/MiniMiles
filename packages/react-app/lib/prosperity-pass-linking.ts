import { getAddress, isAddress } from "viem";

export const CELO_MAINNET_CHAIN_ID = 42220;
export const CELO_MAINNET_CHAIN_ID_HEX = "0xa4ec";
export const CELO_EXPLORER_URL = "https://celoscan.io";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const DEFAULT_SUPERCHAIN_MODULE_ADDRESS =
  "0x58f5805b5072C3Dd157805132714E1dF40E79c66" as const;

export const LINKED_WALLET_ACTIVE_STATUSES = [
  "created",
  "signature_verified",
  "safe_approved",
  "linked",
] as const;

export const LINKED_WALLET_EXPIRABLE_STATUSES = [
  "created",
  "signature_verified",
  "safe_approved",
] as const;

export const LINKED_WALLET_STATUSES = [
  ...LINKED_WALLET_ACTIVE_STATUSES,
  "failed",
  "expired",
] as const;

export type LinkedWalletStatus = (typeof LINKED_WALLET_STATUSES)[number];

export const SUPERCHAIN_MODULE_LINK_ABI = [
  {
    type: "function",
    name: "populateAddOwner",
    inputs: [
      { name: "_safe", type: "address" },
      { name: "_newOwner", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "addOwnerWithThreshold",
    inputs: [
      { name: "_safe", type: "address" },
      { name: "_newOwner", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    anonymous: false,
    type: "event",
    name: "OwnerPopulated",
    inputs: [
      { indexed: true, name: "safe", type: "address" },
      { indexed: true, name: "newOwner", type: "address" },
      { indexed: false, name: "superChainId", type: "string" },
    ],
  },
  {
    anonymous: false,
    type: "event",
    name: "OwnerAdded",
    inputs: [
      { indexed: true, name: "safe", type: "address" },
      { indexed: true, name: "newOwner", type: "address" },
      { indexed: false, name: "superChainId", type: "string" },
    ],
  },
] as const;

export const SAFE_EXEC_ABI = [
  {
    type: "function",
    name: "execTransaction",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "isOwner",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getThreshold",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export function getSuperchainModuleAddress(): `0x${string}` {
  return (
    process.env.NEXT_PUBLIC_SUPERCHAIN_MODULE_ADDRESS ||
    process.env.SUPERCHAIN_MODULE_ADDRESS ||
    DEFAULT_SUPERCHAIN_MODULE_ADDRESS
  ) as `0x${string}`;
}

export function normalizeEvmAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !isAddress(value)) return null;
  return getAddress(value).toLowerCase() as `0x${string}`;
}

export function isTxHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function isZeroAddress(value: string | null | undefined): boolean {
  return !value || value.toLowerCase() === ZERO_ADDRESS;
}

export function buildExternalWalletLinkMessage(params: {
  requestId: string;
  primaryWallet: string;
  linkedWallet: string;
  safeAddress: string;
  nonce: string;
  issuedAt: string;
}): string {
  return [
    "Link external wallet to AkibaMiles Prosperity Pass",
    "",
    "This proves the external wallet belongs to you and can be linked to your Prosperity Pass.",
    "This signature does not move funds or submit a blockchain transaction.",
    "",
    `Primary wallet: ${params.primaryWallet.toLowerCase()}`,
    `External wallet: ${params.linkedWallet.toLowerCase()}`,
    `Prosperity Pass Safe: ${params.safeAddress.toLowerCase()}`,
    `Request ID: ${params.requestId}`,
    `Nonce: ${params.nonce}`,
    `Issued at: ${params.issuedAt}`,
  ].join("\n");
}

export function makePrevalidatedSafeSignature(owner: string): `0x${string}` {
  const normalized = normalizeEvmAddress(owner);
  if (!normalized) throw new Error("Invalid Safe owner address");

  const r = normalized.slice(2).padStart(64, "0");
  const s = "0".repeat(64);
  return `0x${r}${s}01`;
}

export function celoTxUrl(txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  return `${CELO_EXPLORER_URL}/tx/${txHash}`;
}
