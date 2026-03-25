// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal interface for the V1 AkibaMiles token.
interface IMiniPointsV1 {
    function burn(address account, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/// @title AkibaMilesV2
/// @notice Non-transferable loyalty points token.
///         - Upgradeable via UUPS proxy
///         - Burn is now restricted to owner/minters (fixes the open burn bug in V1)
///         - batchMint for efficient migration
///         - claimV2Tokens for self-serve user migration from V1
contract AkibaMilesV2 is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    error NullAddress();
    error Unauthorized();
    error Blacklisted();

    mapping(address => bool) public minters;
    mapping(address => bool) public blacklist;

    /// @notice Address of the V1 AkibaMiles token, used by claimV2Tokens().
    address public v1Token;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __ERC20_init("AkibaMiles", "Miles");
        __Ownable_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        _transferOwnership(initialOwner);
    }

    /* ── access ──────────────────────────────────────────────── */

    modifier onlyAllowed() {
        if (msg.sender != owner() && !minters[msg.sender]) revert Unauthorized();
        _;
    }

    function setMinter(address who, bool enabled) external onlyOwner {
        if (who == address(0)) revert NullAddress();
        minters[who] = enabled;
    }

    /* ── blacklist ───────────────────────────────────────────── */

    event BlacklistUpdated(address indexed account, bool blacklisted);

    function setBlacklist(address account, bool blacklisted) external onlyAllowed {
        if (account == address(0)) revert NullAddress();
        blacklist[account] = blacklisted;
        emit BlacklistUpdated(account, blacklisted);
    }

    function batchSetBlacklist(address[] calldata accounts, bool blacklisted) external onlyAllowed {
        for (uint256 i = 0; i < accounts.length; i++) {
            blacklist[accounts[i]] = blacklisted;
            emit BlacklistUpdated(accounts[i], blacklisted);
        }
    }

    /* ── mint ────────────────────────────────────────────────── */

    function mint(address account, uint256 amount) external onlyAllowed {
        _mint(account, amount);
    }

    /// @notice Mint to multiple addresses in one tx — used for migration.
    function batchMint(address[] calldata accounts, uint256[] calldata amounts)
        external
        onlyAllowed
    {
        require(accounts.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            _mint(accounts[i], amounts[i]);
        }
    }

    /* ── burn ────────────────────────────────────────────────── */

    /// @notice Burn is now restricted to owner/minters. Fixes V1 open burn bug.
    function burn(address account, uint256 amount) external onlyAllowed {
        _burn(account, amount);
    }

    /* ── V1 → V2 self-serve migration ───────────────────────── */

    event V2Claimed(address indexed user, uint256 amount);

    /// @notice Set the V1 token address. Call once after deploy.
    function setV1Token(address _v1) external onlyOwner {
        if (_v1 == address(0)) revert NullAddress();
        v1Token = _v1;
    }

    /// @notice Burns the caller's entire V1 balance and mints the same amount on V2.
    /// @dev V1 burn has no access control, so this contract can call it on behalf of msg.sender.
    ///      Order: read balance → burn V1 (external) → mint V2 (internal).
    ///      nonReentrant guard added as defense-in-depth; V1 has no token hooks.
    function claimV2Tokens() external nonReentrant {
        if (v1Token == address(0)) revert NullAddress();
        uint256 balance = IERC20(v1Token).balanceOf(msg.sender);
        require(balance > 0, "No V1 balance to claim");
        IMiniPointsV1(v1Token).burn(msg.sender, balance);
        _mint(msg.sender, balance);
        emit V2Claimed(msg.sender, balance);
    }

    /// @notice Backend-callable migration: burns `user`'s entire V1 balance and mints V2.
    /// @dev Callable by owner or registered minters so the backend wallet can migrate
    ///      users without requiring them to sign a transaction (avoids MiniPay whitelist friction).
    function claimV2TokensFor(address user) external onlyAllowed nonReentrant {
        if (v1Token == address(0)) revert NullAddress();
        if (user == address(0)) revert NullAddress();
        uint256 balance = IERC20(v1Token).balanceOf(user);
        require(balance > 0, "No V1 balance to claim");
        IMiniPointsV1(v1Token).burn(user, balance);
        _mint(user, balance);
        emit V2Claimed(user, balance);
    }

    /* ── non-transferable ────────────────────────────────────── */

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 /*amount*/
    ) internal override {
        if (from != address(0) && to != address(0)) {
            revert("Transfers are not allowed");
        }
        // Block mints to blacklisted addresses
        if (to != address(0) && blacklist[to]) revert Blacklisted();
        // Block burns from blacklisted addresses (freeze balance in place)
        if (from != address(0) && blacklist[from]) revert Blacklisted();
    }

    /* ── UUPS ────────────────────────────────────────────────── */

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {}
}
