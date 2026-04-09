// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface IAaveV3Pool {
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
}

interface IakUSDT {
    function mint(address account, uint256 amount) external;
    function burn(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

// ── Vault ─────────────────────────────────────────────────────────────────────

/**
 * @title  AkibaMilesVaultUUPS
 * @notice Users deposit USDT to earn AkibaMiles as loyalty rewards.
 *         Principal is supplied to Aave v3 on behalf of the Akiba Safe;
 *         yield accrues to the Safe.  Users receive akUSDT 1:1 as a
 *         non-transferrable receipt token and may withdraw at any time.
 *
 * Flow:
 *   Deposit:  USDT user → Vault → Aave (onBehalfOf=Safe)
 *             akUSDT minted to user 1:1
 *
 *   Withdraw: akUSDT burned from user
 *             aUSDT pulled from Safe → Vault (Safe must have pre-approved vault)
 *             Aave redeems aUSDT → USDT sent directly to user
 */
contract AkibaMilesVaultUUPS is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    // ── Errors ────────────────────────────────────────────────────────────────

    error ZeroAmount();
    error InsufficientReceipts();
    error SafeATokenAllowanceTooLow(uint256 needed, uint256 current);
    error SafeATokenBalanceTooLow(uint256 needed, uint256 current);

    // ── Events ────────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    // ── State ─────────────────────────────────────────────────────────────────

    IERC20      public asset;       // USDT (6 decimals)
    IERC20      public aToken;      // aUSDT from Aave
    IAaveV3Pool public aavePool;    // Aave v3 Pool
    IakUSDT     public akToken;     // akUSDT receipt token (owner = this contract)
    address     public safe;        // Akiba Safe — holds aUSDT, yields go here
    uint16      public referralCode;

    // ── Initializer ───────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialOwner,
        address _asset,
        address _aToken,
        address _aavePool,
        address _vaultToken,
        address _safe,
        uint16  _referralCode
    ) external initializer {
        require(initialOwner  != address(0), "zero owner");
        require(_asset        != address(0), "zero asset");
        require(_aToken       != address(0), "zero aToken");
        require(_aavePool     != address(0), "zero pool");
        require(_vaultToken   != address(0), "zero vaultToken");
        require(_safe         != address(0), "zero safe");

        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _transferOwnership(initialOwner);

        asset       = IERC20(_asset);
        aToken      = IERC20(_aToken);
        aavePool    = IAaveV3Pool(_aavePool);
        akToken     = IakUSDT(_vaultToken);
        safe        = _safe;
        referralCode = _referralCode;
    }

    // ── Core actions ──────────────────────────────────────────────────────────

    /**
     * @notice Deposit USDT into the vault.
     *         Caller must have approved at least `amount` USDT to this contract.
     * @param  amount  Amount of USDT to deposit (6-decimal units).
     */
    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Pull USDT from user
        asset.transferFrom(msg.sender, address(this), amount);

        // Approve Aave pool to spend USDT
        asset.approve(address(aavePool), amount);

        // Supply USDT to Aave; yield accrues to Safe
        aavePool.supply(address(asset), amount, safe, referralCode);

        // Mint akUSDT receipt to user 1:1
        akToken.mint(msg.sender, amount);

        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw USDT from the vault by redeeming akUSDT.
     *         The Akiba Safe must have approved this contract to spend at least
     *         `amount` of aUSDT prior to this call.
     * @param  amount  Amount of USDT to withdraw (6-decimal units).
     */
    function withdraw(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Check user has enough receipt tokens
        uint256 receipts = akToken.balanceOf(msg.sender);
        if (receipts < amount) revert InsufficientReceipts();

        // Check Safe has approved enough aUSDT
        uint256 allowance = aToken.allowance(safe, address(this));
        if (allowance < amount) revert SafeATokenAllowanceTooLow(amount, allowance);

        // Check Safe holds enough aUSDT
        uint256 safeBalance = aToken.balanceOf(safe);
        if (safeBalance < amount) revert SafeATokenBalanceTooLow(amount, safeBalance);

        // Burn receipt token first (CEI: effects before interactions)
        akToken.burn(msg.sender, amount);

        // Pull aUSDT from Safe to this contract
        aToken.transferFrom(safe, address(this), amount);

        // Redeem aUSDT for USDT via Aave; USDT sent directly to user
        aavePool.withdraw(address(asset), amount, msg.sender);

        emit Withdrawn(msg.sender, amount);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency token rescue — recover any ERC20 sent to this contract
     *         by mistake. Cannot drain the active yield position (held by Safe).
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "zero to");
        IERC20(token).transfer(to, amount);
    }

    // ── UUPS ──────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
