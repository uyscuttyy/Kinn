// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public failTransfers;
    bool public falseAfterTransfer;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function setFalseAfterTransfer(bool value) external {
        falseAfterTransfer = value;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        bool moved = _move(msg.sender, to, amount);
        if (moved && falseAfterTransfer) return false;
        return moved;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] < amount) return false;
        allowance[from][msg.sender] -= amount;
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) private returns (bool) {
        if (failTransfers || balanceOf[from] < amount) return false;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
