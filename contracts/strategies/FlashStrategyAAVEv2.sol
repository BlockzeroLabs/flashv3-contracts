// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../interfaces/IERC20C.sol";
import "../interfaces/AAVE/ILendingPool.sol";
import "../interfaces/IFlashStrategy.sol";

contract FlashStrategyAAVEv2 is IFlashStrategy, Ownable {
    using SafeMath for uint256;

    address flashProtocolAddress;
    address fTokenAddress; // The Flash fERC20 token address
    address lendingPoolAddress; // The AAVE V2 lending pool address
    address principalTokenAddress; // The Principal token address (eg DAI)
    address interestBearingTokenAddress; // The AAVE V2 interest bearing token address
    uint16 referralCode = 0; // The AAVE V2 referral code
    uint256 principalBalance; // The amount of principal in this strategy

    event BurnedFToken(address indexed _address, uint256 _tokenAmount, uint256 _yieldReturned);
    event RewardClaimed(address _rewardToken, address indexed _address);

    mapping(address => uint256) public fTokensBurned;

    // User incentive reward related
    uint256 public rewardTokenBalance;
    address public rewardTokenAddress;
    uint256 public rewardLockoutTs;
    uint256 public rewardRatio;
    uint256 rewardLockoutConstant = 7257600; // 84 days in seconds

    constructor(
        address _lendingPoolAddress,
        address _principalTokenAddress,
        address _interestBearingTokenAddress,
        address _flashProtocolAddress
    ) public {
        lendingPoolAddress = _lendingPoolAddress;
        principalTokenAddress = _principalTokenAddress;
        interestBearingTokenAddress = _interestBearingTokenAddress;
        flashProtocolAddress = _flashProtocolAddress;

        increaseAllowance();
    }

    // Implemented as a separate function just in case the strategy ever runs out of allowance
    function increaseAllowance() public {
        IERC20C(principalTokenAddress).approve(lendingPoolAddress, 2**256 - 1);
    }

    function depositPrincipal(uint256 _tokenAmount) public onlyFlashProtocol returns (uint256) {
        // Register how much we are depositing
        principalBalance = principalBalance + _tokenAmount;

        // Deposit into AAVE
        ILendingPool(lendingPoolAddress).deposit(principalTokenAddress, _tokenAmount, address(this), referralCode);

        return _tokenAmount;
    }

    function withdrawYield(uint256 _tokenAmount) private {
        // Withdraw from AAVE
        ILendingPool(lendingPoolAddress).withdraw(principalTokenAddress, _tokenAmount, address(this));

        uint256 aTokenBalance = IERC20C(interestBearingTokenAddress).balanceOf(address(this));
        require(aTokenBalance >= getPrincipalBalance(), "PRINCIPAL BALANCE INVALID");
    }

    function withdrawPrincipal(uint256 _tokenAmount) public onlyFlashProtocol {
        // Withdraw from AAVE
        ILendingPool(lendingPoolAddress).withdraw(principalTokenAddress, _tokenAmount, address(this));

        IERC20C(principalTokenAddress).transfer(msg.sender, _tokenAmount);

        principalBalance = principalBalance - _tokenAmount;
    }

    function withdrawERC20(address[] memory _tokenAddresses, uint256[] memory _tokenAmounts) public onlyOwner {
        require(_tokenAddresses.length == _tokenAmounts.length, "ARRAY SIZE MISMATCH");

        for (uint256 i = 0; i < _tokenAddresses.length; i++) {
            // Ensure the token being withdrawn is not the interest bearing token
            require(_tokenAddresses[i] != interestBearingTokenAddress, "TOKEN ADDRESS PROHIBITED");
            require(_tokenAddresses[i] != rewardTokenAddress, "TOKEN ADDRESS PROHIBITED");

            // Transfer the token to the caller
            IERC20C(_tokenAddresses[i]).transfer(msg.sender, _tokenAmounts[i]);
        }
    }

    function getPrincipalBalance() public view returns (uint256) {
        return principalBalance;
    }

    function getYieldBalance() public view returns (uint256) {
        uint256 interestBearingTokenBalance = IERC20C(interestBearingTokenAddress).balanceOf(address(this));
        uint256 principalBootstrapBalance = IERC20C(principalTokenAddress).balanceOf(address(this));

        return (interestBearingTokenBalance - getPrincipalBalance()) + principalBootstrapBalance;
    }

    function getPrincipalAddress() public view returns (address) {
        return principalTokenAddress;
    }

    function getFTokenAddress() public view returns (address) {
        return fTokenAddress;
    }

    function setFTokenAddress(address _fTokenAddress) public onlyFlashProtocol {
        require(fTokenAddress == address(0), "FTOKEN ADDRESS ALREADY SET");
        fTokenAddress = _fTokenAddress;
    }

    function quoteMintFToken(uint256 _tokenAmount, uint256 _duration) public view returns (uint256) {
        // Enforce minimum _duration
        require(_duration >= 60, "DURATION TOO LOW");

        // 1 ERC20 for 365 DAYS = 1 fERC20
        // 1 second = 0.000000031709792000
        // eg (100000000000000000 * (1 second * 31709792000)) / 10**18
        uint256 amountToMint = (_tokenAmount * (_duration * 31709792000)) / 10**18;

        return amountToMint;
    }

    function quoteBurnFToken(uint256 _tokenAmount) public view returns (uint256) {
        uint256 totalSupply = IERC20C(fTokenAddress).totalSupply();
        require(totalSupply > 0, "INSUFFICIENT fERC20 TOKEN SUPPLY");

        uint256 totalYield = getYieldBalance();

        // Calculate the percentage of _tokenAmount vs totalSupply provided
        // and multiply by total yield
        return (totalYield * ((_tokenAmount * _tokenAmount) / totalSupply)) / _tokenAmount;
    }

    function burnFToken(uint256 _tokenAmount, uint256 _minimumReturned) external returns (uint256) {
        // Calculate how much yield to give back
        uint256 tokensOwed = quoteBurnFToken(_tokenAmount);
        require(tokensOwed >= _minimumReturned, "INSUFFICIENT OUTPUT");

        // Transfer fERC20 (from caller) tokens to contract so we can burn them
        IERC20C(fTokenAddress).burnFrom(msg.sender, _tokenAmount);

        // Update the total
        fTokensBurned[msg.sender] += _tokenAmount;

        // Can we pay all of this yield via the bootstrapped tokens
        uint256 bootstrapBalance = IERC20C(principalTokenAddress).balanceOf(address(this));
        if (bootstrapBalance >= tokensOwed) {
            IERC20C(principalTokenAddress).transfer(msg.sender, tokensOwed);
        } else {
            uint256 amountToWithdraw = remainderSubtract(tokensOwed, bootstrapBalance);
            uint256 bootstrapPayment = tokensOwed - amountToWithdraw;

            withdrawYield(amountToWithdraw);
            IERC20C(principalTokenAddress).transfer(msg.sender, (amountToWithdraw + bootstrapPayment));
        }

        // Distribute rewards if there is a reward balance within contract
        if (rewardTokenBalance > 0) {
            claimReward(_tokenAmount);
        }

        emit BurnedFToken(msg.sender, _tokenAmount, tokensOwed);

        return tokensOwed;
    }

    function remainderSubtract(uint256 a, uint256 b) public pure returns (uint256 remainder) {
        if (b > a) return 0;
        return a - b;
    }

    modifier onlyFlashProtocol() {
        require(msg.sender == flashProtocolAddress || msg.sender == address(this), "NOT FLASH PROTOCOL");
        _;
    }

    function getMaxStakeDuration() public view returns (uint256) {
        return 63072000; // Static 720 days (2 years)
    }

    function depositReward(
        address _rewardTokenAddress,
        uint256 _tokenAmount,
        uint256 _ratio
    ) public onlyOwner {
        require(block.timestamp > rewardLockoutTs, "LOCKOUT IN FORCE");

        // Withdraw any reward tokens currently in contract and deposit new tokens
        if (rewardTokenBalance > 0) {
            IERC20C(rewardTokenAddress).transfer(msg.sender, rewardTokenBalance);
        }
        IERC20C(_rewardTokenAddress).transferFrom(msg.sender, address(this), _tokenAmount);

        // Set Ratio and update lockout
        rewardRatio = _ratio;
        rewardLockoutTs = block.timestamp + rewardLockoutConstant;
        rewardTokenBalance = _tokenAmount;
        rewardTokenAddress = _rewardTokenAddress;
    }

    function addRewardTokens(uint256 _tokenAmount) public onlyOwner {
        IERC20C(rewardTokenAddress).transferFrom(msg.sender, address(this), _tokenAmount);
        rewardLockoutTs = block.timestamp + rewardLockoutConstant;

        // Renew the lockout period
        rewardTokenBalance = rewardTokenBalance + _tokenAmount;
    }

    function setRewardRatio(uint256 _ratio) public onlyOwner {
        // Ensure this can only be called whilst lockout is active
        require(rewardLockoutTs > block.timestamp, "LOCKOUT NOT IN FORCE");

        // Ensure the ratio can only be increased
        require(_ratio > rewardRatio, "RATIO CAN ONLY BE INCREASED");

        rewardRatio = _ratio;
    }

    function quoteReward(uint256 _fERC20Burned) public view returns (uint256) {
        uint256 rewardAmount = (_fERC20Burned * rewardRatio) / (10**18);

        // If the reward amount is greater than balance, transfer entire balance
        if (rewardAmount > rewardTokenBalance) {
            rewardAmount = rewardTokenBalance;
        }

        return rewardAmount;
    }

    function claimReward(uint256 _fERC20Burned) internal {
        uint256 rewardAmount = quoteReward(_fERC20Burned);

        // Transfer and update balance locally
        IERC20C(rewardTokenAddress).transfer(msg.sender, rewardAmount);
        rewardTokenBalance = rewardTokenBalance - rewardAmount;

        emit RewardClaimed(rewardTokenAddress, msg.sender);
    }
}
