// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IAkibaMilesMintable {
    function mint(address account, uint256 amount) external;
    function blacklist(address account) external view returns (bool);
}

/**
 * @title DailyQuestClaimer
 * @notice Users submit a backend-signed EIP-712 voucher to self-claim their
 *         daily check-in AkibaMiles reward. The contract calls mint() directly
 *         so no backend wallet TX is needed.
 *
 *         Compatible with the existing Celo DailyQuestClaimer ABI consumed by
 *         the frontend (same function names, same error names/shapes).
 */
contract DailyQuestClaimer is Ownable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    // ── errors ────────────────────────────────────────────────
    error AlreadyClaimed(address user, uint256 dayNonce);
    error InvalidSignature();
    error Expired(uint256 deadline);
    error Blacklisted();
    error NullAddress();

    // ── EIP-712 ───────────────────────────────────────────────
    bytes32 public constant QUEST_CLAIM_TYPEHASH = keccak256(
        "QuestClaim(address user,uint256 amount,uint256 dayNonce,uint256 deadline)"
    );

    // ── state ──────────────────────────────────────────────────
    IAkibaMilesMintable public immutable milesToken;
    address public signer;

    // user => dayNonce => claimed
    mapping(address => mapping(uint256 => bool)) private _claimed;

    // ── events ─────────────────────────────────────────────────
    event Claimed(address indexed user, uint256 amount, uint256 dayNonce);
    event SignerUpdated(address indexed newSigner);

    // ──────────────────────────────────────────────────────────
    constructor(address _milesToken, address _signer)
        EIP712("DailyQuestClaimer", "1")
    {
        if (_milesToken == address(0) || _signer == address(0)) revert NullAddress();
        milesToken = IAkibaMilesMintable(_milesToken);
        signer = _signer;
    }

    // ── admin ──────────────────────────────────────────────────

    function setSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert NullAddress();
        signer = _signer;
        emit SignerUpdated(_signer);
    }

    // ── views ──────────────────────────────────────────────────

    function claimed(address user, uint256 dayNonce) external view returns (bool) {
        return _claimed[user][dayNonce];
    }

    // ── claim ──────────────────────────────────────────────────

    /**
     * @notice Submit a backend-signed voucher to mint your daily Miles.
     * @param amount    Miles to mint (18-decimal units).
     * @param dayNonce  floor(unixTimestamp / 86400) — one per UTC day.
     * @param deadline  Unix timestamp after which the voucher is invalid.
     * @param signature EIP-712 sig over (user, amount, dayNonce, deadline).
     */
    function claim(
        uint256 amount,
        uint256 dayNonce,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert Expired(deadline);
        if (_claimed[msg.sender][dayNonce]) revert AlreadyClaimed(msg.sender, dayNonce);
        if (milesToken.blacklist(msg.sender)) revert Blacklisted();

        bytes32 structHash = keccak256(abi.encode(
            QUEST_CLAIM_TYPEHASH,
            msg.sender,
            amount,
            dayNonce,
            deadline
        ));

        address recovered = _hashTypedDataV4(structHash).recover(signature);
        if (recovered != signer) revert InvalidSignature();

        _claimed[msg.sender][dayNonce] = true;
        milesToken.mint(msg.sender, amount);

        emit Claimed(msg.sender, amount, dayNonce);
    }
}
