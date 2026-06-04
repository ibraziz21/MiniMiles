// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

/// @title AkibaVoucherRegistry
/// @notice Tracks merchant voucher entitlements won through the AkibaMiles Claw Game.
///         Vouchers are issued by the game contract (authorized), redeemed by merchants/backend
///         (redeemers), and burned by the game contract on the player's behalf.
///
///         rewardClass uses uint8 to mirror the RewardClass enum in AkibaClawGame:
///         0=None, 1=Lose, 2=Common, 3=Rare, 4=Epic, 5=Legendary
contract AkibaVoucherRegistry is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    /* ─────────────────────── Structs ───────────────────── */

    struct VoucherEntitlement {
        uint256 voucherId;
        address owner;
        uint8   tierId;
        uint8   rewardClass;   // 3 = Rare, 5 = Legendary
        uint16  discountBps;   // 2000 = 20%, 10000 = 100%
        uint256 maxValue;      // cap in USDT units (6 dec); 0 = no cap
        uint256 expiresAt;
        bool    redeemed;
        bool    burned;
        bytes32 merchantId;
    }

    /* ─────────────────────── State ─────────────────────── */

    uint256 public nextVoucherId;

    mapping(uint256 => VoucherEntitlement) private _vouchers;

    /// @notice All voucher IDs ever issued to an owner (includes expired/burned).
    mapping(address => uint256[]) private _ownerVouchers;

    /// @notice Authorized issuers — game contracts only.
    mapping(address => bool) public authorized;

    /// @notice Redemption operators — merchant systems / backend relayer.
    mapping(address => bool) public redeemers;

    /* ─────────────────────── Events ────────────────────── */

    event VoucherIssued(
        uint256 indexed voucherId,
        address indexed owner,
        uint8   tierId,
        uint8   rewardClass
    );
    event VoucherRedeemed(uint256 indexed voucherId, address indexed owner);
    event VoucherBurned(uint256 indexed voucherId, address indexed owner);
    event AuthorizedSet(address indexed account, bool enabled);
    event RedeemerSet(address indexed account, bool enabled);

    /* ─────────────────────── Errors ────────────────────── */

    error NotAuthorized();
    error VoucherNotFound();
    error AlreadyUsed();
    error Expired();

    /* ─────────────────────── Init ──────────────────────── */

    function initialize(address _owner) external initializer {
        require(_owner != address(0), "zero addr");
        __Ownable_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        _transferOwnership(_owner);
        nextVoucherId = 1;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /* ─────────────────────── Core ──────────────────────── */

    /// @notice Issue a new voucher entitlement. Called exclusively by authorized game contract.
    function issue(
        address owner_,
        uint8   tierId,
        uint8   rewardClass,
        uint16  discountBps,
        uint256 maxValue,
        uint256 expiresAt,
        bytes32 merchantId
    ) external whenNotPaused returns (uint256 voucherId) {
        if (!authorized[msg.sender]) revert NotAuthorized();

        voucherId = nextVoucherId++;

        _vouchers[voucherId] = VoucherEntitlement({
            voucherId:   voucherId,
            owner:       owner_,
            tierId:      tierId,
            rewardClass: rewardClass,
            discountBps: discountBps,
            maxValue:    maxValue,
            expiresAt:   expiresAt,
            redeemed:    false,
            burned:      false,
            merchantId:  merchantId
        });

        _ownerVouchers[owner_].push(voucherId);

        emit VoucherIssued(voucherId, owner_, tierId, rewardClass);
    }

    /// @notice Mark a voucher as burned. Called by authorized game contract only.
    ///         Prevents the voucher from being redeemed afterward.
    function markBurned(uint256 voucherId) external {
        if (!authorized[msg.sender]) revert NotAuthorized();
        VoucherEntitlement storage v = _vouchers[voucherId];
        if (v.voucherId == 0) revert VoucherNotFound();
        if (v.redeemed || v.burned) revert AlreadyUsed();
        v.burned = true;
        emit VoucherBurned(voucherId, v.owner);
    }

    /// @notice Mark a voucher as redeemed. Called by redeemer (merchant / backend).
    ///         Prevents the voucher from being burned afterward.
    function markRedeemed(uint256 voucherId) external {
        if (!redeemers[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        VoucherEntitlement storage v = _vouchers[voucherId];
        if (v.voucherId == 0) revert VoucherNotFound();
        if (v.redeemed || v.burned) revert AlreadyUsed();
        if (block.timestamp > v.expiresAt) revert Expired();
        v.redeemed = true;
        emit VoucherRedeemed(voucherId, v.owner);
    }

    /* ─────────────────────── Views ─────────────────────── */

    function getVoucher(uint256 voucherId) external view returns (VoucherEntitlement memory) {
        VoucherEntitlement storage v = _vouchers[voucherId];
        if (v.voucherId == 0) revert VoucherNotFound();
        return v;
    }

    /// @notice All voucher IDs ever issued to an address (use getVoucher to read each).
    function getOwnerVouchers(address owner_) external view returns (uint256[] memory) {
        return _ownerVouchers[owner_];
    }

    /// @notice Returns true if the voucher exists, is not burned/redeemed, and has not expired.
    function isValid(uint256 voucherId) external view returns (bool) {
        VoucherEntitlement storage v = _vouchers[voucherId];
        return v.voucherId != 0
            && !v.redeemed
            && !v.burned
            && block.timestamp <= v.expiresAt;
    }

    /* ─────────────────────── Admin ─────────────────────── */

    function setAuthorized(address account, bool enabled) external onlyOwner {
        authorized[account] = enabled;
        emit AuthorizedSet(account, enabled);
    }

    function setRedeemer(address account, bool enabled) external onlyOwner {
        redeemers[account] = enabled;
        emit RedeemerSet(account, enabled);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /* ─────────────────────── Gap ───────────────────────── */

    uint256[47] private __gap;
}
