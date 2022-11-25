// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface ICbETH {
    function exchangeRate() external view returns (uint256);

    function decimals() external view returns(uint8);
}