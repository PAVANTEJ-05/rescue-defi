// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RescueRiskHook {
    function beforeSwap() external pure returns (bool) {
        return true;
    }
}
