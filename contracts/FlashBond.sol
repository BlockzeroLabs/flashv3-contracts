// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IERC20C.sol";
import "hardhat/console.sol"; //TODO: Remove

//    ============================================================================
//    Requirements
//    ============================================================================
//    1. should mint FLASH according to the formula provided by Alex
//      https://docs.google.com/spreadsheets/d/1eqtMfTvTOqP2K3EHm_NMoFJBy70vGDEMfOok0UZ15t8/edit#gid=602172985
//
//    2. contract can start being used from day 0
//
//    3. must allow owner to update where the bonded DAI goes - maximum two
//    addresses.
//          -> This means the owner can update: 2 addresses, 2 percentages
//
//    4. must allow slippage when bonding to ensure a minimum amount of FLASH is
//    obtained.

contract FlashBond is Ownable {

    using SafeMath for uint256;

    // This will be used for both the fees and bond receiver information
    struct BondInformation {
        address receiver1;
        address receiver2;
        uint96 percentageBasisPointsReceiver1;
    }
    BondInformation bondInformation;

    // Store the flash and bond token addresses
    address flashTokenAddress;
    address bondTokenAddress;

    // Keep a running total of Flash minted and DAI bonded
    uint256 cumulativeFlashMinted = 58574560 * (10**18);
    uint256 cumulativeDaiBonded = 1000000 * (10**18);

    event BondCreated(address indexed _bondCreator, uint256 _tokenAmount, uint256 _fTokensMinted);

    constructor(address _bondTokenAddress, address _flashTokenAddress) public {
        flashTokenAddress = _flashTokenAddress;
        bondTokenAddress = _bondTokenAddress;

        // Set some defaults for bonds
        bondInformation.receiver1 = 0x5089722613C2cCEe071C39C59e9889641f435F15;
        bondInformation.receiver2 = 0x5089722613C2cCEe071C39C59e9889641f435F15;
        bondInformation.percentageBasisPoints1 = 10000;
        bondInformation.percentageBasisPoints2 = 0;
    }

    function bond(uint256 _tokenAmount, uint256 _minimumOutput) public returns(uint256) {

        // Calculate the percentage to send to the first bond receiver
        uint256 receiver1Tokens = (_tokenAmount * (10000-bondInformation.percentageBasisPoints1)) / 10000;
        uint256 receiver2Tokens = _tokenAmount - receiver1Tokens;

        // Send the tokens to the one (or two) bond tokens receivers
        IERC20C(bondTokenAddress).transferFrom(msg.sender, bondInformation.receiver1, receiver1Tokens);
        if(receiver2Tokens > 0) {
            IERC20C(bondTokenAddress).transferFrom(msg.sender, bondInformation.receiver2, receiver2Tokens);
        }

        // Determine how much FLASH should be minted
        uint256 amountToMint = quoteBond(_tokenAmount);
        require(amountToMint >= _minimumOutput, "OUTPUT TOO LOW");

        // Mint FLASH and return to user
        IERC20C(flashTokenAddress).mint(msg.sender, amountToMint);

        // Increment counters
        cumulativeDaiBonded = cumulativeDaiBonded + _tokenAmount;
        cumulativeFlashMinted = cumulativeFlashMinted + amountToMint;

        emit BondCreated(msg.sender, _tokenAmount, amountToMint);

        return amountToMint;
    }

    function quoteBond(uint256 _tokenAmount) public view virtual returns (uint256) {
        // Left expanded for clarity - will get compiled down with optimization

        uint256 precision = (10**18);
        uint256 b = 1380000 * precision;        // Curve constant
        uint256 k = 46469150 * precision;       // Starting supply of Flash for bond curve
        uint256 z = 185876600 * precision;      // Maximum supply of Flash as per bond curve
        uint256 v = _tokenAmount + cumulativeDaiBonded;

        uint256 currentSupply = k + cumulativeFlashMinted;

        return (((v*precision)/(v+b))*(z-k)/precision+k)-(currentSupply);
    }

    // This sets the fees for whenever fERC20 tokens are minted
    function setBondReceivers(address[] memory _receivers, uint96[] memory _percentageBasisPoints) public onlyOwner {
        require(_receivers.length == _percentageBasisPoints.length, "ARRAY SIZE MISMATCH");
        require(_receivers.length == 2, "RECIPIENT MAX IS 2");
        require(_percentageBasisPoints[0] + _percentageBasisPoints[1] == 10000, "PERCENTAGE MISMATCH");

        bondInformation.receiver1 = _receivers[0];
        bondInformation.receiver2 = _receivers[1];
        bondInformation.percentageBasisPoints1 = _percentageBasisPoints[0];
        bondInformation.percentageBasisPoints2 = _percentageBasisPoints[1];
    }

    function getBondReceivers() public view returns (BondInformation memory) {
        return bondInformation;
    }
}
