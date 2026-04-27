import { expect } from "chai";
import { ethers } from "hardhat";

describe("AkibaDiceGame Witnet V3 passive randomness", () => {
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

    const Witnet = await ethers.getContractFactory("WitRandomnessMock");
    const witnet = await Witnet.deploy();
    await witnet.waitForDeployment();

    return { owner, signers, mini, dice, witnet };
  }

  async function fillRound(dice: any, mini: any, players: any[], tier = 10) {
    const entry = ethers.parseEther(String(tier));
    for (let i = 0; i < 6; i++) {
      await mini.mint(players[i].address, entry);
      await dice.connect(players[i]).joinTier(tier, i + 1);
    }
    return dice.getActiveRoundId(tier);
  }

  it("sets up a clone and reports it through witRandomness()", async () => {
    const { dice, witnet } = await deployFixture();

    await expect(dice.setupClone(await witnet.getAddress(), 350_000))
      .to.emit(dice, "CloneSetup")
      .withArgs(await witnet.getAddress());

    expect(await dice.rngBase()).to.equal(await witnet.getAddress());
    expect(await dice.rngClone()).to.equal(await witnet.getAddress());
    expect(await dice.witRandomness()).to.equal(await witnet.getAddress());
    expect(await witnet.consumer()).to.equal(await dice.getAddress());
    expect(await witnet.callbackGasLimit()).to.equal(350_000);
  });

  it("finalizes a full round from the Witnet callback without polling", async () => {
    const { signers, mini, dice, witnet } = await deployFixture();
    await dice.setupClone(await witnet.getAddress(), 350_000);

    const players = signers.slice(1, 7);
    const roundId = await fillRound(dice, mini, players);

    await dice.requestRoundRandomness(roundId, { value: ethers.parseEther("0.01") });
    const infoBefore = await dice.getRoundInfo(roundId);
    const randomBlock = infoBefore[4];

    expect(await dice.roundUsesCloneRng(roundId)).to.equal(true);
    expect(await dice.roundByRandomBlock(randomBlock)).to.equal(roundId);

    const randomness = ethers.keccak256(ethers.toUtf8Bytes("witnet callback seed"));
    await expect(witnet.deliver(randomBlock, randomness))
      .to.emit(dice, "RandomnessDelivered")
      .and.to.emit(dice, "RoundResolved");

    const infoAfter = await dice.getRoundInfo(roundId);
    expect(infoAfter[2]).to.equal(true);
    expect(infoAfter[3]).to.be.within(1, 6);
    expect(players.map((p) => p.address)).to.include(infoAfter[5]);
    expect(await dice.getRoundState(roundId)).to.equal(4);
  });

  it("still supports manual drawRound fallback for clone rounds", async () => {
    const { signers, mini, dice, witnet } = await deployFixture();
    await dice.setupClone(await witnet.getAddress(), 350_000);

    const roundId = await fillRound(dice, mini, signers.slice(1, 7));

    await dice.requestRoundRandomness(roundId, { value: ethers.parseEther("0.01") });
    const randomBlock = (await dice.getRoundInfo(roundId))[4];
    const randomness = ethers.keccak256(ethers.toUtf8Bytes("manual fallback seed"));

    await witnet.setRandomness(randomBlock, randomness);
    await expect(dice.drawRound(roundId)).to.emit(dice, "RoundResolved");

    const infoAfter = await dice.getRoundInfo(roundId);
    expect(infoAfter[2]).to.equal(true);
  });

  it("rejects callback calls from non-clone addresses", async () => {
    const { signers, dice, witnet } = await deployFixture();
    await dice.setupClone(await witnet.getAddress(), 350_000);

    await expect(
      dice.connect(signers[1]).reportRandomness(
        ethers.keccak256(ethers.toUtf8Bytes("bad")),
        123,
        124,
        0,
        ethers.ZeroHash,
      )
    ).to.be.revertedWith("Dice: invalid randomizer");
  });
});
