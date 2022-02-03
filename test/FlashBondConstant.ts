import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { Signers } from "./types";
import {
  FlashBondConstant, FlashTokenV3,
} from "../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
import * as crypto from "crypto";

const { deployContract } = hre.waffle;

describe.only("FlashBondConstant Gas Tests", function() {

  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let flashBondContract: FlashBondConstant;
  let daiTokenContract: FlashTokenV3;
  let flashTokenContract: FlashTokenV3;

  before(async function() {
    this.signers = {} as Signers;

    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    this.signers.admin = signers[0];
    console.log("Using address", this.signers.admin.address);

    console.log("Deploying Flash V3 Token")
    const flashTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashTokenV3");
    flashTokenContract = <FlashTokenV3>await deployContract(this.signers.admin, flashTokenArtifact);
    console.log("Flash V3 token deployed to", flashTokenContract.address);

    console.log("Deploying Flash V3 Token (serves as DAI)")
    const daiTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashTokenV3");
    daiTokenContract = <FlashTokenV3>await deployContract(this.signers.admin, daiTokenArtifact);
    console.log("Flash V3 token deployed to", daiTokenContract.address);

    console.log("Deploying Flash Constant Bond Contract")
    const flashBondArtifact: Artifact = await hre.artifacts.readArtifact("FlashBondConstant");
    flashBondContract = <FlashBondConstant>await deployContract(this.signers.admin, flashBondArtifact, [daiTokenContract.address, flashTokenContract.address]);
    console.log("FlashBondConstant deployed to", flashBondContract.address);

    // Add the Minter role on the Flash token contract such that the bond contract can mint
    // keccak256("MINTER_ROLE") = 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6
    await flashTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", flashBondContract.address);

    // Increase allowance (allow the bond contract to spend unlimited DAI on behalf of the user)
    await daiTokenContract.approve(flashBondContract.address, BigNumber.from(10000000000).mul(multiplier));
  })

  it("generate and update 5000 address allowances", async function() {

    let _addresses = [];
    let _amounts = [];

    for(let i = 0; i < 1000; i++) {
      var id = crypto.randomBytes(32).toString('hex');
      var privateKey = "0x"+id;

      var wallet = new ethers.Wallet(privateKey);
      _addresses.push(wallet.address);
      _amounts.push(BigNumber.from(10000).mul(multiplier));
    }

    await flashBondContract.increaseAllowances(_addresses, _amounts);
  })
})

describe("FlashBondConstant Tests", function () {

  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let flashBondContract: FlashBondConstant;
  let daiTokenContract: FlashTokenV3;
  let flashTokenContract: FlashTokenV3;

  before(async function () {
    this.signers = {} as Signers;

    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    this.signers.admin = signers[0];
    console.log("Using address", this.signers.admin.address);

    console.log("Deploying Flash V3 Token")
    const flashTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashTokenV3");
    flashTokenContract = <FlashTokenV3>await deployContract(this.signers.admin, flashTokenArtifact);
    console.log("Flash V3 token deployed to", flashTokenContract.address);

    console.log("Deploying Flash V3 Token (serves as DAI)")
    const daiTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashTokenV3");
    daiTokenContract = <FlashTokenV3>await deployContract(this.signers.admin, daiTokenArtifact);
    console.log("Flash V3 token deployed to", daiTokenContract.address);

    console.log("Deploying Flash Constant Bond Contract")
    const flashBondArtifact: Artifact = await hre.artifacts.readArtifact("FlashBondConstant");
    flashBondContract = <FlashBondConstant>await deployContract(this.signers.admin, flashBondArtifact, [daiTokenContract.address, flashTokenContract.address]);
    console.log("FlashBondConstant deployed to", flashBondContract.address);

    // Add the Minter role on the Flash token contract such that the bond contract can mint
    // keccak256("MINTER_ROLE") = 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6
    await flashTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", flashBondContract.address);

    // Increase allowance (allow the bond contract to spend unlimited DAI on behalf of the user)
    await daiTokenContract.approve(flashBondContract.address, BigNumber.from(10000000000).mul(multiplier));
  });

  it("ensure bond receiver has 0 DAI", async function () {
    expect(await daiTokenContract.balanceOf("0x5089722613C2cCEe071C39C59e9889641f435F15")).to.be.eq("0");
  });

  it("should fail bonding 1 DAI due to insufficient allowance", async function () {
    const _tokenAmount = BigNumber.from(1).mul(multiplier);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    await expect(flashBondContract.bond(_tokenAmount, bondQuote)).to.revertedWith("INSUFFICIENT ALLOWANCE");
  });

  it("increase DAI bonding allowance by 10,000", async function () {
    const _tokenAmount = BigNumber.from(10000).mul(multiplier);

    const result = await flashBondContract.increaseAllowances([this.signers.admin.address], [_tokenAmount]);
    expect(result.confirmations).to.be.gte(1);
  });

  it("ensure bonding 1 DAI = 58.7234042 FLASH", async function () {
    const _tokenAmount = BigNumber.from(1).mul(multiplier);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    const result = await flashBondContract.bond(_tokenAmount, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("58.7234042");
  });

  it("ensure bonding 10 DAI = 587.234042 FLASH", async function () {
    const _tokenAmount = BigNumber.from(10).mul(multiplier);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    const result = await flashBondContract.bond(_tokenAmount, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("587.234042");
  });

  it("ensure bonding 123.456789 DAI = 587.234042 FLASH", async function () {
    const _tokenAmount = ethers.utils.parseUnits("123.456789", 18);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    const result = await flashBondContract.bond(_tokenAmount, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("7249.8029216811138");
  });

  it("increase DAI bonding allowance by 100,000", async function () {
    const _tokenAmount = BigNumber.from(100000).mul(multiplier);

    const result = await flashBondContract.increaseAllowances([this.signers.admin.address], [_tokenAmount]);
    expect(result.confirmations).to.be.gte(1);
  });

  it("ensure bonding 100,000 DAI = 58723404.2 FLASH", async function () {
    const _tokenAmount = ethers.utils.parseUnits("100000", 18);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    const result = await flashBondContract.bond(_tokenAmount, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("5872340.42");
  });

  it("ensure cumulativeFlashMinted = 5880236.1803678811138 FLASH", async function () {
    const cumulativeFlashMinted = await flashBondContract.cumulativeFlashMinted();
    expect(ethers.utils.formatUnits(cumulativeFlashMinted, 18)).to.be.eq("5880236.1803678811138");
  });

  it("ensure bonding 1 DAI = 58.7234042 FLASH", async function () {
    const _tokenAmount = BigNumber.from(1).mul(multiplier);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    const result = await flashBondContract.bond(_tokenAmount, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(ethers.utils.formatUnits(fTokensMinted, 18)).to.be.eq("58.7234042");
  });

  it("should revert if 2,000,000 DAI is bonded with error INSUFFICIENT ALLOWANCE", async function () {
    const _tokenAmount = BigNumber.from(2000000).mul(multiplier);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    await expect(flashBondContract.bond(_tokenAmount, bondQuote)).to.be.revertedWith("INSUFFICIENT ALLOWANCE");
  });

  it("increase DAI bonding allowance by 2,000,000", async function () {
    const _tokenAmount = BigNumber.from(2000000).mul(multiplier);

    const result = await flashBondContract.increaseAllowances([this.signers.admin.address], [_tokenAmount]);
    expect(result.confirmations).to.be.gte(1);
  });

  it("should revert if 2,000,000 DAI is bonded with error EXCEEDS MAX FLASH MINTABLE", async function () {
    const _tokenAmount = BigNumber.from(2000000).mul(multiplier);

    const bondQuote = await flashBondContract.quoteBond(_tokenAmount);
    await expect(flashBondContract.bond(_tokenAmount, bondQuote)).to.be.revertedWith("EXCEEDS MAX FLASH MINTABLE");
  });

  it("ensure bond receiver has 100,135.456789 DAI", async function () {
    const balance = await daiTokenContract.balanceOf("0x5089722613C2cCEe071C39C59e9889641f435F15");
    expect(ethers.utils.formatUnits(balance, 18)).to.be.eq("100135.456789");
  });
});
