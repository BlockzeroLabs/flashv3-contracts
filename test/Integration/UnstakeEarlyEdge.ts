import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { FlashFTokenFactory, FlashNFT, FlashProtocol, FlashStrategyAAVEv2 } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
const { deployContract } = hre.waffle;

describe("Edge Case Tests (unstake early)", function () {
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
    const _duration = 864000; // 10 days

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

  it("(6) scenario 6: Ben edge case", async function () {
    const fTokenContract = await hre.ethers.getContractAt("IERC20C", fTokenAddress);
    let percentageIntoStake;
    let _fTokensToBurn;
    let stake;

    // ============= Step 1 =============
    console.log("\t(5) Step 1 EXPECTED: 9.0% into stake, withdraw ~1.8% of principal, pay ~1.8% fTokens");
    _fTokensToBurn = ethers.utils.parseUnits("0.4983003554048", 18);
    percentageIntoStake = 0.09;
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
    expect(stake._tokensReturned).to.be.gte(18);
    expect(stake._fTokensBurned).to.be.lte(0.5);

    // ============= Step 2 =============
    console.log("\t(5) Step 2 EXPECTED: 9.7% into stake, withdraw ~2.6% of principal, pay ~2.6% fTokens");
    _fTokensToBurn = ethers.utils.parseUnits("0.726980213462016", 18);
    percentageIntoStake = 0.097;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(5) Step 2 ACTUAL: ",
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
    expect(stake._tokensReturned).to.be.gte(26);
    expect(stake._fTokensBurned).to.be.lte(0.73);

    // ============= Step 3 =============
    console.log("\t(5) Step 3 EXPECTED: 80% into stake, withdraw ~95.52% (remaining) of principal, pay ~15.5% fTokens");
    _fTokensToBurn = ethers.utils.parseUnits("100000", 18);
    percentageIntoStake = 0.8;
    stake = await unstakeAbstract(
      fTokenContract,
      protocolContract,
      signers,
      _fTokensToBurn,
      stakeInfo,
      percentageIntoStake,
    );

    console.log(
      "\t(5) Step 3 ACTUAL: ",
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
    expect(stake._tokensReturned).to.be.gte(955);
    expect(stake._fTokensBurned).to.be.lte(4.26);
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
