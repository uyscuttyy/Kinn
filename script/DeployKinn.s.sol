// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVault} from "../src/KinnVault.sol";

interface VmDeploy {
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployKinn {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (KinnVault deployed) {
        uint256 deployerPrivateKey = vm.envUint("KINN_DEPLOYER_PRIVATE_KEY");
        uint256 automationFeeWei = vm.envUint("KINN_AUTOMATION_FEE_WEI");
        vm.startBroadcast(deployerPrivateKey);
        deployed = new KinnVault(automationFeeWei);
        vm.stopBroadcast();
    }
}
