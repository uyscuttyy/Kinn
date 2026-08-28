// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {KinnVaultFactory} from "../src/VaultFactory.sol";

interface VmDeploy {
    function envUint(string calldata name) external view returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployKinn {
    VmDeploy private constant vm = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (KinnVaultFactory deployed) {
        uint256 deployerPrivateKey = vm.envUint("KINN_DEPLOYER_PRIVATE_KEY");
        uint256 automationFeeWei = vm.envUint("KINN_AUTOMATION_FEE_WEI");
        vm.startBroadcast(deployerPrivateKey);
        deployed = new KinnVaultFactory(automationFeeWei);
        vm.stopBroadcast();
    }
}
