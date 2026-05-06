import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { randomUUID } from "crypto";
import { ethers, NonceManager } from "ethers";
import { SafeFactory, EthersAdapter } from "@safe-global/protocol-kit";
import { supabase } from "./supabaseClient";

const CELO_RPC_URL = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const SUPERCHAIN_RPC_URL = process.env.SUPERCHAIN_RPC_URL ?? CELO_RPC_URL;
const MINIPOINTS_V2_ADDRESS =
  process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
const PASS_RELAYER_KEY = process.env.PASS_RELAYER_KEY ?? process.env.BADGES_RELAYER_KEY ?? "";
const SUPERCHAIN_MODULE_ADDRESS =
  process.env.SUPERCHAIN_MODULE_ADDRESS ?? "0x58f5805b5072C3Dd157805132714E1dF40E79c66";
const SUPERCHAIN_GUARD_ADDRESS =
  process.env.SUPERCHAIN_GUARD_ADDRESS ?? "0xED12D87487B372cf4447C8147a89aA01C133Dc52";
const SUPERCHAIN_SETUP_ADDRESS =
  process.env.SUPERCHAIN_SETUP_ADDRESS ?? "0xe0651391D3fEF63F14FB33C9cf4F157F3eD0F4AF";
const ERC4337_MODULE_ADDRESS =
  process.env.ERC4337_MODULE_ADDRESS ?? "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
const SAFE_VERSION = process.env.SAFE_VERSION ?? "1.4.1";
const LOCK_NAME = "prosperity_pass_worker";
const LOCK_LEASE_SECONDS = 300;
const STALLED_JOB_AGE_MS = LOCK_LEASE_SECONDS * 1000 * 2;
const MAX_JOB_ATTEMPTS = 5;

const MINIPOINTS_ABI = [
  "function burn(address account, uint256 amount) external",
  "function mint(address account, uint256 amount) external",
];

const SUPERCHAIN_MODULE_ABI = [
  {
    inputs: [{ internalType: "address", name: "_owner", type: "address" }],
    name: "getUserSuperChainAccount",
    outputs: [
      {
        components: [
          { internalType: "address", name: "smartAccount", type: "address" },
          { internalType: "string", name: "superChainID", type: "string" },
          { internalType: "uint256", name: "points", type: "uint256" },
          { internalType: "uint16", name: "level", type: "uint16" },
          {
            components: [
              { internalType: "uint48", name: "background", type: "uint48" },
              { internalType: "uint48", name: "body", type: "uint48" },
              { internalType: "uint48", name: "accessory", type: "uint48" },
              { internalType: "uint48", name: "head", type: "uint48" },
              { internalType: "uint48", name: "glasses", type: "uint48" },
            ],
            internalType: "struct NounMetadata",
            name: "noun",
            type: "tuple",
          },
        ],
        internalType: "struct ISuperChainModule.Account",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

const SETUP_ABI = [
  {
    type: "function",
    name: "setupSuperChainAccount",
    inputs: [
      { name: "modules", type: "address[]" },
      { name: "superChainModule", type: "address" },
      { name: "guard", type: "address" },
      { name: "owner", type: "address" },
      {
        name: "seed",
        type: "tuple",
        components: [
          { name: "background", type: "uint48" },
          { name: "body", type: "uint48" },
          { name: "accessory", type: "uint48" },
          { name: "head", type: "uint48" },
          { name: "glasses", type: "uint48" },
        ],
      },
      { name: "superChainID", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const DEFAULT_NOUN_SEED = {
  background: 0,
  body: 0,
  accessory: 0,
  head: 0,
  glasses: 0,
} as const;

type ProsperityPassJob = {
  id: string;
  idempotency_key: string;
  user_address: string;
  points: number;
  status: "pending" | "processing" | "completed" | "failed";
  superchain_id: string | null;
  safe_address: string | null;
  burn_tx_hash: string | null;
  tx_hash: string | null;
  refund_tx_hash: string | null;
  last_error: string | null;
  attempts: number;
};

const superchainProvider = new ethers.JsonRpcProvider(SUPERCHAIN_RPC_URL);
const celoProvider = new ethers.JsonRpcProvider(CELO_RPC_URL);

let isRunning = false;
let currentLockOwner: string | null = null;

function makeSuperChainId(username: string | null, address: string): string {
  const base = username && username.trim().length > 0
    ? username.trim().toLowerCase()
    : `user-${address.replace(/^0x/, "").slice(0, 6).toLowerCase()}`;
  return `${base}.akiba`;
}

function hasPassport(rawAccount: any): boolean {
  const smartAccount = String(rawAccount?.smartAccount ?? "");
  const superChainID = String(rawAccount?.superChainID ?? "");
  const points = BigInt(rawAccount?.points ?? 0);
  const level = BigInt(rawAccount?.level ?? 0);

  return (
    (smartAccount !== "" && smartAccount.toLowerCase() !== ethers.ZeroAddress.toLowerCase()) ||
    superChainID.length > 0 ||
    points > 0n ||
    level > 0n
  );
}

async function fetchUsername(userAddress: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("users")
    .select("username")
    .eq("user_address", userAddress)
    .maybeSingle();

  if (error) throw error;
  return data?.username ?? null;
}

async function getExistingPass(owner: string) {
  const contract = new ethers.Contract(
    SUPERCHAIN_MODULE_ADDRESS,
    SUPERCHAIN_MODULE_ABI,
    superchainProvider,
  );
  return contract.getUserSuperChainAccount(owner);
}

function getRelayerSigner() {
  if (!PASS_RELAYER_KEY) throw new Error("PASS_RELAYER_KEY not set");
  return new NonceManager(new ethers.Wallet(PASS_RELAYER_KEY, celoProvider));
}

async function burnPassPoints(userAddress: string, points: number): Promise<string> {
  const signer = getRelayerSigner();
  const contract = new ethers.Contract(MINIPOINTS_V2_ADDRESS, MINIPOINTS_ABI, signer);
  const tx = await contract.burn(userAddress, ethers.parseUnits(String(points), 18));
  await tx.wait();
  return tx.hash;
}

async function refundPassPoints(userAddress: string, points: number): Promise<string> {
  const signer = getRelayerSigner();
  const contract = new ethers.Contract(MINIPOINTS_V2_ADDRESS, MINIPOINTS_ABI, signer);
  const tx = await contract.mint(userAddress, ethers.parseUnits(String(points), 18));
  await tx.wait();
  return tx.hash;
}

async function createSuperAccount(owner: string, superChainID: string): Promise<{ safeAddress: string; txHash?: string }> {
  const signer = getRelayerSigner();
  const ethAdapter = new EthersAdapter({
    ethers,
    signerOrProvider: signer as any,
  });

  const safeFactory = await SafeFactory.create({
    ethAdapter,
    safeVersion: SAFE_VERSION as any,
  });

  const setupIface = new ethers.Interface(SETUP_ABI);
  const modules: string[] =
    ERC4337_MODULE_ADDRESS === ethers.ZeroAddress ? [] : [ERC4337_MODULE_ADDRESS];

  const setupData = setupIface.encodeFunctionData("setupSuperChainAccount", [
    modules,
    SUPERCHAIN_MODULE_ADDRESS,
    SUPERCHAIN_GUARD_ADDRESS,
    owner,
    DEFAULT_NOUN_SEED,
    superChainID,
  ]);

  const safeAccountConfig = {
    owners: [owner],
    threshold: 1,
    to: SUPERCHAIN_SETUP_ADDRESS,
    data: setupData,
    fallbackHandler: ERC4337_MODULE_ADDRESS,
    paymentToken: ethers.ZeroAddress,
    payment: 0,
    paymentReceiver: ethers.ZeroAddress,
  };

  let deploymentTxHash: string | undefined;
  const protocolKit = await safeFactory.deploySafe({
    safeAccountConfig,
    saltNonce: Date.now().toString(),
    callback: (txHash: string) => {
      deploymentTxHash = txHash;
    },
  });

  return {
    safeAddress: await protocolKit.getAddress(),
    txHash: deploymentTxHash,
  };
}

async function resetStalledJobs() {
  const cutoff = new Date(Date.now() - STALLED_JOB_AGE_MS).toISOString();
  const { data } = await supabase
    .from("prosperity_pass_jobs")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .select("id");

  const count = data?.length ?? 0;
  if (count > 0) console.log(`[passWorker] Unstuck ${count} stalled jobs`);
}

async function claimBatch(count: number): Promise<ProsperityPassJob[]> {
  const { data: jobs, error } = await supabase
    .from("prosperity_pass_jobs")
    .select("*")
    .eq("status", "pending")
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(count);

  if (error) throw error;
  if (!jobs || jobs.length === 0) return [];

  await supabase
    .from("prosperity_pass_jobs")
    .update({
      status: "processing",
      processing_by: currentLockOwner,
      processing_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("id", jobs.map((j) => j.id));

  for (const job of jobs) {
    await supabase
      .from("prosperity_pass_jobs")
      .update({ attempts: (job.attempts ?? 0) + 1 })
      .eq("id", job.id);
  }

  return jobs as ProsperityPassJob[];
}

async function completeJob(jobId: string, values: { superchain_id: string; safe_address: string; tx_hash: string | null; burn_tx_hash: string | null }) {
  const { error } = await supabase
    .from("prosperity_pass_jobs")
    .update({
      status: "completed",
      superchain_id: values.superchain_id,
      safe_address: values.safe_address,
      tx_hash: values.tx_hash,
      burn_tx_hash: values.burn_tx_hash,
      last_error: null,
      processing_by: null,
      processing_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) throw error;
}

async function failJob(jobId: string, message: string, extra?: Partial<ProsperityPassJob>) {
  const payload: Record<string, unknown> = {
    status: "failed",
    last_error: message.slice(0, 2000),
    processing_by: null,
    processing_started_at: null,
    updated_at: new Date().toISOString(),
  };

  if (extra?.burn_tx_hash !== undefined) payload.burn_tx_hash = extra.burn_tx_hash;
  if (extra?.refund_tx_hash !== undefined) payload.refund_tx_hash = extra.refund_tx_hash;
  if (extra?.superchain_id !== undefined) payload.superchain_id = extra.superchain_id;
  if (extra?.safe_address !== undefined) payload.safe_address = extra.safe_address;
  if (extra?.tx_hash !== undefined) payload.tx_hash = extra.tx_hash;

  const { error } = await supabase
    .from("prosperity_pass_jobs")
    .update(payload)
    .eq("id", jobId);

  if (error) throw error;
}

async function retryJob(jobId: string, message: string, delaySeconds = 15) {
  const { error } = await supabase
    .from("prosperity_pass_jobs")
    .update({
      status: "pending",
      last_error: message.slice(0, 2000),
      available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      processing_by: null,
      processing_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) throw error;
}

async function handleJob(job: ProsperityPassJob) {
  let burnTxHash = job.burn_tx_hash ?? null;

  try {
    const existing = await getExistingPass(job.user_address);
    if (hasPassport(existing)) {
      await completeJob(job.id, {
        superchain_id: String(existing.superChainID ?? ""),
        safe_address: String(existing.smartAccount ?? ""),
        tx_hash: null,
        burn_tx_hash: burnTxHash,
      });
      return;
    }

    const username = await fetchUsername(job.user_address);
    const superChainID = job.superchain_id ?? makeSuperChainId(username, job.user_address);

    if (!burnTxHash) {
      burnTxHash = await burnPassPoints(job.user_address, job.points);
      await supabase
        .from("prosperity_pass_jobs")
        .update({ burn_tx_hash: burnTxHash, superchain_id: superChainID, updated_at: new Date().toISOString() })
        .eq("id", job.id);
    }

    const { safeAddress, txHash } = await createSuperAccount(job.user_address, superChainID);

    await completeJob(job.id, {
      superchain_id: superChainID,
      safe_address: safeAddress,
      tx_hash: txHash ?? null,
      burn_tx_hash: burnTxHash,
    });
  } catch (err: any) {
    const message = err?.shortMessage ?? err?.message ?? "Prosperity Pass worker failed";

    if (burnTxHash) {
      try {
        const existing = await getExistingPass(job.user_address);
        if (hasPassport(existing)) {
          await completeJob(job.id, {
            superchain_id: String(existing.superChainID ?? job.superchain_id ?? ""),
            safe_address: String(existing.smartAccount ?? ""),
            tx_hash: null,
            burn_tx_hash: burnTxHash,
          });
          return;
        }
      } catch {}

      try {
        const refundTxHash = await refundPassPoints(job.user_address, job.points);
        await failJob(job.id, message, { burn_tx_hash: burnTxHash, refund_tx_hash: refundTxHash });
        return;
      } catch (refundErr: any) {
        const refundMsg = refundErr?.shortMessage ?? refundErr?.message ?? "refund failed";
        await failJob(job.id, `${message} | refund: ${refundMsg}`, { burn_tx_hash: burnTxHash });
        return;
      }
    }

    if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
      await failJob(job.id, message);
    } else {
      await retryJob(job.id, message);
    }
  }
}

export async function releaseCurrentPassLock() {
  if (!currentLockOwner) return;
  try {
    await supabase.rpc("release_minipoint_mint_queue_lock", {
      p_lock_name: LOCK_NAME,
      p_owner: currentLockOwner,
    });
  } catch {}
  currentLockOwner = null;
}

export async function runProsperityPassDrain() {
  if (isRunning) {
    console.log("[passWorker] Already running, skipping");
    return;
  }

  isRunning = true;

  try {
    const owner = randomUUID();
    const { data: acquired } = await supabase.rpc("acquire_minipoint_mint_queue_lock", {
      p_lock_name: LOCK_NAME,
      p_owner: owner,
      p_lease_seconds: LOCK_LEASE_SECONDS,
    });

    if (!acquired) {
      console.log("[passWorker] Lock busy, skipping");
      return;
    }

    currentLockOwner = owner;
    await resetStalledJobs();

    while (true) {
      const jobs = await claimBatch(3);
      if (jobs.length === 0) {
        console.log("[passWorker] Queue empty, done.");
        break;
      }

      for (const job of jobs) {
        await handleJob(job);
      }
    }
  } catch (err: any) {
    console.error("[passWorker] Fatal:", err?.message ?? err);
  } finally {
    await releaseCurrentPassLock();
    isRunning = false;
  }
}

export async function startProsperityPassWorker() {
  console.log("[passWorker] Starting — runs every minute");
  if (!PASS_RELAYER_KEY) {
    console.warn(
      "[passWorker] PASS_RELAYER_KEY/BADGES_RELAYER_KEY missing — jobs can be queued but will never burn or mint a Prosperity Pass."
    );
  }
  runProsperityPassDrain().catch(console.error);
  cron.schedule("* * * * *", () => {
    runProsperityPassDrain().catch(console.error);
  });
}
