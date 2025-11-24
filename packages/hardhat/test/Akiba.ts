import { expect } from "chai";
import { ethers } from "hardhat";

describe("AkibaDiceGame", () => {
  async function deployFixture() {
    const [owner, alice, bob, carol] = await ethers.getSigners();

    // Deploy MiniPointsMock
    const MiniPointsMock = await ethers.getContractFactory("MiniPointsMock");
    const mini = await MiniPointsMock.deploy();
    await mini.waitForDeployment();

    // Deploy AkibaDiceGame (impl only, call initialize directly)
    const Dice = await ethers.getContractFactory("AkibaDiceGame");
    const dice = await Dice.deploy();
    await dice.waitForDeployment();

    await dice.initialize(await mini.getAddress(), owner.address);

    return { owner, alice, bob, carol, mini, dice };
  }

  /* ────────────────────────────────────────────────────────── */
  /* Basic behaviour                                            */
  /* ────────────────────────────────────────────────────────── */

  it("sets default allowed tiers on initialize", async () => {
    const { dice } = await deployFixture();

    expect(await dice.allowedTier(10)).to.equal(true);
    expect(await dice.allowedTier(20)).to.equal(true);
    expect(await dice.allowedTier(30)).to.equal(true);
    expect(await dice.allowedTier(40)).to.equal(false);
  });

  it("reverts when joining with a non-allowed tier", async () => {
    const { dice, alice, mini } = await deployFixture();

    // Give Alice some points so burn won't fail first
    await mini.mint(alice.address, 100);

    await expect(
      dice.connect(alice).joinTier(40, 3) // 40 not allowed by default
    ).to.be.revertedWith("Dice: tier not allowed");
  });

  it("allows a user to join an allowed tier and assigns the slot", async () => {
    const { dice, mini, alice } = await deployFixture();

    const tier = 10;
    const chosenNumber = 3;

    await mini.mint(alice.address, tier);

    const beforeBal = await mini.balanceOf(alice.address);

    await expect(dice.connect(alice).joinTier(tier, chosenNumber))
      .to.emit(dice, "RoundOpened")
      .and.to.emit(dice, "Joined");

    const afterBal = await mini.balanceOf(alice.address);

    // burned exactly `tier`
    expect(beforeBal - afterBal).to.equal(BigInt(tier));

    // There should now be an active round for this tier
    const roundId = await dice.getActiveRoundId(tier);
    expect(roundId).to.not.equal(0n);

    const info = await dice.getRoundInfo(roundId);
    const [storedTier, filledSlots] = info;

    expect(storedTier).to.equal(BigInt(tier));
    expect(filledSlots).to.equal(1);

    // Alice is mapped to chosenNumber
    const slotPlayer = await dice.getRoundSlotPlayer(roundId, chosenNumber);
    expect(slotPlayer).to.equal(alice.address);

    // Alice marked as having joined this round
    expect(await dice.hasJoinedRound(roundId, alice.address)).to.equal(true);
  });

  it("prevents joining the same round twice by the same address", async () => {
    const { dice, mini, alice } = await deployFixture();

    const tier = 10;

    await mini.mint(alice.address, 100);

    await dice.connect(alice).joinTier(tier, 2);

    await expect(
      dice.connect(alice).joinTier(tier, 3)
    ).to.be.revertedWith("Dice: already joined");
  });

  it("prevents two players from picking the same number in a round", async () => {
    const { dice, mini, alice, bob } = await deployFixture();

    const tier = 10;
    const num = 4;

    await mini.mint(alice.address, 100);
    await mini.mint(bob.address, 100);

    // Alice takes number 4
    await dice.connect(alice).joinTier(tier, num);

    // Bob tries to take 4 too
    await expect(
      dice.connect(bob).joinTier(tier, num)
    ).to.be.revertedWith("Dice: number taken");
  });

  it("creates a new round once the previous one is full", async () => {
    const { dice, mini } = await deployFixture();

    const tier = 10;
    const signers = await ethers.getSigners();
    const sixPlayers = signers.slice(1, 7); // use 6 accounts

    for (let i = 0; i < 6; i++) {
      await mini.mint(sixPlayers[i].address, 100);
    }

    // All six join the same tier, different numbers
    for (let i = 0; i < 6; i++) {
      await dice.connect(sixPlayers[i]).joinTier(tier, i + 1);
    }

    const firstRoundId = await dice.getActiveRoundId(tier);
    const firstInfo = await dice.getRoundInfo(firstRoundId);
    const [, filledSlotsFirst] = firstInfo;
    expect(filledSlotsFirst).to.equal(6);

    // Next join on the same tier should spin up a new round
    const signersAll = await ethers.getSigners();
    const extraPlayer = signersAll[7];
    await mini.mint(extraPlayer.address, 100);
    await dice.connect(extraPlayer).joinTier(tier, 3);

    const secondRoundId = await dice.getActiveRoundId(tier);
    expect(secondRoundId).to.not.equal(firstRoundId);

    const secondInfo = await dice.getRoundInfo(secondRoundId);
    const [, filledSlotsSecond] = secondInfo;
    expect(filledSlotsSecond).to.equal(1);
  });

  it("only owner can cancel a round", async () => {
    const { dice, mini, alice } = await deployFixture();

    const tier = 10;
    await mini.mint(alice.address, 100);
    await dice.connect(alice).joinTier(tier, 1);

    const roundId = await dice.getActiveRoundId(tier);

    await expect(
      dice.connect(alice).cancelRound(roundId)
    ).to.be.revertedWith("Owner: not owner");
  });

  it("cancels a partially filled round and refunds players", async () => {
    const { dice, mini, owner, alice, bob } = await deployFixture();

    const tier = 10;

    await mini.mint(alice.address, 100);
    await mini.mint(bob.address, 100);

    // both join same round
    await dice.connect(alice).joinTier(tier, 1);
    await dice.connect(bob).joinTier(tier, 2);

    const roundId = await dice.getActiveRoundId(tier);

    const balAliceBefore = await mini.balanceOf(alice.address);
    const balBobBefore = await mini.balanceOf(bob.address);

    // owner cancels; because filledSlots < 6 and no randomness requested
    await expect(dice.connect(owner).cancelRound(roundId)).to.emit(
      dice,
      "RoundCancelled"
    );

    const balAliceAfter = await mini.balanceOf(alice.address);
    const balBobAfter = await mini.balanceOf(bob.address);

    // each should have been refunded `tier`
    expect(balAliceAfter - balAliceBefore).to.equal(BigInt(tier));
    expect(balBobAfter - balBobBefore).to.equal(BigInt(tier));

    // hasJoinedRound should be cleared
    expect(await dice.hasJoinedRound(roundId, alice.address)).to.equal(false);
    expect(await dice.hasJoinedRound(roundId, bob.address)).to.equal(false);
  });

  it("does not allow cancelling a full round", async () => {
    const { dice, mini, owner } = await deployFixture();

    const tier = 10;
    const signers = await ethers.getSigners();
    const sixPlayers = signers.slice(1, 7);

    for (let i = 0; i < 6; i++) {
      await mini.mint(sixPlayers[i].address, 100);
      await dice.connect(sixPlayers[i]).joinTier(tier, i + 1);
    }

    const roundId = await dice.getActiveRoundId(tier);

    await expect(
      dice.connect(owner).cancelRound(roundId)
    ).to.be.revertedWith("Dice: full pot");
  });

  /* ────────────────────────────────────────────────────────── */
  /* Edge cases                                                */
  /* ────────────────────────────────────────────────────────── */

  it("reverts if chosen number is <1 or >6", async () => {
    const { dice, mini, alice } = await deployFixture();

    const tier = 10;
    await mini.mint(alice.address, 100);

    await expect(
      dice.connect(alice).joinTier(tier, 0)
    ).to.be.revertedWith("Dice: bad number");

    await expect(
      dice.connect(alice).joinTier(tier, 7)
    ).to.be.revertedWith("Dice: bad number");
  });

  it("reverts if user has insufficient MiniPoints balance", async () => {
    const { dice, mini, alice } = await deployFixture();

    const tier = 10;

    // Give less than tier
    await mini.mint(alice.address, 5);

    await expect(
      dice.connect(alice).joinTier(tier, 3)
    ).to.be.revertedWith("Mock: insufficient balance");
  });

  it("only owner can setAllowedTier, and disabling a tier blocks joins", async () => {
    const { dice, mini, owner, alice } = await deployFixture();

    // Non-owner cannot change tiers
    await expect(
      dice.connect(alice).setAllowedTier(50, true)
    ).to.be.revertedWith("Owner: not owner");

    // Owner enables a new tier
    await dice.connect(owner).setAllowedTier(50, true);
    expect(await dice.allowedTier(50)).to.equal(true);

    await mini.mint(alice.address, 100);

    // Can now join tier 50
    await dice.connect(alice).joinTier(50, 2);
    const roundId = await dice.getActiveRoundId(50);
    expect(roundId).to.not.equal(0n);

    // Disable tier 50
    await dice.connect(owner).setAllowedTier(50, false);
    expect(await dice.allowedTier(50)).to.equal(false);

    // Further joins with tier 50 must revert
    await expect(
      dice.connect(alice).joinTier(50, 3)
    ).to.be.revertedWith("Dice: tier not allowed");
  });

  it("opens a new round after cancellation and allows joining again", async () => {
    const { dice, mini, owner, alice } = await deployFixture();

    const tier = 10;

    await mini.mint(alice.address, 100);

    // Alice joins, round has 1/6 filled
    await dice.connect(alice).joinTier(tier, 1);
    const firstRoundId = await dice.getActiveRoundId(tier);

    // Cancel that round
    await dice.connect(owner).cancelRound(firstRoundId);

    // Next join on that tier should open a new round
    await mini.mint(alice.address, 100); // top her up again
    await dice.connect(alice).joinTier(tier, 2);

    const secondRoundId = await dice.getActiveRoundId(tier);
    expect(secondRoundId).to.not.equal(firstRoundId);

    const info = await dice.getRoundInfo(secondRoundId);
    const [, filledSlots] = info;
    expect(filledSlots).to.equal(1);
  });

  it("cannot cancel the same round twice", async () => {
    const { dice, mini, owner, alice } = await deployFixture();

    const tier = 10;

    await mini.mint(alice.address, 100);
    await dice.connect(alice).joinTier(tier, 1);

    const roundId = await dice.getActiveRoundId(tier);

    await dice.connect(owner).cancelRound(roundId);

    await expect(
      dice.connect(owner).cancelRound(roundId)
    ).to.be.revertedWith("Dice: already resolved");
  });

  it("view helpers revert on non-existent round ids", async () => {
    const { dice } = await deployFixture();

    await expect(
      dice.getRoundInfo(999)
    ).to.be.revertedWith("Dice: round not found");

    await expect(
      dice.getRoundSlotPlayer(999, 1)
    ).to.be.revertedWith("Dice: round not found");
  });
});
