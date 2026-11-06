// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local tests only. This is never an acceptable sponsor payment asset.
contract MockUsdt is ERC20 {
    bool public failTransfers;
    bool public chargeFee;
    address public callbackTarget;
    bytes public callbackData;
    bytes4 public callbackFailure;

    constructor() ERC20("Local test USDT", "TEST-USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 value) external { _mint(to, value); }
    function setFailTransfers(bool value) external { failTransfers = value; }
    function setChargeFee(bool value) external { chargeFee = value; }
    function setCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (failTransfers) return false;
        if (callbackTarget != address(0)) {
            address target = callbackTarget;
            callbackTarget = address(0);
            (bool success, bytes memory result) = target.call(callbackData);
            if (!success && result.length >= 4) callbackFailure = bytes4(result);
        }
        return super.transferFrom(from, to, value);
    }
    function _update(address from, address to, uint256 value) internal override {
        if (chargeFee && from != address(0) && to != address(0) && value > 0) {
            super._update(from, address(0), 1);
            super._update(from, to, value - 1);
        } else super._update(from, to, value);
    }
}
