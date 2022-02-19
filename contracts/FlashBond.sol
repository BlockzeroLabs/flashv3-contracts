// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IERC20C.sol";

contract FlashBond is Ownable {

    using SafeMath for uint256;

    // This will be used for both the fees and bond receiver information
    address bondReceiver = 0x5089722613C2cCEe071C39C59e9889641f435F15;

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
    }

    function bond(uint256 _tokenAmount, uint256 _minimumOutput) public returns(uint256) {

        // Send the tokens to the bond tokens receiver
        IERC20C(bondTokenAddress).transferFrom(msg.sender, bondReceiver, _tokenAmount);

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
        uint256 precision = (10**18);
        uint256 b = 1380000 * precision;        // Curve constant
        uint256 k = 46469150 * precision;       // Starting supply of Flash for bond curve
        uint256 z = 185876600 * precision;      // Maximum supply of Flash as per bond curve
        uint256 v = _tokenAmount + cumulativeDaiBonded;

        uint256 currentSupply = k + cumulativeFlashMinted;

        return (((v*precision)/(v+b))*(z-k)/precision+k)-(currentSupply);
    }

    function setBondReceiver(address _receiver) public onlyOwner {
        bondReceiver = _receiver;
    }

    function getBondReceiver() public view returns (address) {
        return bondReceiver;
    }
}
