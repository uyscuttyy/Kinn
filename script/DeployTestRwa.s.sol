// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TestRwaToken} from "../src/TestRwaToken.sol";

interface VmTestRwaDeploy {
    function envUint(string calldata name) external view returns (uint256);
    function addr(uint256 privateKey) external returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployTestRwa {
    VmTestRwaDeploy private constant vm = VmTestRwaDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (TestRwaToken deployed) {
        uint256 deployerPrivateKey = vm.envUint("KINN_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        vm.startBroadcast(deployerPrivateKey);
        deployed = new TestRwaToken("Kinn Test RWA", "tRWA", 18);
        deployed.mint(deployer, 1_000_000 ether);
        vm.stopBroadcast();
    }
}
