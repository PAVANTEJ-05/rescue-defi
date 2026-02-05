// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*//////////////////////////////////////////////////////////////
                            INTERFACE
//////////////////////////////////////////////////////////////*/

interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
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
    error CallFailed();
    error InvalidTarget();

    /*//////////////////////////////////////////////////////////////
                              STORAGE
    //////////////////////////////////////////////////////////////*/

    address public immutable keeper;          // your dummy keeper wallet
    address public immutable lifiRouter;      // official LI.FI router

    uint256 public immutable COOLDOWN_SECONDS;

    // cooldown tracked PER USER (not keeper)
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
     * @notice Executes a LI.FI transaction exactly as provided by keeper
     *
     * @param user      User whose funds are used and position is rescued
     * @param tokenIn   ERC20 token address OR address(0) for ETH
     * @param amountIn Amount of ERC20 to pull (ignored for ETH)
     * @param target   Must be LI.FI router address
     * @param callData Exact calldata returned by LI.FI API
     */
    function executeRescue(
        address user,
        address tokenIn,
        uint256 amountIn,
        address target,
        bytes calldata callData
    )
        external
        payable
        onlyKeeper
        cooldownPassed(user)
    {
        // enforce trusted LI.FI target
        if (target != lifiRouter) revert InvalidTarget();

        // update cooldown FIRST (replay-safe)
        lastRescueAt[user] = block.timestamp;

        // pull ERC20 from user if needed
        if (tokenIn != address(0)) {
            IERC20(tokenIn).transferFrom(
                user,
                address(this),
                amountIn
            );
        }

        // forward exact LI.FI call
        (bool success, ) = target.call{ value: msg.value }(callData);
        if (!success) revert CallFailed();

        emit RescueExecuted(
            user,
            tokenIn,
            amountIn,
            block.timestamp
        );
    }

    /*//////////////////////////////////////////////////////////////
                        RECEIVE ETH (BRIDGES)
    //////////////////////////////////////////////////////////////*/

    receive() external payable {}
}
