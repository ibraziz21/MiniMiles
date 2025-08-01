// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract AkibaMiles is ERC20, Ownable {
    error NullAddress();
    error Unauthorized();
    mapping(address => bool) public minters;

    constructor() ERC20("AkibaMiles", "Miles") {}

    modifier onlyAllowed() {
        if (msg.sender != owner() && !minters[msg.sender])
            revert Unauthorized();
        _;
    }

    function setMinter(address who, bool enabled) external onlyOwner {
        require(who != address(0), "Zero addr");
        minters[who] = enabled;
    }

    function mint(address account, uint256 amount) external onlyAllowed {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external {
        _burn(account, amount);
    }

    // Make token non-transferrable
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20) {
        // Allow minting (from == 0) and burning (to == 0) only
        if (from != address(0) && to != address(0)) {
            revert("Transfers are not allowed");
        }
        super._beforeTokenTransfer(from, to, amount);
    }

    // The following functions are overrides required by Solidity.

    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20) {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal override(ERC20) {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount) internal override(ERC20) {
        super._burn(account, amount);
    }
}

interface IMiniPoints {
    function mint(address account, uint256 amount) external;

    function burn(address account, uint256 amount) external;

    function balanceOf(address account) external view returns (uint256);
}
