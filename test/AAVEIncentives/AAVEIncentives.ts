import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { FlashFToken, FlashStrategyAAVEv2 } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ethers } from "ethers";

const { deployContract } = hre.waffle;

/*
    === Important notice ===

    AAVE on Kovan does not have a deployed incentive contract therefore these tests must be performed
    on a fork of ethereum mainnet.

    The default configuration for tests in this environment are on Kovan. This means to run the tests
    within this file, you may need to modify the hardhat.config.ts file.

    These tests will begin at block 14754600 (ethereum mainnet)
*/

describe.skip("AAVEIncentive Test", function () {
  // This is the Kovan DAI address to be used with AAVE
  let principalTokenAddress = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
  let yieldTokenAddress = "0x028171bCA77440897B824Ca71D1c56caC55b68A3";

  const multiplier = BigNumber.from(10).pow(18);

  let startingDaiBalance: BigNumber;
  let strategyAddress: string;

  before(async function () {
    this.signers = await hre.ethers.getSigners();

    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    this.signers.admin = signers[0];
    //console.log("Using address", this.signers.admin.address);

    // Deploy the AAVE strategy
    //console.log("Deploying AAVE DAI Strategy")
    const flashProtocolAddress = this.signers[1].address;
    const flashStrategyAAVEv2Artifact: Artifact = await hre.artifacts.readArtifact("FlashStrategyAAVEv2");
    this.flashStrategyAAVEv2Artifact = <FlashStrategyAAVEv2>(
      await deployContract(this.signers.admin, flashStrategyAAVEv2Artifact, [
        "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9",
        principalTokenAddress,
        yieldTokenAddress,
        flashProtocolAddress,
      ])
    );
    //console.log("-> AAVE DAI Strategy Deployed to", this.flashStrategyAAVEv2Artifact.address);
    strategyAddress = this.flashStrategyAAVEv2Artifact.address;
  });

  it("should impersonate account 0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8 and transfer 1,000,000 DAI to account 0", async function () {
    // Tell hardhat to impersonate
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8"],
    });
    const signer = await hre.ethers.getSigner("0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(this.signers[0].address, BigNumber.from(1000000).mul(multiplier));

    startingDaiBalance = await daiContract.balanceOf(this.signers[0].address);
    expect(startingDaiBalance).gte(BigNumber.from(1000000).mul(multiplier));
  });

  it("[account 1] should deposit 500,000 DAI principal", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Transfer 10,000 DAI to account 1 from account 0
    const _amount = BigNumber.from(500000).mul(multiplier);
    await daiContract.connect(this.signers[0]).transfer(this.signers[1].address, _amount);

    // Approve spending of x DAI from this account against the Strategy Contract
    await daiContract.connect(this.signers[0]).approve(this.flashStrategyAAVEv2Artifact.address, _amount);
    expect(await daiContract.allowance(this.signers.admin.address, this.flashStrategyAAVEv2Artifact.address)).eq(
      _amount,
    );

    await daiContract.connect(this.signers[0]).transfer(this.flashStrategyAAVEv2Artifact.address, _amount);
    expect(await daiContract.balanceOf(this.flashStrategyAAVEv2Artifact.address)).eq(_amount);

    // Since strategies in the future can specify how much principal has been deposited (eg user deposits 1000 erc20,
    // strategy takes 20% fee, it reports back 800 erc20 deposited). Lets test for that for full coverage
    expect(
      await this.flashStrategyAAVEv2Artifact.connect(this.signers[1]).callStatic.depositPrincipal(_amount),
    ).to.be.eq(_amount);

    // Deposit the x DAI in the Strategy Contract to AAVE
    await this.flashStrategyAAVEv2Artifact.connect(this.signers[1]).depositPrincipal(_amount);

    expect(await this.flashStrategyAAVEv2Artifact.getPrincipalBalance()).eq(_amount);
  });

  it("ensure yield increases after 100 blocks (AAVE)", async function () {
    const oldYieldTotal = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    await mineBlocks(hre.ethers.provider, 100);

    // Check how much yield has been generated
    const yieldGenerated = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    expect(yieldGenerated).to.be.gt(oldYieldTotal);
  });

  it("should claim DAI AAVE rewards and balance should be > 0", async function () {
    const stakedAAVEToken = await hre.ethers.getContractAt("IERC20C", "0x4da27a545c0c5B758a6BA100e3a049001de870f5");
    expect(await stakedAAVEToken.balanceOf(this.flashStrategyAAVEv2Artifact.address)).to.be.eq(0);

    const _assets = [yieldTokenAddress];
    const _amount = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    await this.flashStrategyAAVEv2Artifact.claimAAVEv2Rewards(_assets, _amount);

    const currBalance = await stakedAAVEToken.balanceOf(this.flashStrategyAAVEv2Artifact.address);

    console.log("Staked AAVE Token balance is", currBalance);
    expect(currBalance).to.be.gt(0);
  });
});

async function mineBlocks(provider: ethers.providers.JsonRpcProvider, blocks: number): Promise<void> {
  for (let i = 0; i <= blocks; i++) {
    await provider.send("evm_mine", []);
    //await provider.send("hardhat_mine", [blocks]);
  }
}
