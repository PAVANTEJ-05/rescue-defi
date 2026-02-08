// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract RescueExecutor {
    error OnlyKeeper();
    error CooldownActive(uint256 remaining);
    error InvalidTarget();
    error ERC20TransferFailed();
    error ERC20ApproveFailed();
    error CallFailed();

    address public immutable keeper;
    uint256 public immutable COOLDOWN_SECONDS;

    mapping(address => uint256) public lastRescueAt;

    event RescueExecuted(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        address target,
        uint256 timestamp
    );

    constructor(address _keeper, uint256 _cooldownSeconds) {
        keeper = _keeper;
        COOLDOWN_SECONDS = _cooldownSeconds;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert OnlyKeeper();
        _;
    }

    modifier cooldownPassed(address user) {
        uint256 last = lastRescueAt[user];
        if (last != 0 && block.timestamp - last < COOLDOWN_SECONDS) {
            revert CooldownActive(COOLDOWN_SECONDS - (block.timestamp - last));
        }
        _;
    }

    /// @notice Execute a rescue action on behalf of a user
    /// @param user      The user whose tokens are being rescued
    /// @param tokenIn   The ERC20 token to pull from the user
    /// @param amountIn  How much to pull
    /// @param target    The contract to call (Aave Pool, LiFi Diamond, etc.)
    /// @param callData  The calldata to forward to `target`
    function executeRescue(
        address user,
        address tokenIn,
        uint256 amountIn,
        address target,
        bytes calldata callData
    ) external payable onlyKeeper cooldownPassed(user) {
        if (target == address(0)) revert InvalidTarget();

        lastRescueAt[user] = block.timestamp;

        // 1. Pull tokens from user
        bool ok = IERC20(tokenIn).transferFrom(user, address(this), amountIn);
        if (!ok) revert ERC20TransferFailed();

        // 2. Approve target to spend tokens
        ok = IERC20(tokenIn).approve(target, 0);
        if (!ok) revert ERC20ApproveFailed();
        ok = IERC20(tokenIn).approve(target, amountIn);
        if (!ok) revert ERC20ApproveFailed();

        // 3. Forward call to target
        (bool success, ) = target.call{value: msg.value}(callData);
        if (!success) revert CallFailed();

        emit RescueExecuted(user, tokenIn, amountIn, target, block.timestamp);
    }

    receive() external payable {}
}