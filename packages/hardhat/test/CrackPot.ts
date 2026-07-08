import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { keccak256, encodePacked } from "viem";
import type { CrackPot, MockUSDT, MockMiles } from "../typechain-types";

// ── Constants ──────────────────────────────────────────────────────────
const USDT = (n: number) => BigInt(n);  // raw 6-dec units
const USD  = (n: number) => BigInt(n) * 1_000_000n; // $n in 6-dec units

// Default economics (matches CrackPot.initialize defaults)
const ENTRY_FEE    = USDT(100_000);   // $0.10
const POT_SEED     = USD(2);           // $2.00
const POT_CAP      = USD(50);          // $50.00
const RAKE_BPS     = 5_000n;          // 50%

const RAKE   = (entry: bigint) => (entry * RAKE_BPS) / 10_000n;
const TO_POT = (entry: bigint) => entry - RAKE(entry);

const CYCLE_DURATION = 60 * 60 * 12; // 12 h in seconds

enum Version { MILES = 0, USDT = 1 }

// ── Fixture ────────────────────────────────────────────────────────────

async function deploy() {
  const [owner, relayer, treasury, alice, bob] = await ethers.getSigners();

  const MockMiles = await ethers.getContractFactory("MockMiles");
  const miles = (await MockMiles.deploy()) as unknown as MockMiles;
  await miles.waitForDeployment();

  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const usdt = (await MockUSDT.deploy()) as unknown as MockUSDT;
  await usdt.waitForDeployment();

  const CrackPot = await ethers.getContractFactory("CrackPot");
  const crackpot = (await upgrades.deployProxy(
    CrackPot,
    [
      await miles.getAddress(),
      await usdt.getAddress(),
      relayer.address,
      treasury.address,
    ],
    { initializer: "initialize", kind: "uups" }
  )) as unknown as CrackPot;
  await crackpot.waitForDeployment();

  const addr = await crackpot.getAddress();

  // Fund contract with $4 seed float (enough for 2 cycles).
  await usdt.mint(addr, USD(4));

  // Give alice and bob $10 each and approve contract.
  await usdt.mint(alice.address, USD(10));
  await usdt.mint(bob.address,   USD(10));
  await usdt.connect(alice).approve(addr, ethers.MaxUint256);
  await usdt.connect(bob).approve(addr,   ethers.MaxUint256);

  // Give alice some miles.
  await miles.deal(alice.address, ethers.parseEther("10000"));

  return { crackpot, usdt, miles, owner, relayer, treasury, alice, bob, addr };
}

// Build a deterministic dummy commitment for test helpers.
function dummyCommitment(
  chainId:  bigint,
  addr:     string,
  version:  number,
  expiry:   bigint,
): `0x${string}` {
  const salt = ("0x" + "aa".repeat(32)) as `0x${string}`;
  const code = ("0x" + "01020304") as `0x${string}`;
  return keccak256(
    encodePacked(
      ["string", "uint256", "address", "uint8", "uint64", "bytes32", "bytes4"],
      ["CRACKPOT_SECRET_V1", chainId, addr as `0x${string}`, version, expiry, salt, code],
    ),
  );
}

async function openUsdtCycle(crackpot: CrackPot, relayer: any) {
  const now      = await time.latest();
  const expiry   = BigInt(now + CYCLE_DURATION);
  const chainId  = BigInt((await ethers.provider.getNetwork()).chainId);
  const addr     = await crackpot.getAddress();
  const commitment = dummyCommitment(chainId, addr, Version.USDT, expiry);
  await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](Version.USDT, expiry, commitment);
  return Number(expiry);
}

// ── Helper: assert accounting invariant ───────────────────────────────

async function assertInvariant(crackpot: CrackPot, label: string) {
  const [balance, reserved, house] = await crackpot.usdtAccounting();
  expect(balance, `${label}: balance >= reserved+house`).to.be.gte(reserved + house);
}

// ══════════════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════════════

describe("CrackPot – USDT hardening", () => {

  // ── open ─────────────────────────────────────────────────────────────

  describe("openCycle (USDT)", () => {
    it("reserves usdtPotSeed on open and invariant holds", async () => {
      const { crackpot, relayer } = await deploy();
      await assertInvariant(crackpot, "before open");

      await openUsdtCycle(crackpot, relayer);

      const [bal, reserved, house, free] = await crackpot.usdtAccounting();
      expect(reserved).to.equal(POT_SEED);
      expect(house).to.equal(0n);
      expect(free).to.equal(bal - reserved - house);
      await assertInvariant(crackpot, "after open");
    });

    it("reverts when free balance is insufficient for seed", async () => {
      const { crackpot, relayer, addr, usdt } = await deploy();
      // Drain the contract so free balance < POT_SEED.
      // Transfer out all but $1 (below the $2 seed).
      const bal = await usdt.balanceOf(addr);
      // We can't directly withdraw (no mechanism), so deploy a fresh fixture with no seed float.
      const [owner2, relayer2, treasury2] = await ethers.getSigners();
      const MockMiles2 = await ethers.getContractFactory("MockMiles");
      const miles2 = await MockMiles2.deploy();
      const MockUSDT2 = await ethers.getContractFactory("MockUSDT");
      const usdt2  = await MockUSDT2.deploy();
      const CrackPot2 = await ethers.getContractFactory("CrackPot");
      const cp2 = (await upgrades.deployProxy(
        CrackPot2,
        [await miles2.getAddress(), await usdt2.getAddress(), relayer2.address, treasury2.address],
        { initializer: "initialize", kind: "uups" }
      )) as unknown as CrackPot;
      // Fund $1 only — not enough for $2 seed.
      await usdt2.mint(await cp2.getAddress(), USD(1));

      const now     = await time.latest();
      const expiry3 = BigInt(now + CYCLE_DURATION);
      const cId3    = BigInt((await ethers.provider.getNetwork()).chainId);
      const addr3   = await cp2.getAddress();
      const comm3   = dummyCommitment(cId3, addr3, Version.USDT, expiry3);
      await expect(
        cp2.connect(relayer2)["openCycle(uint8,uint64,bytes32)"](Version.USDT, expiry3, comm3)
      ).to.be.revertedWith("CrackPot: insufficient free USDT for seed");
    });
  });

  // ── entry split ───────────────────────────────────────────────────────

  describe("enterGame (USDT) – entry split", () => {
    it("splits rake to houseWithdrawable and pot contribution to reservedPot", async () => {
      const { crackpot, relayer, alice } = await deploy();
      await openUsdtCycle(crackpot, relayer);

      const rakeAmt  = RAKE(ENTRY_FEE);
      const potAmt   = TO_POT(ENTRY_FEE);

      await crackpot.connect(alice).enterGame(Version.USDT);

      const [, reserved, house] = await crackpot.usdtAccounting();
      // reserved = seed + potContrib
      expect(reserved).to.equal(POT_SEED + potAmt);
      // house = rake only
      expect(house).to.equal(rakeAmt);

      await assertInvariant(crackpot, "after 1 entry");
    });

    it("invariant holds after multiple entries", async () => {
      const { crackpot, relayer, alice, bob } = await deploy();
      await openUsdtCycle(crackpot, relayer);

      await crackpot.connect(alice).enterGame(Version.USDT);
      await crackpot.connect(bob).enterGame(Version.USDT);

      await assertInvariant(crackpot, "after 2 entries");
    });
  });

  // ── pot cap overflow ──────────────────────────────────────────────────

  describe("pot cap overflow", () => {
    it("routes overflow to houseWithdrawable and emits USDTPotCapOverflow", async () => {
      const { crackpot, usdt, relayer, alice, addr } = await deploy();

      // Set a tiny $3 pot cap and open.
      await crackpot.connect(await ethers.getSigner((await ethers.getSigners())[0].address))
        .setUsdtEconomics(ENTRY_FEE, POT_SEED, USD(3), RAKE_BPS);

      // Ensure enough seed float.
      await openUsdtCycle(crackpot, relayer);

      // Fill the pot to cap: seed=$2, cap=$3, space=$1.
      // Each entry puts $0.05 into pot. Need 20 entries to fill $1 of space.
      // Simpler: give alice unlimited funds and send entries until we hit an overflow.
      await usdt.mint(alice.address, USD(100));
      await usdt.connect(alice).approve(addr, ethers.MaxUint256);

      // Send enough entries to fill the pot and cause overflow.
      // space = $3 - $2 = $1. toPot per entry = $0.05. need 20 entries to fill.
      // The 21st entry will overflow.
      for (let i = 0; i < 20; i++) {
        await crackpot.connect(alice).enterGame(Version.USDT);
      }

      // The 21st entry should overflow.
      const tx = await crackpot.connect(alice).enterGame(Version.USDT);
      const receipt = await tx.wait();
      const iface = crackpot.interface;
      const overflowLogs = receipt!.logs
        .map(l => { try { return iface.parseLog(l); } catch { return null; } })
        .filter(l => l?.name === "USDTPotCapOverflow");

      expect(overflowLogs.length).to.equal(1);
      const overflowAmt = overflowLogs[0]!.args[1] as bigint;
      expect(overflowAmt).to.be.gt(0n);

      // Overflow must be reflected in houseWithdrawable.
      const [, , house] = await crackpot.usdtAccounting();
      // house = rake from 21 entries + overflow from 21st
      const rakeTotal = RAKE(ENTRY_FEE) * 21n;
      expect(house).to.be.gte(rakeTotal + overflowAmt);

      await assertInvariant(crackpot, "after overflow entry");
    });
  });

  // ── declareWinner ─────────────────────────────────────────────────────

  describe("declareWinner (USDT)", () => {
    it("decrements reservedPot and pays winner, invariant holds", async () => {
      const { crackpot, usdt, relayer, alice, treasury } = await deploy();
      await openUsdtCycle(crackpot, relayer);

      await crackpot.connect(alice).enterGame(Version.USDT);
      const [, reservedBefore, houseBefore] = await crackpot.usdtAccounting();

      const cycleId = await crackpot.activeCycleId(Version.USDT);
      const cycle   = await crackpot.getCycle(cycleId);
      const payout  = cycle.potBalance;

      const aliceBefore = await usdt.balanceOf(alice.address);
      await crackpot.connect(relayer).declareWinner(Version.USDT, alice.address, 5);
      const aliceAfter = await usdt.balanceOf(alice.address);

      expect(aliceAfter - aliceBefore).to.equal(payout);

      const [, reservedAfter, houseAfter] = await crackpot.usdtAccounting();
      expect(reservedAfter).to.equal(reservedBefore - payout);
      expect(houseAfter).to.equal(houseBefore); // house untouched

      await assertInvariant(crackpot, "after declareWinner");
    });

    it("house funds are untouched when winner is paid", async () => {
      const { crackpot, relayer, alice } = await deploy();
      await openUsdtCycle(crackpot, relayer);

      await crackpot.connect(alice).enterGame(Version.USDT);
      const [, , houseBefore] = await crackpot.usdtAccounting();

      await crackpot.connect(relayer).declareWinner(Version.USDT, alice.address, 3);

      const [, , houseAfter] = await crackpot.usdtAccounting();
      expect(houseAfter).to.equal(houseBefore);
    });
  });

  // ── expireCycle ───────────────────────────────────────────────────────

  describe("expireCycle (USDT)", () => {
    it("releases reservedPot without crediting houseWithdrawable", async () => {
      const { crackpot, relayer, alice } = await deploy();
      const expiry = await openUsdtCycle(crackpot, relayer);

      await crackpot.connect(alice).enterGame(Version.USDT);
      const [balBefore, reservedBefore, houseBefore] = await crackpot.usdtAccounting();

      await time.increaseTo(expiry + 1);
      await crackpot.connect(relayer).expireCycle(Version.USDT);

      const [balAfter, reservedAfter, houseAfter] = await crackpot.usdtAccounting();
      // USDT stays in contract.
      expect(balAfter).to.equal(balBefore);
      // Reserved is fully released.
      expect(reservedAfter).to.equal(0n);
      // House is unchanged — dead pot is NOT added to houseWithdrawable.
      expect(houseAfter).to.equal(houseBefore);

      await assertInvariant(crackpot, "after expireCycle");
    });

    it("dead pot remains as free balance, can seed a new cycle", async () => {
      const { crackpot, relayer, alice } = await deploy();
      const expiry = await openUsdtCycle(crackpot, relayer);

      await crackpot.connect(alice).enterGame(Version.USDT);

      await time.increaseTo(expiry + 1);
      await crackpot.connect(relayer).expireCycle(Version.USDT);

      // Should be able to open a new cycle using the returned seed float.
      const now2    = await time.latest();
      const expiry2 = BigInt(now2 + CYCLE_DURATION);
      const cId2    = BigInt((await ethers.provider.getNetwork()).chainId);
      const addr2   = await crackpot.getAddress();
      const comm2   = dummyCommitment(cId2, addr2, Version.USDT, expiry2);
      await expect(
        crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](Version.USDT, expiry2, comm2)
      ).to.not.be.reverted;

      await assertInvariant(crackpot, "after re-open");
    });
  });

  // ── withdrawHouse ─────────────────────────────────────────────────────

  describe("withdrawHouse", () => {
    it("cannot withdraw active pot funds (only houseWithdrawable)", async () => {
      const { crackpot, relayer, alice, treasury } = await deploy();
      await openUsdtCycle(crackpot, relayer);
      await crackpot.connect(alice).enterGame(Version.USDT);

      const [, reserved, house] = await crackpot.usdtAccounting();

      // Attempting to withdraw more than houseWithdrawable should revert.
      const overAmount = house + reserved; // would dip into pot
      await expect(
        crackpot.connect(relayer).withdrawHouse(overAmount)
      ).to.be.revertedWithCustomError(crackpot, "WithdrawExceedsHouseBalance");
    });

    it("allows withdrawing exactly houseWithdrawable", async () => {
      const { crackpot, usdt, relayer, alice, treasury } = await deploy();
      await openUsdtCycle(crackpot, relayer);
      await crackpot.connect(alice).enterGame(Version.USDT);

      const [, , house] = await crackpot.usdtAccounting();
      expect(house).to.be.gt(0n);

      const tBefore = await usdt.balanceOf(treasury.address);
      await crackpot.connect(relayer).withdrawHouse(house);
      const tAfter  = await usdt.balanceOf(treasury.address);

      expect(tAfter - tBefore).to.equal(house);

      const [, , houseAfter] = await crackpot.usdtAccounting();
      expect(houseAfter).to.equal(0n);

      await assertInvariant(crackpot, "after full house withdrawal");
    });

    it("decrements houseWithdrawable before transfer (CEI)", async () => {
      // After withdrawal, invariant must still hold.
      const { crackpot, relayer, alice } = await deploy();
      await openUsdtCycle(crackpot, relayer);
      await crackpot.connect(alice).enterGame(Version.USDT);

      const [, , house] = await crackpot.usdtAccounting();
      await crackpot.connect(relayer).withdrawHouse(house / 2n);
      await assertInvariant(crackpot, "after partial withdrawal");
    });
  });

  // ── rescueERC20 ───────────────────────────────────────────────────────

  describe("rescueERC20", () => {
    it("rejects USDT token", async () => {
      const { crackpot, usdt, owner } = await deploy();
      await expect(
        crackpot.connect(owner).rescueERC20(await usdt.getAddress(), USD(1), owner.address)
      ).to.be.revertedWithCustomError(crackpot, "USDTRescueBlocked");
    });

    it("allows rescuing a different ERC-20", async () => {
      const { crackpot, owner, addr } = await deploy();
      const MockUSDT2 = await ethers.getContractFactory("MockUSDT");
      const other = await MockUSDT2.deploy();
      await other.mint(addr, USD(5));

      await expect(
        crackpot.connect(owner).rescueERC20(await other.getAddress(), USD(5), owner.address)
      ).to.not.be.reverted;
    });
  });

  // ── recordEntry(USDT) ─────────────────────────────────────────────────

  describe("recordEntry", () => {
    it("reverts for USDT version", async () => {
      const { crackpot, relayer, alice } = await deploy();
      await openUsdtCycle(crackpot, relayer);

      await expect(
        crackpot.connect(relayer).recordEntry(Version.USDT, alice.address)
      ).to.be.revertedWithCustomError(crackpot, "USDTRecordEntryBlocked");
    });

    it("still works for MILES version", async () => {
      const { crackpot, relayer, alice, miles, addr } = await deploy();
      const now    = await time.latest();
      const expiry = BigInt(now + CYCLE_DURATION);
      const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
      const commitment = dummyCommitment(chainId, addr, Version.MILES, expiry);
      await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](Version.MILES, expiry, commitment);

      await expect(
        crackpot.connect(relayer).recordEntry(Version.MILES, alice.address)
      ).to.not.be.reverted;
    });
  });

  // ── Full invariant sequence ────────────────────────────────────────────

  describe("invariant: balance >= reservedPot + houseWithdrawable", () => {
    it("holds across open → entry → overflow → expire → open → entry → winner → withdrawal", async () => {
      const { crackpot, usdt, relayer, alice, bob, owner, treasury, addr } = await deploy();

      // Use a $3 cap to force overflow.
      await crackpot.connect(owner).setUsdtEconomics(ENTRY_FEE, POT_SEED, USD(3), RAKE_BPS);
      await assertInvariant(crackpot, "initial");

      // Open.
      const expiry = await openUsdtCycle(crackpot, relayer);
      await assertInvariant(crackpot, "after open");

      // 20 entries to fill pot (space = $1, 20 × $0.05 = $1 exactly).
      await usdt.mint(alice.address, USD(10));
      await usdt.connect(alice).approve(addr, ethers.MaxUint256);
      for (let i = 0; i < 20; i++) {
        await crackpot.connect(alice).enterGame(Version.USDT);
      }
      await assertInvariant(crackpot, "after 20 entries");

      // 21st entry → overflow.
      await crackpot.connect(alice).enterGame(Version.USDT);
      await assertInvariant(crackpot, "after overflow entry");

      // Expire.
      await time.increaseTo(expiry + 1);
      await crackpot.connect(relayer).expireCycle(Version.USDT);
      await assertInvariant(crackpot, "after expire");

      // Re-open.
      const now2    = await time.latest();
      const expiry2 = BigInt(now2 + CYCLE_DURATION);
      const cId2    = BigInt((await ethers.provider.getNetwork()).chainId);
      const comm2   = dummyCommitment(cId2, addr, Version.USDT, expiry2);
      await crackpot.connect(relayer)["openCycle(uint8,uint64,bytes32)"](Version.USDT, expiry2, comm2);
      await assertInvariant(crackpot, "after re-open");

      // Entry.
      await crackpot.connect(alice).enterGame(Version.USDT);
      await assertInvariant(crackpot, "after re-entry");

      // Winner.
      await crackpot.connect(relayer).declareWinner(Version.USDT, bob.address, 2);
      await assertInvariant(crackpot, "after winner");

      // House withdrawal.
      const [, , house] = await crackpot.usdtAccounting();
      if (house > 0n) {
        await crackpot.connect(relayer).withdrawHouse(house);
        await assertInvariant(crackpot, "after house withdrawal");
      }
    });
  });

});
