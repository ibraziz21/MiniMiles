// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/// @title AkibaRewardVault
/// @notice Custodies USDT used for claw game payouts (Epic wins and Legendary/Rare burns).
///         Only authorized callers (i.e. AkibaClawGame) may pull funds.
///         Admin tops up the vault; Premium-tier entry fees are also routed here.
contract AkibaRewardVault is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    /* ─────────────────────── State ─────────────────────── */

    IERC20 public usdt;

    /// @notice Addresses permitted to call pay() — typically game contracts.
    mapping(address => bool) public authorized;

    /* ─────────────────────── Events ────────────────────── */

    event Authorized(address indexed account, bool enabled);
    event Deposited(address indexed from, uint256 amount);
    event Paid(address indexed to, uint256 amount);

    /* ─────────────────────── Errors ────────────────────── */

    error NotAuthorized();
    error InsufficientBalance(uint256 available, uint256 requested);

    /* ─────────────────────── Init ──────────────────────── */

    function initialize(address _usdt, address _owner) external initializer {
        require(_usdt != address(0) && _owner != address(0), "zero addr");
        __Ownable_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        usdt = IERC20(_usdt);
        _transferOwnership(_owner);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /* ─────────────────────── Core ──────────────────────── */

    /// @notice Admin (or anyone) can top up the vault with USDT.
    function deposit(uint256 amount) external nonReentrant {
        usdt.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Pay USDT to a recipient. Only authorized callers.
    function pay(address to, uint256 amount) external nonReentrant whenNotPaused {
        if (!authorized[msg.sender]) revert NotAuthorized();
        uint256 bal = usdt.balanceOf(address(this));
        if (bal < amount) revert InsufficientBalance(bal, amount);
        usdt.safeTransfer(to, amount);
        emit Paid(to, amount);
    }

    /* ─────────────────────── Views ─────────────────────── */

    function balance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    /* ─────────────────────── Admin ─────────────────────── */

    function setAuthorized(address account, bool enabled) external onlyOwner {
        authorized[account] = enabled;
        emit Authorized(account, enabled);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Rescue tokens other than USDT accidentally sent to the vault.
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(usdt), "core token");
        IERC20(token).safeTransfer(to, amount);
    }

    /* ─────────────────────── Gap ───────────────────────── */

    uint256[48] private __gap;
}
