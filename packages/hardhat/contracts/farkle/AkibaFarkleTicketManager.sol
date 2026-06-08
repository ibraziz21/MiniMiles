// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

interface IAkibaMilesBurnable {
    function burn(address account, uint256 amount) external;
}

/// @title AkibaFarkleTicketManager
/// @notice AkibaMiles-based non-transferable game tickets for Farkle Quick Duel.
///         5 tickets = 25 AkibaMiles (configurable).
/// @dev UUPS upgradeable.
contract AkibaFarkleTicketManager is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    IAkibaMilesBurnable public akibaMiles;
    address public settlementManager;

    uint256 public ticketsPerPack;
    uint256 public milesPerPack;
    uint256 public maxTicketBalance;

    mapping(address => uint256) public ticketBalance;

    event TicketsPurchased(address indexed user, uint256 ticketAmount, uint256 milesBurned);
    event TicketsDebited(address indexed user, uint256 amount, bytes32 indexed reason);
    event TicketsGranted(address indexed user, uint256 amount, bytes32 indexed reason);
    event SettlementManagerUpdated(address newManager);
    event PackConfigUpdated(uint256 tickets, uint256 miles);

    error InsufficientTickets();
    error ExceedsMaxBalance();
    error Unauthorized();
    error ZeroAddress();

    modifier onlySettlement() {
        if (msg.sender != settlementManager) revert Unauthorized();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _akibaMiles) external initializer {
        if (_akibaMiles == address(0)) revert ZeroAddress();
        __Ownable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        akibaMiles      = IAkibaMilesBurnable(_akibaMiles);
        ticketsPerPack  = 5;
        milesPerPack    = 25e18;
        maxTicketBalance = 50;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ── User actions ──────────────────────────────────────────────────────────

    /// @notice Buy one pack by burning AkibaMiles.
    function buyTicketPack() external nonReentrant {
        uint256 newBalance = ticketBalance[msg.sender] + ticketsPerPack;
        if (newBalance > maxTicketBalance) revert ExceedsMaxBalance();
        akibaMiles.burn(msg.sender, milesPerPack);
        ticketBalance[msg.sender] = newBalance;
        emit TicketsPurchased(msg.sender, ticketsPerPack, milesPerPack);
    }

    // ── Settlement manager actions ────────────────────────────────────────────

    function debitTickets(address user, uint256 amount, bytes32 reason) external onlySettlement {
        if (ticketBalance[user] < amount) revert InsufficientTickets();
        unchecked { ticketBalance[user] -= amount; }
        emit TicketsDebited(user, amount, reason);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function grantTickets(address user, uint256 amount, bytes32 reason) external onlyOwner {
        ticketBalance[user] += amount;
        emit TicketsGranted(user, amount, reason);
    }

    function setSettlementManager(address manager) external onlyOwner {
        settlementManager = manager;
        emit SettlementManagerUpdated(manager);
    }

    function setPackConfig(uint256 _tickets, uint256 _miles) external onlyOwner {
        ticketsPerPack = _tickets;
        milesPerPack   = _miles;
        emit PackConfigUpdated(_tickets, _miles);
    }

    function setMaxTicketBalance(uint256 max) external onlyOwner {
        maxTicketBalance = max;
    }

    function setAkibaMiles(address _akibaMiles) external onlyOwner {
        if (_akibaMiles == address(0)) revert ZeroAddress();
        akibaMiles = IAkibaMilesBurnable(_akibaMiles);
    }

    // ── Storage gap ───────────────────────────────────────────────────────────
    uint256[50] private __gap;
}
