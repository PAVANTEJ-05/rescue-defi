// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*//////////////////////////////////////////////////////////////
                        SAFE ERC20 INTERFACE
//////////////////////////////////////////////////////////////*/

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);

    function approve(address spender, uint256 amount)
        external
        returns (bool);
}

/*//////////////////////////////////////////////////////////////
                        RESCUE EXECUTOR
//////////////////////////////////////////////////////////////*/

contract RescueExecutor {
    /*//////////////////////////////////////////////////////////////
                                ERRORS
    //////////////////////////////////////////////////////////////*/

    error OnlyKeeper();
    error CooldownActive(uint256 remaining);
    error InvalidTarget();
    error ERC20TransferFailed();
    error ERC20ApproveFailed();
    error LiFiCallFailed();
    error ResidualBalance();

    /*//////////////////////////////////////////////////////////////
                              STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Off-chain keeper / bot
    address public immutable keeper;

    /// @notice Official LI.FI router address
    address public immutable lifiRouter;

    /// @notice Cooldown in seconds (per user)
    uint256 public immutable COOLDOWN_SECONDS;

    /// @notice Last rescue timestamp per user
    mapping(address => uint256) public lastRescueAt;

    /*//////////////////////////////////////////////////////////////
                                EVENTS
    //////////////////////////////////////////////////////////////*/

    event RescueExecuted(
        address indexed user,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 timestamp
    );

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address _keeper,
        address _lifiRouter,
        uint256 _cooldownSeconds
    ) {
        keeper = _keeper;
        lifiRouter = _lifiRouter;
        COOLDOWN_SECONDS = _cooldownSeconds;
    }

    /*//////////////////////////////////////////////////////////////
                              MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert OnlyKeeper();
        _;
    }

    modifier cooldownPassed(address user) {
        uint256 last = lastRescueAt[user];
        if (block.timestamp < last + COOLDOWN_SECONDS) {
            revert CooldownActive(
                (last + COOLDOWN_SECONDS) - block.timestamp
            );
        }
        _;
    }

    /*//////////////////////////////////////////////////////////////
                        CORE RESCUE EXECUTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Executes an atomic LI.FI rescue flow
     *
     * FLOW (single transaction):
     * 1. Pull ERC20 from user
     * 2. Approve LI.FI router
     * 3. Execute LI.FI calldata (swap / bridge / repay)
     * 4. Cleanup approval
     *
     * If ANY step fails → entire tx reverts → user keeps funds
     */
    function executeRescue(
        address user,
        address tokenIn,
        uint256 amountIn,
        bytes calldata callData
    )
        external
        payable
        onlyKeeper
        cooldownPassed(user)
    {
        // ------------------------------------------------------------------
        // 1. Enforce trusted LI.FI target
        // ------------------------------------------------------------------
        address target = lifiRouter;

        // ------------------------------------------------------------------
        // 2. Update cooldown FIRST (reentrancy & replay safe)
        // ------------------------------------------------------------------
        lastRescueAt[user] = block.timestamp;

        // ------------------------------------------------------------------
        // 3. Pull ERC20 from user
        // ------------------------------------------------------------------
        if (tokenIn != address(0)) {
            bool pulled = IERC20(tokenIn).transferFrom(
                user,
                address(this),
                amountIn
            );
            if (!pulled) revert ERC20TransferFailed();

            // ------------------------------------------------------------------
            // 4. Approve LI.FI router (exact amount)
            // ------------------------------------------------------------------
            bool resetOk = IERC20(tokenIn).approve(target, 0);
            if (!resetOk) revert ERC20ApproveFailed();

            bool approveOk = IERC20(tokenIn).approve(target, amountIn);
            if (!approveOk) revert ERC20ApproveFailed();
        }

        // ------------------------------------------------------------------
        // 5. Execute LI.FI calldata
        // ------------------------------------------------------------------
        (bool success, ) = target.call{ value: msg.value }(callData);
        if (!success) revert LiFiCallFailed();

        // ------------------------------------------------------------------
        // 6. Cleanup approvals & ensure no residual balance
        // ------------------------------------------------------------------
        if (tokenIn != address(0)) {
            // remove approval
            IERC20(tokenIn).approve(target, 0);

            // enforce invariant: executor must not keep funds
            if (IERC20(tokenIn).balanceOf(address(this)) != 0) {
                revert ResidualBalance();
            }
        }

        emit RescueExecuted(
            user,
            tokenIn,
            amountIn,
            block.timestamp
        );
    }

    /*//////////////////////////////////////////////////////////////
                        RECEIVE ETH (OPTIONAL)
    //////////////////////////////////////////////////////////////*/

    receive() external payable {}
}