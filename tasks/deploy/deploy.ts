import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

import {
  FlashStakeV3,
  FlashStakeV3__factory,
  FlashStrategyAAVEv2, FlashStrategyAAVEv2__factory,
  FlashToken,
  FlashToken__factory,
} from "../../typechain";

task("deploy").setAction(async function (taskArguments: TaskArguments, { ethers }) {
  const [wallet1, wallet2, wallet3] = await ethers.getSigners();
  const deployer = wallet1;

  // Deploy the Flash V3 Token
  console.log("Deploying Flash V3 Token");
  const flashV3Factory: FlashToken__factory = await ethers.getContractFactory("FlashToken");
  const flashV3Token: FlashToken = <FlashToken>await flashV3Factory.connect(deployer).deploy();
  await flashV3Token.deployed();
  console.log("-> FlashV3 Token Deployed to", flashV3Token.address);

  // Deploy the Flash V3 Protocol
  console.log("Deploying Flash V3 Protocol")
  const flashV3ProtocolFactory: FlashStakeV3__factory = await ethers.getContractFactory("FlashStakeV3");
  const flashV3Protocol: FlashStakeV3 = <FlashStakeV3>await flashV3ProtocolFactory.connect(deployer).deploy();
  await flashV3Protocol.deployed();
  console.log("-> Flash V3 Protocol Deployed to", flashV3Protocol.address);
  console.log("-> Flash V3 NFT Deployed to", await flashV3Protocol.flashV3NFTAddress());

  // Deploy a new Strategy
  const poolAddresses = ["0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe"]
  const principalTokenAddresses = ["0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD"]
  const interestBearingTokenAddresses = ["0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8"]

  for(let i = 0; i < poolAddresses.length; i++) {
    console.log("Deploying AAVE DAI Strategy", i)
    const strategyAAVEDAIFactory: FlashStrategyAAVEv2__factory = await ethers.getContractFactory("FlashStrategyAAVEv2");
    const flashProtocolAddress = flashV3Protocol.address;
    const FlashStrategyAAVEv2: FlashStrategyAAVEv2 = <FlashStrategyAAVEv2>await strategyAAVEDAIFactory.connect(deployer).deploy(poolAddresses[i], principalTokenAddresses[i], interestBearingTokenAddresses[i], flashProtocolAddress);
    await FlashStrategyAAVEv2.deployed();
    console.log("-> AAVE DAI Strategy Deployed to", FlashStrategyAAVEv2.address);
  }
});
