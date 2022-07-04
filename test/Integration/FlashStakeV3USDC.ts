import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { FlashFTokenFactory, FlashNFT, FlashProtocol, FlashStrategyAAVEv2 } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
const { deployContract } = hre.waffle;

describe("Flashstake Tests (USDC)", function () {
  const principalMultiplier = BigNumber.from(10).pow(BigNumber.from(6));
  const fTokenMultiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let principalTokenAddress = "0xe22da380ee6B445bb8273C81944ADEB6E8450422";
  let interestBearingTokenAddress = "0xe12AFeC5aa12Cf614678f9bFeeB98cA9Bb95b5B0";
  let fTokenAddress: string;

  let protocolContract: FlashProtocol;
  let strategyContract: FlashStrategyAAVEv2;

  let signers: SignerWithAddress[];

  before(async function () {
    signers = await hre.ethers.getSigners();

    // 0. Deploy the FlashNFT
    const nftArtifact: Artifact = await hre.artifacts.readArtifact("FlashNFT");
    const nftContract = <FlashNFT>await deployContract(signers[0], nftArtifact);

    // 0.1. Deploy the Flash FToken Factory contract
    const fTokenFactoryArtifact: Artifact = await hre.artifacts.readArtifact("FlashFTokenFactory");
    const fTokenFactoryContract = <FlashFTokenFactory>await deployContract(signers[0], fTokenFactoryArtifact);

    // 1. Deploy the Flash Protocol contract
    const protocolArtifact: Artifact = await hre.artifacts.readArtifact("FlashProtocol");
    protocolContract = <FlashProtocol>(
      await deployContract(signers[0], protocolArtifact, [nftContract.address, fTokenFactoryContract.address])
    );
    var bytecode = protocolArtifact.bytecode;
    var deployed = protocolArtifact.deployedBytecode;
    var sizeOfB = bytecode.length / 2;
    var sizeOfD = deployed.length / 2;
    console.log("size of bytecode in bytes = ", sizeOfB);
    console.log("size of deployed in bytes = ", sizeOfD);
    console.log("initialisation and constructor code in bytes = ", sizeOfB - sizeOfD);
    await nftContract.transferOwnership(protocolContract.address);
    await fTokenFactoryContract.transferOwnership(protocolContract.address);

    // 2. Deploy the Flash AAVEv2 Strategy
    const lendingPoolAddress = "0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe";
    const flashProtocolAddress = protocolContract.address;

    const strategyArtifact: Artifact = await hre.artifacts.readArtifact("FlashStrategyAAVEv2");
    strategyContract = <FlashStrategyAAVEv2>(
      await deployContract(signers[0], strategyArtifact, [
        lendingPoolAddress,
        principalTokenAddress,
        interestBearingTokenAddress,
        flashProtocolAddress,
      ])
    );

    // 3. Register this strategy with the Flash Protocol
    // Note: This will also call the strategy and set the fTokenAdress
    const result = await protocolContract.registerStrategy(
      strategyContract.address,
      principalTokenAddress,
      "fUSDC",
      "fUSDC",
    );

    // Normally we'd set the fee here but since we test that further on, it's not needed.
    //

    // We must look at the event to determine the fTokenAddress
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "StrategyRegistered";
    }))[0]["args"];
    // @ts-ignore
    fTokenAddress = args["_fTokenAddress"];

    console.log("fTokenAddress is", fTokenAddress);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000,000 USDC to account 1", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[1].address, BigNumber.from(1000000).mul(principalMultiplier));

    const balance = await daiContract.balanceOf(signers[1].address);
    expect(balance).gte(BigNumber.from(1000000).mul(principalMultiplier));
  });

  it("should fail when staking for 59 seconds with error ISD", async function () {
    const _amount = BigNumber.from(1000).mul(principalMultiplier);
    const _duration = 59; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[1]).approve(protocolContract.address, _amount);

    await expect(
      protocolContract
        .connect(signers[1])
        .stake(strategyContract.address, _amount, _duration, signers[1].address, false),
    ).to.be.revertedWith("ISD");
  });

  it("should fail when staking for 720 days and 1 second with error ISD", async function () {
    const _amount = BigNumber.from(1000).mul(principalMultiplier);
    const _duration = 63072000 + 1;

    // Approve the contract for spending
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await principalTokenContract.connect(signers[1]).approve(protocolContract.address, _amount);

    await expect(
      protocolContract
        .connect(signers[1])
        .stake(strategyContract.address, _amount, _duration, signers[1].address, false),
    ).to.be.revertedWith("ISD");
  });

  it("should stake 1,000 USDC from account 1 for 365 days (do not issue NFT) and get back 1000.000000512 fUSDC ", async function () {
    const _amount = BigNumber.from(1000).mul(principalMultiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await principalTokenContract.connect(signers[1]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[1])
      .stake(strategyContract.address, _amount, _duration, signers[1].address, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const stakeId = args["_stakeId"];

    // Lookup fTokenMinted from the contract
    const stakeInfo = await protocolContract.getStakeInfo(stakeId, false);
    expect(stakeInfo.fTokensToUser).to.be.eq("1000000000512000000000");

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[1].address)).to.be.eq(stakeInfo.fTokensToUser);
    expect(stakeInfo.active).to.be.true;
  });

  it("(1) should unstake as account 1 after 365 days and get back 1,000 USDC", async function () {
    const stakeInfo = await protocolContract.getStakeInfo(1, false);

    // Increase the timestamp of the next block
    const newTs = stakeInfo.stakeStartTs.add(BigNumber.from(31536000));
    console.log("(1) setting next blocktimestamp to", newTs);

    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs.toNumber()]);
    await hre.network.provider.send("evm_mine");

    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    const oldBalance = await principalTokenContract.balanceOf(signers[1].address);
    const expectedBalance = oldBalance.add(BigNumber.from(1000).mul(principalMultiplier));

    await protocolContract.connect(signers[1]).unstake(1, false, 0);
    const newBalance = await principalTokenContract.balanceOf(signers[1].address);
    expect(newBalance).to.be.eq(expectedBalance);

    console.log("(1) oldBalance principal", oldBalance);
    console.log("(1) newBalance principal", newBalance);
  });

  it("(aa) should burn all fTokens for entire yield pot", async function () {
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);

    // Perform approval
    await fTokenContract.connect(signers[1]).approve(strategyContract.address, "1000000000512000000000");

    const oldPrincipalBalance = await principalTokenContract.balanceOf(signers[1].address);
    const fTokenBalance = await fTokenContract.balanceOf(signers[1].address);
    console.log("(aa) oldPrincipalBalance", oldPrincipalBalance);
    console.log("(aa) fTokenBalance", fTokenBalance);

    const totalYield = await strategyContract.getYieldBalance();
    console.log("(aa) totalYield", totalYield);

    // Perform the Burn
    await strategyContract.connect(signers[1]).burnFToken(fTokenBalance, "0", signers[1].address);

    const newPrincipalBalance = await principalTokenContract.balanceOf(signers[1].address);
    console.log("(aa) newPrincipalBalance", newPrincipalBalance);

    expect(await principalTokenContract.balanceOf(signers[1].address)).to.be.gte(oldPrincipalBalance.add(totalYield));
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 2,000 USDC to account 2", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    await principalTokenContract
      .connect(signer)
      .transfer(signers[2].address, BigNumber.from(2000).mul(principalMultiplier));

    const balance = await principalTokenContract.balanceOf(signers[2].address);
    expect(balance).gte(BigNumber.from(2000).mul(principalMultiplier));
  });

  it("should stake 2,000 USDC from account 2 for 365 days (issue NFT) and get 2000.000001024 fUSDC", async function () {
    const _amount = BigNumber.from(2000).mul(principalMultiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await principalTokenContract.connect(signers[2]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[2])
      .stake(strategyContract.address, _amount, _duration, signers[2].address, true);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "NFTIssued";
    }))[0]["args"];
    // @ts-ignore
    const stakeId = args["_stakeId"];
    // @ts-ignore
    const nftId = args["nftId"];
    console.log("stakeId", stakeId, "nftId", nftId);

    // Lets lookup using the nft too
    const stakeInfo = await protocolContract.getStakeInfo(nftId, true);

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[2].address)).to.be.eq(stakeInfo.fTokensToUser);
    expect(stakeInfo.fTokensToUser).to.be.eq("2000000001024000000000");
    expect(stakeInfo.active).to.be.true;
  });

  it("should transfer NFT 1 from account 2 to account 3", async function () {
    const nftAddress = await protocolContract.flashNFTAddress();
    const flashNFTContract = await hre.ethers.getContractAt("FlashNFT", nftAddress);

    expect(await flashNFTContract.ownerOf(1)).to.be.eq(signers[2].address);

    await flashNFTContract.connect(signers[2]).transferFrom(signers[2].address, signers[3].address, 1);

    expect(await flashNFTContract.ownerOf(1)).to.be.eq(signers[3].address);
  });

  it("should fail when account 2 attempts to unstake (without NFT) after 365 days with error NTR", async function () {
    const stakeInfo = await protocolContract.getStakeInfo(1, true);

    // Increase the timestamp of the next block
    const newTs = stakeInfo["stakeStartTs"].add(stakeInfo["stakeDuration"]).toNumber();
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs]);

    await expect(protocolContract.connect(signers[2]).unstake(2, false, 0)).to.be.revertedWith("NTR");
  });

  it("should unstake with NFT as account 3 and receive initial principal", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    const oldBalance = await principalTokenContract.balanceOf(signers[3].address);
    const expectedBalance = oldBalance.add(BigNumber.from(2000).mul(principalMultiplier));

    // Here we are specifying the NFT ID and not the Stake ID (hence 1)
    await protocolContract.connect(signers[3]).unstake(1, true, 0);
    const newBalance = await principalTokenContract.balanceOf(signers[3].address);
    expect(newBalance).to.be.eq(expectedBalance);

    // Ensure the NFT is not burned
    const nftAddress = await protocolContract.flashNFTAddress();
    const nftContract = await hre.ethers.getContractAt("FlashNFT", nftAddress);
    expect(await nftContract.ownerOf(1)).to.be.eq(signers[3].address);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 2,000 DAI to account 3", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await principalTokenContract
      .connect(signer)
      .transfer(signers[3].address, BigNumber.from(2000).mul(principalMultiplier));

    const balance = await principalTokenContract.balanceOf(signers[3].address);
    expect(balance).gte(BigNumber.from(2000).mul(principalMultiplier));
  });

  it("(1) should stake 1,000 USDC from account 3 (do not issue NFT) and get back 1000.000000512 fERC20", async function () {
    const _amount = BigNumber.from(1000).mul(principalMultiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await principalTokenContract.connect(signers[3]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[3])
      .stake(strategyContract.address, _amount, _duration, signers[3].address, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const stakeInfo = await protocolContract.getStakeInfo(args["_stakeId"], false);

    console.log("(1) input tokens =", _amount.toString());
    // @ts-ignore
    console.log("(1) stake id =", args["_stakeId"].toString());
    // @ts-ignore
    console.log("(1) fTokensToUser =", stakeInfo.fTokensToUser.toString());

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[3].address)).to.be.eq(stakeInfo.fTokensToUser);
    expect(await fTokenContract.balanceOf(signers[3].address)).to.be.eq(ethers.utils.parseUnits("1000.000000512", 18));
    expect(stakeInfo.active).to.be.true;
  });

  it("account 3 should approve protocol to spend fTokens", async function () {
    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract
      .connect(signers[3])
      .approve(protocolContract.address, BigNumber.from(1000000).mul(fTokenMultiplier));
  });

  it("(2) set next block timestamp to 25% into stake", async function () {
    // Get the information about the stake
    const stakeInfo = await protocolContract.getStakeInfo(3, false);
    console.log("(2) stake info: stakeStartTs:", stakeInfo["stakeStartTs"].toString());
    console.log("(2) stake info: stakeDuration:", stakeInfo["stakeDuration"].toString());

    const newTs = stakeInfo["stakeStartTs"].add(stakeInfo["stakeDuration"].div(BigNumber.from(4)));
    console.log("(2) setting next block timestamp to", newTs.toString());

    // Set the next block timestamp
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs.toNumber()]);
  });

  it("should unstake early from account 3 (not using NFT), burn 750.000000384 fTokens and get back 1000 USDC", async function () {
    // Perform the early unstake
    const result = await protocolContract.connect(signers[3]).unstake(3, false, "750000000384000000000");

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Unstaked";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_tokensReturned"]).to.be.eq(BigNumber.from(1000).mul(principalMultiplier));
    // @ts-ignore
    expect(args["_fTokensBurned"]).to.be.eq("750000000384000000000");
  });

  it("should set fee: 20% to 0x5089722613C2cCEe071C39C59e9889641f435F15", async function () {
    await protocolContract.connect(signers[0]).setMintFeeInfo("0x5089722613C2cCEe071C39C59e9889641f435F15", 2000);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000 DAI to account 4", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await principalTokenContract
      .connect(signer)
      .transfer(signers[4].address, BigNumber.from(1000).mul(principalMultiplier));

    const balance = await principalTokenContract.balanceOf(signers[4].address);
    expect(balance).gte(BigNumber.from(1000).mul(principalMultiplier));
  });

  it("should stake 1,000 DAI from account 4 (do not issue NFT) and get back 800.0000004096 fUSDC", async function () {
    const _amount = BigNumber.from(1000).mul(principalMultiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await principalTokenContract.connect(signers[4]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[4])
      .stake(strategyContract.address, _amount, _duration, signers[4].address, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const stakeInfo = await protocolContract.getStakeInfo(args["_stakeId"], false);

    expect(stakeInfo.fTokensToUser).to.be.eq("800000000409600000000");
  });

  it("should verify total fTokens minted is 1000.000000512, of which 800.0000004096 went to the user and 200.0000001024 to the feeRecipient", async function () {
    const stakeInfo = await protocolContract.getStakeInfo(4, false);
    const fTokenToUser = stakeInfo.fTokensToUser;
    const fTokenFee = stakeInfo.fTokensFee;
    const totalFTokensMinted = fTokenToUser.add(fTokenFee);

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);

    // First ensure the total is 1000.000000512000000000
    expect("1000000000512000000000").to.be.eq(totalFTokensMinted);

    // Ensure the fee is as expected
    expect("200000000102400000000").to.be.eq(fTokenFee);
    expect(await fTokenContract.balanceOf("0x5089722613C2cCEe071C39C59e9889641f435F15")).to.be.eq(fTokenFee);

    // Ensure the user got as expected
    expect("800000000409600000000").to.be.eq(fTokenToUser);
    expect(await fTokenContract.balanceOf(signers[4].address)).to.be.eq(fTokenToUser);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 10,000 USDC to account 5", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    await principalTokenContract
      .connect(signer)
      .transfer(signers[5].address, BigNumber.from(10000).mul(principalMultiplier));

    const balance = await principalTokenContract.balanceOf(signers[5].address);
    expect(balance).gte(BigNumber.from(10000).mul(principalMultiplier));
  });

  it("(1) should stake 10,000 USDC from account 5 for 365 days (do not issue NFT) and get back 8000.000004096 (due to fee)", async function () {
    const _amount = BigNumber.from(10000).mul(principalMultiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await principalTokenContract.connect(signers[5]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[5])
      .stake(strategyContract.address, _amount, _duration, signers[5].address, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const stakeInfo = await protocolContract.getStakeInfo(args["_stakeId"], false);
    // @ts-ignore
    console.log("(1) stake id:", args["_stakeId"].toString());
    // @ts-ignore
    console.log("(1) fTokensToUser", stakeInfo.fTokensToUser.toString());
    // @ts-ignore
    console.log("(1) fTokensFee:", stakeInfo.fTokensFee.toString());

    expect(stakeInfo.fTokensToUser).to.be.eq("8000000004096000000000");
  });

  it("(2) should issue nft for stake id 5 as account 5", async function () {
    const result = await protocolContract.connect(signers[5]).issueNFT(5);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "NFTIssued";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_stakeId"]).to.be.eq(5);

    // @ts-ignore
    console.log("(2) nft id", args["nftId"].toString());

    // Ensure this NFT is in the users wallet
    const nftContract = await hre.ethers.getContractAt("FlashNFT", await protocolContract.flashNFTAddress());
    expect(await nftContract.ownerOf(2)).to.be.eq(signers[5].address);
  });

  it("account 5 should approve protocol to spend fTokens", async function () {
    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract
      .connect(signers[5])
      .approve(protocolContract.address, BigNumber.from(1000000).mul(fTokenMultiplier));
  });

  it("(2) set next block timestamp to 50% into stake", async function () {
    // Get the information about the stake
    const stakeInfo = await protocolContract.getStakeInfo(2, true);
    console.log("(2) stake info: stakeStartTs:", stakeInfo["stakeStartTs"].toString());
    console.log("(2) stake info: stakeDuration:", stakeInfo["stakeDuration"].toString());

    const newTs = stakeInfo["stakeStartTs"].add(stakeInfo["stakeDuration"].div(BigNumber.from(2)));
    console.log("(2) setting next block timestamp to", newTs.toString());

    // Set the next block timestamp
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs.toNumber()]);
  });

  it("should unstake early from account 5 (using NFT), burn 5000 fTokens and get back 4999.999997", async function () {
    // Perform the early unstake
    const result = await protocolContract.connect(signers[5]).unstake(2, true, "5000000000000000000000");

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Unstaked";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_fTokensBurned"]).to.be.eq("5000000000000000000000");
    // @ts-ignore
    expect(args["_tokensReturned"]).to.be.eq("4999999997");
  });
});
