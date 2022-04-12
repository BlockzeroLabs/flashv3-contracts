import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { FlashIncentives, TestFlashStrategyAAVEv2 } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
const { deployContract } = hre.waffle;

describe.only("Flash Incentives", function () {
  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let incentiveContract: FlashIncentives;
  let testStratContract: TestFlashStrategyAAVEv2;

  let signers: SignerWithAddress[];

  before(async function () {
    signers = await hre.ethers.getSigners();

    // 1. Deploy the test strategy
    const testStratArtifact: Artifact = await hre.artifacts.readArtifact("Test_FlashStrategyAAVEv2");
    testStratContract = <TestFlashStrategyAAVEv2>await deployContract(signers[0], testStratArtifact);

    // 2. Deploy the incentives contract
    const incentivesArtifact: Artifact = await hre.artifacts.readArtifact("FlashIncentives");
    incentiveContract = <FlashIncentives>await deployContract(signers[0], incentivesArtifact);
  });

  it("account 3 should return 123 fERC20 burned from strategy contract", async function () {
    const _amount = BigNumber.from(123).mul(multiplier);

    await testStratContract.connect(signers[3]).setTotalFTokenBurned(signers[3].address, _amount);
    expect(await testStratContract.connect(signers[3]).getTotalFTokenBurned(signers[3].address)).to.be.eq(_amount);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000,000 DAI to account 0", async function () {
    // Tell hardhat to impersonate
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[0].address, BigNumber.from(1000000).mul(multiplier));
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000,000 DAI to account 1", async function () {
    // Tell hardhat to impersonate
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[1].address, BigNumber.from(1000000).mul(multiplier));
  });

  it("account 0 should fail to deposit grant with expiry < 3 months with error GRANT EXPIRY MUST BE > 3 MONTHS", async function () {
    const _strategyAddress = testStratContract.address;
    const _tokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD"; // (DAI)
    const _grantAmount = BigNumber.from(10000).mul(multiplier);
    const _ratio = BigNumber.from(5).mul(BigNumber.from(10).pow(17)); // 1 fERC20 = 0.5 DAI
    const _expiryTimestamp = Math.floor(Date.now() / 1000) + 60;

    // Approve the contact to spend
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");
    await daiContract.connect(signers[0]).approve(incentiveContract.address, _grantAmount);

    await expect(
      incentiveContract.depositGrant(_strategyAddress, _tokenAddress, _grantAmount, _ratio, _expiryTimestamp),
    ).to.be.revertedWith("GRANT EXPIRY MUST BE > 3 MONTHS");
  });

  it("account 0 should deposit grant, grantAmount=10,000 DAI, ratio=0.5, expiry=3 months", async function () {
    const _strategyAddress = testStratContract.address;
    const _tokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD"; // (DAI)
    const _grantAmount = BigNumber.from(10000).mul(multiplier);
    const _ratio = BigNumber.from(5).mul(BigNumber.from(10).pow(17)); // 1 fERC20 = 0.5 DAI
    const _expiryTimestamp = Math.floor(Date.now() / 1000) + 7257600; // 3 months

    // Approve the contact to spend
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");
    await daiContract.connect(signers[0]).approve(incentiveContract.address, _grantAmount);

    await incentiveContract.depositGrant(_strategyAddress, _tokenAddress, _grantAmount, _ratio, _expiryTimestamp);
  });

  it("account 1 should be unable to withdraw grant with error NOT GRANT OWNER", async function () {
    await expect(incentiveContract.connect(signers[1]).withdrawGrants([1])).to.be.revertedWith("NOT GRANT OWNER");
  });

  it("account 0 should be unable to withdraw grant with error MINIMUM WITHDRAWAL TIME IS 3 MONTHS", async function () {
    await expect(incentiveContract.connect(signers[0]).withdrawGrants([1])).to.be.revertedWith(
      "MINIMUM WITHDRAWAL TIME IS 3 MONTHS",
    );
  });

  it("account 3 should be unable to claim non-existent grant with error GRANT IS NOT ACTIVE", async function () {
    await expect(incentiveContract.connect(signers[3]).claimGrants([0])).to.be.revertedWith("GRANT IS NOT ACTIVE");
  });

  it("account 3 should claim single grant and receive 61.5 DAI tokens", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");
    const oldDaiBalance = await daiContract.connect(signers[3]).balanceOf(signers[3].address);

    const result = await incentiveContract.connect(signers[3]).claimGrants([1]);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "GrantClaimed";
    }))[0]["args"];
    // @ts-ignore
    const _tokenAmount = args["_tokenAmount"];

    expect(_tokenAmount).to.be.eq(ethers.utils.parseUnits("61.5", 18));

    const newDaiBalance = await daiContract.connect(signers[3]).balanceOf(signers[3].address);
    expect(newDaiBalance.sub(oldDaiBalance)).to.be.eq(_tokenAmount);
  });

  it("set the next block timestamp to 3 months into the future", async function () {
    const newTs = new Date().getTime() / 1000 + 7257600;
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs]);
    await hre.network.provider.send("evm_mine");
  });

  it("account 0 should be able to withdraw grant 1 and get back 9938.5 DAI", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");
    const oldDaiBalance = await daiContract.connect(signers[0]).balanceOf(signers[0].address);

    await incentiveContract.connect(signers[0]).withdrawGrants([1]);

    const newDaiBalance = await daiContract.connect(signers[0]).balanceOf(signers[0].address);

    expect(newDaiBalance.sub(oldDaiBalance)).to.be.eq(ethers.utils.parseUnits("9938.5", 18));
  });

  it("account 1 should deposit grant, grantAmount=10,000 DAI, ratio=1.5, expiry=3 months", async function () {
    const _strategyAddress = testStratContract.address;
    const _tokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD"; // (DAI)
    const _grantAmount = BigNumber.from(10000).mul(multiplier);
    const _ratio = BigNumber.from(5).mul(BigNumber.from(10).pow(17)); // 1 fERC20 = 0.5 DAI
    const _expiryTimestamp = Math.floor(Date.now() / 1000) + 7257600; // 3 months

    // Approve the contact to spend
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");
    await daiContract.connect(signers[1]).approve(incentiveContract.address, _grantAmount);

    await incentiveContract.depositGrant(_strategyAddress, _tokenAddress, _grantAmount, _ratio, _expiryTimestamp);
  });

  it("account 0 should deposit grant, grantAmount=10,000 DAI, ratio=1.5, expiry=3 months", async function () {
    const _strategyAddress = testStratContract.address;
    const _tokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD"; // (DAI)
    const _grantAmount = BigNumber.from(10000).mul(multiplier);
    const _ratio = BigNumber.from(5).mul(BigNumber.from(10).pow(17)); // 1 fERC20 = 0.5 DAI
    const _expiryTimestamp = Math.floor(Date.now() / 1000) + 7257600; // 3 months

    // Approve the contact to spend
    const daiContract = await hre.ethers.getContractAt("IERC20C", "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD");
    await daiContract.connect(signers[1]).approve(incentiveContract.address, _grantAmount);

    await incentiveContract.depositGrant(_strategyAddress, _tokenAddress, _grantAmount, _ratio, _expiryTimestamp);
  });
});
