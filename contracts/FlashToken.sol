// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract FlashToken is ERC20, ERC20Burnable {
    constructor() ERC20("Flashstake", "FLASH") {
        _mint(msg.sender, 46469150 * 10**decimals());
    }
}
