import { expect } from "chai";
import { ethers } from "hardhat";

describe("AkibaDiceGame commit-reveal randomness", () => {
  const points = (amount: string | number) => ethers.parseEther(String(amount));

  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [owner] = signers;

    const MiniPointsMock = await ethers.getContractFactory("MiniPointsMock");
    const mini = await MiniPointsMock.deploy();
    await mini.waitForDeployment();

    const Dice = await ethers.getContractFactory("AkibaDiceGame");
    const dice = await Dice.deploy();
    await dice.waitForDeployment();
    await dice.initialize(await mini.getAddress(), owner.address);

    return { owner, signers, mini, dice };
  }

  async function queueSecret(dice: any, secretText: string) {
    const secret = ethers.keccak256(ethers.toUtf8Bytes(secretText));
    const nonce = await dice.nextHouseCommitNonce();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const commit = ethers.solidityPackedKeccak256(
      ["bytes32", "address", "uint256", "uint256"],
      [secret, await dice.getAddress(), chainId, nonce]
    );

    await dice.queueHouseCommits([commit]);
    return { nonce, secret, commit };
  }

  async function fillRound(dice: any, mini: any, players: any[], tier = 10) {
    const entry = points(tier);
    for (let i = 0; i < 6; i++) {
      await mini.mint(players[i].address, entry);
      await dice.connect(players[i]).joinTier(tier, i + 1);
    }
    return dice.getActiveRoundId(tier);
  }

  async function mineUntilAfter(blockNumber: bigint) {
    const current = BigInt(await ethers.provider.getBlockNumber());
    const blocks = blockNumber > current ? blockNumber - current + 1n : 1n;
    await ethers.provider.send("hardhat_mine", [
      `0x${blocks.toString(16)}`,
    ]);
  }

  it("requires a queued house commit before opening a round", async () => {
    const { signers, mini, dice } = await deployFixture();
    const player = signers[1];

    await mini.mint(player.address, points(10));
    await expect(dice.connect(player).joinTier(10, 1)).to.be.revertedWith(
      "Dice: no house commit"
    );
  });

  it("locks a future block and resolves with the matching secret", async () => {
    const { signers, mini, dice } = await deployFixture();
    const { nonce, secret, commit } = await queueSecret(dice, "round-one");
    const players = signers.slice(1, 7);

    const roundId = await fillRound(dice, mini, players);
    expect(await dice.roundHouseCommit(roundId)).to.equal(commit);
    expect(await dice.roundHouseCommitNonce(roundId)).to.equal(nonce);

    const info = await dice.getRoundInfo(roundId);
    const targetBlock = info[4];
    expect(targetBlock).to.equal(await dice.roundTargetBlock(roundId));
    expect(await dice.getRoundState(roundId)).to.equal(2);

    await mineUntilAfter(targetBlock);
    expect(await dice.getRoundState(roundId)).to.equal(3);

    await expect(dice.revealAndDraw(roundId, secret))
      .to.emit(dice, "CommitRandomnessRevealed")
      .and.to.emit(dice, "RoundResolved");

    const after = await dice.getRoundInfo(roundId);
    expect(after[2]).to.equal(true);
    expect(after[3]).to.be.within(1, 6);
    expect(players.map((p) => p.address)).to.include(after[5]);
    expect(await dice.getRoundState(roundId)).to.equal(4);
  });

  it("rejects the wrong reveal secret", async () => {
    const { signers, mini, dice } = await deployFixture();
    await queueSecret(dice, "correct-secret");
    const roundId = await fillRound(dice, mini, signers.slice(1, 7));
    const targetBlock = (await dice.getRoundInfo(roundId))[4];
    await mineUntilAfter(targetBlock);

    const wrongSecret = ethers.keccak256(ethers.toUtf8Bytes("wrong-secret"));
    await expect(dice.revealAndDraw(roundId, wrongSecret)).to.be.revertedWith(
      "Dice: bad reveal"
    );
  });

  it("refunds a full round if the reveal window expires", async () => {
    const { signers, mini, dice } = await deployFixture();
    await dice.setRandomnessConfig(1, 2);
    await queueSecret(dice, "expired-secret");

    const players = signers.slice(1, 7);
    const roundId = await fillRound(dice, mini, players);
    const targetBlock = await dice.roundTargetBlock(roundId);

    for (const player of players) {
      expect(await mini.balanceOf(player.address)).to.equal(0);
    }

    await mineUntilAfter(targetBlock + 3n);

    await expect(dice.cancelExpiredReveal(roundId))
      .to.emit(dice, "RoundCancelled")
      .and.to.emit(dice, "CommitRevealExpiredCancelled");

    for (const player of players) {
      expect(await mini.balanceOf(player.address)).to.equal(points(10));
      expect(await dice.hasJoinedRound(roundId, player.address)).to.equal(false);
    }

    expect(await dice.getRoundState(roundId)).to.equal(4);
  });
});
