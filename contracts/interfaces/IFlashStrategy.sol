// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

interface IFlashStrategy {

    // This is how principal will be deposited into the contract
    function depositPrincipal(uint256 _tokenAmount) external;

    // This is how principal will be returned from the contract
    function withdrawPrincipal(uint256 _tokenAmount) external;

    // Responsible for instant upfront yield. Takes fERC20 tokens specific to this
    // strategy. The strategy is responsible for returning some amount of principal tokens
    function burnFToken(uint256 _tokenAmount, uint256 _minimumReturned) external returns (uint256);

    // This should return the current total of all principal within the contract
    function getPrincipalBalance() external view returns (uint256);

    // This should return the current total of all yield generated to date (including bootstrapped tokens)
    function getYieldBalance() external view returns (uint256);

    // This should return the current APY for this strategy - used for display purposes
    function getAPY() external view returns (uint256);

    // This should return the principal token address (eg DAI)
    function getPrincipalAddress() external view returns (address);

    // View function which quotes how many principal tokens would be returned if x
    // fERC20 tokens are burned
    function quoteMintFToken(uint256 _tokenAmount, uint256 duration) external view returns (uint256);

    // View function which quotes how many principal tokens would be returned if x
    // fERC20 tokens are burned
    // IMPORTANT NOTE: This should utilise bootstrap tokens if they exist
    // bootstrapped tokens are any principal tokens that exist within the smart contract
    function quoteBurnFToken(uint256 _tokenAmount) external view returns (uint256);
}
