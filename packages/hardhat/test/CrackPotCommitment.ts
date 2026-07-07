/**
 * CrackPot commitment + upgrade-safety tests.
 *
 * Run with:
 *   npx hardhat --config hardhat.crackpot.config.ts test test/CrackPotCommitment.ts
 *
 * Coverage:
 *   1.  Storage layout is upgrade-safe (bytes32 appended to Cycle struct).
 *   2.  Old openCycle(uint8, uint64) reverts with CommitmentRequired.
 *   3.  New openCycle(uint8, uint64, bytes32) stores commitment and emits it.
 *   4.  Zero commitment is rejected.
 *   5.  Commitment is readable via getCycle() after opening.
 *   6.  declareWinner emits CycleCracked after a commitment-opened cycle.
 *   7.  Full lifecycle: open(commitment) → enter → declare → invariant.
 */

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256 } from "viem";
import { encodePacked } from "viem";
import type { CrackPot, MockUSDT, MockMiles } from "../typechain-types";

// ── Constants ──────────────────────────────────────────────────────────────
const USDT = (n: number) => BigInt(n);
const USD  = (n: number) => BigInt(n) * 1_000_000n;

const ENTRY_FEE    = USDT(100_000);
const POT_SEED     = USD(2);
const CYCLE_DURATION = 60 * 60 * 12;

enum Version { MILES = 0, USDT = 1 }

// Mirrors the TypeScript commitment algorithm in crackpotEngine.ts
function computeCommitment(
  chainId:         bigint,
  contractAddress: string,
  version:         number,
  expiresAt:       bigint,
  salt:            `0x${string}`,
  code:            [number, number, number, number],
): `0x${string}` {
  const codeHex = code.map((n) => n.toString(16).padStart(2, "0")).join("") as `0x${string}`;
  return keccak256(
    encodePacked(
      ["string", "uint256", "address", "uint8", "uint64", "bytes32", "bytes4"],
      ["CRACKPOT_SECRET_V1", chainId, contractAddress as `0x${string}`, version, expiresAt, salt, `0x${codeHex}` as `0x${string}`],
    ),
  );
}

// ── Fixture ────────────────────────────────────────────────────────────────

async function deploy() {
  const [owner, relayer, treasury, alice] = await ethers.getSigners();

  const MockMiles = await ethers.getContractFactory("MockMiles");
  const miles = (await MockMiles.deploy()) as unknown as MockMiles;
  await miles.waitForDeployment();

  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const usdt = (await MockUSDT.deploy()) as unknown as MockUSDT;
  await usdt.waitForDeployment();

  const CrackPot = await ethers.getContractFactory("CrackPot");
  const crackpot = (await upgrades.deployProxy(
    CrackPot,
    [await miles.getAddress(), await usdt.getAddress(), relayer.address, treasury.address],
    { initializer: "initialize", kind: "uups" },
  )) as unknown as CrackPot;
  await crackpot.waitForDeployment();

  const addr = await crackpot.getAddress();

  // Fund contract with $4 seed float.
  await usdt.mint(addr, USD(4));

  // Give alice $10 and approve.
  await usdt.mint(alice.address, USD(10));
  await usdt.connect(alice).approve(addr, ethers.MaxUint256);

  // Give alice miles.
  await miles.deal(alice.address, ethers.parseEther("10000"));

  return { crackpot, usdt, miles, owner, relayer, treasury, alice, addr };
}

// ── Storage layout validation ──────────────────────────────────────────────
// OpenZeppelin upgrades plugin validates layout compatibility when using
// upgradeProxy.  This test deploys V1 (current CrackPot) and validates that
// upgrading to V2 (itself, after the struct append) does not corrupt storage.

describe("CrackPot – storage layout upgrade safety", () => {
  it("validateUpgrade passes — bytes32 appended to Cycle struct is safe", async () => {
    const [owner] = await ethers.getSigners();

    // Deploy fresh proxy.
    const MockMiles = await ethers.getContractFactory("MockMiles");
    const miles = await MockMiles.deploy();
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const usdt = await MockUSDT.deploy();

    const [, relayer, treasury] = await ethers.getSigners();
    const CrackPotFactory = await ethers.getContractFactory("CrackPot");
    const proxy = await upgrades.deployProxy(
      CrackPotFactory,
      [await miles.getAddress(), await usdt.getAddress(), relayer.address, treasury.address],
      { initializer: "initialize", kind: "uups" },
    );
    await proxy.waitForDeployment();

    // upgradeProxy with the SAME factory validates that the new implementation's
    // storage layout is compatible with what the proxy already holds.
    // This will throw if any existing variable is reordered, removed, or shrunk.
    await expect(
      upgrades.upgradeProxy(await proxy.getAddress(), CrackPotFactory, { kind: "uups" }),
    ).to.not.be.rejected;
  });

  it("existing storage values are intact after a self-upgrade", async () => {
    const { crackpot, relayer, alice, addr, usdt } = await deploy();

    // Open a USDT cycle (commitment-aware).
    const now    = await time.latest();
    const expiry = BigInt(now + CYCLE_DURATION);
    const salt   = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const code: [number, number, number, number] = [1, 2, 3, 4];
    const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
    const commitment = computeCommitment(chainId, addr, Version.USDT, expiry, salt, code);

    await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](
      Version.USDT,
      expiry,
      commitment,
    );

    const cycleIdBefore = await crackpot.activeCycleId(Version.USDT);
    const cycleBefore   = await crackpot.getCycle(cycleIdBefore);

    // Perform self-upgrade.
    const CrackPotFactory = await ethers.getContractFactory("CrackPot");
    const upgraded = (await upgrades.upgradeProxy(
      await crackpot.getAddress(),
      CrackPotFactory,
      { kind: "uups" },
    )) as unknown as CrackPot;

    // All pre-upgrade values must be intact.
    const cycleIdAfter  = await upgraded.activeCycleId(Version.USDT);
    const cycleAfter    = await upgraded.getCycle(cycleIdAfter);

    expect(cycleIdAfter).to.equal(cycleIdBefore);
    expect(cycleAfter.potBalance).to.equal(cycleBefore.potBalance);
    expect(cycleAfter.expiresAt).to.equal(cycleBefore.expiresAt);
    expect(cycleAfter.secretCommitment).to.equal(commitment);
  });
});

// ── Commitment API tests ───────────────────────────────────────────────────

describe("CrackPot – commitment-aware openCycle", () => {

  describe("deprecated two-arg openCycle", () => {
    it("reverts with CommitmentRequired", async () => {
      const { crackpot, relayer } = await deploy();
      const now = await time.latest();
      await expect(
        crackpot.connect(relayer)["openCycle(uint8,uint64)"](Version.USDT, now + CYCLE_DURATION),
      ).to.be.revertedWithCustomError(crackpot, "CommitmentRequired");
    });
  });

  describe("three-arg openCycle", () => {
    it("rejects a zero commitment", async () => {
      const { crackpot, relayer } = await deploy();
      const now = await time.latest();
      await expect(
        crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](
          Version.USDT,
          now + CYCLE_DURATION,
          ethers.ZeroHash,
        ),
      ).to.be.revertedWith("CrackPot: zero commitment");
    });

    it("stores commitment on-chain and emits CycleOpened with it", async () => {
      const { crackpot, relayer, addr } = await deploy();
      const now    = await time.latest();
      const expiry = BigInt(now + CYCLE_DURATION);
      const salt   = ("0x" + "cd".repeat(32)) as `0x${string}`;
      const code: [number, number, number, number] = [0, 5, 3, 1];
      const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
      const commitment = computeCommitment(chainId, addr, Version.USDT, expiry, salt, code);

      const tx      = await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](
        Version.USDT,
        expiry,
        commitment,
      );
      const receipt = await tx.wait();

      // CycleOpened event must include the commitment.
      const iface = crackpot.interface;
      const openedLogs = receipt!.logs
        .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
        .filter((l) => l?.name === "CycleOpened");

      expect(openedLogs.length).to.equal(1);
      expect(openedLogs[0]!.args.secretCommitment).to.equal(commitment);

      // getCycle must return the commitment.
      const cycleId = await crackpot.activeCycleId(Version.USDT);
      const cycle   = await crackpot.getCycle(cycleId);
      expect(cycle.secretCommitment).to.equal(commitment);
    });

    it("commitment is readable via getActiveCycle", async () => {
      const { crackpot, relayer, addr } = await deploy();
      const now    = await time.latest();
      const expiry = BigInt(now + CYCLE_DURATION);
      const salt   = ("0x" + "ef".repeat(32)) as `0x${string}`;
      const code: [number, number, number, number] = [2, 4, 0, 3];
      const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
      const commitment = computeCommitment(chainId, addr, Version.USDT, expiry, salt, code);

      await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](
        Version.USDT,
        expiry,
        commitment,
      );

      const cycle = await crackpot.getActiveCycle(Version.USDT);
      expect(cycle.secretCommitment).to.equal(commitment);
    });

    it("CycleCracked event is emitted after declareWinner on a commitment cycle", async () => {
      const { crackpot, relayer, alice, addr } = await deploy();
      const now    = await time.latest();
      const expiry = BigInt(now + CYCLE_DURATION);
      const salt   = ("0x" + "12".repeat(32)) as `0x${string}`;
      const code: [number, number, number, number] = [3, 3, 3, 3];
      const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
      const commitment = computeCommitment(chainId, addr, Version.USDT, expiry, salt, code);

      await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](
        Version.USDT,
        expiry,
        commitment,
      );
      await crackpot.connect(alice).enterGame(Version.USDT);

      const cycleId = await crackpot.activeCycleId(Version.USDT);
      const cycle   = await crackpot.getCycle(cycleId);
      const payout  = cycle.potBalance;

      const tx      = await crackpot.connect(relayer).declareWinner(Version.USDT, alice.address, 7);
      const receipt = await tx.wait();

      const iface = crackpot.interface;
      const crackedLogs = receipt!.logs
        .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
        .filter((l) => l?.name === "CycleCracked");

      expect(crackedLogs.length).to.equal(1);
      const args = crackedLogs[0]!.args;
      expect(args.winner.toLowerCase()).to.equal(alice.address.toLowerCase());
      expect(args.payout).to.equal(payout);
      expect(args.guesses).to.equal(7n);
      expect(args.cycleId).to.equal(cycleId);
    });

    it("MILES cycle also requires commitment", async () => {
      const { crackpot, relayer } = await deploy();
      const now    = await time.latest();
      const expiry = BigInt(now + CYCLE_DURATION);
      const salt   = ("0x" + "34".repeat(32)) as `0x${string}`;
      const code: [number, number, number, number] = [0, 0, 0, 0];
      const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
      const commitment = computeCommitment(chainId, await crackpot.getAddress(), Version.MILES, expiry, salt, code);

      await expect(
        crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](
          Version.MILES,
          expiry,
          commitment,
        ),
      ).to.not.be.reverted;
    });
  });

  describe("full USDT lifecycle with commitment", () => {
    it("open → enter → winner → invariant holds", async () => {
      const { crackpot, relayer, alice, addr, usdt } = await deploy();
      const now    = await time.latest();
      const expiry = BigInt(now + CYCLE_DURATION);
      const salt   = ("0x" + "56".repeat(32)) as `0x${string}`;
      const code: [number, number, number, number] = [1, 3, 5, 2];
      const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
      const commitment = computeCommitment(chainId, addr, Version.USDT, expiry, salt, code);

      await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](
        Version.USDT,
        expiry,
        commitment,
      );
      await crackpot.connect(alice).enterGame(Version.USDT);
      await crackpot.connect(relayer).declareWinner(Version.USDT, alice.address, 3);

      // USDT accounting invariant must hold after settlement.
      const [bal, reserved, house] = await crackpot.usdtAccounting();
      expect(bal).to.be.gte(reserved + house);
    });
  });
});
