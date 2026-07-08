// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Simple 6-decimal ERC-20 used for CrackPot USDT tests.
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "mUSDT") {}

    function decimals() public pure override returns (uint8) { return 6; }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
