import hre from "hardhat";
import {
  FlashNFT,
} from "../../typechain";
import { Artifact } from "hardhat/types";
import { expect } from "chai";
import { BigNumber, ContractReceipt } from "ethers";

const { deployContract } = hre.waffle;

describe("Flash NFT Token Tests", function() {
  let flashNFTContract: FlashNFT;

  before(async function() {
    this.signers = await hre.ethers.getSigners();

    // Deploy the NFT Contract
    const nftArtifact: Artifact = await hre.artifacts.readArtifact("FlashNFT");
    flashNFTContract = <FlashNFT>await deployContract(this.signers[0], nftArtifact);
  })

  it("should mint as owner and ensure NFT ID started from 0", async function () {
    let result = await flashNFTContract.connect(this.signers[0]).mint(this.signers[1].address);

    let receipt: ContractReceipt = await result.wait();
    // @ts-ignore
    const args = (receipt.events?.filter((x) => {return x.event == "Transfer"}))[0]['args'];
    // @ts-ignore

    const tokenId = args["tokenId"];

    expect(tokenId).to.be.eq(BigNumber.from(0));
  });

  it("should fail minting NFT as non owner", async function () {
    await expect(
      flashNFTContract.connect(this.signers[1]).mint(this.signers[1].address),
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should fail burning NFT as non owner", async function () {
    await expect(
      flashNFTContract.connect(this.signers[1]).burn(0),
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("should burn NFT as owner", async function () {
    expect(
      await flashNFTContract.connect(this.signers[0]).burn(0),
    ).to.be.ok
  });
});
