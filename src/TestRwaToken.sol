// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Testnet-only ERC-20 used to validate Kinn's RWA lifecycle.
contract TestRwaToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public immutable minter;

    mapping(address account => uint256) public balanceOf;
    mapping(address owner => mapping(address spender => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    error Unauthorized();
    error InsufficientBalance();
    error InsufficientAllowance();
    error InvalidRecipient();

    constructor(string memory tokenName, string memory tokenSymbol, uint8 tokenDecimals) {
        name = tokenName;
        symbol = tokenSymbol;
        decimals = tokenDecimals;
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert Unauthorized();
        if (to == address(0)) revert InvalidRecipient();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        if (available < amount) revert InsufficientAllowance();
        allowance[from][msg.sender] = available - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert InvalidRecipient();
        uint256 available = balanceOf[from];
        if (available < amount) revert InsufficientBalance();
        balanceOf[from] = available - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
