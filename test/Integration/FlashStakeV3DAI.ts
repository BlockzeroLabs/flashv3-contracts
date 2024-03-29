import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  FlashFTokenFactory,
  FlashNFT,
  FlashProtocol,
  FlashStrategyAAVEv2,
  FlashToken,
  UserIncentive,
} from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
const { deployContract } = hre.waffle;

describe("Flashstake Tests (DAI)", function () {
  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let principalTokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD";
  let interestBearingTokenAddress = "0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8";
  let fTokenAddress: string;

  let protocolContract: FlashProtocol;
  let strategyContract: FlashStrategyAAVEv2;
  let flashTokenContract: FlashToken;

  let userIncentiveContract: UserIncentive;

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
      "fDAI",
      "fDAI",
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

  it("account 0 should deploy Flash Token contract", async function () {
    const tokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    flashTokenContract = <FlashToken>await deployContract(signers[0], tokenArtifact);
  });

  it("should deploy rewards contract and inform strategy", async function () {
    const uiArtifact: Artifact = await hre.artifacts.readArtifact("UserIncentive");
    userIncentiveContract = <UserIncentive>await deployContract(signers[0], uiArtifact, [strategyContract.address]);

    await strategyContract.setUserIncentiveAddress(userIncentiveContract.address);
  });

  it("should fail when trying to register the same strategy again with error", async function () {
    await expect(protocolContract.registerStrategy(strategyContract.address, principalTokenAddress, "fDAI", "fDAI")).to
      .be.reverted;
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000,000 DAI to account 1", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[1].address, BigNumber.from(1000000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[1].address);
    expect(balance).gte(BigNumber.from(1000000).mul(multiplier));
  });

  it("should deposit 1,000 DAI as bootstrap from account 1", async function () {
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[1]).transfer(strategyContract.address, BigNumber.from(1000).mul(multiplier));
    expect(await daiContract.balanceOf(strategyContract.address)).to.be.eq(BigNumber.from(1000).mul(multiplier));
  });

  it("should fail staking 1,000 DAI from account 1 into unregistered strategy with error", async function () {
    // We are specifying a strategy address which is unregistered (protocolContract.address)
    await expect(protocolContract.connect(signers[1]).stake(protocolContract.address, 1, 1, signers[1].address, false))
      .to.be.reverted;
  });

  it("should fail when staking for 59 seconds with error ISD", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
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
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 63072000 + 1;

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[1]).approve(protocolContract.address, _amount);

    await expect(
      protocolContract
        .connect(signers[1])
        .stake(strategyContract.address, _amount, _duration, signers[1].address, false),
    ).to.be.revertedWith("ISD");
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

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[1].address)).to.be.eq(stakeInfo.fTokensToUser);
    expect(stakeInfo.active).to.be.true;
  });

  it("should fail when unstaking as account 2 with error NSO", async function () {
    await expect(protocolContract.connect(signers[2]).unstake(1, false, 0)).to.be.revertedWith("NSO");
  });

  it("(1) should unstake as account 1 after 365 days", async function () {
    const stakeInfo = await protocolContract.getStakeInfo(1, false);

    // Increase the timestamp of the next block
    const newTs = stakeInfo.stakeStartTs.add(BigNumber.from(31536000));
    console.log("(1) setting next blocktimestamp to", newTs);

    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs.toNumber()]);
    await hre.network.provider.send("evm_mine");

    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    const oldBalance = await daiContract.balanceOf(signers[1].address);
    const expectedBalance = oldBalance.add(BigNumber.from(1000).mul(multiplier));

    await protocolContract.connect(signers[1]).unstake(1, false, 0);
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
    await daiContract.connect(signer).transfer(signers[2].address, BigNumber.from(2000).mul(multiplier));

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

  it("should fail when attempting to create NFT for stake that already have an NFT associated", async function () {
    await expect(protocolContract.issueNFT(2)).to.be.reverted;
  });

  it("should transfer NFT 1 from account 2 to account 3", async function () {
    const nftAddress = await protocolContract.flashNFTAddress();
    const flashNFTContract = await hre.ethers.getContractAt("FlashNFT", nftAddress);

    expect(await flashNFTContract.ownerOf(1)).to.be.eq(signers[2].address);

    await flashNFTContract.connect(signers[2]).transferFrom(signers[2].address, signers[3].address, 1);

    expect(await flashNFTContract.ownerOf(1)).to.be.eq(signers[3].address);
  });

  it("should fail when account 2 attempts to unstake (without NFT) after 365 days with error NTR", async function () {
    // Increase the timestamp of the next block
    const newTs = new Date().getTime() / 1000 + 31536000 * 4;
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs]);
    await hre.network.provider.send("evm_mine");

    await expect(protocolContract.connect(signers[2]).unstake(2, false, 0)).to.be.revertedWith("NTR");
  });

  it("should fail when account 2 attempts to unstake with invalid nft ID with error SNM", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[2]).unstake(100, true, 0)).to.be.revertedWith("SNM");
  });

  it("should fail when account 6 attempts to unstake with NFT ID they do not own", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[6]).unstake(100, true, 0)).to.be.revertedWith("SNM");
  });

  it("should fail when account 6 attempts to unstake NFT they do not own with error NNO", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[6]).unstake(1, true, 0)).to.be.revertedWith("NNO");
  });

  it("increase block timestamp", async function () {
    const stakeInfo = await protocolContract.getStakeInfo(1, true);

    // Increase the timestamp of the next block
    const newTs = stakeInfo["stakeStartTs"].add(stakeInfo["stakeDuration"]).toNumber();
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTs]);
  });

  it("should unstake with NFT as account 3 and receive initial principal", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    const oldBalance = await daiContract.balanceOf(signers[3].address);
    const expectedBalance = oldBalance.add(BigNumber.from(2000).mul(multiplier));

    // Here we are specifying the NFT ID and not the Stake ID (hence 1)
    await protocolContract.connect(signers[3]).unstake(1, true, 0);
    const newBalance = await daiContract.balanceOf(signers[3].address);
    expect(newBalance).to.be.eq(expectedBalance);

    // Ensure the NFT is not burned
    const nftAddress = await protocolContract.flashNFTAddress();
    const nftContract = await hre.ethers.getContractAt("FlashNFT", nftAddress);
    expect(await nftContract.ownerOf(1)).to.be.eq(signers[3].address);
  });

  it("should fail when attempting to unstake using same NFT", async function () {
    await expect(protocolContract.connect(signers[3]).unstake(1, true, 0)).to.be.revertedWith("SNM");

    // The above would report as SNM (stake-nft-missing) since the stake has ended
    // and the stake information has been deleted. Therefore the user is trying
    // to unstake stakeId 0 to which the user does not have the corresponding NFT
    // side note: stakeId 0 is impossible since stakes start at 1
  });

  it("should fail when attempting to create NFT for invalid stake", async function () {
    await expect(protocolContract.issueNFT(0)).to.be.reverted;
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 2,000 DAI to account 3", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[3].address, BigNumber.from(2000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[3].address);
    expect(balance).gte(BigNumber.from(2000).mul(multiplier));
  });

  it("(1) should stake 1,000 DAI from account 3 (do not issue NFT) and get back 1000.000000512 fERC20", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[3]).approve(protocolContract.address, _amount);

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
    await fTokenContract.connect(signers[3]).approve(protocolContract.address, BigNumber.from(1000000).mul(multiplier));
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

  it("should unstake early from account 3 (not using NFT) and burn 750.000000384000000000 fTokens", async function () {
    // Perform the early unstake
    const result = await protocolContract.connect(signers[3]).unstake(3, false, "750000000384000000000");

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
      protocolContract.connect(signers[5]).setMintFeeInfo("0x5089722613C2cCEe071C39C59e9889641f435F15", 20000),
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should fail when setting fee to 20.01% with error MINT FEE TOO HIGH", async function () {
    await expect(
      protocolContract.connect(signers[0]).setMintFeeInfo("0x5089722613C2cCEe071C39C59e9889641f435F15", 2001),
    ).to.be.reverted;
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
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[4].address, BigNumber.from(1000).mul(multiplier));

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
    await daiContract.connect(signer).transfer(signers[5].address, BigNumber.from(10000).mul(multiplier));

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

  it("should fail when unstaking as account 2 with error NSO", async function () {
    await expect(protocolContract.connect(signers[2]).unstake(5, false, 0)).to.be.revertedWith("NSO");
  });

  it("should fail when issuing nft as account 2 with error", async function () {
    await expect(protocolContract.connect(signers[2]).issueNFT(5)).to.be.reverted;
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

  it("should fail when account 2 attempts to unstakeEarly with invalid nft ID with error SNM", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[2]).unstake(100, true, 0)).to.be.revertedWith("SNM");
  });

  it("should fail when account 2 attempts to unstake NFT they do not own with error NNO", async function () {
    // We don't need to increase the EVM ts because we did that in the last test

    await expect(protocolContract.connect(signers[2]).unstake(2, true, 0)).to.be.revertedWith("NNO");
  });

  it("should fail when account 2 attempts to unstakeEarly (without NFT) with error NTR", async function () {
    await expect(protocolContract.connect(signers[2]).unstake(5, false, 0)).to.be.revertedWith("NTR");
  });

  it("should fail unstaking early with nft with error MIN DUR 1HR", async function () {
    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[5]).approve(protocolContract.address, BigNumber.from(1000000).mul(multiplier));

    // Perform the early unstake
    await expect(protocolContract.connect(signers[5]).unstake(2, true, 0)).to.be.revertedWith("MIN DUR 1HR");
  });

  it("account 5 should approve protocol to spend fTokens", async function () {
    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[5]).approve(protocolContract.address, BigNumber.from(1000000).mul(multiplier));
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

  it("should unstake early from account 5 (using NFT) and burn 5000.00000256 fTokens", async function () {
    // Perform the early unstake
    const result = await protocolContract.connect(signers[5]).unstake(2, true, "5000000002560000000000");

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Unstaked";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_tokensReturned"]).to.be.eq(BigNumber.from(10000).mul(multiplier));
    // @ts-ignore
    expect(args["_fTokensBurned"]).to.be.eq("5000000002560000000000");
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000 DAI to account 6", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[6].address, BigNumber.from(1000).mul(multiplier));

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

    await protocolContract
      .connect(signers[6])
      .flashStake(strategyContract.address, _amount, _duration, 0, signers[6].address, false);
    expect(await daiContract.balanceOf(signers[6].address)).to.be.gt(0);

    // Since the initial 1000 DAI was staked, it is no longer in the wallet. Once burning the fDAI, we expect there to
    // be some DAI in the wallet again (the yield they generated during the flashstake)
  });

  it("account 0 should approve spending of 150,000 Flash tokens against Rewards contract", async function () {
    const _amount = BigNumber.from(150000).mul(multiplier);
    await flashTokenContract.connect(signers[0]).approve(userIncentiveContract.address, _amount);
  });

  it("non-owner should fail when depositing reward with error Ownable: caller is not the owner", async function () {
    const _tokenAddress = flashTokenContract.address;
    const _amount = BigNumber.from(100000).mul(multiplier);
    const _ratio = ethers.utils.parseUnits("0.5", 18);

    await expect(
      userIncentiveContract.connect(signers[1]).depositReward(_tokenAddress, _amount, _ratio),
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("account 0 should deposit 100,000 FLASH rewards with a ratio of 0.5", async function () {
    const _tokenAddress = flashTokenContract.address;
    const _amount = BigNumber.from(100000).mul(multiplier);
    const _ratio = ethers.utils.parseUnits("0.5", 18);

    await userIncentiveContract.depositReward(_tokenAddress, _amount, _ratio);
  });

  it("account 0 should add additional 1,000 FLASH rewards", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    await userIncentiveContract.addRewardTokens(_amount);
  });

  it("reward balance should be 101,000 FLASH", async function () {
    expect(await userIncentiveContract.rewardTokenBalance()).to.be.eq(BigNumber.from(101000).mul(multiplier));
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000 DAI to account 7", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 1,000,000 DAI
    await daiContract.connect(signer).transfer(signers[7].address, BigNumber.from(1000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[7].address);
    expect(balance).gte(BigNumber.from(1000).mul(multiplier));
  });

  it("should stake 1,000 DAI from account 7 (do not issue NFT) and mint fERC20 tokens", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    await daiContract.connect(signers[7]).approve(protocolContract.address, _amount);

    // Perform the stake
    const result = await protocolContract
      .connect(signers[7])
      .stake(strategyContract.address, _amount, _duration, signers[7].address, false);

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

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[7].address)).to.be.eq(stakeInfo.fTokensToUser);
    console.log("\tfERC20 tokens minted:", ethers.utils.formatUnits(stakeInfo.fTokensToUser, 18));
  });

  it("account 7 should burn 10 fERC20 tokens and receive 5 FLASH tokens", async function () {
    const _amountToBurn = BigNumber.from(10).mul(multiplier);

    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[7]).approve(strategyContract.address, _amountToBurn);

    // Burn the fERC20 token against strategy contract to get yield
    const _minimumReturned = await strategyContract.connect(signers[7]).quoteBurnFToken(_amountToBurn);
    const result = await strategyContract
      .connect(signers[7])
      .burnFToken(_amountToBurn, _minimumReturned, signers[7].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_tokenAmount"]).to.be.eq(ethers.utils.parseUnits("10", 18));

    expect(await flashTokenContract.balanceOf(signers[7].address)).to.be.eq(ethers.utils.parseUnits("5", 18));
  });

  it("account 0 should increase reward ratio to 0.75", async function () {
    const _ratio = ethers.utils.parseUnits("0.75", 18);
    await userIncentiveContract.setRewardRatio(_ratio);
  });

  it("account 7 should burn 10 fERC20 tokens and receive 7.5 FLASH tokens", async function () {
    const _amountToBurn = BigNumber.from(10).mul(multiplier);

    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[7]).approve(strategyContract.address, _amountToBurn);

    // Burn the fERC20 token against strategy contract to get yield
    const _minimumReturned = await strategyContract.connect(signers[7]).quoteBurnFToken(_amountToBurn);
    const result = await strategyContract
      .connect(signers[7])
      .burnFToken(_amountToBurn, _minimumReturned, signers[7].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_tokenAmount"]).to.be.eq(ethers.utils.parseUnits("10", 18));

    // Since we already had 5 tokens from the last test, we will get another 7.5 here so total is 12.5
    expect(await flashTokenContract.balanceOf(signers[7].address)).to.be.eq(ethers.utils.parseUnits("12.5", 18));
  });

  it("should increment next block timestamp by 3 months", async function () {
    // Increase the timestamp of the next block
    const newTs = new Date().getTime() / 1000 + 7257600; // 84 days
    await hre.network.provider.send("evm_increaseTime", [newTs]);
    await hre.network.provider.send("evm_mine");
  });

  it("account 0 should deposit 1,000 FLASH @ 1.5 ratio", async function () {
    // Get the current Flash balance of account 0
    const oldRewardBalance = await flashTokenContract.balanceOf(signers[0].address);

    // Determine how many reward tokens are in contract that we expect to get back
    const contractRewardBalance = await userIncentiveContract.rewardTokenBalance();

    const _tokenAddress = flashTokenContract.address;
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _ratio = ethers.utils.parseUnits("1.5", 18);

    await userIncentiveContract.depositReward(_tokenAddress, _amount, _ratio);

    // Get the new Flash balance of account 0
    const newRewardBalance = await flashTokenContract.balanceOf(signers[0].address);

    const expectedBalance = oldRewardBalance.add(contractRewardBalance).sub(_amount);

    expect(newRewardBalance).to.be.eq(expectedBalance);
  });

  it("account 7 should burn 700 fERC20 tokens and receive 1,000 FLASH tokens at account 8", async function () {
    const _amountToBurn = BigNumber.from(700).mul(multiplier);

    // Account 8 should have no principal tokens
    const principalTokenContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    expect(await principalTokenContract.balanceOf(signers[8].address)).to.be.eq(0);

    // Approve the fToken contract for spending
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    await fTokenContract.connect(signers[7]).approve(strategyContract.address, _amountToBurn);

    // Burn the fERC20 token against strategy contract to get yield
    const _minimumReturned = await strategyContract.connect(signers[7]).quoteBurnFToken(_amountToBurn);
    const result = await strategyContract
      .connect(signers[7])
      .burnFToken(_amountToBurn, _minimumReturned, signers[8].address);

    // Determine how many yield tokens we got back via event
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "BurnedFToken";
    }))[0]["args"];
    // @ts-ignore
    expect(args["_tokenAmount"]).to.be.eq(ethers.utils.parseUnits("700", 18));

    // We should get back 1,000 since this is the maximum amount of rewards in the contract
    // even though the user is eligible for 1,050
    // since we already have 12 Flash tokens, the total should now be 1012.5
    expect(await flashTokenContract.balanceOf(signers[8].address)).to.be.eq(ethers.utils.parseUnits("1000", 18));

    // We would have also got back some principal tokens
    expect(await principalTokenContract.balanceOf(signers[8].address)).to.be.gt(0);
  });

  it("ensure reward token balance is 0 and owner can depositReward: 1000 Flash @ 1.5 ratio", async function () {
    const oldRewardBalance = await userIncentiveContract.rewardTokenBalance();
    expect(oldRewardBalance).to.be.eq("0");

    const _tokenAddress = flashTokenContract.address;
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _ratio = ethers.utils.parseUnits("1.5", 18);

    await userIncentiveContract.depositReward(_tokenAddress, _amount, _ratio);

    const newRewardBalance = await userIncentiveContract.rewardTokenBalance();
    expect(newRewardBalance).to.be.eq(oldRewardBalance.add(_amount));
  });

  it("should impersonate account 0xca4ad39f872e89ef23eabd5716363fc22513e147 and transfer 1,000 DAI to account 9", async function () {
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: ["0xca4ad39f872e89ef23eabd5716363fc22513e147"],
    });
    const signer = await hre.ethers.getSigner("0xca4ad39f872e89ef23eabd5716363fc22513e147");
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);

    // Connect using the impersonated account and transfer 10,000 DAI
    await daiContract.connect(signer).transfer(signers[9].address, BigNumber.from(10000).mul(multiplier));

    const balance = await daiContract.balanceOf(signers[9].address);
    expect(balance).gte(BigNumber.from(10000).mul(multiplier));
  });

  it("account 9 should flashstake 1000 DAI and redirect yield to account 10", async function () {
    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 63072000;

    // Expect the balance to be initially 0
    const daiContract = await hre.ethers.getContractAt("IERC20C", principalTokenAddress);
    expect(await daiContract.balanceOf(signers[10].address)).to.be.eq(0);

    // Perform approvals
    await daiContract.connect(signers[9]).approve(protocolContract.address, _amount);

    await protocolContract
      .connect(signers[9])
      .flashStake(strategyContract.address, _amount, _duration, 0, signers[10].address, false);
    expect(await daiContract.balanceOf(signers[10].address)).to.be.gt(0);
  });
});
