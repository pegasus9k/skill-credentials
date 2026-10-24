// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol"; // semi-fungible token standard
import "./PermissionGatekeeper.sol";

contract SkillBadge is ERC1155, PermissionGatekeeper {

    // ═══════════════════════════════════════════
    // Role constants (same keccak256 as IdentityRegistry)
    // ═══════════════════════════════════════════
    bytes32 public constant HEI_ADMIN_ROLE = keccak256("HEI_ADMIN_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant STUDENT_ROLE = keccak256("STUDENT_ROLE");

    // ═══════════════════════════════════════════
    // Maximum skill dimensions per badge (ecosystem rule)
    // ═══════════════════════════════════════════
    uint8 public constant MAX_SKILLS_PER_BADGE = 4;

    // ═══════════════════════════════════════════
    // Calldata parameter structs
    // ═══════════════════════════════════════════
    // Wrapping function parameters in a struct compresses stack pressure
    // (the EVM's 16-slot stack is the constraint that triggers
    // "Stack too deep" errors when a function has 6+ params plus locals).
    // Define and Update use separate structs because their data shapes differ:
    // updateBadge cannot change seasonId or courseId (immutable post-definition).

    struct BadgeDefineParams {
        bytes32 seasonId;       // Temporal anchor (e.g., keccak256("2025-S1"))
        bytes32 courseId;       // Course identifier (e.g., keccak256("ARed112"))
        bytes32 badgeCode;      // Evaluation identifier (e.g., keccak256("AR:GridLab"))
        bytes32[] skillIds;     // Which skills this badge carries (max 4)
        uint8[] points;         // Point values, parallel to skillIds
        bytes32 metadataCID;    // 32-byte SHA-256 digest of IPFS-pinned JSON
    }

    struct BadgeUpdateParams {
        bytes32 badgeCode;
        bytes32[] skillIds;
        uint8[] points;
        bytes32 metadataCID;
    }

    // ═══════════════════════════════════════════
    // Storage struct: badge type definition
    // ═══════════════════════════════════════════
    // Note: structs with mappings cannot be assigned as a whole
    // in Solidity (fields must be set individually in storage).
    struct BadgeDef {
        bytes32 seasonId;
        bytes32 courseId;
        bytes32 badgeCode;
        // Dual storage: the array lets indexers enumerate skills (getSkillIds).
        // The mapping lets SkillGraph look up points in O(1) (getSkillPoints).
        // Without the array, callers would have to guess which skills exist.
        // Without the mapping, allocation would loop-search instead of direct lookup.
        bytes32[] skillIds;                    // Which skills this badge carries (max 4)
        mapping(bytes32 => uint8) skills;      // skillId -> points (O(1) lookup)
        bytes32 metadataCID;                   // 32-byte SHA-256 digest of IPFS-pinned JSON
        bool exists;                           // Architectural guard flag
    }

    // ═══════════════════════════════════════════
    // State variables
    // ═══════════════════════════════════════════

    // Counter: assigns sequential IDs to new badge types (1, 2, 3...)
    // The "0" value is used as the "unallocated" sentinel in SkillGraph.sol -> committedTo()
    uint256 public nextTokenId = 1;

    // Badge catalog: tokenId -> definition struct (shared across all student holders)
    mapping(uint256 => BadgeDef) public badgeDefinitions;

    // Per-student grade hashes: student address -> tokenId -> SHA-256(grade + salt)
    mapping(address => mapping(uint256 => bytes32)) public gradeCommitments;

    // Season locks: seasonId -> frozen? (blocks new definitions and updates, not minting)
    mapping(bytes32 => bool) public seasonFrozen;

    // ═══════════════════════════════════════════
    // Events
    // ═══════════════════════════════════════════
    // Lean events. Indexer reads details via view functions
    // (getSkillIds, getSkillPoints, getMetadataCID).
    // SkillGraph follows the same lean event pattern (NodeDefined, NodeUpdated, etc.)

    event BadgeDefined(
        uint256 indexed tokenId,
        bytes32 indexed seasonId,
        bytes32 indexed courseId,
        bytes32 badgeCode
    );

    event BadgeUpdated(
        uint256 indexed tokenId,
        bytes32 badgeCode
    );

    event BadgeMinted(
        address indexed student,
        uint256 indexed tokenId,
        bytes32 gradeCommitment
    );

    event SeasonFrozen(
        bytes32 indexed seasonId
    );

    // ═══════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════
    constructor(address _registry, string memory _baseURI)
        ERC1155(_baseURI)
        PermissionGatekeeper(_registry)
    {}

    // ═══════════════════════════════════════════
    // Soulbound enforcement: block all transfers (only mints pass through)
    // ═══════════════════════════════════════════
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        require(from == address(0), "SkillBadge: soulbound, not transferable");
        super._update(from, to, ids, values);
    }

    // ═══════════════════════════════════════════
    // FR1: Define Badge Type (seasonal administrator)
    // ═══════════════════════════════════════════

    /// @notice Registers a new badge type with dynamic skill entries.
    /// @param params Definition parameters; see BadgeDefineParams above.
    ///        params.metadataCID may be bytes32(0) if metadata has not yet been pinned.
    function defineBadge(BadgeDefineParams calldata params)
        external
        onlyRole(HEI_ADMIN_ROLE)
        returns (uint256)
    {
        // Cannot add badges to a locked season
        require(!seasonFrozen[params.seasonId], "Season is frozen");

        // Skill arrays must match in length
        require(params.skillIds.length == params.points.length, "Mismatched skill arrays");

        // Enforce ecosystem rule: max 4 skill dimensions per badge
        require(params.skillIds.length <= MAX_SKILLS_PER_BADGE, "Too many skills (max 4)");

        // At least one skill required
        require(params.skillIds.length > 0, "Must have at least one skill");

        // Assign sequential ID and increment counter
        uint256 tokenId = nextTokenId;
        nextTokenId++;

        // Store definition field by field (structs with mappings can't be bulk-assigned)
        BadgeDef storage def = badgeDefinitions[tokenId];
        def.seasonId = params.seasonId;
        def.courseId = params.courseId;
        def.badgeCode = params.badgeCode;
        def.metadataCID = params.metadataCID;
        def.exists = true;

        // Store skill entries: both the iterable array and the O(1) mapping
        for (uint256 i = 0; i < params.skillIds.length; i++) {
            require(params.points[i] > 0, "Skill points must be > 0");
            // Prevent duplicate skill IDs in a single badge
            require(def.skills[params.skillIds[i]] == 0, "Duplicate skill ID");

            def.skillIds.push(params.skillIds[i]);
            def.skills[params.skillIds[i]] = params.points[i];
        }

        emit BadgeDefined(
            tokenId,
            params.seasonId,
            params.courseId,
            params.badgeCode
        );
        return tokenId;
    }

    // ═══════════════════════════════════════════
    // FR1b: Update Badge Definition (seasonal administrator)
    // ═══════════════════════════════════════════

    /// @notice Updates a badge's code, skill entries, and metadata CID (only before season freeze).
    /// @param _tokenId The badge token to update (lookup key, kept outside the params struct).
    /// @param params New values; see BadgeUpdateParams above.
    function updateBadge(uint256 _tokenId, BadgeUpdateParams calldata params)
        external
        onlyRole(HEI_ADMIN_ROLE)
    {
        BadgeDef storage def = badgeDefinitions[_tokenId];
        require(def.exists, "Badge type not defined");
        require(!seasonFrozen[def.seasonId], "Season is frozen");
        require(params.skillIds.length == params.points.length, "Mismatched skill arrays");
        require(params.skillIds.length <= MAX_SKILLS_PER_BADGE, "Too many skills (max 4)");
        require(params.skillIds.length > 0, "Must have at least one skill");

        // Clear old skill entries
        for (uint256 i = 0; i < def.skillIds.length; i++) {
            delete def.skills[def.skillIds[i]];
        }
        delete def.skillIds;

        // Write new skill entries
        def.badgeCode = params.badgeCode;
        def.metadataCID = params.metadataCID;
        for (uint256 i = 0; i < params.skillIds.length; i++) {
            require(params.points[i] > 0, "Skill points must be > 0");
            require(def.skills[params.skillIds[i]] == 0, "Duplicate skill ID");
            def.skillIds.push(params.skillIds[i]);
            def.skills[params.skillIds[i]] = params.points[i];
        }

        emit BadgeUpdated(_tokenId, params.badgeCode);
    }

    // ═══════════════════════════════════════════
    // FR2: Mint Badge to Student (Oracle)
    // ═══════════════════════════════════════════

    function mintBadge(
        address _student,
        uint256 _tokenId,
        bytes32 _gradeCommitment
    ) external onlyRole(ORACLE_ROLE) {
        require(badgeDefinitions[_tokenId].exists, "Badge type not defined");
        require(balanceOf(_student, _tokenId) == 0, "Already minted");
        require(registry.hasRole(STUDENT_ROLE, _student), "Recipient is not a registered student");

        _mint(_student, _tokenId, 1, "");
        gradeCommitments[_student][_tokenId] = _gradeCommitment;

        emit BadgeMinted(_student, _tokenId, _gradeCommitment);
    }

    // ═══════════════════════════════════════════
    // FR3: Freeze Season (seasonal administrator)
    // ═══════════════════════════════════════════

    function freezeSeason(bytes32 _seasonId) external onlyRole(HEI_ADMIN_ROLE) {
        require(!seasonFrozen[_seasonId], "Already frozen");
        seasonFrozen[_seasonId] = true;
        emit SeasonFrozen(_seasonId);
    }

    // ═══════════════════════════════════════════
    // View Functions (because BadgeDef contains a mapping and can't be returned as a whole)
    // ═══════════════════════════════════════════

    /// @notice O(1) lookup: returns points for a specific skill in a badge
    /// @dev Returns 0 if skill not present (Solidity mapping default).
    /// @dev Used by SkillGraph.sol during allocation threshold checks.
    function getSkillPoints(uint256 _tokenId, bytes32 _skillId) external view returns (uint8) {
        require(badgeDefinitions[_tokenId].exists, "Badge type not defined");
        return badgeDefinitions[_tokenId].skills[_skillId];
    }

    /// @notice Returns the list of skill IDs that a badge carries.
    /// @dev Used by frontend/indexer to know which skills to query.
    function getSkillIds(uint256 _tokenId) external view returns (bytes32[] memory) {
        require(badgeDefinitions[_tokenId].exists, "Badge type not defined");
        return badgeDefinitions[_tokenId].skillIds;
    }

    /// @notice Returns the number of skill dimensions in a badge.
    function getSkillCount(uint256 _tokenId) external view returns (uint256) {
        require(badgeDefinitions[_tokenId].exists, "Badge type not defined");
        return badgeDefinitions[_tokenId].skillIds.length;
    }

    /// @notice Returns the raw 32-byte IPFS metadata digest for a badge
    /// @dev May be bytes32(0) if metadata was never pinned for this badge
    function getMetadataCID(uint256 _tokenId) external view returns (bytes32) {
        require(badgeDefinitions[_tokenId].exists, "Badge type not defined");
        return badgeDefinitions[_tokenId].metadataCID;
    }

    /// @notice Reconstructs the full IPFS URI from the stored 32-byte digest.
    /// @dev Format: "ipfs://f01551220<64-hex-chars>"
    ///      f=base16 multibase, 01=CIDv1, 55=raw codec, 12=SHA-256, 20=32-byte length.
    /// @dev Reverts for undefined badge IDs, matching other view functions.
    /// @dev Satisfies the ERC1155 standard interface: 
    ///      external wallets (MetaMask, OpenSea) call uri() to auto-display token metadata.
    ///      Our own indexer bypasses this. It reads the raw CID via getMetadataCID()
    ///      and reconstructs the link in JavaScript, which is more efficient.
    function uri(uint256 _tokenId) public view override returns (string memory) {
        require(badgeDefinitions[_tokenId].exists, "Badge type not defined");
        bytes32 cid = badgeDefinitions[_tokenId].metadataCID;
        return string(abi.encodePacked("ipfs://f01551220", _bytes32ToHex(cid)));
    }

    /// @dev Lowercase hex encoding of a bytes32 value (64 chars, no "0x" prefix).
    function _bytes32ToHex(bytes32 _data) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory str = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            str[i * 2]     = alphabet[uint8(_data[i] >> 4)];
            str[i * 2 + 1] = alphabet[uint8(_data[i] & 0x0f)];
        }
        return string(str);
    }
}
