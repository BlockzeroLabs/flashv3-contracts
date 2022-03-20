import hre from "hardhat";
import {
  FlashToken,
} from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt } from "ethers";

const { deployContract } = hre.waffle;

describe("Flash Token Tests", function() {
  let flashTokenContract: FlashToken;
  const multiplier = BigNumber.from(10).pow(18);

  before(async function() {
    this.signers = await hre.ethers.getSigners();

    // Deploy the Flash Token Contract
    const tokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    flashTokenContract = <FlashToken>await deployContract(this.signers[0], tokenArtifact);

    // Grant minter role to address 0
    await flashTokenContract.grantRole("0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6", this.signers[0].address);
  })

  it("should mint 10,000 as owner", async function () {
    let result = await flashTokenContract.connect(this.signers[0]).mint(this.signers[1].address, BigNumber.from(10000).mul(multiplier));

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "Transfer"}))[0]['args'];
    // @ts-ignore

    const value = args["value"];

    expect(value).to.be.eq(BigNumber.from(10000).mul(multiplier));
  });

  it("should fail minting as non owner", async function () {
    await expect(
      flashTokenContract.connect(this.signers[1]).mint(this.signers[1].address, BigNumber.from(10000).mul(multiplier)),
    ).to.be.reverted;
  });

  it("should burn tokens", async function () {
    expect(
      await flashTokenContract.connect(this.signers[0]).burn(BigNumber.from(10000).mul(multiplier)),
    ).to.be.ok
  });
});
