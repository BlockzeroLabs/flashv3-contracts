import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { FlashNFT, FlashStakeV3, FlashStrategyAAVEv2 } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt } from "ethers";
const { deployContract } = hre.waffle;

describe("Flashstake Tests", function () {
  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let principalTokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD";
  let interestBearingTokenAddress = "0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8";
  let fTokenAddress: string;

  let protocolContract: FlashStakeV3;
  let strategyContract: FlashStrategyAAVEv2;

  let signers: SignerWithAddress[];

  before(async function () {
    signers = await hre.ethers.getSigners();

    // 0. Deploy the FlashNFT
    const nftArtifact: Artifact = await hre.artifacts.readArtifact("FlashNFT");
    const nftContract = <FlashNFT>await deployContract(signers[0], nftArtifact);

    // 1. Deploy the Flash Protocol contract
    const protocolArtifact: Artifact = await hre.artifacts.readArtifact("FlashStakeV3");
    protocolContract = <FlashStakeV3>await deployContract(signers[0], protocolArtifact, [nftContract.address]);
    await nftContract.transferOwnership(protocolContract.address);

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
    await protocolContract.registerStrategy(strategyContract.address, principalTokenAddress, "fDAI", "fDAI");

    // Normally we'd set the fee here but since we test that further on, it's not needed.

    fTokenAddress = await strategyContract.getFTokenAddress();
  });

  it("should ensure protocol throws error UNREGISTERED STRATEGY when getting fToken address for invalid strategy", async function () {
    await expect(protocolContract.getFTokenAddress(signers[0].address)).to.be.revertedWith("UNREGISTERED STRATEGY");
  });

  it("should ensure protocol reports correct fToken address for newly registered strategy", async function () {
    await expect(await protocolContract.getFTokenAddress(strategyContract.address)).to.be.eq(fTokenAddress);
  });

  it("should fail when trying to register the same strategy again with error STRATEGY ALREADY REGISTERED", async function () {
    await expect(
      protocolContract.registerStrategy(strategyContract.address, principalTokenAddress, "fDAI", "fDAI"),
    ).to.be.revertedWith("STRATEGY ALREADY REGISTERED");
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000,000 DAI to account 1", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    daiContract.connect(signer).transfer(signers[1].address, BigNumber.from(1000000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[1].address);
    expect(balance).gte(BigNumber.from(1000000).mul(multiplier));
  });

  it("should deposit 1,000 DAI as bootstrap from account 1", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[1]).transfer(strategyContract.address, BigNumber.from(1000).mul(multiplier));
    expect(await daiContract.balanceOf(strategyContract.address)).to.be.eq(BigNumber.from(1000).mul(multiplier));
  });

  it("should fail staking 1,000 DAI from account 1 into unregistered strategy with error UNREGISTERED STRATEGY", async function () {
    // We are specifying a strategy address which is unregistered (protocolContract.address)
    await expect(protocolContract.connect(signers[1]).stake(protocolContract.address, 1, 1, false)).to.be.revertedWith(
      "UNREGISTERED STRATEGY",
    );
  });

  it("should fail when staking for 59 seconds with error MINIMUM STAKE DURATION IS 60 SECONDS", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 59; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[1]).approve(protocolContract.address, _amount);

    await expect(
      protocolContract.connect(signers[1]).stake(strategyContract.address, _amount, _duration, false),
    ).to.be.revertedWith("MINIMUM STAKE DURATION IS 60 SECONDS");
  });

  it("should fail when staking for 720 days and 1 second with error EXCEEDS MAX STAKE DURATION", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 63072000 + 1;

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[1]).approve(protocolContract.address, _amount);

    await expect(
      protocolContract.connect(signers[1]).stake(strategyContract.address, _amount, _duration, false),
    ).to.be.revertedWith("EXCEEDS MAX STAKE DURATION");
  });

  it("should stake 1,000 DAI from account 1 (do not issue NFT)", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[1]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[1])
      .stake(strategyContract.address, _amount, _duration, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const fTokenMinted = args["_fTokenMinted"];

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[1].address)).to.be.eq(fTokenMinted);
  });

  it("should fail when unstaking as account 1 with error STAKE NOT EXPIRED", async function () {
    await expect(protocolContract.connect(signers[1]).unstake(1, false)).to.be.revertedWith("STAKE NOT EXPIRED");
  });

  it("should fail when unstaking as account 2 with error NOT OWNER OF STAKE", async function () {
    await expect(protocolContract.connect(signers[2]).unstake(1, false)).to.be.revertedWith("NOT OWNER OF STAKE");
  });

  it("should unstake as account 1 after 365 days", async function () {
    // Increase the timestamp of the next block
    const newTs = new Date().getTime() / 1000 + 31536000; // Get the current Ts and add 355 days
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs]);
    await hre.network.provider.send("evm_mine");

    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    const oldBalance = await daiContract.balanceOf(signers[1].address);
    const expectedBalance = oldBalance.add(BigNumber.from(1000).mul(multiplier));

    await protocolContract.connect(signers[1]).unstake(1, false);
    const newBalance = await daiContract.balanceOf(signers[1].address);
    expect(newBalance).to.be.eq(expectedBalance);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 2,000 DAI to account 2", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    daiContract.connect(signer).transfer(signers[2].address, BigNumber.from(2000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[2].address);
    expect(balance).gte(BigNumber.from(2000).mul(multiplier));
  });

  it("should stake 2,000 DAI from account 2 (issue NFT)", async function () {
    const _amount = BigNumber.from(2000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[2]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract.connect(signers[2]).stake(strategyContract.address, _amount, _duration, true);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const fTokenMinted = args["_fTokenMinted"];

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[2].address)).to.be.eq(fTokenMinted);
    expect(fTokenMinted).to.be.eq("2000000001024000000000");
  });

  it("should fail when attempting to create NFT for stake that already have an NFT associated", async function () {
    await expect(protocolContract.issueNFT(2)).to.be.revertedWith("NFT FOR STAKE ALREADY EXISTS");
  });

  it("should transfer NFT 1 from account 2 to account 3", async function () {
    const nftAddress = await protocolContract.getFlashNFTAddress();
    const flashNFTContract = await hre.ethers.getContractAt("FlashNFT", nftAddress);

    expect(await flashNFTContract.ownerOf(1)).to.be.eq(signers[2].address);

    await flashNFTContract.connect(signers[2]).transferFrom(signers[2].address, signers[3].address, 1);

    expect(await flashNFTContract.ownerOf(1)).to.be.eq(signers[3].address);
  });

  it("should fail when account 2 attempts to unstake (without NFT) after 365 days with error NFT TOKEN REQUIRED", async function () {
    // Increase the timestamp of the next block
    const newTs = new Date().getTime() / 1000 + 31536000 * 4;
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs]);
    await hre.network.provider.send("evm_mine");

    await expect(protocolContract.connect(signers[2]).unstake(2, false)).to.be.revertedWith("NFT TOKEN REQUIRED");
  });

  it("should fail when account 2 attempts to unstake with invalid nft ID with error NFT FOR STAKE NON-EXISTENT", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[2]).unstake(100, true)).to.be.revertedWith(
      "NFT FOR STAKE NON-EXISTENT",
    );
  });

  it("should fail when account 6 attempts to unstake with NFT ID they do not own", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[6]).unstake(100, true)).to.be.revertedWith(
      "NFT FOR STAKE NON-EXISTENT",
    );
  });

  it("should fail when account 6 attempts to unstake NFT they do not own with error NOT OWNER OF NFT", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[6]).unstake(1, true)).to.be.revertedWith("NOT OWNER OF NFT");
  });

  it("should unstake with NFT as account 3 and receive initial principal", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    const oldBalance = await daiContract.balanceOf(signers[3].address);
    const expectedBalance = oldBalance.add(BigNumber.from(2000).mul(multiplier));

    // Here we are specifying the NFT ID and not the Stake ID (hence 1)
    await protocolContract.connect(signers[3]).unstake(1, true);
    const newBalance = await daiContract.balanceOf(signers[3].address);
    expect(newBalance).to.be.eq(expectedBalance);
  });

  it("should fail when attempting to create NFT for invalid stake", async function () {
    await expect(protocolContract.issueNFT(0)).to.be.revertedWith("STAKE NON-EXISTENT");
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 2,000 DAI to account 3", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    daiContract.connect(signer).transfer(signers[3].address, BigNumber.from(2000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[3].address);
    expect(balance).gte(BigNumber.from(2000).mul(multiplier));
  });

  it("(1) should stake 1,000 DAI from account 3 (do not issue NFT)", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[3]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[3])
      .stake(strategyContract.address, _amount, _duration, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const fTokenMinted = args["_fTokenMinted"];

    console.log("(1) input tokens =", _amount.toString());
    // @ts-ignore
    console.log("(1) stake id =", args["_stakeId"].toString());
    // @ts-ignore
    console.log("(1) _fTokenMinted =", args["_fTokenMinted"].toString());

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[3].address)).to.be.eq(fTokenMinted);
  });

  it("(2) set next block timestamp to 25% into stake", async function () {
    // Get the information about the stake
    const stakeInfo = await protocolContract.getStakeInfo(3, false);
    console.log("(2) stake info: stakeStartTs:", stakeInfo["stakeStartTs"].toString());
    console.log("(2) stake info: stakeDuration:", stakeInfo["stakeDuration"].toString());

    const newTs = stakeInfo["stakeStartTs"].add(stakeInfo["stakeDuration"].div(BigNumber.from(4))).sub(1);
    console.log("(2) setting next block timestamp to", newTs.toString());

    // Set the next block timestamp
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs.toNumber()]);
  });

  it("should unstake early from account 3 (not using NFT) and burn 750.000000384000000000 fTokens", async function () {
    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[3]).approve(protocolContract.address, BigNumber.from(1000000).mul(multiplier));

    // Perform the early unstake
    const result = await protocolContract.connect(signers[3]).unstakeEarly(3, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Unstaked";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_tokensReturned"]).to.be.eq(BigNumber.from(1000).mul(multiplier));
    // @ts-ignore
    expect(args["_fTokensBurned"]).to.be.eq("750000000384000000000");
  });

  it("should fail when setting fToken fee as non-owner with error Ownable: caller is not the owner", async function () {
    await expect(
      protocolContract.connect(signers[5]).setMintFees("0x5089722613C2cCEe071C39C59e9889641f435F15", 20000),
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should fail when setting fee to 20.01% with error MINT FEE TOO HIGH", async function () {
    await expect(
      protocolContract.connect(signers[0]).setMintFees("0x5089722613C2cCEe071C39C59e9889641f435F15", 2001),
    ).to.be.revertedWith("MINT FEE TOO HIGH");
  });

  it("should set fee: 20% to 0x5089722613C2cCEe071C39C59e9889641f435F15", async function () {
    await protocolContract.connect(signers[0]).setMintFees("0x5089722613C2cCEe071C39C59e9889641f435F15", 2000);
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000 DAI to account 4", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    daiContract.connect(signer).transfer(signers[4].address, BigNumber.from(1000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[4].address);
    expect(balance).gte(BigNumber.from(1000).mul(multiplier));
  });

  it("should stake 1,000 DAI from account 4 (do not issue NFT) and get back 800.0000004096", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[4]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[4])
      .stake(strategyContract.address, _amount, _duration, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const fTokenMinted = args["_fTokenMinted"];

    expect(fTokenMinted).to.be.eq("800000000409600000000");
  });

  it("should verify total fTokens minted is 1000.000000512000000000, of which 800.0000004096 went to the user and 200.0000001024 to the feeRecipient", async function () {
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

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 10,000 DAI to account 5", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    daiContract.connect(signer).transfer(signers[5].address, BigNumber.from(10000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[5].address);
    expect(balance).gte(BigNumber.from(10000).mul(multiplier));
  });

  it("(1) should stake 10,000 DAI from account 5 for 365 days (do not issue NFT) and get back 8000.000004096 (due to fee)", async function () {
    const _amount = BigNumber.from(10000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[5]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[5])
      .stake(strategyContract.address, _amount, _duration, false);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Staked";
    }))[0]["args"];
    // @ts-ignore
    const fTokenMinted = args["_fTokenMinted"];
    // @ts-ignore
    console.log("(1) stake id:", args["_stakeId"].toString());
    // @ts-ignore
    console.log("(1) _fTokenMinted", args["_fTokenMinted"].toString());
    // @ts-ignore
    console.log("(1) _fTokenFee:", args["_fTokenFee"].toString());

    expect(fTokenMinted).to.be.eq("8000000004096000000000");
  });

  it("should fail when unstaking as account 2 with error NOT OWNER OF STAKE", async function () {
    await expect(protocolContract.connect(signers[2]).unstakeEarly(5, false)).to.be.revertedWith("NOT OWNER OF STAKE");
  });

  it("should fail when issuing nft as account 2 with error NOT OWNER OF STAKE", async function () {
    await expect(protocolContract.connect(signers[2]).issueNFT(5)).to.be.revertedWith("NOT OWNER OF STAKE");
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
    const nftContract = await hre.ethers.getContractAt("FlashNFT", await protocolContract.getFlashNFTAddress());
    expect(await nftContract.ownerOf(2)).to.be.eq(signers[5].address);
  });

  it("should fail when account 2 attempts to unstakeEarly with invalid nft ID with error NFT FOR STAKE NON-EXISTENT", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[2]).unstakeEarly(100, true)).to.be.revertedWith(
      "NFT FOR STAKE NON-EXISTENT",
    );
  });

  it("should fail when account 2 attempts to unstake NFT they do not own with error NOT OWNER OF NFT", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[2]).unstakeEarly(2, true)).to.be.revertedWith("NOT OWNER OF NFT");
  });

  it("should fail when account 2 attempts to unstakeEarly (without NFT) with error NFT TOKEN REQUIRED", async function () {
    await expect(protocolContract.connect(signers[2]).unstakeEarly(2, false)).to.be.revertedWith("NFT TOKEN REQUIRED");
  });

  it("should fail unstaking early with nft with error MINIMUM STAKE DURATION IS 60 SECONDS", async function () {
    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[5]).approve(protocolContract.address, BigNumber.from(1000000).mul(multiplier));

    // Perform the early unstake
    await expect(protocolContract.connect(signers[5]).unstakeEarly(2, true)).to.be.revertedWith(
      "MINIMUM STAKE DURATION IS 60 SECONDS",
    );
  });

  it("(2) set next block timestamp to 50% into stake", async function () {
    // Get the information about the stake
    const stakeInfo = await protocolContract.getStakeInfo(2, true);
    console.log("(2) stake info: stakeStartTs:", stakeInfo["stakeStartTs"].toString());
    console.log("(2) stake info: stakeDuration:", stakeInfo["stakeDuration"].toString());

    const newTs = stakeInfo["stakeStartTs"].add(stakeInfo["stakeDuration"].div(BigNumber.from(2))).sub(1);
    console.log("(2) setting next block timestamp to", newTs.toString());

    // Set the next block timestamp
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs.toNumber()]);
  });

  it("should unstake early from account 5 (using NFT) and burn 4000.000002048 fTokens", async function () {
    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[5]).approve(protocolContract.address, BigNumber.from(1000000).mul(multiplier));

    // Perform the early unstake
    const result = await protocolContract.connect(signers[5]).unstakeEarly(2, true);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Unstaked";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_tokensReturned"]).to.be.eq(BigNumber.from(10000).mul(multiplier));
    // @ts-ignore
    expect(args["_fTokensBurned"]).to.be.eq("4000000002048000000000");
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000 DAI to account 6", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    daiContract.connect(signer).transfer(signers[6].address, BigNumber.from(1000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[6].address);
    expect(balance).gte(BigNumber.from(1000).mul(multiplier));
  });

  it("account 6 should flashstake 1000 DAI and wallet DAI balance is > 0", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 63072000;

    // Expect the balance to be initially 1000
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    expect(await daiContract.balanceOf(signers[6].address)).to.be.eq(_amount);

    // Perform approvals
    await daiContract.connect(signers[6]).approve(protocolContract.address, _amount);

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[6]).approve(protocolContract.address, BigNumber.from(1000000).mul(multiplier));

    const result = await protocolContract
      .connect(signers[6])
      .flashStake(strategyContract.address, _amount, _duration, false);
    expect(await daiContract.balanceOf(signers[6].address)).to.be.gt(0);

    // Since the initial 1000 DAI was staked, it is no longer in the wallet. Once burning the fDAI, we expect there to
    // be some DAI in the wallet again (the yield they generated during the flashstake)
  });
});
