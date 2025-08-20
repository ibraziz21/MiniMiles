// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
  AkibaMiles Vault — UUPS Upgradeable (Instant Withdrawals)
  - deposit(amount):
      * pull USDT from user
      * supply to Aave v3 on behalf of Safe (aUSDT -> Safe)
      * mint akUSDT 1:1 to user (principal receipt)
  - withdraw(amount):
      * burn user's akUSDT
      * transferFrom aUSDT from Safe to this vault (Safe pre-approves)
      * Aave.withdraw USDT directly to user
  - Yield/rewards accrue to the Safe.
*/

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import {IakUSDT} from "./akUSDT.sol";

/* Aave v3 minimal interface */
interface IAaveV3Pool {
  function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
  function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

contract AkibaMilesVaultUUPS is
  Initializable,
  UUPSUpgradeable,
  OwnableUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable
{
  using SafeERC20 for IERC20;

  // --- Config (upgradeable storage, no immutables) ---
  IERC20      public asset;        // USDT (underlying)
  IERC20      public aToken;       // aUSDT (interest-bearing)
  IAaveV3Pool public aavePool;     // Aave v3 Pool
  address     public safe;         // Treasury Safe (holds aUSDT)
  uint16      public referralCode; // usually 0

  // --- Receipt token (principal ledger) ---
  IakUSDT public akToken; // akUSDT; this vault must be its owner/minter

  // --- Events ---
  event Deposited(address indexed user, uint256 amount);
  event Withdrawn(address indexed user, uint256 amount);

  // --- Errors ---
  error ZeroAmount();
  error InsufficientReceipts();
  error SafeATokenBalanceTooLow(uint256 needed, uint256 current);
  error SafeATokenAllowanceTooLow(uint256 needed, uint256 current);

  // -------- Initializer (replaces constructor) --------
  function initialize(
    address _asset,
    address _aToken,
    address _aavePool,
    address _vaultToken,
    address _safe,
    uint16  _referralCode
  ) external initializer {
    if (_asset == address(0) || _aToken == address(0) || _aavePool == address(0) || _safe == address(0) || _vaultToken == address(0)) {
      revert("zero addr");
    }
    //Reject Initialize Hijack
    if(msg.sender != 0xF20a5e1a4ca28D64f2C4A90998A41E8045288F48) revert("Not Allowed");
    
    __Ownable_init();
    __UUPSUpgradeable_init();
    __Pausable_init();
    __ReentrancyGuard_init();

    asset        = IERC20(_asset);
    aToken       = IERC20(_aToken);
    aavePool     = IAaveV3Pool(_aavePool);
    akToken      = IakUSDT(_vaultToken);
    safe         = _safe;
    referralCode = _referralCode; // set 0 unless you have a program
  }

  // -------- Core: Deposit --------
  function deposit(uint256 amount) external whenNotPaused nonReentrant {
    if (amount == 0) revert ZeroAmount();

    // 1) Pull USDT from user
    uint256 beforeBal = asset.balanceOf(address(this));
    asset.safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = asset.balanceOf(address(this)) - beforeBal; // supports fee-on-transfer (expected 1:1)

    // 2) Approve Aave if needed
    uint256 curAllow = asset.allowance(address(this), address(aavePool));
    if (curAllow < received) {
      asset.safeApprove(address(aavePool), 0);
      asset.safeApprove(address(aavePool), type(uint256).max);
    }

    // 3) Supply on behalf of Safe (aUSDT -> Safe; yield -> Safe)
    aavePool.supply(address(asset), received, safe, referralCode);

    // 4) Mint akUSDT to user (principal receipt)
    akToken.mint(msg.sender, received);

    emit Deposited(msg.sender, received);
  }

  // -------- Core: Withdraw (instant) --------
  function withdraw(uint256 amount) external whenNotPaused nonReentrant {
    if (amount == 0) revert ZeroAmount();

    // 1) Burn user's akUSDT
    if (akToken.balanceOf(msg.sender) < amount) revert InsufficientReceipts();
    akToken.burn(msg.sender, amount);

    // 2) Ensure Safe has enough aUSDT and has approved this vault (the PROXY) to pull
    uint256 bal = aToken.balanceOf(safe);
    if (bal < amount) revert SafeATokenBalanceTooLow(amount, bal);
    uint256 allow_ = aToken.allowance(safe, address(this));
    if (allow_ < amount) revert SafeATokenAllowanceTooLow(amount, allow_);

    // 3) Pull aUSDT from Safe -> vault
    aToken.safeTransferFrom(safe, address(this), amount);

    // 4) Redeem to USDT directly to user
    aavePool.withdraw(address(asset), amount, msg.sender);

    emit Withdrawn(msg.sender, amount);
  }

  // -------- Admin --------
  function pause() external onlyOwner { _pause(); }
  function unpause() external onlyOwner { _unpause(); }

  /// Recover stray tokens (NOT the core asset or aToken).
  function rescueToken(address token, address to, uint256 amount) external onlyOwner {
    require(token != address(asset) && token != address(aToken), "core token");
    IERC20(token).safeTransfer(to, amount);
  }

  // -------- UUPS auth --------
  function _authorizeUpgrade(address) internal override onlyOwner {}

  // -------- Storage gap for future upgrades --------
  uint256[45] private __gap;
}
