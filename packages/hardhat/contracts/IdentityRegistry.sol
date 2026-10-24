// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title IdentityRegistry: Single source of truth for ecosystem roles
/// @notice All role assignments flow through dedicated anchor/remove functions.
///         Direct grantRole(), revokeRole() and renounceRole() are blocked to enforce the
///         registration workflows, ensuring every role change emits its own
///         event, so the ledger keeps a full record of which addresses held
///         each role and when.

contract IdentityRegistry is AccessControl {

    // ═══════════════════════════════════════════
    // Role constants (keccak256 computed at compile time - bytecode)
    // ═══════════════════════════════════════════
    bytes32 public constant HEI_ADMIN_ROLE  = keccak256("HEI_ADMIN_ROLE");   // Seasonal administrator
    bytes32 public constant REGISTRAR_ROLE  = keccak256("REGISTRAR_ROLE");   // Backend service that anchors students
    bytes32 public constant ORACLE_ROLE     = keccak256("ORACLE_ROLE");      // Backend service that mints badges
    bytes32 public constant THIRD_PARTY_ROLE = keccak256("THIRD_PARTY_ROLE"); // F12: third parties (was SPONSOR_ROLE)
    bytes32 public constant STUDENT_ROLE    = keccak256("STUDENT_ROLE");     // Enrolled students

    // ═══════════════════════════════════════════
    // Registration events (one per role type)
    // ═══════════════════════════════════════════
    // F12: one event per role, so the ledger keeps a typed, public record of
    // every grant and removal. The event indexer does not read these events.
    // The backend and the contracts check roles with hasRole() instead.

    event StudentRegistered(address indexed wallet);
    event ThirdPartyRegistered(address indexed wallet);
    event OracleRegistered(address indexed wallet);
    event RegistrarRegistered(address indexed wallet);

    // ═══════════════════════════════════════════
    // Deactivation events (lifecycle tracking)
    // ═══════════════════════════════════════════
    // Paired with remove functions, so the ledger records the full
    // registration lifecycle: registered -> active -> deactivated.

    event StudentDeactivated(address indexed wallet);
    event ThirdPartyDeactivated(address indexed wallet);
    event OracleDeactivated(address indexed wallet);
    event RegistrarDeactivated(address indexed wallet);

    // ═══════════════════════════════════════════
    // Constructor: Bootstrap Sequence
    // ═══════════════════════════════════════════
    // Transaction 1: Deploy with HEI Admin address:
    //   - Deployer gets temporary DEFAULT_ADMIN_ROLE;
    //   - Role hierarchy configured via _setRoleAdmin;
    //   - HEI_ADMIN_ROLE granted to university delegate
    //
    // Transaction 2: Deployer calls renounceAdmin() to permanently discard root privileges.

    constructor(address heiAdmin) {
        require(heiAdmin != address(0), "Invalid HEI admin");

        // Temporary root: must be renounced after bootstrap
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        // Role hierarchy: HEI Admin administers all operational roles
        _setRoleAdmin(HEI_ADMIN_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(REGISTRAR_ROLE, HEI_ADMIN_ROLE);
        _setRoleAdmin(ORACLE_ROLE, HEI_ADMIN_ROLE);
        _setRoleAdmin(THIRD_PARTY_ROLE, HEI_ADMIN_ROLE);
        _setRoleAdmin(STUDENT_ROLE, HEI_ADMIN_ROLE);

        _grantRole(HEI_ADMIN_ROLE, heiAdmin);
    }

    // ═══════════════════════════════════════════
    // Block direct grantRole / revokeRole / renounceRole
    // ═══════════════════════════════════════════
    // OpenZeppelin's grantRole() and revokeRole() are general-purpose.
    // Overridden to block direct grantRole() calls. This routes all changes
    // through anchor/remove, guaranteeing that every role change emits its event.
    // F26: renounceRole() too, so no holder drops its own role outside the
    // remove functions. renounceAdmin() revokes internally and still works.

    function grantRole(bytes32, address) public pure override {
        revert("Use dedicated anchor functions");
    }

    function revokeRole(bytes32, address) public pure override {
        revert("Use dedicated remove functions");
    }

    function renounceRole(bytes32, address) public pure override {
        revert("Use dedicated remove functions");
    }

    // ═══════════════════════════════════════════
    // Bootstrap: Deployer renounces root access
    // ═══════════════════════════════════════════
    // Called after verifying HEI Admin can operate the system.
    // After this, no address holds DEFAULT_ADMIN_ROLE.
    // HEI_ADMIN becomes the highest operational authority. Irreversible.


    function renounceAdmin() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokeRole(DEFAULT_ADMIN_ROLE, msg.sender);
        // NOTE: During prototype development, deployer can retain
        // DEFAULT_ADMIN_ROLE for operational flexibility.
    }

    // ═══════════════════════════════════════════
    // Anchor functions (controlled registration gateways)
    // ═══════════════════════════════════════════
    // Each role has its own anchor function with:
    //   - Specific caller restriction (who can register this role);
    //   - Non-zero address validation;
    //   - Duplicate registration check;
    //   - Typed event emission.

    /// @notice Register a student wallet. Called by the backend service
    ///         after FénixEdu OAuth verification.
    function anchorStudent(address wallet) external onlyRole(REGISTRAR_ROLE) {
        require(wallet != address(0), "Invalid address");
        require(!hasRole(STUDENT_ROLE, wallet), "Already registered");

        _grantRole(STUDENT_ROLE, wallet);
        emit StudentRegistered(wallet);
    }

    /// @notice Register a third party wallet. Called by the seasonal
    ///         administrator after reviewing the application. The organization
    ///         details and the NIF stay in the private data.
    function anchorThirdParty(address wallet) external onlyRole(HEI_ADMIN_ROLE) {
        require(wallet != address(0), "Invalid address");
        require(!hasRole(THIRD_PARTY_ROLE, wallet), "Already registered");

        _grantRole(THIRD_PARTY_ROLE, wallet);
        emit ThirdPartyRegistered(wallet);
    }

    /// @notice Activate the Oracle service key. Called by HEI Admin
    ///         during platform setup.
    function anchorOracle(address wallet) external onlyRole(HEI_ADMIN_ROLE) {
        require(wallet != address(0), "Invalid address");
        require(!hasRole(ORACLE_ROLE, wallet), "Already registered");

        _grantRole(ORACLE_ROLE, wallet);
        emit OracleRegistered(wallet);
    }

    /// @notice Activate the Registrar service key. Called by HEI Admin
    ///         during platform setup.
    function anchorRegistrar(address wallet) external onlyRole(HEI_ADMIN_ROLE) {
        require(wallet != address(0), "Invalid address");
        require(!hasRole(REGISTRAR_ROLE, wallet), "Already registered");

        _grantRole(REGISTRAR_ROLE, wallet);
        emit RegistrarRegistered(wallet);
    }

    // ═══════════════════════════════════════════
    // Remove functions (controlled revocation gateways)
    // ═══════════════════════════════════════════
    // Revocation is atomic and system-wide:
    // A single removal here immediately locks the stakeholder out of
    // every downstream module via PermissionGatekeeper.

    function removeStudent(address wallet) external onlyRole(HEI_ADMIN_ROLE) {
        require(hasRole(STUDENT_ROLE, wallet), "Not a registered student");

        _revokeRole(STUDENT_ROLE, wallet);
        emit StudentDeactivated(wallet);
    }

    function removeThirdParty(address wallet) external onlyRole(HEI_ADMIN_ROLE) {
        require(hasRole(THIRD_PARTY_ROLE, wallet), "Not a registered third party");

        _revokeRole(THIRD_PARTY_ROLE, wallet);
        emit ThirdPartyDeactivated(wallet);
    }

    function removeOracle(address wallet) external onlyRole(HEI_ADMIN_ROLE) {
        require(hasRole(ORACLE_ROLE, wallet), "Not a registered oracle");

        _revokeRole(ORACLE_ROLE, wallet);
        emit OracleDeactivated(wallet);
    }

    function removeRegistrar(address wallet) external onlyRole(HEI_ADMIN_ROLE) {
        require(hasRole(REGISTRAR_ROLE, wallet), "Not a registered registrar");

        _revokeRole(REGISTRAR_ROLE, wallet);
        emit RegistrarDeactivated(wallet);
    }
}
