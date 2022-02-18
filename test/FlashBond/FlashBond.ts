import hre from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import {
  FlashBond, FlashToken,
} from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt, ethers } from "ethers";
const { deployContract } = hre.waffle;
const fs = require("fs");

describe("FlashBond Tests", function () {

  const multiplier = BigNumber.from(10).pow(BigNumber.from(18));

  let flashBondContract: FlashBond;
  let daiTokenContract: FlashToken;
  let flashTokenContract: FlashToken;

  beforeEach(async function () {
    this.signers = await hre.ethers.getSigners();

    const signers: SignerWithAddress[] = await hre.ethers.getSigners();
    this.signers.admin = signers[0];
    //console.log("Using address", this.signers.admin.address);

    //console.log("Deploying Flash V3 Token")
    const flashTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    flashTokenContract = <FlashToken>await deployContract(this.signers.admin, flashTokenArtifact);
    //console.log("Flash V3 token deployed to", flashTokenContract.address);

    //console.log("Deploying Flash V3 Token (serves as DAI)")
    const daiTokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    daiTokenContract = <FlashToken>await deployContract(this.signers.admin, daiTokenArtifact);
    //console.log("Flash V3 token deployed to", daiTokenContract.address);

    //console.log("Deploying Flash Bond Contract")
    const flashBondArtifact: Artifact = await hre.artifacts.readArtifact("FlashBond");
    flashBondContract = <FlashBond>await deployContract(this.signers.admin, flashBondArtifact, [daiTokenContract.address, flashTokenContract.address]);
    //console.log("FlashBond deployed to", flashBondContract.address);

    // Add the Minter role on the Flash token contract such that the bond contract can mint
    // keccak256("MINTER_ROLE") = 0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6
    await flashTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", flashBondContract.address);

    // Increase allowance (allow the bond contract to spend unlimited DAI on behalf of the user)
    await daiTokenContract.approve(flashBondContract.address, BigNumber.from(1000000).mul(multiplier));

    await daiTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", this.signers[0].address);
  });

  it("[single] should bond 10,000 DAI for 338211.757322175600976250 FLASH", async function () {

    const amountToBond = BigNumber.from(10000).mul(multiplier);

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, amountToBond);
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, amountToBond);

    // Get a quote
    const bondQuote = await flashBondContract.quoteBond(amountToBond);

    // Bond the specified amount of tokens
    const result = await flashBondContract.bond(amountToBond, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(fTokensMinted).to.eq(ethers.utils.parseUnits("338211.757322175600976250", 18));

    // ensure the bond receiver address now has 10,000 DAI
    const bondReceiver = await flashBondContract.getBondReceiver();
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq(amountToBond);
  });

  it("[single] should bond 100,000,000 DAI for 78953789.775346747309506050 FLASH", async function () {

    const amountToBond = BigNumber.from(100000000).mul(multiplier);

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, amountToBond);
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, amountToBond);

    // Get a quote
    const bondQuote = await flashBondContract.quoteBond(amountToBond);

    // Bond the specified amount of tokens
    const result = await flashBondContract.bond(amountToBond, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(fTokensMinted).to.eq(ethers.utils.parseUnits("78953789.775346747309506050", 18));

    // ensure the bond receiver address now has x DAI
    const bondReceiver = await flashBondContract.getBondReceiver();
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq(amountToBond);
  });

  it("[single] should bond 1,000,000,000 DAI for 80640964.501685987266265900 FLASH", async function () {

    const amountToBond = BigNumber.from(1000000000).mul(multiplier);

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, amountToBond);
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, amountToBond);

    // Get a quote
    const bondQuote = await flashBondContract.quoteBond(amountToBond);

    // Bond the specified amount of tokens
    const result = await flashBondContract.bond(amountToBond, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(fTokensMinted).to.eq(ethers.utils.parseUnits("80640964.501685987266265900", 18));

    // ensure the bond receiver address now has x DAI
    const bondReceiver = await flashBondContract.getBondReceiver();
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq(amountToBond);
  });

  it("[single] should bond 2,000 DAI for 67868.589420654773835950 FLASH", async function () {

    const amountToBond = BigNumber.from(2000).mul(multiplier);

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, amountToBond);
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, amountToBond);

    // Get a quote
    const bondQuote = await flashBondContract.quoteBond(amountToBond);

    // Bond the specified amount of tokens
    const result = await flashBondContract.bond(amountToBond, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(fTokensMinted).to.eq(ethers.utils.parseUnits("67868.589420654773835950", 18));

    // ensure the bond receiver address now has x DAI
    const bondReceiver = await flashBondContract.getBondReceiver();
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq(amountToBond);
  });

  it("[single] should change bond receiver and ensure 10,000 DAI (bonded) arrives to new address", async function () {

    const amountToBond = BigNumber.from(10000).mul(multiplier);

    await flashBondContract.setBondReceiver(this.signers[3].address);

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, amountToBond);
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, amountToBond);

    // Get a quote
    const bondQuote = await flashBondContract.quoteBond(amountToBond);

    // Bond the specified amount of tokens
    await flashBondContract.bond(amountToBond, bondQuote);

    // ensure the bond receiver address now has x DAI
    expect(await daiTokenContract.balanceOf(this.signers[3].address)).to.be.eq(amountToBond);
  });

  it("[single] should bond 1,000,000 DAI for 23915055.384615400000000000 FLASH", async function () {

    const amountToBond = BigNumber.from(1000000).mul(multiplier);

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, amountToBond);
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, amountToBond);

    // Get a quote
    const bondQuote = await flashBondContract.quoteBond(amountToBond);

    // Bond the specified amount of tokens
    const result = await flashBondContract.bond(amountToBond, bondQuote);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
    // @ts-ignore
    const fTokensMinted = args['_fTokensMinted']

    expect(fTokensMinted).to.eq(ethers.utils.parseUnits("23915055.384615384511447700", 18));

    // ensure the bond receiver address now has x DAI
    const bondReceiver = await flashBondContract.getBondReceiver();
    expect(await daiTokenContract.balanceOf(bondReceiver)).to.be.eq(amountToBond);
  });

  it("[single] should ensure slippage works as expected", async function () {

    const amountToBond = BigNumber.from(10000).mul(multiplier);

    await flashBondContract.setBondReceiver(this.signers[3].address);

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, amountToBond);
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, amountToBond);

    // Get a quote
    let bondQuote = await flashBondContract.quoteBond(amountToBond);
    bondQuote = bondQuote.add(BigNumber.from(1)); // Add additional (expect this to fail)

    // Bond the specified amount of tokens
    await expect(flashBondContract.bond(amountToBond, bondQuote)).to.be.revertedWith("OUTPUT TOO LOW");
  });

  it("TC1: should generate outputs for spreadsheet chart (10,000 DAI increments)", async function () {

    // Output array holding variables
    let totalBonded = BigNumber.from(0);

    // Initialise the output results file
    const text = "inputDAI,cumulativeDAI,outputFlashSC\n";
    fs.writeFileSync("results-10thou.csv", text)

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, BigNumber.from(100000000).mul(multiplier));
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, BigNumber.from(100000000).mul(multiplier));

    let amountToBond = BigNumber.from(10000).mul(multiplier);
    for(let i = 0; i < 500; i++) {

      // Increase the bonding amount in increments
      totalBonded = totalBonded.add(amountToBond);

      // Get a quote then bond
      const bondQuote = await flashBondContract.quoteBond(amountToBond);
      const result = await flashBondContract.bond(amountToBond, bondQuote);

      let receipt: ContractReceipt = await result.wait();
      // @ts-ignore
      const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
      // @ts-ignore
      const fTokensMinted = args['_fTokensMinted']

      // Save this info to a file
      const text = ethers.utils.formatUnits(amountToBond, 18) + "," + ethers.utils.formatUnits(totalBonded, 18) + "," + ethers.utils.formatUnits(fTokensMinted, 18) + "\n";
      fs.appendFileSync("results-10thou.csv", text);

      //console.log("total bonded so far (DAI):", ethers.utils.formatUnits(totalBonded, 18))
    }
  }).timeout(600 * 1000); // 10 minute timeout

  it("TC2: should generate outputs for spreadsheet chart (100,000 DAI increments)", async function () {

    // Output array holding variables
    let totalBonded = BigNumber.from(0);

    // Initialise the output results file
    const text = "inputDAI,cumulativeDAI,outputFlashSC\n";
    fs.writeFileSync("results-100thou.csv", text)

    // As owner of DAI, mint required DAI and approve allowance for interaction with contract
    await daiTokenContract.connect(this.signers[0]).mint(this.signers[0].address, BigNumber.from(100000000).mul(multiplier));
    await daiTokenContract.connect(this.signers[0]).approve(flashBondContract.address, BigNumber.from(100000000).mul(multiplier));

    let amountToBond = BigNumber.from(100000).mul(multiplier);
    for(let i = 0; i < 500; i++) {

      // Increase the bonding amount in increments
      totalBonded = totalBonded.add(amountToBond);

      // Get a quote then bond
      const bondQuote = await flashBondContract.quoteBond(amountToBond);
      const result = await flashBondContract.bond(amountToBond, bondQuote);

      let receipt: ContractReceipt = await result.wait();
      // @ts-ignore
      const args = (receipt.events?.filter((x) => {return x.event == "BondCreated"}))[0]['args'];
      // @ts-ignore
      const fTokensMinted = args['_fTokensMinted']

      // Save this info to a file
      const text = ethers.utils.formatUnits(amountToBond, 18) + "," + ethers.utils.formatUnits(totalBonded, 18) + "," + ethers.utils.formatUnits(fTokensMinted, 18) + "\n";
      fs.appendFileSync("results-100thou.csv", text);

      //console.log("total bonded so far (DAI):", ethers.utils.formatUnits(totalBonded, 18))
    }
  }).timeout(600 * 1000); // 10 minute timeout
});
