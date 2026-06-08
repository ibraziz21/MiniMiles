// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAkibaMilesReward {
    function mint(address to, uint256 amount) external;
}

/// @title RewardTreasury
/// @notice Holds AkibaMiles reward inventory and USDT reward liquidity.
///         Only the settlement manager may distribute rewards.
/// @dev UUPS upgradeable.
contract RewardTreasury is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    IAkibaMilesReward public akibaMiles;
    IERC20            public usdt;
    address           public settlementManager;

    bool public milesRewardEnabled;
    bool public usdtRewardEnabled;

    event AkibaMilesRewarded(address indexed user, uint256 amount, bytes32 indexed reason);
    event USDTRewarded(address indexed user, uint256 amount, bytes32 indexed reason);
    event TreasuryFunded(address indexed token, uint256 amount);
    event SettlementManagerUpdated(address newManager);
    event RewardToggled(bool miles, bool usdtFlag);

    error Unauthorized();
    error RewardDisabled();
    error InsufficientBalance();
    error ZeroAddress();

    modifier onlySettlement() {
        if (msg.sender != settlementManager) revert Unauthorized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _akibaMiles, address _usdt) external initializer {
        if (_akibaMiles == address(0) || _usdt == address(0)) revert ZeroAddress();
        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        akibaMiles          = IAkibaMilesReward(_akibaMiles);
        usdt                = IERC20(_usdt);
        milesRewardEnabled  = true;
        usdtRewardEnabled   = true;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── Settlement manager actions ────────────────────────────────────────────

    function grantAkibaMilesReward(
        address user,
        uint256 amount,
        bytes32 reason
    ) external onlySettlement whenNotPaused {
        if (!milesRewardEnabled) revert RewardDisabled();
        akibaMiles.mint(user, amount);
        emit AkibaMilesRewarded(user, amount, reason);
    }

    function payUSDTReward(
        address user,
        uint256 amount,
        bytes32 reason
    ) external onlySettlement whenNotPaused nonReentrant {
        if (!usdtRewardEnabled) revert RewardDisabled();
        if (usdt.balanceOf(address(this)) < amount) revert InsufficientBalance();
        usdt.safeTransfer(user, amount);
        emit USDTRewarded(user, amount, reason);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function fundUSDT(uint256 amount) external nonReentrant {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryFunded(address(usdt), amount);
    }

    function setSettlementManager(address manager) external onlyOwner {
        settlementManager = manager;
        emit SettlementManagerUpdated(manager);
    }

    function setRewardsEnabled(bool miles, bool usdtFlag) external onlyOwner {
        milesRewardEnabled = miles;
        usdtRewardEnabled  = usdtFlag;
        emit RewardToggled(miles, usdtFlag);
    }

    function setAkibaMiles(address _akibaMiles) external onlyOwner {
        if (_akibaMiles == address(0)) revert ZeroAddress();
        akibaMiles = IAkibaMilesReward(_akibaMiles);
    }

    function setUsdt(address _usdt) external onlyOwner {
        if (_usdt == address(0)) revert ZeroAddress();
        usdt = IERC20(_usdt);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ── Storage gap ───────────────────────────────────────────────────────────
    uint256[50] private __gap;
}
