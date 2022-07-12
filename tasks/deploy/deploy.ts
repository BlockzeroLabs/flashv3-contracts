import { task } from "hardhat/config";
import { TaskArguments } from "hardhat/types";

import {
  FlashBack,
  FlashBack__factory,
  FlashFTokenFactory,
  FlashFTokenFactory__factory,
  FlashNFT,
  FlashNFT__factory,
  FlashProtocol,
  FlashProtocol__factory,
  FlashStrategyAAVEv2,
  FlashStrategyAAVEv2__factory,
  FlashToken,
  FlashToken__factory,
  UserIncentive,
  UserIncentive__factory,
} from "../../typechain";
import { BigNumber } from "ethers";

task("deploy:FlashToken").setAction(async function (taskArguments: TaskArguments, { ethers }) {
  const [wallet1] = await ethers.getSigners();

  console.log("Deploying Flash V3 Token");
  const flashV3Factory: FlashToken__factory = await ethers.getContractFactory("FlashToken");
  const flashV3Token: FlashToken = <FlashToken>await flashV3Factory.connect(wallet1).deploy();
  await flashV3Token.deployed();
  console.log("-> FlashV3 Token Deployed to", flashV3Token.address);
});

task("deploy:SendAllFlashTokens")
  .addParam("tokenaddress", "address of the token")
  .addParam("address", "address to send to")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();
    const tokenContract: FlashToken = <FlashToken>await ethers.getContractAt("FlashToken", taskArguments.tokenaddress);

    // Determine balance
    console.log("Determining token balance...");
    const balance = await tokenContract.connect(wallet1).balanceOf(wallet1.address);
    console.log("Wallet has a balance of", ethers.utils.formatUnits(balance, 18));

    // Transfer all the tokens
    console.log("Transferring all tokens...");
    await tokenContract.connect(wallet1).transfer(taskArguments.address, balance);
    console.log("Tokens sent to", taskArguments.address);
  });

task("deploy:FlashNFT").setAction(async function (taskArguments: TaskArguments, { ethers }) {
  const [wallet1] = await ethers.getSigners();

  console.log("Deploying Flash V3 NFT");
  const nftFactory: FlashNFT__factory = await ethers.getContractFactory("FlashNFT");
  const nftToken: FlashNFT = <FlashNFT>await nftFactory.connect(wallet1).deploy();
  console.log("-> FlashV3 NFT Deployed to", nftToken.address);
});

task("deploy:FlashFTokenFactory").setAction(async function (taskArguments: TaskArguments, { ethers }) {
  const [wallet1] = await ethers.getSigners();

  console.log("Deploying Flash FTokenContractFactory");
  const flashV3fTokenFactory: FlashFTokenFactory__factory = await ethers.getContractFactory("FlashFTokenFactory");
  const flashV3FTokenContract: FlashFTokenFactory = <FlashFTokenFactory>(
    await flashV3fTokenFactory.connect(wallet1).deploy()
  );
  await flashV3FTokenContract.connect(wallet1).deployed();
  console.log("-> Flash FTokenContractFactory Deployed to", flashV3FTokenContract.address);
});

task("deploy:FlashProtocol")
  .addParam("nftaddress", "The Flash NFT address")
  .addParam("flashftokenfactory", "The Flash FToken Factory address")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    console.log("Deploying Flash V3 Protocol");
    const flashV3ProtocolFactory: FlashProtocol__factory = await ethers.getContractFactory("FlashProtocol");
    const flashV3Protocol: FlashProtocol = <FlashProtocol>(
      await flashV3ProtocolFactory.connect(wallet1).deploy(taskArguments.nftaddress, taskArguments.flashftokenfactory)
    );
    await flashV3Protocol.connect(wallet1).deployed();
    console.log("-> Flash V3 Protocol Deployed to", flashV3Protocol.address);

    console.log("Setting mint fees to 20%");
    await flashV3Protocol.setMintFeeInfo("0x53B51DE1706FC485f389cA3D5B8fE4251F0d769e", 2000);
    console.log("-> done");
  });

task("deploy:TransferNFTOwnership")
  .addParam("nftaddress", "The Flash NFT address")
  .addParam("flashprotocoladdress", "The Flash protocol address")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    // Retrieve the Flash NFT contract obj
    const nftToken: FlashNFT = <FlashNFT>await ethers.getContractAt("FlashNFT", taskArguments.nftaddress);

    console.log("Transferring ownership of NFT to Flash Protocol");
    // Transfer ownership of nft to protocol
    await nftToken.connect(wallet1).transferOwnership(taskArguments.flashprotocoladdress);
    console.log("-> Done");
  });

task("deploy:TransferFactoryOwnership")
  .addParam("factoryaddress", "The Flash F Token factory address")
  .addParam("flashprotocoladdress", "The Flash protocol address")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    const factoryContract: FlashFTokenFactory = <FlashFTokenFactory>(
      await ethers.getContractAt("FlashFTokenFactory", taskArguments.factoryaddress)
    );

    console.log("Transferring ownership of factory to Flash Protocol");
    await factoryContract.connect(wallet1).transferOwnership(taskArguments.flashprotocoladdress);
    console.log("-> Done");
  });

task("deploy:FlashAAVEStrategy")
  .addParam("pooladdress", "The AAVE v2 Pool Address")
  .addParam("principaltokenaddress", "The principal token address - eg DAI, USDC")
  .addParam("interestbearingtokenaddresses", "The AAVE v2 interest bearing token address - eg aDAI")
  .addParam("flashprotocoladdress", "The Flash protocol address")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    // KOVAN
    // const poolAddresses = ["0xE0fBa4Fc209b4948668006B2bE61711b7f465bAe"]
    // const principalTokenAddresses = ["0xFf795577d9AC8bD7D90Ee22b6C1703490b6512FD"]
    // const interestBearingTokenAddresses = ["0xdCf0aF9e59C002FA3AA091a46196b37530FD48a8"]

    console.log("Deploying Strategy");
    const strategyAAVEDAIFactory: FlashStrategyAAVEv2__factory = await ethers.getContractFactory("FlashStrategyAAVEv2");
    const FlashStrategyAAVEv2: FlashStrategyAAVEv2 = <FlashStrategyAAVEv2>(
      await strategyAAVEDAIFactory
        .connect(wallet1)
        .deploy(
          taskArguments.pooladdress,
          taskArguments.principaltokenaddress,
          taskArguments.interestbearingtokenaddresses,
          taskArguments.flashprotocoladdress,
        )
    );
    await FlashStrategyAAVEv2.deployed();
    console.log("-> Strategy Deployed to", FlashStrategyAAVEv2.address);
  });

task("deploy:RegisterStrategy")
  .addParam("flashprotocoladdress", "The Flash protocol address")
  .addParam("strategyaddress", "The strategy address")
  .addParam("principaltokenaddress", "The principal token address - eg DAI, USDC")
  .addParam("ftokenname", "The fToken name - eg fDAI Token")
  .addParam("ftokensymbol", "The fToken symbol - eg fDAI")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    console.log("Registering strategy against Flashstake protocol");
    const flashProtocolContract: FlashProtocol = <FlashProtocol>(
      await ethers.getContractAt("FlashProtocol", taskArguments.flashprotocoladdress)
    );

    await flashProtocolContract
      .connect(wallet1)
      .registerStrategy(
        taskArguments.strategyaddress,
        taskArguments.principaltokenaddress,
        taskArguments.ftokenname,
        taskArguments.ftokensymbol,
      );
    console.log("-> Strategy registered");
  });

task("deploy:FlashBack")
  .addParam("stakingtokenaddress", "The token to be staked")
  .addParam("rewardtokenaddress", "The reward token address")
  .addParam("maxapr", "The maximum APR")
  .addParam("minimumstakeduration", "The minimum amount of seconds the user will need to stake for")
  .addParam("maximumstakeduration", "The maximum number of seconds the user can stake for")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    console.log("Deploying FlashBack Contract");
    const flashBackFactory: FlashBack__factory = await ethers.getContractFactory("FlashBack");
    const flashBack: FlashBack = <FlashBack>(
      await flashBackFactory
        .connect(wallet1)
        .deploy(
          taskArguments.stakingtokenaddress,
          taskArguments.rewardtokenaddress,
          BigNumber.from(taskArguments.minimumstakeduration),
          BigNumber.from(taskArguments.maximumstakeduration),
        )
    );
    await flashBack.deployed();
    console.log("-> FlashBack Contract Deployed", flashBack.address);

    console.log("FlashBack Setting Ratio to:", BigNumber.from(taskArguments.maxapr));
    await flashBack.connect(wallet1).setMaxAPR(BigNumber.from(taskArguments.maxapr));
    console.log("-> FlashBack Ratio set.");
  });

task("deploy:UserIncentive")
  .addParam("strategyaddress", "The strategy address we want to incentivise")
  .setAction(async function (taskArguments: TaskArguments, { ethers }) {
    const [wallet1] = await ethers.getSigners();

    console.log("Deploying UserIncentive Contract");
    const uiFactory: UserIncentive__factory = await ethers.getContractFactory("UserIncentive");
    const userIncentiveContract: UserIncentive = <UserIncentive>(
      await uiFactory.connect(wallet1).deploy(taskArguments.strategyaddress, 7257600)
    );
    await userIncentiveContract.deployed();
    console.log("-> UserIncentive Contract Deployed", userIncentiveContract.address);

    console.log("Updating Strategy to use UserIncentive contract");
    const strategyContract: FlashStrategyAAVEv2 = <FlashStrategyAAVEv2>(
      await ethers.getContractAt("FlashStrategyAAVEv2", taskArguments.strategyaddress)
    );
    await strategyContract.connect(wallet1).setUserIncentiveAddress(userIncentiveContract.address);
    console.log("-> Done");
  });

/*
  =============================
  Steps to deploy:
  =============================

// 1. Deploy the Flash Token
npx hardhat deploy:FlashToken --network kovan

// 2. Transfer the Flash tokens if needed
npx hardhat deploy:SendAllFlashTokens --network kovan --tokenaddress <flash token address> --address <address to send to>

// 3. Deploy the Flash NFT
npx hardhat deploy:FlashNFT --network kovan

// 4. Deploy the Flash FToken Factory
npx hardhat deploy:FlashFTokenFactory --network kovan

// 5. Deploy the FlashProtocol
npx hardhat deploy:FlashProtocol --network kovan --nftaddress xx --flashftokenfactory xx

// 6. Transfer the ownership of Flash NFT to Flash protocol
npx hardhat deploy:TransferNFTOwnership --network kovan --nftaddress xx --flashprotocoladdress xx

// 7 Transfer the ownership of Flash FToken Factory to flash protocol
npx hardhat deploy:TransferFactoryOwnership --network kovan --factoryaddress xx --flashprotocoladdress xx

// 8. Deploy flash strategy (AAVE v2)
npx hardhat deploy:FlashAAVEStrategy --network kovan --pooladdress xxx --principaltokenaddress xxx --interestbearingtokenaddresses xx --flashprotocoladdress xx

// 9. Register the new strategy against the Flashstake protocol
npx hardhat deploy:RegisterStrategy --network kovan --flashprotocoladdress xxx --strategyaddress xxx --principaltokenaddress xxx --ftokenname fDAI --ftokensymbol fDAI

// 10. Deploy the FlashBack contract
npx hardhat deploy:FlashBack --network kovan --stakingtokenaddress xx --rewardtokenaddress xx --maxapr xx --minimumstakeduration xx --maximumstakeduration xx

// 11. Deploy the UserIncentive contract
npx hardhat deploy:UserIncentive --network kovan --strategyaddress xx

// Manually deposit rewards using functions (UserIncentive)

// 12. Verify all the contracts
npx hardhat verify --network kovan <contractAddress>

*/
