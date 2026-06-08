// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IAkibaMilesV2 {
    function mint(address account, uint256 amount) external;
}

/**
 * @title DailyQuestClaimer
 * @notice Lets users claim daily quest rewards on-chain using a backend-signed
 *         EIP-712 voucher. The contract mints AkibaMiles directly to the user,
 *         making the reward visible on-chain without backend gas overhead.
 *
 * Flow:
 *   1. User calls GET /api/quests/daily/voucher — server checks eligibility and
 *      returns a signed voucher (amount, dayNonce, deadline, sig).
 *   2. User submits the voucher to claim() — contract verifies sig, records
 *      the nonce, and mints Miles directly to msg.sender.
 *   3. Frontend calls POST /api/quests/daily/confirm with the tx hash — server
 *      records the claim in Supabase for streak/analytics.
 *
 * Replay protection: dayNonce = floor(block.timestamp / 1 days).
 * A user can claim at most once per UTC day; the contract enforces this on-chain.
 */
contract DailyQuestClaimer is Ownable, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "QuestClaim(address user,uint256 amount,uint256 dayNonce,uint256 deadline)"
    );

    IAkibaMilesV2 public immutable milesToken;

    /// @notice Backend signing key — only vouchers from this key are accepted.
    address public signer;

    /// @notice Prevents double-claim: claimed[user][dayNonce] = true once used.
    mapping(address => mapping(uint256 => bool)) public claimed;

    event QuestClaimed(address indexed user, uint256 dayNonce, uint256 amount);
    event SignerUpdated(address indexed newSigner);

    error AlreadyClaimed(address user, uint256 dayNonce);
    error VoucherExpired(uint256 deadline);
    error InvalidSignature();
    error ZeroAddress();

    constructor(address _milesToken, address _signer)
        EIP712("DailyQuestClaimer", "1")
    {
        if (_milesToken == address(0) || _signer == address(0)) revert ZeroAddress();
        milesToken = IAkibaMilesV2(_milesToken);
        signer = _signer;
    }

    /**
     * @notice Claim daily quest reward using a backend-signed voucher.
     * @param amount    AkibaMiles to mint (18-decimal units).
     * @param dayNonce  floor(block.timestamp / 1 days) — one per UTC day.
     * @param deadline  Unix timestamp after which the voucher is invalid.
     * @param signature EIP-712 signature from `signer`.
     */
    function claim(
        uint256 amount,
        uint256 dayNonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert VoucherExpired(deadline);
        if (claimed[msg.sender][dayNonce]) revert AlreadyClaimed(msg.sender, dayNonce);

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_TYPEHASH, msg.sender, amount, dayNonce, deadline)
        );
        address recovered = _hashTypedDataV4(structHash).recover(signature);
        if (recovered != signer) revert InvalidSignature();

        claimed[msg.sender][dayNonce] = true;
        milesToken.mint(msg.sender, amount);

        emit QuestClaimed(msg.sender, dayNonce, amount);
    }

    // ── Owner ──────────────────────────────────────────────────────────

    function setSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        signer = _signer;
        emit SignerUpdated(_signer);
    }

    /// @notice Convenience view — has this user already claimed for today?
    function hasClaimedToday(address user) external view returns (bool) {
        uint256 today = block.timestamp / 1 days;
        return claimed[user][today];
    }
}
