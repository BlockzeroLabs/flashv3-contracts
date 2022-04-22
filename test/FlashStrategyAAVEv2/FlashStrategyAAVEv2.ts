import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { FlashFToken, FlashStrategyAAVEv2 } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";

const { deployContract } = hre.waffle;

describe("FlashStrategyAAVEv2 Tests", function () {
  // This is the Kovan DAI address to be used with AAVE
  let principalTokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD";

  const multiplier = BigNumber.from(10).pow(18);

  let fTokenAddress: string;
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
        "0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe",
        principalTokenAddress,
        "0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8",
        flashProtocolAddress,
      ])
    );
    //console.log("-> AAVE DAI Strategy Deployed to", this.flashStrategyAAVEv2Artifact.address);
    strategyAddress = this.flashStrategyAAVEv2Artifact.address;

    // Create a new fERC20 token
    const flashFTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashFToken");
    const flashFTokenContract = <FlashFToken>(
      await deployContract(this.signers.admin, flashFTokenArtifact, ["fDAI", "fDAI"])
    );
    //console.log("Flash fERC20 token deployed to", flashFTokenContract.address);
    fTokenAddress = flashFTokenContract.address;

    // Set the FTokenAddress in the strategy
    await this.flashStrategyAAVEv2Artifact.connect(this.signers[1]).setFTokenAddress(flashFTokenContract.address);
    //console.log("Successfully set fToken address in strategy")

    // Attempt to set again and expect this to fail
    await expect(
      this.flashStrategyAAVEv2Artifact.connect(this.signers[1]).setFTokenAddress(flashFTokenContract.address),
    ).to.be.revertedWith("FTOKEN ADDRESS ALREADY SET");

    // Approve the Flash Strategy contract to spend fTokens from user wallet
    await flashFTokenContract.approve(
      this.flashStrategyAAVEv2Artifact.address,
      BigNumber.from(2).pow(BigNumber.from(256)).sub(BigNumber.from(1)),
    );
  });

  it("should ensure getFTokenAddress returns correct address", async function () {
    expect(await this.flashStrategyAAVEv2Artifact.getFTokenAddress()).eq(fTokenAddress);
  });

  it("should ensure getPrincipalAddress returns correct address", async function () {
    expect(await this.flashStrategyAAVEv2Artifact.getPrincipalAddress()).eq(principalTokenAddress);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000,000 DAI to account 0", async function () {
    // Tell hardhat to impersonate
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(this.signers[0].address, BigNumber.from(1000000).mul(multiplier));

    startingDaiBalance = await daiContract.balanceOf(this.signers[0].address);
    expect(startingDaiBalance).gte(BigNumber.from(1000000).mul(multiplier)); // We only need 10,000 for tests
  });

  it("[account 0] ensure depositing principal fails with error NOT FLASH PROTOCOL", async function () {
    await expect(
      this.flashStrategyAAVEv2Artifact.depositPrincipal(BigNumber.from(10000).mul(multiplier)),
    ).to.be.revertedWith("NOT FLASH PROTOCOL");
  });

  it("[account 1] should deposit 10,000 DAI principal", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Transfer 10,000 DAI to account 1 from account 0
    const _amount = BigNumber.from(10000).mul(multiplier);
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

  it("[account 0] should revert when withdrawing principal with error NOT FLASH PROTOCOL", async function () {
    await expect(
      this.flashStrategyAAVEv2Artifact.withdrawPrincipal(BigNumber.from(10000).mul(multiplier)),
    ).to.be.revertedWith("NOT FLASH PROTOCOL");
  });

  it("[account 1] should withdraw 10,000 DAI (principal) and still have yield in contract", async function () {
    // Withdraw the DAI
    await this.flashStrategyAAVEv2Artifact
      .connect(this.signers[1])
      .withdrawPrincipal(BigNumber.from(10000).mul(multiplier));

    // Ensure principal is 0
    const principalBalance = await this.flashStrategyAAVEv2Artifact.getPrincipalBalance();
    expect(principalBalance).eq(0);

    // Ensure yield is > 0
    const yieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();
    expect(yieldBalance).gt(1);
  });

  it("should mint 10000.00000512 fERC20 (simulating 10k DAI for 365 days)", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    fTokenContract.mint(this.signers.admin.address, ethers.utils.parseUnits("10000.00000512", 18));
  });

  it("should burn 5,000.00000256 fERC20 for totalYield / 2", async function () {
    // The amount we want to burn (fERC20)
    const burnAmount = ethers.utils.parseUnits("5000.00000256", 18);

    // Determine the current total yield balance
    const yieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    // Get a quote - how much yield token can we get
    const quotedAmount = this.flashStrategyAAVEv2Artifact.quoteBurnFToken(burnAmount);

    // Perform the burn
    const result = await this.flashStrategyAAVEv2Artifact.burnFToken(burnAmount, quotedAmount, this.signers[0].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    const yieldReturned = args["_yieldReturned"];

    console.log("\t\tTotal yield is currently", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t\tExpected result", ethers.utils.formatUnits(yieldBalance.div(2), 18));
    console.log("\t\tActual result", ethers.utils.formatUnits(yieldReturned, 18));
    //expect(ethers.utils.formatUnits(yieldReturned, 18)).eq("0.000000024526053965");
    expect(yieldReturned).to.be.eq(yieldBalance.div(2));
  });

  it("should burn 2,500.00000128 fERC20 for totalYield / 2", async function () {
    // The amount we want to burn (fERC20)
    const burnAmount = ethers.utils.parseUnits("2500.00000128", 18);

    // Determine the current total yield balance
    const yieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    // Get a quote - how much yield token can we get
    const quotedAmount = this.flashStrategyAAVEv2Artifact.quoteBurnFToken(burnAmount);

    // Perform the burn
    const result = await this.flashStrategyAAVEv2Artifact.burnFToken(burnAmount, quotedAmount, this.signers[0].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    const yieldReturned = args["_yieldReturned"];

    console.log("\t\tTotal yield is currently", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t\tExpected result", ethers.utils.formatUnits(yieldBalance.div(2), 18));
    console.log("\t\tActual result", ethers.utils.formatUnits(yieldReturned, 18));
    expect(yieldReturned).to.be.eq(yieldBalance.div(2));
  });

  it("should burn 2,500.00000128 fERC20 for totalYield", async function () {
    // The amount we want to burn (fERC20)
    const burnAmount = ethers.utils.parseUnits("2500.00000128", 18);

    // Determine the current total yield balance
    const yieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    // Get a quote - how much yield token can we get
    const quotedAmount = this.flashStrategyAAVEv2Artifact.quoteBurnFToken(burnAmount);

    // Perform the burn
    const result = await this.flashStrategyAAVEv2Artifact.burnFToken(burnAmount, quotedAmount, this.signers[0].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    const yieldReturned = args["_yieldReturned"];

    console.log("\t\tTotal yield is currently", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t\tExpected result", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t\tActual result", ethers.utils.formatUnits(yieldReturned, 18));
    expect(ethers.utils.formatUnits(yieldReturned, 18)).eq(ethers.utils.formatUnits(yieldBalance, 18));
  });

  it("ensure quoting 1 DAI for 365 days = 1.000000000512000000 fDAI", async function () {
    // First ensure the quote function is working as expected
    const _tokenAmount = BigNumber.from(1).mul(multiplier);
    const _duration = 31536000;
    expect(await this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration)).eq("1000000000512000000");
  });

  it("ensure quoting 1 DAI for 1 days = 0.0027397260288 fDAI", async function () {
    // First ensure the quote function is working as expected
    const _tokenAmount = BigNumber.from(1).mul(multiplier);
    const _duration = 86400;
    const result = await this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration);
    expect(ethers.utils.formatUnits(result, 18)).eq("0.0027397260288");
  });

  it("ensure quoting 0.000000000100000000 DAI for 60 seconds = 0.00000000000000190 fDAI", async function () {
    // First ensure the quote function is working as expected
    const _tokenAmount = 100000000;
    const _duration = 60;
    expect(await this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration)).eq("190");
  });

  it("ensure quoting 100,000 DAI for 1 days = 50000.000025600000000000 fDAI", async function () {
    // First ensure the quote function is working as expected
    const _tokenAmount = BigNumber.from(100000).mul(multiplier);
    const _duration = 31536000 / 2;
    expect(await this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration)).eq(
      "50000000025600000000000",
    );
  });

  it("ensure quoting for 59 seconds reverts with error DURATION TOO LOW", async function () {
    // Since we use the quote method internally for determining how much fDAI is minted
    // this is also where we would test the revert.

    const _tokenAmount = BigNumber.from(1).mul(multiplier);
    const _duration = 59;
    await expect(this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration)).to.be.revertedWith(
      "DURATION TOO LOW",
    );
  });

  it("ensure quoting 1 DAI for 61 seconds = 0.000001934297312000 fERC20", async function () {
    // Since we use the quote method internally for determining how much fDAI is minted
    // this is also where we would test the revert.

    const _tokenAmount = BigNumber.from(1).mul(multiplier);
    const _duration = 61;
    expect(await this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration)).eq("1934297312000");
  });

  it("ensure quoting 1 DAI for 182.5 days = 0.500000000256000000 fDAI", async function () {
    // First ensure the quote function is working as expected
    const _tokenAmount = BigNumber.from(1).mul(multiplier);
    const _duration = 31536000 / 2;
    expect(await this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration)).eq("500000000256000000");
  });

  it("ensure quoting 1 DAI for 3650 days = 10.00000000512000000 fDAI", async function () {
    // First ensure the quote function is working as expected
    const _tokenAmount = BigNumber.from(1).mul(multiplier);
    const _duration = 31536000 * 10;
    expect(await this.flashStrategyAAVEv2Artifact.quoteMintFToken(_tokenAmount, _duration)).eq("10000000005120000000");
  });

  it("any ERC20 tokens in the contract can be withdrawn by owner except the interest bearing token (a token)", async function () {
    // Impersonate a random account that has some tokens
    const tokenAddress = "0xD17F23B7f29ceE9adF46da62073fc6cf50F2f218";
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0x71ca1834b42CC6f8783Fc0B461Cf5A0F8B568a50"],
    });
    const signer = await hre.ethers.getSigner("0x71ca1834b42CC6f8783Fc0B461Cf5A0F8B568a50");
    const erc20TokenContract = await hre.ethers.getContractAt("IERC20C", tokenAddress);

    // Transfer these tokens to the FlashStrategy contract
    await erc20TokenContract
      .connect(signer)
      .transfer(this.flashStrategyAAVEv2Artifact.address, BigNumber.from(100).mul(multiplier));
    expect(await erc20TokenContract.balanceOf(this.flashStrategyAAVEv2Artifact.address)).to.be.eq(
      BigNumber.from(100).mul(multiplier),
    );

    // Attempt to withdraw as non-owner (should revert)
    const tokensToWithdraw = [tokenAddress];
    const amountsToWithdraw = [BigNumber.from(100).mul(multiplier)];
    await expect(
      this.flashStrategyAAVEv2Artifact.connect(this.signers[2]).withdrawERC20(tokensToWithdraw, amountsToWithdraw),
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Attempt to withdraw as owner (should be fine)
    expect(
      await this.flashStrategyAAVEv2Artifact
        .connect(this.signers[0])
        .withdrawERC20(tokensToWithdraw, amountsToWithdraw),
    ).to.be.ok;
    expect(await erc20TokenContract.balanceOf(this.flashStrategyAAVEv2Artifact.address)).to.be.eq(
      BigNumber.from(0).mul(multiplier),
    );
    expect(await erc20TokenContract.balanceOf(this.signers[0].address)).to.be.eq(BigNumber.from(100).mul(multiplier));

    // Attempt to withdraw interest bearing token as owner (should revert)
    const tokensToWithdraw2 = ["0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8"];
    const amountsToWithdraw2 = [BigNumber.from(100).mul(multiplier)];

    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xe5800fee4a42ac3149c2d7b828b20c44f9699b71"],
    });
    const signer2 = await hre.ethers.getSigner("0xe5800fee4a42ac3149c2d7b828b20c44f9699b71");
    const aDaiContract = await hre.ethers.getContractAt("IERC20C", tokensToWithdraw2[0]);
    await aDaiContract.connect(signer2).transfer(this.signers[0].address, amountsToWithdraw2[0]);
    await aDaiContract
      .connect(this.signers[0])
      .transfer(this.flashStrategyAAVEv2Artifact.address, amountsToWithdraw2[0]);
    expect(await aDaiContract.balanceOf(this.flashStrategyAAVEv2Artifact.address)).to.be.eq(amountsToWithdraw2[0]);

    await expect(
      this.flashStrategyAAVEv2Artifact.connect(this.signers[0]).withdrawERC20(tokensToWithdraw2, amountsToWithdraw),
    ).to.be.revertedWith("TOKEN ADDRESS PROHIBITED");
  });

  it("should revert with ARRAY SIZE MISMATCH when providing invalid input to withdrawERC20", async function () {
    // Attempt to withdraw as non-owner (should revert)
    const tokensToWithdraw = ["0xe5800fee4a42ac3149c2d7b828b20c44f9699b71"];
    const amountsToWithdraw = [BigNumber.from(100).mul(multiplier), BigNumber.from(100).mul(multiplier)];
    await expect(
      this.flashStrategyAAVEv2Artifact.withdrawERC20(tokensToWithdraw, amountsToWithdraw),
    ).to.be.revertedWith("ARRAY SIZE MISMATCH");
  });

  it("should deposit 10,000 DAI as bootstrap balance", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract
      .connect(this.signers[0])
      .transfer(this.flashStrategyAAVEv2Artifact.address, BigNumber.from(10000).mul(multiplier));
    expect(await daiContract.balanceOf(this.flashStrategyAAVEv2Artifact.address)).to.be.eq(
      BigNumber.from(10000).mul(multiplier),
    );
  });
});

describe("FlashStrategyAAVEv2 Bootstrap Tests", function () {
  // This is the Kovan DAI address to be used with AAVE
  let principalTokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD";
  let interestBearingTokenAddress = "0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8";

  const multiplier = BigNumber.from(10).pow(18);

  let fTokenAddress: string;
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
        "0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe",
        principalTokenAddress,
        "0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8",
        flashProtocolAddress,
      ])
    );
    //console.log("-> AAVE DAI Strategy Deployed to", this.flashStrategyAAVEv2Artifact.address);
    strategyAddress = this.flashStrategyAAVEv2Artifact.address;

    // Create a new fERC20 token
    const flashFTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashFToken");
    const flashFTokenContract = <FlashFToken>(
      await deployContract(this.signers.admin, flashFTokenArtifact, ["fDAI", "fDAI"])
    );
    //console.log("Flash fERC20 token deployed to", flashFTokenContract.address);
    fTokenAddress = flashFTokenContract.address;

    // Set the FTokenAddress in the strategy
    await this.flashStrategyAAVEv2Artifact.connect(this.signers[1]).setFTokenAddress(flashFTokenContract.address);
    //console.log("Successfully set fToken address in strategy")

    // Attempt to set again and expect this to fail
    await expect(
      this.flashStrategyAAVEv2Artifact.connect(this.signers[1]).setFTokenAddress(flashFTokenContract.address),
    ).to.be.revertedWith("FTOKEN ADDRESS ALREADY SET");

    // Approve the Flash Strategy contract to spend fTokens from user wallet
    await flashFTokenContract.approve(
      this.flashStrategyAAVEv2Artifact.address,
      BigNumber.from(2).pow(BigNumber.from(256)).sub(BigNumber.from(1)),
    );
  });

  it("remainder subtract tests: 0-5=0, 5-5=0, 10-5=5", async function () {
    expect(await this.flashStrategyAAVEv2Artifact.remainderSubtract(0, 5)).to.be.eq(BigNumber.from(0));
    expect(await this.flashStrategyAAVEv2Artifact.remainderSubtract(5, 5)).to.be.eq(BigNumber.from(0));
    expect(await this.flashStrategyAAVEv2Artifact.remainderSubtract(10, 5)).to.be.eq(BigNumber.from(5));
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000,000 DAI to account 0", async function () {
    // Tell hardhat to impersonate
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(this.signers[0].address, BigNumber.from(1000000).mul(multiplier));

    startingDaiBalance = await daiContract.balanceOf(this.signers[0].address);
    expect(startingDaiBalance).gte(BigNumber.from(1000000).mul(multiplier)); // We only need 10,000 for tests
  });

  it("[account 1] should deposit 10,000 DAI principal", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Transfer 10,000 DAI to account 1 from account 0
    const _amount = BigNumber.from(10000).mul(multiplier);
    await daiContract.connect(this.signers[0]).transfer(this.signers[1].address, _amount);

    // Approve spending of x DAI from this account against the Strategy Contract
    await daiContract.connect(this.signers[0]).approve(this.flashStrategyAAVEv2Artifact.address, _amount);
    expect(await daiContract.allowance(this.signers.admin.address, this.flashStrategyAAVEv2Artifact.address)).eq(
      _amount,
    );

    await daiContract.connect(this.signers[0]).transfer(this.flashStrategyAAVEv2Artifact.address, _amount);
    expect(await daiContract.balanceOf(this.flashStrategyAAVEv2Artifact.address)).eq(_amount);

    // Deposit the x DAI in the Strategy Contract to AAVE
    await this.flashStrategyAAVEv2Artifact.connect(this.signers[1]).depositPrincipal(_amount);

    // Ensure the contract now reports there is 10,000 principal balance
    expect(await this.flashStrategyAAVEv2Artifact.getPrincipalBalance()).eq(_amount);
  });

  it("ensure yield increases after 100 blocks (AAVE)", async function () {
    const oldYieldTotal = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    await mineBlocks(hre.ethers.provider, 100);

    // Check how much yield has been generated
    const yieldGenerated = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    expect(yieldGenerated).to.be.gt(oldYieldTotal);
  });

  it("[account 0] should deposit 100 DAI as bootstrap balance", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract
      .connect(this.signers[0])
      .transfer(this.flashStrategyAAVEv2Artifact.address, BigNumber.from(100).mul(multiplier));
    expect(await daiContract.balanceOf(this.flashStrategyAAVEv2Artifact.address)).to.be.eq(
      BigNumber.from(100).mul(multiplier),
    );
  });

  it("should mint 10000.00000512 fERC20 (simulating 10k DAI for 365 days)", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    fTokenContract.mint(this.signers.admin.address, ethers.utils.parseUnits("10000.00000512", 18));
  });

  it("should ensure total yield is more than 100 DAI", async function () {
    const currentYieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();
    expect(currentYieldBalance).to.be.gt(BigNumber.from(100).mul(multiplier));
    console.log("\tCurrent Yield Balance is", ethers.utils.formatUnits(currentYieldBalance, 18));
  });

  it("(1) should burn half fDAI (~5000) for half of available yield paid from only bootstrap balance", async function () {
    // The amount we want to burn (fERC20)
    const burnAmount = ethers.utils.parseUnits("5000.00000256", 18);

    // Determine the current total yield balance
    const yieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    // Get a quote - how much yield token can we get
    const quotedAmount = this.flashStrategyAAVEv2Artifact.quoteBurnFToken(burnAmount);

    // Perform the burn
    const result = await this.flashStrategyAAVEv2Artifact.burnFToken(burnAmount, quotedAmount, this.signers[0].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    const yieldReturned = args["_yieldReturned"];

    console.log("\t(1) Total yield is currently", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t(1) Expected result", ethers.utils.formatUnits(yieldBalance.div(2), 18));
    console.log("\t(1) Actual result", ethers.utils.formatUnits(yieldReturned, 18));
    expect(yieldReturned).to.be.gte(yieldBalance.div(2));
  });

  it("(2) should burn remaining fDAI (~5000) for half of available yield paid from both bootstrap balance and strategy", async function () {
    // The amount we want to burn (fERC20)
    const burnAmount = ethers.utils.parseUnits("5000.00000256", 18);

    // Determine the current total yield balance
    const yieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    // Get a quote - how much yield token can we get
    const quotedAmount = this.flashStrategyAAVEv2Artifact.quoteBurnFToken(burnAmount);

    // Perform the burn
    const result = await this.flashStrategyAAVEv2Artifact.burnFToken(burnAmount, quotedAmount, this.signers[0].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    const yieldReturned = args["_yieldReturned"];

    console.log("\t(2) Total yield is currently", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t(2) Expected result", ethers.utils.formatUnits(yieldBalance.div(2), 18));
    console.log("\t(2) Actual result", ethers.utils.formatUnits(yieldReturned, 18));
    expect(yieldReturned).to.be.gte(yieldBalance.div(2));
  });

  it("should ensure total yield is 0 DAI", async function () {
    const currentYieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();
    console.log("\tCurrent Yield Balance is", ethers.utils.formatUnits(currentYieldBalance, 18));
    expect(currentYieldBalance).to.be.eq(0);
  });

  it("ensure yield increases after 100 blocks (AAVE)", async function () {
    const oldYieldTotal = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    await mineBlocks(hre.ethers.provider, 100);

    // Check how much yield has been generated
    const yieldGenerated = await this.flashStrategyAAVEv2Artifact.getYieldBalance();
    console.log("\tCurrent Yield Balance is", ethers.utils.formatUnits(yieldGenerated, 18));

    expect(yieldGenerated).to.be.gt(oldYieldTotal);
  });

  it("should mint 1 fERC20", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    fTokenContract.mint(this.signers.admin.address, ethers.utils.parseUnits("1", 18));
  });

  it("(3) should burn all fDAI for all of available yield paid from only strategy balance", async function () {
    // The amount we want to burn (fERC20)
    const burnAmount = ethers.utils.parseUnits("1", 18);

    // Determine the current total yield balance
    const yieldBalance = await this.flashStrategyAAVEv2Artifact.getYieldBalance();

    // Get a quote - how much yield token can we get
    const quotedAmount = this.flashStrategyAAVEv2Artifact.quoteBurnFToken(burnAmount);

    // Perform the burn
    const result = await this.flashStrategyAAVEv2Artifact.burnFToken(burnAmount, quotedAmount, this.signers[0].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    const yieldReturned = args["_yieldReturned"];

    console.log("\t(1) Total yield is currently", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t(1) Expected result", ethers.utils.formatUnits(yieldBalance, 18));
    console.log("\t(1) Actual result", ethers.utils.formatUnits(yieldReturned, 18));
    expect(yieldReturned).to.be.gte(yieldBalance);
  });

  it("should ensure principal balance is >= 10,000 aDAI", async function () {
    const currentPrincipalBalance = await this.flashStrategyAAVEv2Artifact.getPrincipalBalance();

    const aTokenContract = await hre.ethers.getContractAt("IERC20C", interestBearingTokenAddress);
    const currentATokenBalance = await aTokenContract.balanceOf(this.flashStrategyAAVEv2Artifact.address);

    expect(currentPrincipalBalance).to.be.gte(BigNumber.from(10000).mul(multiplier));
    expect(currentATokenBalance).to.be.eq(BigNumber.from(10000).mul(multiplier));
  });

  it("should ensure quote is not available when fERC20 token supply is 0", async function () {
    await expect(
      this.flashStrategyAAVEv2Artifact.quoteBurnFToken(BigNumber.from(1).mul(multiplier)),
    ).to.be.revertedWith("INSUFFICIENT fERC20 TOKEN SUPPLY");
  });
});

async function mineBlocks(provider: ethers.providers.JsonRpcProvider, blocks: number): Promise<void> {
  for (let i = 0; i <= blocks; i++) {
    await provider.send("evm_mine", []);
    //await provider.send("hardhat_mine", [blocks]);
  }
}
