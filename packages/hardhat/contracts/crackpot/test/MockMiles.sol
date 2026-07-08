// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Minimal AkibaMiles mock: freely mintable/burnable, no access control.
contract MockMiles {
    mapping(address => uint256) private _bal;

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
    }

    function burn(address from, uint256 amount) external {
        require(_bal[from] >= amount, "MockMiles: insufficient balance");
        _bal[from] -= amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _bal[account];
    }

    /// @dev Convenience for test setup — give a player a starting balance.
    function deal(address to, uint256 amount) external {
        _bal[to] = amount;
    }
}
