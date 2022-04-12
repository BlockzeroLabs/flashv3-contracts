// SPDX-License-Identifier: MIT
pragma solidity >=0.8.4;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./interfaces/IERC20C.sol";
import "./interfaces/IFlashStrategy.sol";

contract FlashIncentives {
    struct GrantStruct {
        address grantOwner;
        address strategyAddress;
        address tokenAddress;
        uint256 grantAmount;
        uint256 ratio;
        uint256 expiryTimestamp;
        uint256 uploadTimestamp;
        bool active;
        uint256 totalClaimed;
    }
    mapping(uint256 => GrantStruct) public grants;
    mapping(address => mapping(address => uint256)) public strategyFERC20Claimed;
    uint256 grantCount;

    event GrantDeposited(
        uint256 _grantId,
        address _strategyAddress,
        address _tokenAddress,
        uint256 _grantAmount,
        uint256 ratio,
        uint256 _expiry
    );
    event GrantWithdrawn(uint256 _grantId, uint256 _totalClaimed, uint256 _totalWithdrawn);
    event GrantClaimed(uint256 _grantId, address _strategyAddress, address _tokenAddress, uint256 _tokenAmount);

    constructor() {}

    function depositGrant(
        address _strategyAddress,
        address _tokenAddress,
        uint256 _grantAmount,
        uint256 _ratio,
        uint256 _expiryTimestamp
    ) public returns (uint256) {
        require(_expiryTimestamp > block.timestamp + 7257600, "GRANT EXPIRY MUST BE > 3 MONTHS");

        // Transfer the tokens from the user to this contract
        IERC20C(_tokenAddress).transferFrom(msg.sender, address(this), _grantAmount);

        // Save this grant
        grantCount = grantCount + 1;
        grants[grantCount].grantOwner = msg.sender;
        grants[grantCount].strategyAddress = _strategyAddress;
        grants[grantCount].tokenAddress = _tokenAddress;
        grants[grantCount].grantAmount = _grantAmount;
        grants[grantCount].ratio = _ratio;
        grants[grantCount].expiryTimestamp = _expiryTimestamp;
        grants[grantCount].active = true;

        emit GrantDeposited(grantCount, _strategyAddress, _tokenAddress, _grantAmount, _ratio, _expiryTimestamp);

        return grantCount;
    }

    function withdrawGrants(uint256[] memory _grantIds) public {
        for (uint256 i = 0; i < _grantIds.length; i++) {
            GrantStruct storage grant = grants[_grantIds[i]];

            require(grant.grantOwner == msg.sender, "NOT GRANT OWNER");
            require(block.timestamp + 7257600 >= grant.expiryTimestamp, "MINIMUM WITHDRAWAL TIME IS 3 MONTHS");

            // Withdraw the tokens
            uint256 tokensToReturn = grant.grantAmount - grant.totalClaimed;
            IERC20C(grant.tokenAddress).transfer(msg.sender, tokensToReturn);

            // Update the grant
            grant.active = false;

            emit GrantWithdrawn(_grantIds[i], grant.totalClaimed, tokensToReturn);
        }
    }

    function claimGrants(uint256[] memory _grantIds) public {
        for (uint256 i = 0; i < _grantIds.length; i++) {
            GrantStruct storage grant = grants[_grantIds[i]];

            // ensure the grant is active
            require(grant.active, "GRANT IS NOT ACTIVE");

            uint256 fERC20Burned = getFERC20EligibleAmount(msg.sender, _grantIds[i]);

            uint256 grantPayable = (fERC20Burned * grant.ratio) / (10**18);
            IERC20C(grant.tokenAddress).transfer(msg.sender, grantPayable);

            grant.totalClaimed = grant.totalClaimed + grantPayable;

            // Update how many fERC20 tokens burned have been claimed
            strategyFERC20Claimed[grant.strategyAddress][msg.sender] += fERC20Burned;

            emit GrantClaimed(_grantIds[i], grant.strategyAddress, grant.tokenAddress, grantPayable);
        }
    }

    function getFERC20EligibleAmount(address _address, uint256 _grantId) public view returns (uint256) {
        require(grants[_grantId].active, "GRANT IS NOT ACTIVE");

        // Determine how many fERC20 tokens have been burned for the strategy
        uint256 fERC20TotalBurned = IFlashStrategy(grants[_grantId].strategyAddress).getTotalFTokenBurned(_address);

        // Determine for this strategy, how many fERC20 burned were claimed
        uint256 fERC20Burned = strategyFERC20Claimed[grants[_grantId].strategyAddress][_address];

        // Now we deduct the amount the user claimed against the total fERC20 burned
        return fERC20TotalBurned - fERC20Burned;
    }

    // This will allow the withdrawal and deposit of a given grant within the same transaction
    function replaceGrant(
        uint256 _grantId,
        uint256 _grantAmount,
        uint256 _newRatio,
        uint256 _newExpiryTimestamp
    ) public {
        // Withdraw previous grant
        withdrawGrants([_grantId]);
        return
            depositGrant(
                grants[_grantId].strategyAddress,
                grants[_grantId].tokenAddress,
                _grantAmount,
                _newRatio,
                _newExpiryTimestamp
            );
    }
}
