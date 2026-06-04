import { expect } from "chai";
import { ethers } from "hardhat";

describe("AkibaSkillGames", () => {
  const GAME_RULE_TAP = 1;
  const ENTRY = 5n;
  const MAX_MILES = 35n;
  const MAX_STABLE = 250_000n;

  async function deployFixture() {
    const [owner, verifier, alice, badVerifier] = await ethers.getSigners();

    const Miles = await ethers.getContractFactory("MiniPointsMock");
    const miles = await Miles.deploy();
    await miles.waitForDeployment();

    const Stable = await ethers.getContractFactory("ERC20Mock");
    const stable = await Stable.deploy("Mock USDT", "mUSDT");
    await stable.waitForDeployment();

    const Treasury = await ethers.getContractFactory("GameTreasury");
    const treasury = await Treasury.deploy(await miles.getAddress(), await stable.getAddress());
    await treasury.waitForDeployment();

    const Games = await ethers.getContractFactory("AkibaSkillGames");
    const games = await Games.deploy(await miles.getAddress(), await treasury.getAddress(), verifier.address);
    await games.waitForDeployment();

    await treasury.setGameContract(await games.getAddress());
    await treasury.fundMiles(1_000n);
    await stable.mint(owner.address, 10_000_000n);
    await stable.approve(await treasury.getAddress(), 10_000_000n);
    await treasury.fundStable(10_000_000n);
    await games.setSupportedGameConfig(GAME_RULE_TAP, true, ENTRY, MAX_MILES, MAX_STABLE, 3600);

    return { owner, verifier, alice, badVerifier, miles, stable, treasury, games };
  }

  async function signSettlement(params: {
    games: any;
    verifier: any;
    sessionId: bigint;
    player: string;
    gameType: number;
    score: bigint;
    rewardMiles: bigint;
    rewardStable: bigint;
    expiry: bigint;
  }) {
    const { games, verifier, sessionId, player, gameType, score, rewardMiles, rewardStable, expiry } = params;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const digest = await games.settlementDigest(
      sessionId,
      player,
      gameType,
      score,
      rewardMiles,
      rewardStable,
      expiry,
      await games.getAddress(),
      chainId
    );
    return verifier.signMessage(ethers.getBytes(digest));
  }

  it("starts a game and burns entry Miles", async () => {
    const { alice, miles, games } = await deployFixture();
    await miles.mint(alice.address, 100n);
    const seedCommitment = ethers.keccak256(ethers.toUtf8Bytes("seed"));

    await expect(games.connect(alice).startGame(GAME_RULE_TAP, seedCommitment))
      .to.emit(games, "GameStarted")
      .withArgs(1n, alice.address, GAME_RULE_TAP, ENTRY, seedCommitment);

    expect(await miles.balanceOf(alice.address)).to.equal(95n);
    const session = await games.sessions(1n);
    expect(session.player).to.equal(alice.address);
    expect(session.seedCommitment).to.equal(seedCommitment);
  });

  it("settles once with verifier authorization and pays rewards", async () => {
    const { alice, verifier, miles, stable, games } = await deployFixture();
    await miles.mint(alice.address, 100n);
    await games.connect(alice).startGame(GAME_RULE_TAP, ethers.keccak256(ethers.toUtf8Bytes("seed")));

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await signSettlement({
      games,
      verifier,
      sessionId: 1n,
      player: alice.address,
      gameType: GAME_RULE_TAP,
      score: 18n,
      rewardMiles: 35n,
      rewardStable: 250_000n,
      expiry,
    });

    await expect(games.connect(alice).settleGame(1n, 18n, 35n, 250_000n, expiry, signature))
      .to.emit(games, "GameSettled")
      .withArgs(1n, alice.address, GAME_RULE_TAP, 18n, 35n, 250_000n);

    expect(await miles.balanceOf(alice.address)).to.equal(130n);
    expect(await stable.balanceOf(alice.address)).to.equal(250_000n);
  });

  it("rejects duplicate settlement", async () => {
    const { alice, verifier, miles, games } = await deployFixture();
    await miles.mint(alice.address, 100n);
    await games.connect(alice).startGame(GAME_RULE_TAP, ethers.keccak256(ethers.toUtf8Bytes("seed")));

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await signSettlement({
      games,
      verifier,
      sessionId: 1n,
      player: alice.address,
      gameType: GAME_RULE_TAP,
      score: 14n,
      rewardMiles: 18n,
      rewardStable: 0n,
      expiry,
    });

    await games.connect(alice).settleGame(1n, 14n, 18n, 0n, expiry, signature);
    await expect(games.connect(alice).settleGame(1n, 14n, 18n, 0n, expiry, signature))
      .to.be.revertedWithCustomError(games, "AlreadySettled");
  });

  it("rejects bad verifier signatures", async () => {
    const { alice, badVerifier, miles, games } = await deployFixture();
    await miles.mint(alice.address, 100n);
    await games.connect(alice).startGame(GAME_RULE_TAP, ethers.keccak256(ethers.toUtf8Bytes("seed")));

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await signSettlement({
      games,
      verifier: badVerifier,
      sessionId: 1n,
      player: alice.address,
      gameType: GAME_RULE_TAP,
      score: 14n,
      rewardMiles: 18n,
      rewardStable: 0n,
      expiry,
    });

    await expect(games.connect(alice).settleGame(1n, 14n, 18n, 0n, expiry, signature))
      .to.be.revertedWithCustomError(games, "UnauthorizedSettlement");
  });

  it("rejects rewards above game config caps", async () => {
    const { alice, verifier, miles, games } = await deployFixture();
    await miles.mint(alice.address, 100n);
    await games.connect(alice).startGame(GAME_RULE_TAP, ethers.keccak256(ethers.toUtf8Bytes("seed")));

    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const signature = await signSettlement({
      games,
      verifier,
      sessionId: 1n,
      player: alice.address,
      gameType: GAME_RULE_TAP,
      score: 100n,
      rewardMiles: 36n,
      rewardStable: 0n,
      expiry,
    });

    await expect(games.connect(alice).settleGame(1n, 100n, 36n, 0n, expiry, signature))
      .to.be.revertedWithCustomError(games, "RewardExceedsConfig");
  });
});
