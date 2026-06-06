import { randomBytes, randomUUID } from "crypto";
import { ethers } from "ethers";
import { verifyMessage } from "viem";
import { supabase } from "@/lib/supabaseClient";
import { fetchSuperAccountForOwner } from "@/lib/prosperity-pass";
import {
  CELO_MAINNET_CHAIN_ID,
  LINKED_WALLET_ACTIVE_STATUSES,
  LINKED_WALLET_EXPIRABLE_STATUSES,
  LinkedWalletStatus,
  SUPERCHAIN_MODULE_LINK_ABI,
  buildExternalWalletLinkMessage,
  getSuperchainModuleAddress,
  isTxHash,
  isZeroAddress,
  normalizeEvmAddress,
} from "@/lib/prosperity-pass-linking";

export type LinkedWalletRequestRow = {
  id: string;
  primary_wallet: string;
  safe_address: string;
  linked_wallet: string;
  status: LinkedWalletStatus;
  signature_message: string | null;
  signature: string | null;
  signature_verified_at: string | null;
  safe_approval_tx_hash: string | null;
  safe_approved_at: string | null;
  final_tx_hash: string | null;
  linked_at: string | null;
  expires_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicLinkedWalletRequest = {
  id: string;
  primaryWallet: string;
  safeAddress: string;
  linkedWallet: string;
  status: LinkedWalletStatus;
  signatureMessage: string | null;
  signatureVerifiedAt: string | null;
  safeApprovalTxHash: string | null;
  safeApprovedAt: string | null;
  finalTxHash: string | null;
  linkedAt: string | null;
  expiresAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  moduleAddress: `0x${string}`;
  chainId: number;
};

const CELO_RPC_URL =
  process.env.CELO_RPC_URL ||
  process.env.NEXT_PUBLIC_CELO_RPC_URL ||
  "https://forno.celo.org";

const LINK_REQUEST_TTL_HOURS = 24;

const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
const moduleInterface = new ethers.Interface(SUPERCHAIN_MODULE_LINK_ABI as any);

function asRow(data: unknown): LinkedWalletRequestRow {
  return data as LinkedWalletRequestRow;
}

export function toPublicLinkedWalletRequest(
  row: LinkedWalletRequestRow
): PublicLinkedWalletRequest {
  return {
    id: row.id,
    primaryWallet: row.primary_wallet,
    safeAddress: row.safe_address,
    linkedWallet: row.linked_wallet,
    status: row.status,
    signatureMessage: row.signature_message,
    signatureVerifiedAt: row.signature_verified_at,
    safeApprovalTxHash: row.safe_approval_tx_hash,
    safeApprovedAt: row.safe_approved_at,
    finalTxHash: row.final_tx_hash,
    linkedAt: row.linked_at,
    expiresAt: row.expires_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    moduleAddress: getSuperchainModuleAddress(),
    chainId: CELO_MAINNET_CHAIN_ID,
  };
}

export async function expireStaleLinkedWalletRequests(
  primaryWallet?: string
): Promise<void> {
  let query = supabase
    .from("prosperity_pass_linked_wallets")
    .update({
      status: "expired",
      last_error: "Link request expired before completion",
    })
    .in("status", [...LINKED_WALLET_EXPIRABLE_STATUSES])
    .lt("expires_at", new Date().toISOString());

  if (primaryWallet) {
    query = query.eq("primary_wallet", primaryWallet);
  }

  const { error } = await query;
  if (error) {
    console.warn("[linked-wallets] expire stale failed", error);
  }
}

export async function getLatestLinkedWalletRequestForPrimary(
  primaryWallet: string
): Promise<LinkedWalletRequestRow | null> {
  await expireStaleLinkedWalletRequests(primaryWallet);

  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .select("*")
    .eq("primary_wallet", primaryWallet)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? asRow(data) : null;
}

export async function getLinkedWalletRequestById(
  id: string
): Promise<LinkedWalletRequestRow | null> {
  await expireStaleLinkedWalletRequests();

  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? asRow(data) : null;
}

export async function createLinkedWalletRequest(params: {
  primaryWallet: string;
  linkedWallet: string;
}): Promise<LinkedWalletRequestRow> {
  const primaryWallet = normalizeEvmAddress(params.primaryWallet);
  const linkedWallet = normalizeEvmAddress(params.linkedWallet);

  if (!primaryWallet) throw new Error("Invalid primary wallet");
  if (!linkedWallet) throw new Error("Invalid external wallet");
  if (primaryWallet === linkedWallet) {
    throw new Error("External wallet must be different from your MiniPay wallet");
  }

  await expireStaleLinkedWalletRequests(primaryWallet);

  const existingPrimary = await getActiveRequest("primary_wallet", primaryWallet);
  if (existingPrimary) {
    throw new Error("This Prosperity Pass already has an active linked wallet request");
  }

  const existingExternal = await getActiveRequest("linked_wallet", linkedWallet);
  if (existingExternal) {
    throw new Error("This external wallet is already linked or pending");
  }

  const pass = await fetchSuperAccountForOwner(primaryWallet);
  if (!pass.hasPassport || !pass.account || isZeroAddress(pass.account.smartAccount)) {
    throw new Error("Create your Prosperity Pass before linking an external wallet");
  }

  const linkedPass = await fetchSuperAccountForOwner(linkedWallet);
  if (linkedPass.hasPassport) {
    throw new Error("This external wallet already has a Prosperity Pass");
  }

  const safeAddress = normalizeEvmAddress(pass.account.smartAccount);
  if (!safeAddress) throw new Error("Could not resolve Prosperity Pass Safe");

  const requestId = randomUUID();
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const signatureMessage = buildExternalWalletLinkMessage({
    requestId,
    primaryWallet,
    linkedWallet,
    safeAddress,
    nonce,
    issuedAt,
  });

  const expiresAt = new Date(
    Date.now() + LINK_REQUEST_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .insert({
      id: requestId,
      primary_wallet: primaryWallet,
      safe_address: safeAddress,
      linked_wallet: linkedWallet,
      status: "created",
      signature_message: signatureMessage,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) throw error;
  return asRow(data);
}

export async function verifyExternalWalletSignature(params: {
  row: LinkedWalletRequestRow;
  signature: string;
}): Promise<LinkedWalletRequestRow> {
  const { row, signature } = params;

  assertNotExpired(row);

  if (!/^0x[a-fA-F0-9]+$/.test(signature)) {
    throw new Error("Invalid signature format");
  }

  if (!row.signature_message) {
    throw new Error("Missing signature message");
  }

  const valid = await verifyMessage({
    address: row.linked_wallet as `0x${string}`,
    message: row.signature_message,
    signature: signature as `0x${string}`,
  });

  if (!valid) {
    throw new Error("Signature does not match the external wallet");
  }

  // Already done — idempotent
  if (row.status === "linked" || row.status === "safe_approved" || row.status === "signature_verified") {
    return row;
  }

  if (row.status !== "created") {
    throw new Error(`Cannot verify signature while request is ${row.status}`);
  }

  // Signature is sufficient proof of ownership — mark as linked immediately.
  // The Safe owner steps are no longer required for activity-tracking use cases.
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .update({
      status: "linked",
      signature,
      signature_verified_at: now,
      linked_at: now,
      last_error: null,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) throw error;
  return asRow(data);
}

export async function confirmSafeApprovalTx(params: {
  row: LinkedWalletRequestRow;
  txHash: string;
}): Promise<LinkedWalletRequestRow> {
  const { row, txHash } = params;
  assertNotExpired(row);
  assertTxHash(txHash);

  if (row.status === "linked") return row;
  if (row.status !== "signature_verified" && row.status !== "safe_approved") {
    throw new Error("External wallet signature must be verified first");
  }

  const receipt = await getConfirmedReceipt(txHash);
  const matched = receiptHasModuleEvent(receipt, "OwnerPopulated", row);

  if (!matched) {
    throw new Error("Transaction did not approve this external wallet on the pass Safe");
  }

  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .update({
      status: "safe_approved",
      safe_approval_tx_hash: txHash,
      safe_approved_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) throw error;
  return asRow(data);
}

export async function confirmFinalAddOwnerTx(params: {
  row: LinkedWalletRequestRow;
  txHash: string;
}): Promise<LinkedWalletRequestRow> {
  const { row, txHash } = params;
  assertNotExpired(row);
  assertTxHash(txHash);

  if (row.status === "linked") return row;
  if (row.status !== "safe_approved") {
    throw new Error("Pass Safe approval must be completed first");
  }

  const receipt = await getConfirmedReceipt(txHash);
  const matched = receiptHasModuleEvent(receipt, "OwnerAdded", row);

  if (!matched) {
    throw new Error("Transaction did not add this external wallet to the pass Safe");
  }

  const linkedPass = await fetchSuperAccountForOwner(row.linked_wallet);
  const linkedSafe = normalizeEvmAddress(linkedPass.account?.smartAccount);
  if (!linkedPass.hasPassport || linkedSafe !== row.safe_address) {
    throw new Error("External wallet is not linked to the expected Prosperity Pass");
  }

  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .update({
      status: "linked",
      final_tx_hash: txHash,
      linked_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) throw error;
  return asRow(data);
}

export async function getTrackedWalletsForUser(
  primaryWalletInput: string
): Promise<`0x${string}`[]> {
  const primaryWallet = normalizeEvmAddress(primaryWalletInput);
  if (!primaryWallet) return [];

  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .select("linked_wallet")
    .eq("primary_wallet", primaryWallet)
    .eq("status", "linked")
    .limit(1);

  if (error) throw error;

  const wallets = new Set<`0x${string}`>([primaryWallet]);
  for (const row of data ?? []) {
    const linked = normalizeEvmAddress((row as any).linked_wallet);
    if (linked) wallets.add(linked);
  }
  return [...wallets];
}

async function getActiveRequest(
  column: "primary_wallet" | "linked_wallet",
  value: string
): Promise<LinkedWalletRequestRow | null> {
  const { data, error } = await supabase
    .from("prosperity_pass_linked_wallets")
    .select("*")
    .eq(column, value)
    .in("status", [...LINKED_WALLET_ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? asRow(data) : null;
}

function assertNotExpired(row: LinkedWalletRequestRow): void {
  if (
    row.status !== "linked" &&
    (row.status === "expired" || new Date(row.expires_at).getTime() < Date.now())
  ) {
    throw new Error("Link request has expired");
  }
}

function assertTxHash(txHash: string): asserts txHash is `0x${string}` {
  if (!isTxHash(txHash)) {
    throw new Error("Invalid transaction hash");
  }
}

async function getConfirmedReceipt(txHash: string): Promise<ethers.TransactionReceipt> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error("Transaction is not confirmed yet");
  }
  if (receipt.status !== 1) {
    throw new Error("Transaction failed on-chain");
  }
  return receipt;
}

function receiptHasModuleEvent(
  receipt: ethers.TransactionReceipt,
  eventName: "OwnerPopulated" | "OwnerAdded",
  row: LinkedWalletRequestRow
): boolean {
  const moduleAddress = getSuperchainModuleAddress().toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== moduleAddress) continue;

    try {
      const parsed = moduleInterface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });

      if (!parsed || parsed.name !== eventName) continue;

      const safe = normalizeEvmAddress(parsed.args.safe);
      const newOwner = normalizeEvmAddress(parsed.args.newOwner);
      if (safe === row.safe_address && newOwner === row.linked_wallet) {
        return true;
      }
    } catch {
      // Ignore logs emitted by the same contract but unrelated to this flow.
    }
  }

  return false;
}
