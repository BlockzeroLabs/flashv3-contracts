// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IERC20C.sol";

//    ============================================================================
//    Requirements
//    ============================================================================
//    1. should mint and return 1 FLASH for every 0.01702898551 DAI
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
//    104,723,404.2553 has been minted.
//
//    6. whenever a user creates a bond, the amount (100%) should go directly to a
//    specified address (multisig). This specified address should be editable by
//    the owner. The owner will initially be multisig.

contract FlashBondConstant is Ownable {

    using SafeMath for uint256;

    address bondRecipientAddress = 0x5089722613C2cCEe071C39C59e9889641f435F15;
    uint256 maxFlashMintable = 104723404255300000000000000;

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
    mapping(address => uint256) public whitelistAllowances;
    bool whitelistEnabled = true;

    event BondCreated(address indexed _bondCreator, uint256 _tokenAmount, uint256 _fTokensMinted);

    constructor(address _bondTokenAddress, address _flashTokenAddress) public {
        flashTokenAddress = _flashTokenAddress;
        bondTokenAddress = _bondTokenAddress;
    }

    function bond(uint256 _tokenAmount, uint256 _minimumReceived) public returns(uint256) {

        // Send the provided DAI to the bond recipient
        IERC20C(bondTokenAddress).transferFrom(msg.sender, bondRecipientAddress, _tokenAmount);

        // Determine how much FLASH should be minted
        uint256 amountToMint = quoteBond(_tokenAmount);
        require(amountToMint >= _minimumReceived, "OUTPUT TOO LOW");

        if(whitelistEnabled) {
            // Ensure the user is not bonding more than their allowance
            require(whitelistAllowances[msg.sender] > _tokenAmount, "INSUFFICIENT ALLOWANCE");
            // Decrease the users whitelistAllowances
            whitelistAllowances[msg.sender] = whitelistAllowances[msg.sender] - _tokenAmount;
        }

        require(cumulativeFlashMinted + amountToMint <= maxFlashMintable, "EXCEEDS MAX FLASH MINTABLE");

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
        return (_tokenAmount * 5857456) / (10**5);
    }

    function increaseAllowances(address[] memory _addresses, uint256[] memory _amounts) public onlyOwner {
        require(_addresses.length == _amounts.length, "ARRAY SIZE MISMATCH");

        for(uint i = 0; i < _addresses.length; i++) {
            whitelistAllowances[_addresses[i]] = whitelistAllowances[_addresses[i]] + _amounts[i];
        }
    }

    function deactivateWhiteList() public onlyOwner {
        whitelistEnabled = false;
    }
}
