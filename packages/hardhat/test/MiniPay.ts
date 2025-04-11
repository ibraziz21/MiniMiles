import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Raffle, Raffle__factory, MiniPoints, MiniPoints__factory, MockERC20, MockERC20__factory } from "../typechain-types";
import { Contract } from "ethers";

describe("Raffle Contract", function () {
  let owner: any;
  let beneficiary: any;
  let user1: any;
  let user2: any;
  let raffleAddress: any;
  let cUSDAddress: any;
  let cKESAddress: any

  let miniPoints: MiniPoints;
  let cUSD: MockERC20;         // mock cUSD
  let cKES: MockERC20;         // mock cKES
  let raffle: Raffle;

  const initialMint = ethers.parseEther("1000000"); // 1M tokens for tests

  before(async () => {
    [owner, beneficiary, user1, user2] = await ethers.getSigners();

    // 1. Deploy MiniPoints
    const MiniPointsFactory = await ethers.getContractFactory("MiniPoints");
    miniPoints = await MiniPointsFactory.connect(owner).deploy();
    await miniPoints.waitForDeployment()
    // In Ethers v6, use getAddress() to fetch the deployed address
    const miniPointsAddress = await miniPoints.getAddress();
    console.log("Address: ", miniPointsAddress)


    // 2. Deploy mock cUSD token
    const MockERC20Factory = await ethers.getContractFactory("mockERC20");
    cUSD = await MockERC20Factory.connect(owner).deploy("celo USD", "cUSD");
    await cUSD.waitForDeployment()


    // 3. Deploy mock cKES token
    cKES = await MockERC20Factory.connect(owner).deploy("celo KES", "cKES");
    await cKES.waitForDeployment()

    cUSDAddress = await cUSD.getAddress()
    cKESAddress = await cKES.getAddress()

    // 4. Deploy Raffle
    const RaffleFactory = await ethers.getContractFactory("Raffle");
    raffle = await RaffleFactory.connect(owner).deploy(miniPointsAddress, cUSDAddress, cKESAddress);
    await cKES.waitForDeployment()

    raffleAddress = await raffle.getAddress()


  });

  it("Should set the correct owner", async () => {
    const contractOwner = await raffle.owner();
    expect(contractOwner).to.equal(owner.address);
  });

  it("Owner can create a new Raffle Round", async () => {
    // Approve the Raffle contract to spend some cUSD
    const rewardPool = ethers.parseEther("1000"); // 1000 cUSD for reward

    console.log("Raffle Address: ", raffleAddress)
    await cUSD.connect(owner).approve(raffleAddress, rewardPool);

    const currentBlock = await ethers.provider.getBlock("latest");
    if (currentBlock != undefined) {
      const startTime = currentBlock.timestamp + 1;
      // start in ~1 second
      const duration = 60 * 60;                     // 1 hour
      const maxParticipants = 5;
      const ticketCostPoints = ethers.parseUnits("100", 0); // 100 MiniPoints

      // Create the round
      const tx = await raffle.connect(owner).createRaffleRound(
        startTime,
        duration,
        maxParticipants,
        cUSDAddress,     // using cUSD for reward
        rewardPool,
        ticketCostPoints,
        beneficiary.address
      );
      const receipt = await tx.wait();
      // const event = receipt.logs?.find((e: any) => e.event === "RoundCreated");
      // We'll store the found event log in a variable:
      let roundCreatedLog: any | undefined;

      // Loop over all logs in the receipt
      for (const log of receipt.logs) {
        // Check if Ethers recognized it as an EventLog from our Raffle contract
        if ("fragment" in log && log.fragment.name === "RoundCreated") {
          roundCreatedLog = log;
          break; // Found it, no need to check further logs
        }
      }

      // Ensure we found the event
      expect(roundCreatedLog).to.not.be.undefined;

      // Now check the args
      // roundCreatedLog.args is a Result array/object with the event params
      expect(roundCreatedLog.args.roundId).to.equal(1n); // since it's a BigInt
      expect(roundCreatedLog.args.rewardPool).to.equal(rewardPool);
      expect(roundCreatedLog.args.rewardToken).to.equal(cUSDAddress);

    } else {
      console.log("Undefined Block")
    }
  });

  it("Non-owner cannot create a new Raffle Round", async () => {
    const rewardPool = ethers.parseEther("100");
    await cUSD.connect(owner).approve(raffleAddress, rewardPool);
    //await cUSD.connect(user1).approve(raffleAddress, rewardPool); // Owner approval
     // Owner approval
    const currentBlock = await ethers.provider.getBlock("latest");

    if (currentBlock != undefined) {
    // Attempt as user1
    await expect(
      raffle
        .connect(user1)
        .createRaffleRound(
          currentBlock.timestamp + 1,
          3600,
          5,
          cUSDAddress,
          rewardPool,
          50,
          beneficiary.address
        
    )).to.be.reverted; // or your custom revert message
  }
  });

  it("Creating a raffle round should fail if allowance is insufficient", async () => {
    // For example: user1 tries to create with not enough allowance
    const rewardPool = ethers.parseEther("200");

    const currentBlock = await ethers.provider.getBlock("latest");

    if (currentBlock != undefined) {
    // user1 doesn’t approve anything
    await expect(
      raffle
        .connect(owner)
        .createRaffleRound(
          currentBlock.timestamp + 1,
          3600,
          5,
          cUSDAddress,
          rewardPool,
          50,
          beneficiary.address
        )
    ).to.be.revertedWith("Insufficient Allowance");
  }
  });


  it("Should fail if duration is 0 or maxParticipants is 0, etc.", async () => {
    const rewardPool = ethers.parseEther("100");
    await cUSD.connect(owner).approve(raffleAddress, rewardPool);
    const currentBlock = await ethers.provider.getBlock("latest");

    if (currentBlock != undefined) {
    // user1 doesn’t approve anything
    await expect(
      raffle
        .connect(owner)
        .createRaffleRound(
          currentBlock.timestamp + 1,
          0,
          5,
          cUSDAddress,
          rewardPool,
          50,
          beneficiary.address
        )
    ).to.be.revertedWith("Duration must be > 0");

    await expect(
      raffle
        .connect(owner)
        .createRaffleRound(
          currentBlock.timestamp + 1,
          3600,
          0, // zero maxParticipants
          cUSDAddress,
          rewardPool,
          50,
          beneficiary.address
        )
    ).to.be.revertedWith("Max participants must be > 0");
  }
  });


    // ----------------------------------------------------------------------------------------------
  // FUND RAFFLE ROUND TESTS
  // ----------------------------------------------------------------------------------------------

  it("Owner can fund an existing raffle round", async () => {
    // Round #1 exists from earlier tests.
    const fundAmount = ethers.parseEther("500");
    await cUSD.connect(owner).approve(raffleAddress, fundAmount);

    const tx = await raffle.connect(owner).fundRaffleRound(1, cUSDAddress, fundAmount);
    const receipt = await tx.wait();

    // Confirm the rewardPool for round #1 is increased.
    const roundInfo = await raffle.rounds(1);
    // original rewardPool was 1000 cUSD
    expect(roundInfo.rewardPool).to.equal(ethers.parseEther("1500"));
  });

  it("Non-owner cannot fund a raffle round", async () => {
    const fundAmount = ethers.parseEther("100");
    await cUSD.connect(user1).approve(raffleAddress, fundAmount); // user1 approved but not owner
    await expect(
      raffle.connect(user1).fundRaffleRound(1, cUSDAddress, fundAmount)
    ).to.be.revertedWith("Not owner");
  });

  it("Cannot fund a non-existent round", async () => {
    const fundAmount = ethers.parseEther("100");
    await cUSD.connect(owner).approve(raffleAddress, fundAmount);
    await expect(
      raffle.connect(owner).fundRaffleRound(99, cUSDAddress, fundAmount) // round #99 doesn't exist
    ).to.be.revertedWith("Round does not exist");
  });

  // it("Cannot fund an inactive round", async () => {
  //   // We'll create a short round, end it, then attempt to fund it.
  //   // Create a round #2
  //   const rewardPool = ethers.parseEther("50");
  //   await cUSD.connect(owner).approve(raffleAddress, rewardPool);

  //   const nowBlock = await ethers.provider.getBlock("latest");
  //   const createTx = await raffle.connect(owner).createRaffleRound(
  //     nowBlock.timestamp + 1, 
  //     5, // 5s duration
  //     2,
  //     cUSDAddress,
  //     rewardPool,
  //     10,
  //     beneficiary.address
  //   );
  //   await createTx.wait();

  //   // Wait 6s so the round #2 ends
  //   await fastForward(6);

  //   // Draw a winner to mark it inactive (or no winner if no participants)
  //   await raffle.connect(owner).drawWinner(2);

  //   // Now attempt to fund
  //   const fundAmount = ethers.parseEther("20");
  //   await cUSD.connect(owner).approve(raffleAddress, fundAmount);
  //   await expect(
  //     raffle.connect(owner).fundRaffleRound(2, cUSDAddress, fundAmount)
  //   ).to.be.revertedWith("Round not active");
  // });



  it("User can join a Raffle round by burning MiniPoints", async () => {
    // Let user1 acquire some MiniPoints first
    await miniPoints.connect(owner).mint(user1.address, 1000);

    // Move time forward so raffle is active
    // Hardhat's default won't automatically jump in time, so we'll do a small evm_increaseTime
    await ethers.provider.send("evm_increaseTime", [2]); // 2 seconds
    await ethers.provider.send("evm_mine", []); // force a block

    // Check user1's initial MiniPoints
    const initialPoints = await miniPoints.balanceOf(user1.address);
    expect(initialPoints).to.equal(1000);

    // Join raffle round #1
    await raffle.connect(user1).joinRaffle(1);

    // Now user1 should have burned 100 points
    const afterBurn = await miniPoints.balanceOf(user1.address);
    expect(afterBurn).to.equal(900);

    // Check participants
    const participantCount = await raffle.getParticipantCount(1);
    expect(participantCount).to.equal(1);
  });

  it("Should allow drawing a winner after time ends or max participants is reached", async () => {
    // For demonstration, we'll fast-forward time to ensure round ended
    await ethers.provider.send("evm_increaseTime", [3600]); // 1 hour
    await ethers.provider.send("evm_mine", []);

    // Draw winner
    const tx = await raffle.connect(owner).drawWinner(1);
    const receipt = await tx.wait();

    let winnerSelectedLog: any | undefined;
    for (const log of receipt.logs) {
      if ("fragment" in log && log.fragment.name === "WinnerSelected") {
        winnerSelectedLog = log;
        break;
      }
    }

    expect(winnerSelectedLog).to.not.be.undefined;
    expect(winnerSelectedLog.args.roundId).to.equal(1);
    // The winner could be user1 (since that’s the only participant).
    // But the test is mostly to confirm the event is emitted and the function doesn’t revert.
  });

  it("Should create a second raffle using cKES and let multiple participants join, then pick a winner", async () => {
    // Approve the Raffle contract to spend cKES
    const rewardPool = ethers.parseEther("500"); // 500 cKES for reward
    await cKES.connect(owner).approve(raffleAddress, rewardPool);

    // Let's create round #2
    const currentBlock = await ethers.provider.getBlock("latest");
    if (currentBlock != undefined) {
      const startTime = currentBlock.timestamp + 1;
      const duration = 120; // 2 minutes
      const maxParticipants = 2;
      const ticketCostPoints = 50; // minimal points

      const tx = await raffle.connect(owner).createRaffleRound(
        startTime,
        duration,
        maxParticipants,
        cKESAddress, // using cKES this time
        rewardPool,
        ticketCostPoints,
        beneficiary.address
      );
      await tx.wait();

      // Move time forward so raffle #2 is active
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine", []);

      // Mint MiniPoints to both user1 and user2
      await miniPoints.connect(owner).mint(user1.address, 200);
      await miniPoints.connect(owner).mint(user2.address, 200);

      // user1 joins
      await raffle.connect(user1).joinRaffle(2);
      // user2 joins
      await raffle.connect(user2).joinRaffle(2);

      // Since maxParticipants = 2, we’ve reached the limit.
      // We can immediately draw a winner.
      const drawTx = await raffle.connect(owner).drawWinner(2);
      const drawReceipt = await drawTx.wait();
 // 9) Parse the "WinnerSelected" event from drawReceipt.logs
 let winnerSelectedLog: any | undefined;
 for (const log of drawReceipt.logs) {
   if ("fragment" in log && log.fragment.name === "WinnerSelected") {
     winnerSelectedLog = log;
     break;
   }
 }

 // Verify we got the WinnerSelected event
 expect(winnerSelectedLog).to.not.be.undefined;
 expect(winnerSelectedLog.args.roundId).to.equal(2n);
 expect(winnerSelectedLog.args.reward).to.equal(rewardPool);
 // The winner could be user1 or user2. No guarantee which one.
    }
  });

});
