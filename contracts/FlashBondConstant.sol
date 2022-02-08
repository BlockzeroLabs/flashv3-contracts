// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IERC20C.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "hardhat/console.sol"; //TODO: Remove

//    ============================================================================
//    Requirements
//    ============================================================================
//    1. should mint and return 1 FLASH for every 0.017072258 DAI
//    bonded.
//
//    2. must have a whitelist which is by default enabled. This whitelist when
//    enabled will enforce allowance limits.
//
//    3. must have functionality to enforce allowance limits. The allowance limit
//    specifies a specific address and the amount of DAI they are able to bond. If
//    the user attempts to bond more DAI than the allowance, tx should fail.
//
//    4. must allow owner to specify a list of addresses and list of amounts to
//    increase each addresses allowance as per item 3 (above).
//
//    5. contract should stop minting FLASH once the maximum FLASH amount of
//    58,574,560 has been minted.
//
//    6. whenever a user creates a bond, the amount (100%) should go directly to a
//    specified address (multisig). This specified address should be editable by
//    the owner. The owner will initially be multisig.

contract FlashBondConstant is Ownable {

    using SafeMath for uint256;

    address bondRecipientAddress = 0x5089722613C2cCEe071C39C59e9889641f435F15;
    uint256 maxGlobalAllowance = 58574560 * (10**18);

    struct BondStruct {
        address receiver1;
        address receiver2;
        uint96 percentageBasisPoints1;
        uint96 percentageBasisPoints2;
    }

    BondStruct bondInformation;
    address flashTokenAddress;
    address bondTokenAddress;
    uint256 public cumulativeFlashMinted;

    bytes32 merkleRoot = 0x0;
    bool whitelistEnabled = true;
    uint96 allowanceMultiplier = 0; // 0 = disabled, 500 = 5%, 5000 = 50%, 50000 = 500%, 500000 = 5000%
    mapping(address => uint256) allowanceUsed;

    event BondCreated(address indexed _bondCreator, uint256 _tokenAmount, uint256 _fTokensMinted);

    constructor(address _bondTokenAddress, address _flashTokenAddress) public {
        flashTokenAddress = _flashTokenAddress;
        bondTokenAddress = _bondTokenAddress;
    }

    function getAvailableAllowance(uint256 _index, address _address, uint256 _initialAllowance, bytes32[] calldata _merkleProof) public virtual view returns(uint256) {

        // validate the merkle proof
        bytes32 node = keccak256(abi.encodePacked(_index, _address, _initialAllowance));
        require(MerkleProof.verify(_merkleProof, merkleRoot, node), "INVALID_PROOF");

        // calculate the total allowance for this address taking into consideration the
        // allowanceMultiplier and initialAllowance
        uint256 totalAllowance;
        if(allowanceMultiplier == 0) {
            totalAllowance = _initialAllowance;
        } else {
            // Increase the initialAllowance by a percentage
            totalAllowance = ((_initialAllowance * allowanceMultiplier) / 10000) + _initialAllowance;
        }

        uint256 availableAllowance = totalAllowance - allowanceUsed[msg.sender];

        return availableAllowance;
    }

    function bond(uint256 _tokenAmount, uint256 _index, address _address, uint256 _initialAllowance, bytes32[] calldata _merkleProof) public returns(uint256) {

        // Only check user allowances if whitelist is enabled
        if(whitelistEnabled) {
            uint256 availableAllowance = getAvailableAllowance(_index, _address, _initialAllowance, _merkleProof);
            require(availableAllowance >= _tokenAmount, "INSUFFICIENT ALLOWANCE");

            // Log how much has been bonded
            allowanceUsed[msg.sender] = allowanceUsed[msg.sender] + _tokenAmount;
        }

        // Transfer the bond token from caller to bondRecipient address
        IERC20C(bondTokenAddress).transferFrom(msg.sender, bondRecipientAddress, _tokenAmount);

        // Determine how much FLASH should be minted
        uint256 amountToMint = quoteBond(_tokenAmount);

        require(cumulativeFlashMinted + amountToMint <= maxGlobalAllowance, "EXCEEDS MAX FLASH MINTABLE");

        // Mint FLASH and return to user
        IERC20C(flashTokenAddress).mint(msg.sender, amountToMint);

        // Add the amount we minted to the cumulativeFlashMinted
        cumulativeFlashMinted = cumulativeFlashMinted + amountToMint;

        emit BondCreated(msg.sender, _tokenAmount, amountToMint);

        return amountToMint;
    }

    function quoteBond(uint256 _tokenAmount) public view virtual returns (uint256) {

        // 1 DAI = 58.57456 FLASH
        // 1 FLASH = 0.017072258 DAI
        uint256 flashMintable = (_tokenAmount * 5857456) / (10**5);

        if(flashMintable > maxGlobalAllowance) {
            flashMintable = maxGlobalAllowance;
        }

        return flashMintable;
    }

    function deactivateWhiteList() public onlyOwner {
        whitelistEnabled = false;
    }

    function isWhitelistEnabled() public view returns(bool) {
        return whitelistEnabled;
    }

    function setMerkleRoot(bytes32 _merkleRoot) public onlyOwner {
        require(merkleRoot[0] == 0, "MERKLE ROOT ALREADY SET");
        merkleRoot = _merkleRoot;
    }

    function setAllowanceMultiplier(uint96 _allowanceMultiplier) onlyOwner public {
        allowanceMultiplier = _allowanceMultiplier;
    }

    function getAllowanceMultiplier() public view returns(uint256) {
        return allowanceMultiplier;
    }
}
