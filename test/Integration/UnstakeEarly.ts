import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { FlashFTokenFactory, FlashNFT, FlashProtocol, FlashStrategyAAVEv2 } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
const { deployContract } = hre.waffle;

describe("Flashstake Tests", function () {
  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let principalTokenAddress = "0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD";
  let interestBearingTokenAddress = "0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8";
  let fTokenAddress: string;

  let protocolContract: FlashProtocol;
  let strategyContract: FlashStrategyAAVEv2;

  let signers: SignerWithAddress[];

  let stakeInfo: [
    string,
    string,
    BigNumber,
    BigNumber,
    BigNumber,
    boolean,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber,
    BigNumber,
  ] & {
    stakerAddress: string;
    strategyAddress: string;
    stakeStartTs: BigNumber;
    stakeDuration: BigNumber;
    stakedAmount: BigNumber;
    active: boolean;
    nftId: BigNumber;
    fTokensToUser: BigNumber;
    fTokensFee: BigNumber;
    totalFTokenBurned: BigNumber;
    totalStakedWithdrawn: BigNumber;
  };

  beforeEach(async function () {
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
    await protocolContract.registerStrategy(strategyContract.address, principalTokenAddress, "fDAI", "fDAI");

    // Normally we'd set the fee here but since we test that further on, it's not needed.

    fTokenAddress = await strategyContract.getFTokenAddress();

    // ====== Send some DAI to account 1 ======
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

    // ====== Create a stake ======

    const _amount = BigNumber.from(1000).mul(multiplier);
    const _duration = 31536000; // 365 days in seconds

    // Approve the contract for spending
    await daiContract.connect(signers[1]).approve(protocolContract.address, _amount);

    // Perform the stake
    //await hre.network.provider.send("evm_setNextBlockTimestamp", [1642896000]);
    //console.log("Set next block timestamp to 1642896000");

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
    stakeInfo = await protocolContract.getStakeInfo(stakeId, false);
    //console.log("StakeInfo:", stakeInfo);

    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    expect(await fTokenContract.balanceOf(signers[1].address)).to.be.eq(stakeInfo.fTokensToUser);
    expect(stakeInfo.active).to.be.true;
  });

  it("(1) scenario 1", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    console.log(
      "\t(1) Step 1 EXPECTED: 60.0% into stake (40.0% remaining), withdraw +10.0% of principal, pay 10.0% fTokens",
    );
    _fTokensToBurn = ethers.utils.parseUnits("100.0000000512", 18);
    percentageIntoStake = 0.6;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(1) Step 1 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(100);
    expect(stake._fTokensBurned).to.be.eq(100.0000000512);

    // ============= Step 2 =============
    console.log(
      "\t(1) Step 2 EXPECTED: 70.0% into stake (30.0% remaining), withdraw +90.0% of principal, pay 20.0% fTokens",
    );
    percentageIntoStake = 0.7;
    _fTokensToBurn = ethers.utils.parseUnits("200.0000001024", 18);
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(1) Step 2 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(900);
    expect(stake._fTokensBurned).to.be.eq(200.0000001024);
  });

  it("(2) scenario 2", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    console.log(
      "\t(2) Step 1 EXPECTED: 10.0% into stake (90.0% remaining), withdraw +10.0% of principal, pay 10.0% fTokens",
    );
    _fTokensToBurn = ethers.utils.parseUnits("100.0000000512", 18);
    percentageIntoStake = 0.1;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(2) Step 1 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(100);
    expect(stake._fTokensBurned).to.be.eq(100.0000000512);

    // ============= Step 2 =============
    console.log(
      "\t(2) Step 2 EXPECTED: 90.0% into stake (10.0% remaining), withdraw +90.0% of principal, pay 0.0% fTokens",
    );
    percentageIntoStake = 0.9;
    _fTokensToBurn = ethers.utils.parseUnits("0", 18);
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(2) Step 2 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(900);
    expect(stake._fTokensBurned).to.be.eq(0);
  });

  it("(3) scenario 3", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    console.log(
      "\t(3) Step 1 EXPECTED: 10.0% into stake (90.0% remaining), withdraw +10.0% of principal, pay 10.0% fTokens",
    );
    _fTokensToBurn = ethers.utils.parseUnits("100.0000000512", 18);
    percentageIntoStake = 0.1;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(3) Step 1 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(100);
    expect(stake._fTokensBurned).to.be.eq(100.0000000512);

    // ============= Step 2 =============
    console.log(
      "\t(3) Step 2 EXPECTED: 20.0% into stake (80.0% remaining), withdraw +10.0% of principal, pay 10.0% fTokens",
    );
    percentageIntoStake = 0.2;
    _fTokensToBurn = ethers.utils.parseUnits("100.0000000512", 18);
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(3) Step 2 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(100);
    expect(stake._fTokensBurned).to.be.eq(100.0000000512);

    // ============= Step 3 =============
    console.log(
      "\t(3) Step 3 EXPECTED: 30.0% into stake (70.0% remaining), withdraw +10.0% of principal, pay 10.0% fTokens",
    );
    percentageIntoStake = 0.3;
    _fTokensToBurn = ethers.utils.parseUnits("100.0000000512", 18);
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(3) Step 3 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(100);
    expect(stake._fTokensBurned).to.be.eq(100.0000000512);

    // ============= Step 2 =============
    console.log(
      "\t(3) Step 4 EXPECTED: 100.0% into stake (0.0% remaining), withdraw +70.0% of principal, pay 0.0% fTokens",
    );
    percentageIntoStake = 1;
    _fTokensToBurn = ethers.utils.parseUnits("0", 18);
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(3) Step 4 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(700);
    expect(stake._fTokensBurned).to.be.eq(0);
  });

  it("(4) scenario 4", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    console.log(
      "\t(4) Step 1 EXPECTED: 10.0% into stake (90.0% remaining), withdraw +50.0% of principal, pay 50.0% fTokens",
    );
    _fTokensToBurn = ethers.utils.parseUnits("500.000000256", 18);
    percentageIntoStake = 0.1;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(4) Step 1 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(500);
    expect(stake._fTokensBurned).to.be.eq(500.000000256);

    // ============= Step 2 =============
    console.log(
      "\t(4) Step 2 EXPECTED: 20.0% into stake (80.0% remaining), withdraw +50.0% of principal, pay 30.0% fTokens",
    );
    percentageIntoStake = 0.2;
    _fTokensToBurn = ethers.utils.parseUnits("300.0000001536", 18);
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(4) Step 2 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(500);
    expect(stake._fTokensBurned).to.be.eq(300.0000001536);
  });

  it("(5) scenario 5", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    console.log(
      "\t(5) Step 1 EXPECTED: 100.0% into stake (0.0% remaining), withdraw +100.0% of principal, pay 0.0% fTokens",
    );
    _fTokensToBurn = ethers.utils.parseUnits("0", 18);
    percentageIntoStake = 1;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(5) Step 1 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(1000);
    expect(stake._fTokensBurned).to.be.eq(0);
  });

  it("ensure when unstaking after stake ends, if user specifies too many fTokens, none are burned", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    _fTokensToBurn = ethers.utils.parseUnits("100", 18);
    percentageIntoStake = 1;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );
    expect(stake._tokensReturned).to.be.eq(1000);
    expect(stake._fTokensBurned).to.eq(0);
  });

  it("ensure user cannot burn more fTokens than required", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    console.log(
      "\t(4) Step 1 EXPECTED: 10.0% into stake (90.0% remaining), withdraw +50.0% of principal, pay 50.0% fTokens",
    );
    _fTokensToBurn = ethers.utils.parseUnits("500.000000256", 18);
    percentageIntoStake = 0.1;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(4) Step 1 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(500);
    expect(stake._fTokensBurned).to.eq(500.000000256);

    // ============= Step 2 =============
    console.log(
      "\t(4) Step 2 EXPECTED: 20.0% into stake (80.0% remaining), withdraw +50.0% of principal, pay 30.0% fTokens",
    );
    percentageIntoStake = 0.2;
    _fTokensToBurn = ethers.utils.parseUnits("301", 18);
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(4) Step 2 ACTUAL: ",
      percentageIntoStake * 100,
      "% into stake,",
      "withdraw",
      stake.percentagePrincipalWithdrawn * 100,
      "% (",
      stake._tokensReturned,
      ") of principal, " + "pay",
      stake.percentageFTokenPaid * 100,
      "% of minted fTokens (",
      stake._fTokensBurned,
      ")",
    );
    expect(stake._tokensReturned).to.be.eq(500);
    expect(stake._fTokensBurned).to.be.eq(300.0000001536);

    // This test is about how many fTokens were inputted vs actually burned
    // 301.000... < 301
  });

  async function unstakeAbstract(
    fTokenContract: any,
    protocolContract: any,
    signers: any,
    _fTokensToBurn: any,
    stakeInfo: any,
    percentageIntoStake: any,
  ): Promise<{
    _fTokensBurned: number;
    percentageFTokenPaid: number;
    percentagePrincipalWithdrawn: number;
    _tokensReturned: number;
  }> {
    const newTimestamp = stakeInfo.stakeStartTs.add(stakeInfo.stakeDuration.toNumber() * percentageIntoStake);
    await fTokenContract.connect(signers[1]).approve(protocolContract.address, _fTokensToBurn);
    await hre.network.provider.send("evm_setNextBlockTimestamp", [newTimestamp.toNumber()]);

    const result = await protocolContract.connect(signers[1]).unstake(1, false, _fTokensToBurn);
    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter(x => {
      return x.event == "Unstaked";
    }))[0]["args"];
    // @ts-ignore
    const _fTokensBurned = parseFloat(ethers.utils.formatUnits(args["_fTokensBurned"], 18));
    // @ts-ignore
    const _tokensReturned = parseFloat(ethers.utils.formatUnits(args["_tokensReturned"], 18));
    expect(_fTokensToBurn).to.be.eq(_fTokensToBurn);

    const _totalFTokensMinted = parseFloat(
      ethers.utils.formatUnits(stakeInfo.fTokensToUser.add(stakeInfo.fTokensFee), 18),
    );

    const percentagePrincipalWithdrawn =
      _tokensReturned / parseFloat(ethers.utils.formatUnits(stakeInfo.stakedAmount, 18));
    const percentageFTokenPaid = _fTokensBurned / _totalFTokensMinted;

    return {
      percentagePrincipalWithdrawn: percentagePrincipalWithdrawn,
      _tokensReturned: _tokensReturned,
      percentageFTokenPaid: percentageFTokenPaid,
      _fTokensBurned: _fTokensBurned,
    };
  }
});
