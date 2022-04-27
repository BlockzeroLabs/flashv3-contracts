import hre from "hardhat";
import { FlashToken } from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber } from "ethers";

const { deployContract } = hre.waffle;

describe("Flash Token Tests", function () {
  let flashTokenContract: FlashToken;
  const multiplier = BigNumber.from(10).pow(18);

  before(async function () {
    this.signers = await hre.ethers.getSigners();

    // Deploy the Flash Token Contract
    const tokenArtifact: Artifact = await hre.artifacts.readArtifact("FlashToken");
    flashTokenContract = <FlashToken>await deployContract(this.signers[0], tokenArtifact);
  });

  it("should burn tokens", async function () {
    expect(await flashTokenContract.connect(this.signers[0]).burn(BigNumber.from(10000).mul(multiplier))).to.be.ok;
  });
});
