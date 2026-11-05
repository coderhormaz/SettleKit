// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Compilation-only spike. This is not SettleKit's payment router and is never deployed.
contract ToolchainSmoke {
    using SafeERC20 for IERC20;

    function requireExactAmount(uint256 amount) external pure returns (uint256) {
        require(amount > 0, "ZERO_AMOUNT");
        return amount;
    }
}
