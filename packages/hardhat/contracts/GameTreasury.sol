// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAkibaMilesMintable {
    function mint(address account, uint256 amount) external;
}

contract GameTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NullAddress();
    error Unauthorized();
    error InsufficientMilesPool();

    IAkibaMilesMintable public immutable milesToken;
    IERC20 public stableToken;
    address public gameContract;
    uint256 public availableMiles;

    event GameContractUpdated(address indexed gameContract);
    event StableTokenUpdated(address indexed stableToken);
    event MilesFunded(uint256 amount);
    event StableFunded(address indexed from, uint256 amount);
    event Payout(address indexed player, uint256 milesAmount, uint256 stableAmount);

    constructor(address _milesToken, address _stableToken) {
        if (_milesToken == address(0)) revert NullAddress();
        milesToken = IAkibaMilesMintable(_milesToken);
        stableToken = IERC20(_stableToken);
    }

    modifier onlyGameContract() {
        if (msg.sender != gameContract) revert Unauthorized();
        _;
    }

    function setGameContract(address _gameContract) external onlyOwner {
        if (_gameContract == address(0)) revert NullAddress();
        gameContract = _gameContract;
        emit GameContractUpdated(_gameContract);
    }

    function setStableToken(address _stableToken) external onlyOwner {
        stableToken = IERC20(_stableToken);
        emit StableTokenUpdated(_stableToken);
    }

    /// @notice AkibaMilesV2 is non-transferable, so the reward pool is an accounting cap.
    /// The treasury must be configured as a minter on the Miles token before payouts.
    function fundMiles(uint256 amount) external onlyOwner {
        availableMiles += amount;
        emit MilesFunded(amount);
    }

    function fundStable(uint256 amount) external onlyOwner {
        if (address(stableToken) == address(0)) revert NullAddress();
        stableToken.safeTransferFrom(msg.sender, address(this), amount);
        emit StableFunded(msg.sender, amount);
    }

    function payout(address player, uint256 milesAmount, uint256 stableAmount)
        external
        onlyGameContract
        nonReentrant
    {
        if (player == address(0)) revert NullAddress();
        if (milesAmount > 0) {
            if (availableMiles < milesAmount) revert InsufficientMilesPool();
            availableMiles -= milesAmount;
            milesToken.mint(player, milesAmount);
        }
        if (stableAmount > 0) {
            if (address(stableToken) == address(0)) revert NullAddress();
            stableToken.safeTransfer(player, stableAmount);
        }
        emit Payout(player, milesAmount, stableAmount);
    }
}
