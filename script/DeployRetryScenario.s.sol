// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface VmRetryScenario {
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

interface IKinnRetryScenario {
    function createVault(
        uint64 checkInInterval,
        uint8 maxMissedCheckIns,
        address[] calldata accounts,
        uint16[] calldata allocationsBps
    ) external payable;

    function deposit(address token, uint256 amount) external;
}

contract RetryScenarioRwaToken {
    string public constant name = "Kinn Retry Test RWA";
    string public constant symbol = "rtRWA";
    uint8 public constant decimals = 18;

    address public immutable controller;
    bool public failTransfers;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(address tokenController) {
        controller = tokenController;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == controller, "only controller");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function setFailTransfers(bool value) external {
        require(msg.sender == controller, "only controller");
        failTransfers = value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 available = allowance[from][msg.sender];
        if (available < amount) return false;
        allowance[from][msg.sender] = available - amount;
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private returns (bool) {
        if (failTransfers || to == address(0) || balanceOf[from] < amount) return false;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract RetryScenarioVaultOwner {
    address public immutable controller;
    RetryScenarioRwaToken public immutable token;

    constructor(address kinn, address beneficiary, address scenarioController) payable {
        controller = scenarioController;
        token = new RetryScenarioRwaToken(address(this));

        address[] memory accounts = new address[](1);
        accounts[0] = beneficiary;
        uint16[] memory allocations = new uint16[](1);
        allocations[0] = 10_000;
        IKinnRetryScenario(kinn).createVault{value: msg.value}(60, 1, accounts, allocations);

        uint256 amount = 75 ether;
        token.mint(address(this), amount);
        token.approve(kinn, amount);
        IKinnRetryScenario(kinn).deposit(address(token), amount);
        token.setFailTransfers(true);
    }

    function enableTransfers() external {
        require(msg.sender == controller, "only controller");
        token.setFailTransfers(false);
    }
}

contract DeployRetryScenario {
    VmRetryScenario private constant vm =
        VmRetryScenario(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (RetryScenarioVaultOwner scenario) {
        uint256 deployerPrivateKey = vm.envUint("KINN_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address kinn = vm.envAddress("KINN_CONTRACT_ADDRESS");
        address beneficiary = vm.envAddress("KINN_RETRY_BENEFICIARY");
        uint256 reserve = vm.envUint("KINN_RETRY_AUTOMATION_RESERVE_WEI");

        vm.startBroadcast(deployerPrivateKey);
        scenario = new RetryScenarioVaultOwner{value: reserve}(kinn, beneficiary, deployer);
        vm.stopBroadcast();
    }
}
