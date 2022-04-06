// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./FlashFToken.sol";
import "./interfaces/IFlashStrategy.sol";
import "./FlashNFT.sol";
import "./interfaces/IERC20C.sol";

contract FlashStakeV3 is Ownable {
    using SafeMath for uint256;

    // This will store the NFT contract address which will be used to represent Stakes
    address public flashNFTAddress;

    // Define the structure for each strategy
    struct StrategyInformation {
        address fTokenAddress;
        address principalTokenAddress;
    }
    mapping(address => StrategyInformation) public strategies;

    // This will store the NFT ID to StakeID mapping
    mapping(uint256 => uint256) public nftIdMappingsToStakeIds;

    // This will store how many stakes we have
    uint256 public stakeCount = 0;

    // The global fToken mint fee
    uint96 public globalMintFee = 0;
    address public globalMintFeeRecipient = 0x5089722613C2cCEe071C39C59e9889641f435F15;

    // This defines the structure of the Stake information we store
    struct StakeStruct {
        address stakerAddress; // Address of staker
        address strategyAddress; // Address of strategy being used
        uint256 stakeStartTs; // Unix timestamp of when stake started
        uint256 stakeDuration; // Time in seconds from start time until stake ends
        uint256 stakedAmount; // The amount of tokens staked
        bool active; // Stake has been removed/unstaked
        uint256 nftId; // NFT id if set
        uint256 fTokensToUser; // How many fERC20 tokens were minted
        uint256 fTokensFee; // How many fERC20 tokens were taken as fee
    }
    mapping(uint256 => StakeStruct) public stakes;

    // Define events
    event StrategyRegistered(
        address indexed _strategyAddress,
        address indexed _principalTokenAddress,
        address indexed _fTokenAddress
    );
    event Staked(
        address indexed _staker,
        address indexed _strategyAddress,
        uint256 _tokenAmount,
        uint256 _fTokenMinted,
        uint256 _fTokenFee,
        uint256 _stakeId,
        bool _nftIssued,
        uint256 _nftId
    );
    event Unstaked(
        address indexed _strategyAddress,
        bool _isNFT,
        uint256 _stakeId,
        bool _unstakedEarly,
        uint256 _tokensReturned,
        uint256 _fTokensBurned
    );
    event NFTIssued(uint256 _stakeId, uint256 nftId);
    event NFTRedeemed(uint256 _stakeId, uint256 nftId);

    constructor(address _flashNFTAddress) public {
        flashNFTAddress = _flashNFTAddress;
    }

    function getFlashNFTAddress() public view returns (address) {
        return flashNFTAddress;
    }

    function registerStrategy(
        address _strategyAddress,
        address _principalTokenAddress,
        string memory _fTokenName,
        string memory _fTokenSymbol
    ) public returns (StrategyInformation memory) {
        require(strategies[_strategyAddress].principalTokenAddress == address(0), "STRATEGY ALREADY REGISTERED");

        FlashFToken flashFToken = new FlashFToken(_fTokenName, _fTokenSymbol);

        // Store the appropriate information
        strategies[_strategyAddress].fTokenAddress = address(flashFToken);
        strategies[_strategyAddress].principalTokenAddress = _principalTokenAddress;

        IFlashStrategy(_strategyAddress).setFTokenAddress(address(flashFToken));

        emit StrategyRegistered(_strategyAddress, _principalTokenAddress, address(flashFToken));

        return strategies[_strategyAddress];
    }

    function stake(
        address _strategyAddress,
        uint256 _tokenAmount,
        uint256 _stakeDuration,
        bool _issueNFT
    ) public returns (StakeStruct memory) {
        require(strategies[_strategyAddress].principalTokenAddress != address(0), "UNREGISTERED STRATEGY");

        require(_stakeDuration >= 60, "MINIMUM STAKE DURATION IS 60 SECONDS");
        require(_stakeDuration <= IFlashStrategy(_strategyAddress).getMaxStakeDuration(), "EXCEEDS MAX STAKE DURATION");

        // Transfer the tokens from caller to the strategy contract
        IERC20C(strategies[_strategyAddress].principalTokenAddress).transferFrom(
            msg.sender,
            address(_strategyAddress),
            _tokenAmount
        );

        // Determine how many fERC20 tokens to mint (ask strategy)
        uint256 tokensToMint = IFlashStrategy(_strategyAddress).quoteMintFToken(_tokenAmount, _stakeDuration);

        // Deposit into the strategy
        uint256 principalAfterDeductions = IFlashStrategy(_strategyAddress).depositPrincipal(_tokenAmount);

        // Calculate fee and if this is more than 0, transfer fee
        uint256 fee = (tokensToMint * globalMintFee) / 10000;
        if (fee > 0) {
            FlashFToken(strategies[_strategyAddress].fTokenAddress).mint(globalMintFeeRecipient, fee);
        }

        // Mint fERC20 tokens to the user
        FlashFToken(strategies[_strategyAddress].fTokenAddress).mint(msg.sender, (tokensToMint - fee));

        // Save the stake details
        stakeCount = stakeCount + 1;
        uint256 stakeId = stakeCount;
        stakes[stakeId].stakerAddress = msg.sender;
        stakes[stakeId].strategyAddress = _strategyAddress;
        stakes[stakeId].stakeStartTs = block.timestamp;
        stakes[stakeId].stakeDuration = _stakeDuration;
        stakes[stakeId].stakedAmount = principalAfterDeductions;
        stakes[stakeId].fTokensToUser = (tokensToMint - fee);
        stakes[stakeId].fTokensFee = fee;
        stakes[stakeId].active = true;

        // Mint NFT if requested
        if (_issueNFT) {
            issueNFT(stakeId);
        }

        emit Staked(
            msg.sender,
            _strategyAddress,
            principalAfterDeductions,
            (tokensToMint - fee),
            fee,
            stakeId,
            _issueNFT,
            stakes[stakeId].nftId
        );

        return stakes[stakeId];
    }

    function unstake(uint256 _id, bool _isNFT) public {
        uint256 stakeId;
        address returnAddress;
        if (_isNFT) {
            stakeId = nftIdMappingsToStakeIds[_id];
            returnAddress = msg.sender;
            require(stakes[stakeId].nftId == _id, "NFT FOR STAKE NON-EXISTENT");
            require(FlashNFT(flashNFTAddress).ownerOf(_id) == msg.sender, "NOT OWNER OF NFT");

            // Burn the NFT
            FlashNFT(flashNFTAddress).burn(_id);
            emit NFTRedeemed(stakeId, _id);
        } else {
            stakeId = _id;
            returnAddress = stakes[stakeId].stakerAddress;

            require(stakes[stakeId].nftId == 0, "NFT TOKEN REQUIRED");
            require(stakes[stakeId].stakerAddress == msg.sender, "NOT OWNER OF STAKE");
        }

        require(stakes[stakeId].active == true, "STAKE NON-EXISTENT");
        require(block.timestamp > (stakes[stakeId].stakeStartTs + stakes[stakeId].stakeDuration), "STAKE NOT EXPIRED");

        // Remove tokens from Strategy
        IFlashStrategy(stakes[stakeId].strategyAddress).withdrawPrincipal(stakes[stakeId].stakedAmount);

        // Transfer tokens back to user
        IERC20C(strategies[stakes[stakeId].strategyAddress].principalTokenAddress).transfer(
            returnAddress,
            stakes[stakeId].stakedAmount
        );

        // Mark stake as inactive
        stakes[stakeId].active = false;

        emit Unstaked(stakes[stakeId].strategyAddress, _isNFT, _id, false, stakes[stakeId].stakedAmount, 0);
    }

    function issueNFT(uint256 _stakeId) public returns (uint256) {
        require(stakes[_stakeId].active == true, "STAKE NON-EXISTENT");
        require(stakes[_stakeId].nftId == 0, "NFT FOR STAKE ALREADY EXISTS");
        require(stakes[_stakeId].stakerAddress == msg.sender, "NOT OWNER OF STAKE");

        // Mint the NFT
        uint256 nftId = FlashNFT(flashNFTAddress).mint(msg.sender);

        // Store the NFT ID
        stakes[stakeCount].nftId = nftId;

        // Update the NFT Mapping so we can look it up later
        nftIdMappingsToStakeIds[nftId] = _stakeId;

        emit NFTIssued(_stakeId, nftId);

        return nftId;
    }

    function setMintFees(address _feeRecipient, uint96 _feePercentageBasis) public onlyOwner {
        require(_feePercentageBasis <= 2000, "MINT FEE TOO HIGH");
        globalMintFeeRecipient = _feeRecipient;
        globalMintFee = _feePercentageBasis;
    }

    function unstakeEarly(uint256 _id, bool _isNFT) public {
        uint256 stakeId;
        address returnAddress;
        if (_isNFT) {
            stakeId = nftIdMappingsToStakeIds[_id];
            returnAddress = msg.sender;
            require(stakes[stakeId].nftId == _id, "NFT FOR STAKE NON-EXISTENT");
            require(FlashNFT(flashNFTAddress).ownerOf(_id) == msg.sender, "NOT OWNER OF NFT");

            // Burn the NFT
            FlashNFT(flashNFTAddress).burn(_id);
            emit NFTRedeemed(stakeId, _id);
        } else {
            stakeId = _id;
            returnAddress = stakes[stakeId].stakerAddress;

            require(stakes[stakeId].nftId == 0, "NFT TOKEN REQUIRED");
            require(stakes[stakeId].stakerAddress == msg.sender, "NOT OWNER OF STAKE");
        }
        require(stakes[stakeId].active == true, "STAKE NON-EXISTENT");

        // Determine how many fERC20 to burn
        uint256 secondsLeft = (stakes[stakeId].stakeStartTs + stakes[stakeId].stakeDuration) - block.timestamp;
        require(stakes[stakeId].stakeDuration - secondsLeft >= 60, "MINIMUM STAKE DURATION IS 60 SECONDS");

        uint256 percentageToBurn = (secondsLeft * (10**18)) / stakes[stakeId].stakeDuration;
        uint256 fTokenBurnAmount = (stakes[stakeId].fTokensToUser * percentageToBurn) / (10**18);

        // Burn these fTokens
        FlashFToken(getFTokenAddress(stakes[stakeId].strategyAddress)).burnFrom(msg.sender, fTokenBurnAmount);

        // Withdraw the principal and return to the user
        IFlashStrategy(stakes[stakeId].strategyAddress).withdrawPrincipal(stakes[stakeId].stakedAmount);

        // Transfer tokens back to user
        IERC20C(strategies[stakes[stakeId].strategyAddress].principalTokenAddress).transfer(
            returnAddress,
            stakes[stakeId].stakedAmount
        );

        // Mark stake as inactive
        stakes[stakeId].active = false;

        emit Unstaked(
            stakes[stakeId].strategyAddress,
            false,
            stakeId,
            true,
            stakes[stakeId].stakedAmount,
            fTokenBurnAmount
        );
    }

    function getFTokenAddress(address _strategyAddress) public view returns (address) {
        require(strategies[_strategyAddress].principalTokenAddress != address(0), "UNREGISTERED STRATEGY");

        return strategies[_strategyAddress].fTokenAddress;
    }

    function getStakeInfo(uint256 _id, bool _isNFT) public view returns (StakeStruct memory) {
        uint256 stakeId;
        if (_isNFT) {
            stakeId = nftIdMappingsToStakeIds[_id];
            require(stakes[stakeId].nftId == _id, "NFT FOR STAKE NON-EXISTENT");
        } else {
            stakeId = _id;
        }

        return stakes[stakeId];
    }

    function flashStake(
        address _strategyAddress,
        uint256 _tokenAmount,
        uint256 _stakeDuration,
        bool _issueNFT
    ) public returns (bool) {
        // Stake
        uint256 fTokensMinted = stake(_strategyAddress, _tokenAmount, _stakeDuration, _issueNFT).fTokensToUser;

        FlashFToken fToken = FlashFToken(strategies[_strategyAddress].fTokenAddress);
        fToken.transferFrom(msg.sender, address(this), fTokensMinted);

        // Quote, approve, burn
        uint256 quotedReturn = IFlashStrategy(_strategyAddress).quoteBurnFToken(fTokensMinted);

        fToken.approve(_strategyAddress, fTokensMinted);
        uint256 tokensReturned = IFlashStrategy(_strategyAddress).burnFToken(fTokensMinted, quotedReturn);

        // Transfer yield to user
        IERC20C(strategies[_strategyAddress].principalTokenAddress).transfer(msg.sender, tokensReturned);

        return true;
    }
}
