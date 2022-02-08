import hre from "hardhat";
import {
  FlashBondConstant, FlashToken,
} from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
import * as crypto from "crypto";
import BalanceTree from "../utils/balance-tree";

const { deployContract } = hre.waffle;

describe.only("FlashBondConstant Merkle Tree Tests", function() {

  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let flashBondContract: FlashBondConstant;
  let daiTokenContract: FlashToken;
  let flashTokenContract: FlashToken;

  beforeEach(async function() {
    this.signers = await hre.ethers.getSigners();

    const flashTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    flashTokenContract = <FlashToken>await deployContract(this.signers[0], flashTokenArtifact);

    const daiTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    daiTokenContract = <FlashToken>await deployContract(this.signers[0], daiTokenArtifact);

    const flashBondArtifact: Artifact = await hre.artifacts.readArtifact("FlashBondConstant");
    flashBondContract = <FlashBondConstant>await deployContract(this.signers[0], flashBondArtifact, [daiTokenContract.address, flashTokenContract.address]);

    // Add the Minter role on the Flash token contract such that the bond contract can mint
    // keccak256("MINTER_ROLE") = 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6
    await flashTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", flashBondContract.address);

    // Increase allowance (allow the bond contract to spend unlimited DAI on behalf of the user)
    await daiTokenContract.approve(flashBondContract.address, BigNumber.from(10000000000).mul(multiplier));
  })

  it("generate and test basic merkle tree w/ 2 addresses", async function() {

    const data = [
      { index: BigNumber.from(0), account: "0x6f3E2DC1B8B1C73324f0AaB7aE7E423c89aFffe8", amount: BigNumber.from("100") },
      { index: BigNumber.from(1), account: "0x270AaC50359098041989F7CA490E7E91c7265B8D", amount: BigNumber.from("101") },
    ]
    const tree = new BalanceTree(data);
    await flashBondContract.setMerkleRoot(tree.getHexRoot());

    let proof = tree.getProof(0, "0x6f3E2DC1B8B1C73324f0AaB7aE7E423c89aFffe8", BigNumber.from(100));
    expect(await flashBondContract.getAvailableAllowance(
      0,
      "0x6f3E2DC1B8B1C73324f0AaB7aE7E423c89aFffe8",
      BigNumber.from("100"),
      proof)
    ).to.be.eq(BigNumber.from("100"));

    proof = tree.getProof(1, "0x270AaC50359098041989F7CA490E7E91c7265B8D", BigNumber.from(101));
    expect(await flashBondContract.getAvailableAllowance(
      1,
      "0x270AaC50359098041989F7CA490E7E91c7265B8D",
      BigNumber.from("101"),
      proof)
    ).to.be.eq(BigNumber.from("101"));
  })

  it("generate and test merkle tree w/ 1,000 addresses", async function() {

    let data = [];
    for(let i = 0; i < 1000; i++) {
      const wallet = new ethers.Wallet("0x"+crypto.randomBytes(32).toString('hex'));
      const randomAllowance = BigNumber.from(Math.floor((Math.random() * 100000) + 1)).mul(multiplier);

      data.push({
        account: wallet.address,
        amount: randomAllowance})
    }

    const tree = new BalanceTree(data);
    await flashBondContract.setMerkleRoot(tree.getHexRoot());

    // Iterate over every single address and ensure the allowance is what we set it as
    for(let i = 0; i < data.length; i++) {
      const proof = tree.getProof(i, data[i].account, data[i].amount);

      const result = await flashBondContract.getAvailableAllowance(
        i,
        data[i].account,
        data[i].amount,
        proof);

      expect(result).to.be.eq(data[i].amount);
    }
  })
})

describe.only("FlashBondConstant Tests", function () {

  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));
  const bondReceiver = "0x5089722613C2cCEe071C39C59e9889641f435F15";

  let flashBondContract: FlashBondConstant;
  let daiTokenContract: FlashToken;
  let flashTokenContract: FlashToken;

  let tree: BalanceTree;
  let treeData: { account: string; amount: BigNumber; }[];

  before(async function () {
    this.signers = await hre.ethers.getSigners();

    //console.log("Using address", this.signers.admin.address);

    //console.log("Deploying Flash V3 Token")
    const flashTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    flashTokenContract = <FlashToken>await deployContract(this.signers[0], flashTokenArtifact);
    //console.log("Flash V3 token deployed to", flashTokenContract.address);

    //console.log("Deploying Flash V3 Token (serves as DAI)")
    const daiTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    daiTokenContract = <FlashToken>await deployContract(this.signers[0], daiTokenArtifact);
    //console.log("Flash V3 token deployed to", daiTokenContract.address);

    //console.log("Deploying Flash Constant Bond Contract")
    const flashBondArtifact: Artifact = await hre.artifacts.readArtifact("FlashBondConstant");
    flashBondContract = <FlashBondConstant>await deployContract(this.signers[0], flashBondArtifact, [daiTokenContract.address, flashTokenContract.address]);
    //console.log("FlashBondConstant deployed to", flashBondContract.address);

    // Add the Minter role on the Flash token contract such that the bond contract can mint
    // keccak256("MINTER_ROLE") = 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6
    await flashTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", flashBondContract.address);

    // Increase allowance (allow the bond contract to spend unlimited DAI on behalf of the user)
    await daiTokenContract.approve(flashBondContract.address, BigNumber.from(10000000000).mul(multiplier));
    await daiTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", this.signers[0].address);
  });

  it("should ensure whitelist enabled", async function () {
    expect(await flashBondContract.isWhitelistEnabled()).to.be.true;
  });

  it("should generate merkle tree and update allowances on contract", async function () {
    treeData = [
      { account: this.signers[0].address, amount: BigNumber.from(10000).mul(multiplier)},
      { account: this.signers[1].address, amount: BigNumber.from(20000).mul(multiplier)},
      { account: this.signers[2].address, amount: BigNumber.from(2000000).mul(multiplier)},
      { account: this.signers[3].address, amount: BigNumber.from(40000).mul(multiplier)},
    ]

    tree = new BalanceTree(treeData);
    await flashBondContract.setMerkleRoot(tree.getHexRoot());
  });

  it("ensure bond receiver has 0 DAI", async function () {
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq("0");
  });

  it("account 0 should have initial allowance of 10,000", async function () {
    const merkleIndex = 0;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    expect(await flashBondContract.connect(this.signers[merkleIndex].address).getAvailableAllowance(
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.be.eq(BigNumber.from(10000).mul(multiplier))
  });

  it("account 1 should have initial allowance of 20,000", async function () {
    const merkleIndex = 1;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    expect(await flashBondContract.getAvailableAllowance(
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.be.eq(BigNumber.from(20000).mul(multiplier))
  });

  it("account 2 should have initial allowance of 2,000,000", async function () {
    const merkleIndex = 2;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    expect(await flashBondContract.getAvailableAllowance(
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.be.eq(BigNumber.from(2000000).mul(multiplier))
  });

  it("account 0 should fail bonding 10,001 DAI due to insufficient allowance", async function () {
    const _tokenAmount = BigNumber.from(10001).mul(multiplier);

    const merkleIndex = 0;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    await expect(flashBondContract.connect(this.signers[merkleIndex]).bond(
      _tokenAmount,
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.revertedWith("INSUFFICIENT ALLOWANCE");
  });

  it("account 0 should bond 1 DAI for 58.7234042 FLASH", async function () {
    const _tokenAmount = BigNumber.from(1).mul(multiplier);

    const merkleIndex = 0;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    const result = await flashBondContract.connect(this.signers[merkleIndex]).bond(_tokenAmount, merkleIndex, merkleAddress, merkleInitialAllowance, merkleProof);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("58.57456");
  });

  it("account 0 should bond 9,999 DAI for 585,687.025 FLASH", async function () {
    const _tokenAmount = BigNumber.from(9999).mul(multiplier);

    const merkleIndex = 0;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    const result = await flashBondContract.connect(this.signers[merkleIndex]).bond(_tokenAmount, merkleIndex, merkleAddress, merkleInitialAllowance, merkleProof);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("585687.02544");
  });

  it("account 2 should fail bonding 1,000,001 DAI with error ERC20: transfer amount exceeds balance", async function () {
    const _tokenAmount = BigNumber.from(1000001).mul(multiplier);

    const merkleIndex = 2;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    await expect(flashBondContract.connect(this.signers[merkleIndex]).bond(
      _tokenAmount,
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
  });

  it("should mint 1,000,001 DAI into account 2 as admin", async function () {
    const _tokenAmount = BigNumber.from(1000001).mul(multiplier);

    // Mint the above token amount to the account as admin
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[2].address, _tokenAmount);
    expect(await daiTokenContract.balanceOf(this.signers[2].address)).to.eq(_tokenAmount);
  });

  it("account 2 should fail bonding 1,000,001 DAI with error EXCEEDS MAX FLASH MINTABLE", async function () {
    const _tokenAmount = BigNumber.from(1000001).mul(multiplier);

    const merkleIndex = 2;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    // Ensure the bonding contract has sufficent allowance
    await daiTokenContract.connect(this.signers[merkleIndex]).approve(flashBondContract.address, BigNumber.from(_tokenAmount));

    await expect(flashBondContract.connect(this.signers[merkleIndex]).bond(
      _tokenAmount,
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.be.revertedWith("EXCEEDS MAX FLASH MINTABLE");
  });

  it("should fail setting allowance multiplier to 10% as non-owner with error Ownable: caller is not the owner", async function () {
    await expect(flashBondContract.connect(this.signers[1]).setAllowanceMultiplier(1000)).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should set allowance multiplier to 10%", async function () {
    await flashBondContract.setAllowanceMultiplier(1000);

    expect(await flashBondContract.getAllowanceMultiplier()).to.be.eq(1000);
  });

  it("account 1 should have available allowance of 22,000", async function () {
    const merkleIndex = 1;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    expect(await flashBondContract.connect(this.signers[merkleIndex]).getAvailableAllowance(
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.be.eq(BigNumber.from(22000).mul(multiplier))
  });

  it("should set allowance multiplier to 1000%", async function () {
    await flashBondContract.setAllowanceMultiplier(100000);

    expect(await flashBondContract.getAllowanceMultiplier()).to.be.eq(100000);
  });

  it("account 1 should have available allowance of 220,000", async function () {
    const merkleIndex = 1;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    expect(await flashBondContract.connect(this.signers[merkleIndex]).getAvailableAllowance(
      merkleIndex,
      merkleAddress,
      merkleInitialAllowance,
      merkleProof)).to.be.eq(BigNumber.from(220000).mul(multiplier))
  });

  it("account 0 should fail bonding 970,000 DAI with error INSUFFICIENT ALLOWANCE", async function () {
    const _tokenAmount = BigNumber.from(420420).mul(multiplier);

    const merkleIndex = 0;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    await expect(flashBondContract.connect(this.signers[merkleIndex]).bond(_tokenAmount, merkleIndex, merkleAddress, merkleInitialAllowance, merkleProof)).to.be.revertedWith("INSUFFICIENT ALLOWANCE");
  });

  it("should fail deactivate whitelist as non-owner with error Ownable: caller is not the owner", async function () {
    await expect(flashBondContract.connect(this.signers[1]).deactivateWhiteList()).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should deactivate whitelist as owner", async function () {
    await flashBondContract.connect(this.signers[0]).deactivateWhiteList();
    expect(await flashBondContract.isWhitelistEnabled()).to.be.false;
  });

  it("account 0 should bond 970,000 DAI for 56,817,323.2 FLASH", async function () {
    const _tokenAmount = BigNumber.from(970000).mul(multiplier);

    const merkleIndex = 0;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    const result = await flashBondContract.connect(this.signers[merkleIndex]).bond(_tokenAmount, merkleIndex, merkleAddress, merkleInitialAllowance, merkleProof);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("56817323.2");
  });

  it("should ensure bond recipient balance is 980,000", async function () {
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq(ethers.utils.parseUnits("980000", 18));
  });

  it("should mint 40,000 DAI into account 3 as admin", async function () {
    const _tokenAmount = BigNumber.from(40000).mul(multiplier);

    // Mint the above token amount to the account as admin
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[3].address, _tokenAmount);
    expect(await daiTokenContract.balanceOf(this.signers[3].address)).to.eq(_tokenAmount);
  });

  it("account 3 should fail bonding 40,000 DAI with error EXCEEDS MAX FLASH MINTABLE", async function () {
    const _tokenAmount = BigNumber.from(40000).mul(multiplier);

    const merkleIndex = 3;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    // Ensure the bonding contract has sufficent allowance
    await daiTokenContract.connect(this.signers[merkleIndex]).approve(flashBondContract.address, BigNumber.from(_tokenAmount));

    await expect(flashBondContract.connect(this.signers[merkleIndex]).bond(_tokenAmount, merkleIndex, merkleAddress, merkleInitialAllowance, merkleProof)).to.be.revertedWith("EXCEEDS MAX FLASH MINTABLE");
  });

  it("account 3 should bond 20,000 DAI for 1,171,491.2 FLASH", async function () {
    const _tokenAmount = BigNumber.from(20000).mul(multiplier);

    const merkleIndex = 3;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    // Ensure the bonding contract has sufficent allowance
    await daiTokenContract.connect(this.signers[merkleIndex]).approve(flashBondContract.address, BigNumber.from(_tokenAmount));

    const result = await flashBondContract.connect(this.signers[merkleIndex]).bond(_tokenAmount, merkleIndex, merkleAddress, merkleInitialAllowance, merkleProof);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("1171491.2");
  });

  it("ensure bond receiver has 1,000,000 DAI", async function () {
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq(ethers.utils.parseUnits("1000000", 18));
  });

  it("account 0 should fail bonding 1 DAI with error EXCEEDS MAX FLASH MINTABLE", async function () {
    const _tokenAmount = BigNumber.from(1).mul(multiplier);

    const merkleIndex = 0;
    const merkleAddress = treeData[merkleIndex].account;
    const merkleInitialAllowance = treeData[merkleIndex].amount;
    const merkleProof = tree.getProof(merkleIndex, merkleAddress, merkleInitialAllowance);

    await expect(flashBondContract.connect(this.signers[merkleIndex]).bond(_tokenAmount, merkleIndex, merkleAddress, merkleInitialAllowance, merkleProof)).to.be.revertedWith("EXCEEDS MAX FLASH MINTABLE");
  });
});
