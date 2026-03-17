// app/api/create-super-account/route.ts
import { NextRequest, NextResponse } from "next/server";
import { ethers, NonceManager } from "ethers";
import { SafeFactory, EthersAdapter } from "@safe-global/protocol-kit";

export const runtime = "nodejs";

/* ────────────────────────────── Env / config ────────────────────────────── */

const CELO_RPC_URL = process.env.CELO_RPC_URL || "https://forno.celo.org";

const BACKEND_PRIVATE_KEY = process.env.BADGES_RELAYER_KEY;

// Prosperity Pass deployment addresses (Prosperity Pass row from your doc)
const SUPERCHAIN_MODULE_ADDRESS =
  process.env.SUPERCHAIN_MODULE_ADDRESS ??
  "0x58f5805b5072C3Dd157805132714E1dF40E79c66";

const SUPERCHAIN_GUARD_ADDRESS =
  process.env.SUPERCHAIN_GUARD_ADDRESS ??
  "0xED12D87487B372cf4447C8147a89aA01C133Dc52";

const SUPERCHAIN_SETUP_ADDRESS =
  process.env.SUPERCHAIN_SETUP_ADDRESS ??
  "0xe0651391D3fEF63F14FB33C9cf4F157F3eD0F4AF";

// Optional AA module: if not set, we just don’t wire ERC4337 yet
const ERC4337_MODULE_ADDRESS =
  process.env.ERC4337_MODULE_ADDRESS ||
  "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";

// Safe version – align with Prosperity Passport if you know it
const SAFE_VERSION = process.env.SAFE_VERSION || "1.4.1";

if (!BACKEND_PRIVATE_KEY) {
  console.warn(
    "[create-super-account] PRIVATE_KEY env missing – route will throw on first request."
  );
}
if (
  !SUPERCHAIN_MODULE_ADDRESS ||
  !SUPERCHAIN_GUARD_ADDRESS ||
  !SUPERCHAIN_SETUP_ADDRESS
) {
  console.warn(
    "[create-super-account] SUPERCHAIN_* envs missing – SuperChain setup will fail."
  );
}
if (!process.env.ERC4337_MODULE_ADDRESS) {
  console.warn(
    "[create-super-account] ERC4337_MODULE_ADDRESS not set – deploying Safe without AA fallback handler."
  );
}

/**
 * setupSuperChainAccount ABI from HackMD
 */
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

// For now, just a fixed avatar seed (you can randomize later)
const DEFAULT_NOUN_SEED = {
  background: 0,
  body: 0,
  accessory: 0,
  head: 0,
  glasses: 0,
} as const;

/* ────────────────────────────── Handler ───────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    if (!BACKEND_PRIVATE_KEY) {
      throw new Error("PRIVATE_KEY env is not set");
    }
    if (
      !SUPERCHAIN_MODULE_ADDRESS ||
      !SUPERCHAIN_GUARD_ADDRESS ||
      !SUPERCHAIN_SETUP_ADDRESS
    ) {
      throw new Error(
        "SUPERCHAIN_MODULE_ADDRESS / SUPERCHAIN_GUARD_ADDRESS / SUPERCHAIN_SETUP_ADDRESS must be set"
      );
    }

    const body = await req.json().catch(() => null);

    const owner = body?.owner as `0x${string}` | undefined;
    const superChainID = body?.superChainID as string | undefined;

    if (!owner || !owner.startsWith("0x") || owner.length !== 42) {
      return NextResponse.json(
        { error: "Invalid or missing owner address" },
        { status: 400 }
      );
    }

    if (!superChainID || typeof superChainID !== "string") {
      return NextResponse.json(
        { error: "Missing superChainID" },
        { status: 400 }
      );
    }

    console.log("[create-super-account] Creating Eco Account for", {
      owner,
      superChainID,
    });

    // 1) Backend signer on Celo
    const provider = new ethers.JsonRpcProvider(CELO_RPC_URL);
    const baseWallet = new ethers.Wallet(BACKEND_PRIVATE_KEY, provider);

    // Wrap with NonceManager to avoid nonce clashes / replacement-underpriced
    const signer = new NonceManager(baseWallet);

    // 2) EthersAdapter just like your sweep script
    const ethAdapter = new EthersAdapter({
      ethers,
      signerOrProvider: signer as any,
    });

    // 3) SafeFactory using the Safe SDK
    const safeFactory = await SafeFactory.create({
      ethAdapter,
      safeVersion: SAFE_VERSION as any,
    });

    // 4) Encode setupSuperChainAccount
    const setupIface = new ethers.Interface(SETUP_ABI);

    const modules: string[] =
      ERC4337_MODULE_ADDRESS ===
      "0x0000000000000000000000000000000000000000"
        ? []
        : [ERC4337_MODULE_ADDRESS];

    const setupData = setupIface.encodeFunctionData(
      "setupSuperChainAccount",
      [
        modules,
        SUPERCHAIN_MODULE_ADDRESS,
        SUPERCHAIN_GUARD_ADDRESS,
        owner,
        DEFAULT_NOUN_SEED,
        superChainID,
      ]
    );

    // 5) Safe account config: call SuperChainAccountSetup during Safe setup
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

    // Salt nonce so each owner / call path is unique
    const saltNonce = Date.now().toString();
    let deploymentTxHash: string | undefined;

    const protocolKit = await safeFactory.deploySafe({
      safeAccountConfig,
      saltNonce,
      callback: (txHash: string) => {
        deploymentTxHash = txHash;
        console.log(
          "[create-super-account] Safe deployment tx hash:",
          txHash
        );
      },
    });

    const safeAddress = (await protocolKit.getAddress()) as `0x${string}`;

    console.log("[create-super-account] Deployed Eco Account", {
      safeAddress,
      deploymentTxHash,
    });

    return NextResponse.json(
      {
        smartAccount: safeAddress,
        txHash: deploymentTxHash,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[API] /api/create-super-account error:", err);

    const rawMsg: string =
      err?.shortMessage ||
      err?.info?.error?.message ||
      err?.message ||
      "";

    // Specific handling for replacement-underpriced (nonce / pending-tx issue)
    const lower = rawMsg.toLowerCase();

    if (
      err?.code === "REPLACEMENT_UNDERPRICED" ||
      lower.includes("replacement transaction underpriced")
    ) {
      return NextResponse.json(
        {
          error: "REPLACEMENT_UNDERPRICED",
          message:
            "There is already a pending transaction from the backend signer (likely a previous Safe deployment). " +
            "Wait for it to confirm or speed it up / cancel it, then try again.",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        error: rawMsg || "Internal error creating Super Account",
      },
      { status: 500 }
    );
  }
}
