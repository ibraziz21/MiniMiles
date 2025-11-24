// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Very simple points token for testing AkibaDiceGame.
///      Matches the interface used by AkibaRaffle / MiniPoints:
///      - mint(address,uint256)
///      - burn(address,uint256)
///      - balanceOf(address) → uint256
contract MiniPointsMock {
    mapping(address => uint256) private _balances;

    function mint(address to, uint256 amount) external {
        _balances[to] += amount;
    }

    function burn(address from, uint256 amount) external {
        require(_balances[from] >= amount, "Mock: insufficient balance");
        _balances[from] -= amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }
}
