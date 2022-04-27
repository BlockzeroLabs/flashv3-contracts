// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IERC20C.sol";

contract FlashBack is Ownable {
    using SafeMath for uint256;

    address stakingTokenAddress;

    constructor(address _stakingTokenAddress) public {
        stakingTokenAddress = _stakingTokenAddress;
    }

    function stakeTokens(uint256 _amount, uint256 _duration) public returns (uint256) {
        // Ensure duration is < contract life
        // Ensure duration is > minimum stake duration
        // Ensure duration is < 1 year
        // Transfer tokens from user into contract
        // Calculate the reward user will get after duration ends
        // Store info
    }

    function unstake(uint256 _stakeId) public returns (uint256) {
        // Determine if the stake exists
        // Determine whether stake ended or user is unstaking early
        // Transfer back originally staked tokens and reward (if duration ended)
    }

    function calculateAPY(uint256 _duration) public view returns (uint256) {
        // Each second staked increases APY by 0.0000031712962963
        return _duration * 317129629629;
    }
}
