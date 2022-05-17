import hre from "hardhat";
import { FlashBack, FlashToken } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { ContractReceipt, ethers } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

const { deployContract } = hre.waffle;

describe("FlashBack Tests", function () {
  let flashTokenContract: FlashToken;
  let flashBackContract: FlashBack;
  let signers: SignerWithAddress[];
  let forfeitAddress = "0x0585AD5227bE9b5c2D7f9506f9b5b2409BF48524";

  before(async function () {
    signers = await hre.ethers.getSigners();

    // Deploy the Flash Token Contract
    const flashTokenContractA: Artifact = await hre.artifacts.readArtifact("FlashToken");
    flashTokenContract = <FlashToken>await deployContract(signers[0], flashTokenContractA);

    // Deploy the FlashBack contract
    const flashBackContractA: Artifact = await hre.artifacts.readArtifact("FlashBack");
    flashBackContract = <FlashBack>await deployContract(signers[0], flashBackContractA, [flashTokenContract.address]);

    // Set the forfeit address
    await flashBackContract.setForfeitRewardAddress(forfeitAddress);
  });

  it("should transfer 25,000,000 Flash from account 0 to flashback contract", async function () {
    let _amount = ethers.utils.parseUnits("25000000", 18);
    let _recipient = flashBackContract.address;

    await flashTokenContract.connect(signers[0]).transfer(_recipient, _amount);

    expect(await flashTokenContract.balanceOf(_recipient)).to.be.eq(_amount);
    expect(await flashBackContract.getAvailableRewards()).to.be.eq(_amount);
  });

  it("should transfer 1,000,000 Flash from account 0 to account 1", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _recipient = signers[1].address;

    await flashTokenContract.connect(signers[0]).transfer(_recipient, _amount);

    expect(await flashTokenContract.balanceOf(_recipient)).to.be.eq(_amount);
  });

  it("should transfer 1,000,000 Flash from account 0 to account 2", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _recipient = signers[2].address;

    await flashTokenContract.connect(signers[0]).transfer(_recipient, _amount);

    expect(await flashTokenContract.balanceOf(_recipient)).to.be.eq(_amount);
  });

  it("account 1 should get quote, 1,000,000 FLASH for 365 days = 1,000,000.000007424 in rewards", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _duration = 31536000;

    let result = await flashBackContract.calculateReward(_amount, _duration);

    expect(result).to.be.eq(ethers.utils.parseUnits("1000000.000007424", 18));
  });

  it("account 1 should get quote, 1,000,000 FLASH for 182.5 days = 500,000.000003712 in rewards", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _duration = 15768000;

    let result = await flashBackContract.calculateReward(_amount, _duration);

    expect(result).to.be.eq(ethers.utils.parseUnits("500000.000003712", 18));
  });

  it("account 1 should get quote, 100,000,000 FLASH for 365 days = 25,000,000 in rewards (total available)", async function () {
    let _amount = ethers.utils.parseUnits("100000000", 18);
    let _duration = 31536000;

    let result = await flashBackContract.calculateReward(_amount, _duration);

    expect(result).to.be.eq(ethers.utils.parseUnits("25000000", 18));
  });

  it("account 1 should fail getting quote, 1,000,000 FLASH for 366 days with error MAXIMUM STAKE DURATION IS 365 DAYS", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _duration = 31622400;

    await expect(flashBackContract.calculateReward(_amount, _duration)).to.be.revertedWith(
      "MAXIMUM STAKE DURATION IS 365 DAYS",
    );
  });

  it("account 1 should fail getting quote, 1,000,000 FLASH for < 10 days with error MINIMUM STAKE DURATION IS 10 DAYS", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _duration = 863999;

    await expect(flashBackContract.calculateReward(_amount, _duration)).to.be.revertedWith(
      "MINIMUM STAKE DURATION IS 10 DAYS",
    );
  });

  it("account 1 should fail getting quote, 0 FLASH for < 10 days with error INSUFFICIENT INPUT", async function () {
    let _amount = ethers.utils.parseUnits("0", 18);
    let _duration = 863999;

    await expect(flashBackContract.calculateReward(_amount, _duration)).to.be.revertedWith("INSUFFICIENT INPUT");
  });

  it("(1) account 1 should stake 1,000,000 Flash for 36.5 days", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _duration = 86400 * 36.5;
    let _minimumReward = ethers.utils.parseUnits("100000.0000007424", 18);

    // Approval and stake
    await flashTokenContract.connect(signers[1]).approve(flashBackContract.address, _amount);
    let result = await flashBackContract.connect(signers[1]).stake(_amount, _duration, _minimumReward);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    console.log("(1) Stake ID =", args["stakeId"]);

    expect((await flashBackContract.stakes(1)).active).to.be.true;
    expect(await flashTokenContract.balanceOf(signers[1].address)).to.be.eq(0);
  });

  it("(2) account 2 should stake 536,432 Flash for 365 days", async function () {
    let _amount = ethers.utils.parseUnits("536432", 18);
    let _duration = 86400 * 365;
    let _minimumReward = ethers.utils.parseUnits("536432.000003982471168", 18);

    // Approval and stake
    await flashTokenContract.connect(signers[2]).approve(flashBackContract.address, _amount);
    let result = await flashBackContract.connect(signers[2]).stake(_amount, _duration, _minimumReward);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    console.log("(2) Stake ID =", args["stakeId"]);

    expect((await flashBackContract.stakes(2)).active).to.be.true;
    expect(await flashTokenContract.balanceOf(signers[2].address)).to.be.eq(ethers.utils.parseUnits("463568", 18));
  });

  it("(3) account 2 should fail: stake 12,500 Flash for 365 days, _minimumReward = 12501 with error MINIMUM REWARD NOT MET", async function () {
    let _amount = ethers.utils.parseUnits("12500", 18);
    let _duration = 86400 * 365;
    let _minimumReward = ethers.utils.parseUnits("12501", 18);

    // Approval and stake
    await flashTokenContract.connect(signers[2]).approve(flashBackContract.address, _amount);
    await expect(flashBackContract.connect(signers[2]).stake(_amount, _duration, _minimumReward)).to.be.revertedWith(
      "MINIMUM REWARD NOT MET",
    );
  });

  it("(3) account 2 should stake 12,500 Flash for 365 days", async function () {
    let _amount = ethers.utils.parseUnits("12500", 18);
    let _duration = 86400 * 365;
    let _minimumReward = ethers.utils.parseUnits("12500.0000000928", 18);

    // Approval and stake
    await flashTokenContract.connect(signers[2]).approve(flashBackContract.address, _amount);
    let result = await flashBackContract.connect(signers[2]).stake(_amount, _duration, _minimumReward);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    console.log("(3) Stake ID =", args["stakeId"]);

    expect((await flashBackContract.stakes(3)).active).to.be.true;
    expect(await flashTokenContract.balanceOf(signers[2].address)).to.be.eq(ethers.utils.parseUnits("451068", 18));
  });

  it("account 1 should fail unstaking with error MINIMUM STAKE DURATION IS 10 DAYS", async function () {
    await expect(flashBackContract.connect(signers[1]).unstake(1)).to.be.revertedWith(
      "MINIMUM STAKE DURATION IS 10 DAYS",
    );
  });

  it("account 2 should fail unstaking account 1's stake with error NOT OWNER OF STAKE", async function () {
    await expect(flashBackContract.connect(signers[2]).unstake(1)).to.be.revertedWith("NOT OWNER OF STAKE");
  });

  it("increase block time by 10 days", async function () {
    // Increase the timestamp of the next block
    const increaseBy = 86400 * 10;
    await hre.network.provider.send("evm_increaseTime", [increaseBy]);
  });

  it("(3a) account 1 should unstake early (stakeid 1), get back principal, rewards should redirect to treasury", async function () {
    const stakeInfo = await flashBackContract.stakes(1);
    const oldBalance = await flashTokenContract.balanceOf(signers[1].address);
    console.log("(3a) oldBalance", ethers.utils.formatUnits(oldBalance));

    await flashBackContract.connect(signers[1]).unstake(1);

    const expectedBalance = oldBalance.add(stakeInfo.stakedAmount);
    console.log("(3a) expectedBalance", ethers.utils.formatUnits(expectedBalance));
    console.log("(3a) actualBalance", ethers.utils.formatUnits(await flashTokenContract.balanceOf(signers[1].address)));
    expect(await flashTokenContract.balanceOf(signers[1].address)).to.be.eq(expectedBalance);
    expect((await flashBackContract.stakes(1)).active).to.be.false;

    expect(await flashTokenContract.balanceOf(await flashBackContract.forfeitRewardAddress())).to.be.eq(
      stakeInfo.reservedReward,
    );
    expect(await flashTokenContract.balanceOf(forfeitAddress)).to.be.eq(stakeInfo.reservedReward);
    console.log("(3a) Forfeit address balance", stakeInfo.reservedReward);
  });

  it("increase block time by 365 days", async function () {
    // Increase the timestamp of the next block
    const increaseBy = 86400 * 365;
    await hre.network.provider.send("evm_increaseTime", [increaseBy]);
  });

  it("(4) account 2 should unstake, principal and reward to wallet", async function () {
    const stakeInfo = await flashBackContract.stakes(2);
    const oldBalance = await flashTokenContract.balanceOf(signers[2].address);

    await flashBackContract.connect(signers[2]).unstake(2);

    const expectedBalance = oldBalance.add(stakeInfo.stakedAmount).add(stakeInfo.reservedReward);
    expect(await flashTokenContract.balanceOf(signers[2].address)).to.be.eq(expectedBalance);
    expect((await flashBackContract.stakes(2)).active).to.be.false;

    console.log("(4) oldBalance", ethers.utils.formatUnits(oldBalance));
    console.log("(4) expectedBalance", ethers.utils.formatUnits(expectedBalance));
  });

  it("(5) account 2 should unstake, principal and reward to wallet", async function () {
    const stakeInfo = await flashBackContract.stakes(3);
    const oldBalance = await flashTokenContract.balanceOf(signers[2].address);

    await flashBackContract.connect(signers[2]).unstake(3);

    const expectedBalance = oldBalance.add(stakeInfo.stakedAmount).add(stakeInfo.reservedReward);
    expect(await flashTokenContract.balanceOf(signers[2].address)).to.be.eq(expectedBalance);
    expect((await flashBackContract.stakes(3)).active).to.be.false;

    console.log("(5) oldBalance", ethers.utils.formatUnits(oldBalance));
    console.log("(5) expectedBalance", ethers.utils.formatUnits(expectedBalance));
  });

  it("account 2 should attempt to unstake twice and fail with error INVALID STAKE", async function () {
    await expect(flashBackContract.connect(signers[2]).unstake(3)).to.be.revertedWith("INVALID STAKE");
  });

  it("account 0 should fail to increase reward rate to > 63419583968 / 200% with error INVALID REWARD RATE", async function () {
    await expect(flashBackContract.connect(signers[0]).setRewardRate("63419583969")).to.be.revertedWith(
      "INVALID REWARD RATE",
    );
  });

  it("account 0 should increase reward rate to: 63419583968 / 200%", async function () {
    await flashBackContract.connect(signers[0]).setRewardRate("63419583968");
  });

  it("account 1 should get quote, 1,000,000 FLASH for 182.5 days = 1000000.000007424 in rewards", async function () {
    let _amount = ethers.utils.parseUnits("1000000", 18);
    let _duration = 15768000;

    let result = await flashBackContract.calculateReward(_amount, _duration);

    expect(result).to.be.eq(ethers.utils.parseUnits("1000000.000007424", 18));
  });
});
