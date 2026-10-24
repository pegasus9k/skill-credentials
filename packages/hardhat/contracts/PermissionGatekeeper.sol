// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Minimal interface: exposes only hasRole() from IdentityRegistry.
interface IIdentityRegistry {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

abstract contract PermissionGatekeeper {
    IIdentityRegistry public immutable registry;

    constructor(address _registry) {
        require(_registry != address(0), "Invalid registry");
        registry = IIdentityRegistry(_registry);
    }

    // Reusable access control modifier inherited by SkillBadge, SkillGraph and SkillPath.
    // Delegates role verification to the IdentityRegistry via cross-contract call.
    // The _; placeholder is where the actual function body executes.
    modifier onlyRole(bytes32 role) {
        require(
            registry.hasRole(role, msg.sender),
            "PermissionGatekeeper: unauthorized"
        );
        _;
    }
}