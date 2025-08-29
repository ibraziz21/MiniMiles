// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @notice Minimal interface your Raffle uses (keep for compatibility).
interface IPrizeNFT {
    function mintTo(address to) external returns (uint256);
}

/// @title PhysicalPrizeNFT
/// @dev Voucher-style ERC721 used to redeem a physical prize.
///      - Raffle contract mints to the winner
///      - Winner must `claim()` before `expiry`
///      - If not claimed by expiry, owner can `revokeExpired()` and re-raffle
contract PhysicalPrizeNFT is ERC721URIStorage, Ownable {
    // ---- Roles ----
    address public raffle; // AkibaRaffle proxy address allowed to mint

    // ---- Config ----
    uint256 public defaultClaimWindow = 30 days; // can be changed by owner

    // ---- Prize state ----
    struct Prize {
        uint64 expiry;   // unix timestamp when claim window ends
        bool   claimed;  // winner marked as claimed
        uint64 roundId;  // optional: raffle round for UX/traceability
    }

    // tokenId => prize info
    mapping(uint256 => Prize) public prizeInfo;

    // simple incremental token id
    uint256 private _nextId = 1;

    // ---- Events ----
    event RaffleSet(address indexed raffle);
    event DefaultClaimWindowSet(uint256 seconds_);
    event PrizeMinted(uint256 indexed tokenId, address indexed to, uint64 roundId, uint64 expiryTs, string tokenURI_);
    event PrizeClaimed(uint256 indexed tokenId, address indexed claimer);
    event PrizeRevoked(uint256 indexed tokenId);

    // ---- Modifiers ----
    modifier onlyRaffle() {
        require(msg.sender == raffle, "PrizeNFT: not raffle");
        _;
    }

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    // -------- Admin --------

    function setRaffle(address raffle_) external onlyOwner {
        require(raffle_ != address(0), "PrizeNFT: zero raffle");
        raffle = raffle_;
        emit RaffleSet(raffle_);
    }

    /// @notice Set default claim window (in seconds). E.g., 30 days = 30 * 86400
    function setDefaultClaimWindow(uint256 seconds_) external onlyOwner {
        require(seconds_ > 0, "PrizeNFT: zero window");
        defaultClaimWindow = seconds_;
        emit DefaultClaimWindowSet(seconds_);
    }

    // -------- Minting (Raffle-only) --------

    /// @notice Backwards-compatible mint with default window and empty URI.
    function mintTo(address to) external onlyRaffle returns (uint256 tokenId) {
        tokenId = _mintPrize(to, 0, 0, "");
    }

    /// @notice Preferred mint with per-round metadata and optional override window/URI.
    /// @param to Winner address
    /// @param roundId Optional: AkibaRaffle round id (0 if unused)
    /// @param claimWindowSeconds 0 => use defaultClaimWindow; otherwise custom (e.g., 10 days)
    /// @param tokenURI_ Optional metadata URI (empty string to skip)
    function mintTo(
        address to,
        uint64 roundId,
        uint256 claimWindowSeconds,
        string memory tokenURI_
    ) external onlyRaffle returns (uint256 tokenId) {
        tokenId = _mintPrize(to, roundId, claimWindowSeconds, tokenURI_);
    }

    function _mintPrize(
        address to,
        uint64 roundId,
        uint256 claimWindowSeconds,
        string memory tokenURI_
    ) internal returns (uint256 tokenId) {
        require(to != address(0), "PrizeNFT: zero to");

        uint256 window = (claimWindowSeconds == 0) ? defaultClaimWindow : claimWindowSeconds;
        require(window > 0, "PrizeNFT: bad window");

        tokenId = _nextId++;
        _safeMint(to, tokenId);

        if (bytes(tokenURI_).length != 0) {
            _setTokenURI(tokenId, tokenURI_);
        }

        uint64 expiryTs = uint64(block.timestamp + window);
        prizeInfo[tokenId] = Prize({
            expiry: expiryTs,
            claimed: false,
            roundId: roundId
        });

        emit PrizeMinted(tokenId, to, roundId, expiryTs, tokenURI_);
    }

    // -------- Claim / Revoke --------

    /// @notice Winner claims the physical prize before expiry (on-chain acknowledgement).
    function claim(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "PrizeNFT: not owner");
        Prize storage p = prizeInfo[tokenId];
        require(!p.claimed, "PrizeNFT: already claimed");
        require(block.timestamp <= p.expiry, "PrizeNFT: expired");

        p.claimed = true;
        emit PrizeClaimed(tokenId, msg.sender);
    }

    /// @notice After expiry and if unclaimed, owner can revoke (burn) to re-raffle.
    function revokeExpired(uint256 tokenId) external onlyOwner {
        Prize storage p = prizeInfo[tokenId];
        require(!p.claimed, "PrizeNFT: already claimed");
        require(block.timestamp > p.expiry, "PrizeNFT: not expired");

        _burn(tokenId);
        delete prizeInfo[tokenId];
        emit PrizeRevoked(tokenId);
    }

    // -------- Views --------

    function getPrize(uint256 tokenId)
        external
        view
        returns (uint64 expiry, bool claimed, uint64 roundId)
    {
        Prize memory p = prizeInfo[tokenId];
        return (p.expiry, p.claimed, p.roundId);
    }
}
