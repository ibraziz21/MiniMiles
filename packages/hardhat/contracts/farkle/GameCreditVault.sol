// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title GameCreditVault
/// @notice USDT-based credit purchase and reward credit accounting.
///
///         Purchased credits — consumed for paid game entry (non-withdrawable by default).
///         Reward credits    — earned from wins, claimable as USDT when enabled.
///
///         Initial pack: 5 credits = 0.50 USDT (1 credit = 0.10 USDT, 6 decimals).
/// @dev UUPS upgradeable.
contract GameCreditVault is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    IERC20  public usdt;
    address public settlementManager;
    bool    public claimEnabled;

    struct CreditPack {
        uint256 packId;
        uint256 usdtAmount;    // USDT base units (6 decimals: 500000 = $0.50)
        uint256 creditAmount;
        bool    active;
    }

    mapping(uint256 => CreditPack) public creditPacks;
    mapping(address => uint256)    public gameCreditBalance;
    mapping(address => uint256)    public rewardCreditBalance; // USDT base units
    uint256 public nextPackId;

    event CreditsPurchased(address indexed user, uint256 indexed packId, uint256 usdtAmount, uint256 creditAmount);
    event GameCreditsDebited(address indexed user, uint256 amount, bytes32 indexed reason);
    event RewardCreditsGranted(address indexed user, uint256 amount, bytes32 indexed reason);
    event RewardCreditsClaimed(address indexed user, uint256 amount);
    event CreditPackSet(uint256 indexed packId, uint256 usdtAmount, uint256 creditAmount, bool active);
    event SettlementManagerUpdated(address newManager);
    event ClaimToggled(bool enabled);

    error PackInactive();
    error InsufficientCredits();
    error InsufficientRewardCredits();
    error ClaimDisabled();
    error Unauthorized();
    error ZeroAddress();

    modifier onlySettlement() {
        if (msg.sender != settlementManager) revert Unauthorized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _usdt) external initializer {
        if (_usdt == address(0)) revert ZeroAddress();
        __Ownable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        usdt = IERC20(_usdt);

        // Pack 0: 5 credits = 0.50 USDT
        creditPacks[0] = CreditPack(0, 500_000, 5, true); // 6-decimal USDT
        nextPackId = 1;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── User actions ──────────────────────────────────────────────────────────

    function buyCredits(uint256 packId) external nonReentrant whenNotPaused {
        CreditPack storage pack = creditPacks[packId];
        if (!pack.active) revert PackInactive();
        usdt.safeTransferFrom(msg.sender, address(this), pack.usdtAmount);
        gameCreditBalance[msg.sender] += pack.creditAmount;
        emit CreditsPurchased(msg.sender, packId, pack.usdtAmount, pack.creditAmount);
    }

    function claimRewardCredits(uint256 amount) external nonReentrant {
        if (!claimEnabled) revert ClaimDisabled();
        if (rewardCreditBalance[msg.sender] < amount) revert InsufficientRewardCredits();
        unchecked { rewardCreditBalance[msg.sender] -= amount; }
        usdt.safeTransfer(msg.sender, amount);
        emit RewardCreditsClaimed(msg.sender, amount);
    }

    // ── Settlement manager actions ────────────────────────────────────────────

    function debitGameCredits(address user, uint256 amount, bytes32 reason) external onlySettlement {
        if (gameCreditBalance[user] < amount) revert InsufficientCredits();
        unchecked { gameCreditBalance[user] -= amount; }
        emit GameCreditsDebited(user, amount, reason);
    }

    function creditRewardCredits(address user, uint256 amount, bytes32 reason) external onlySettlement {
        rewardCreditBalance[user] += amount;
        emit RewardCreditsGranted(user, amount, reason);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function setCreditPack(
        uint256 packId,
        uint256 usdtAmount,
        uint256 creditAmount,
        bool    active
    ) external onlyOwner {
        creditPacks[packId] = CreditPack(packId, usdtAmount, creditAmount, active);
        emit CreditPackSet(packId, usdtAmount, creditAmount, active);
    }

    function addCreditPack(uint256 usdtAmount, uint256 creditAmount) external onlyOwner returns (uint256 packId) {
        packId = nextPackId++;
        creditPacks[packId] = CreditPack(packId, usdtAmount, creditAmount, true);
        emit CreditPackSet(packId, usdtAmount, creditAmount, true);
    }

    function setClaimEnabled(bool enabled) external onlyOwner {
        claimEnabled = enabled;
        emit ClaimToggled(enabled);
    }

    function setSettlementManager(address manager) external onlyOwner {
        settlementManager = manager;
        emit SettlementManagerUpdated(manager);
    }

    function setUsdt(address _usdt) external onlyOwner {
        if (_usdt == address(0)) revert ZeroAddress();
        usdt = IERC20(_usdt);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function withdrawUSDT(address to, uint256 amount) external onlyOwner {
        usdt.safeTransfer(to, amount);
    }

    // ── Storage gap ───────────────────────────────────────────────────────────
    uint256[50] private __gap;
}
