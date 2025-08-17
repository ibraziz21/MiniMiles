// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MiniRaffle.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract AkibaRaffleV2 is AkibaRaffle {
    using SafeERC20 for IERC20;

    event Withdraw(address indexed token, address indexed to, uint256 amount);

    /// @notice Owner withdraws stuck tokens (USDT, cUSD, etc.) from contract
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Withdraw: zero addr");
        require(amount > 0, "Withdraw: zero amount");
        IERC20(token).safeTransfer(to, amount);

        emit Withdraw(token, to, amount);
    }

        function drawWinner(
        uint256 _roundId
    ) external nonReentrant override roundExists(_roundId) {
        RaffleRound storage r = rounds[_roundId];
        require(r.isActive, "Raffle: inactive round");
        require(!r.winnerSelected, "Raffle: already drawn");
        require(
            block.timestamp > r.endTime || r.totalTickets == r.maxTickets,
            "Raffle: unfinished"
        );
        uint256 threshold = (uint256(r.maxTickets) * 60) / 100;
        require(r.totalTickets >= threshold, "Raffle: threshold not met");
        require(
            r.randomBlock != 0 && RNG.isRandomized(r.randomBlock),
            "Raffle: randomness pending"
        );

        uint256 pick = RNG.random(r.totalTickets, 0, r.randomBlock);
        r.winner = _selectByIndex(r, pick);
        r.isActive = false;
        r.winnerSelected = true;
        if (address(r.rewardToken) == address(miles)) {
            miniPoints.mint(r.winner, r.rewardPool);
        } else {
            r.rewardToken.safeTransfer(r.winner, r.rewardPool);
        }

        emit WinnerSelected(_roundId, r.winner, r.rewardPool);
    }

       function closeRaffle(
        uint256 _roundId
    ) external nonReentrant override roundExists(_roundId) {
        RaffleRound storage round = rounds[_roundId];
        require(round.isActive, "Raffle: inactive");
        require(block.timestamp > round.endTime, "Raffle: not ended");

        // must be below 60% of maxTickets
        require(
            round.totalTickets * 100 < uint256(round.maxTickets) * 20,
            "Raffle: threshold met"
        );

        // refund each participant their spent points
        round.isActive = false;
        for (uint256 i = 0; i < round.participants.length; i++) {
            address player = round.participants[i];
            uint32 bought = round.tickets[player];
            if (bought > 0) {
                uint256 refundAmount = uint256(bought) * round.ticketCostPoints;
                // mint the same amount back
                miniPoints.mint(player, refundAmount);
                // zero out tickets to avoid re-entry
                round.tickets[player] = 0;
            }
        }

        // mark closed

        emit RaffleClosed(_roundId);
    }
}