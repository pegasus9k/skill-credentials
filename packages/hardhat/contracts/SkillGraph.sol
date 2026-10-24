// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "./PermissionGatekeeper.sol";

// SkillGraph only needs three functions from SkillBadge.sol:
interface ISkillBadge {
    function balanceOf(address account, uint256 id) external view returns (uint256); // does the student own this badge?
    function getSkillPoints(uint256 tokenId, bytes32 skillId) external view returns (uint8); // how many points for this skill?
    function getSkillIds(uint256 tokenId) external view returns (bytes32[] memory); // which skills does this badge carry?
}

contract SkillGraph is ERC1155, PermissionGatekeeper {

    bytes32 public constant HEI_ADMIN_ROLE = keccak256("HEI_ADMIN_ROLE");
    bytes32 public constant STUDENT_ROLE = keccak256("STUDENT_ROLE");

    ISkillBadge public immutable skillBadge;

    // Prototype bounds on prerequisite expressiveness. The current DAG needs
    // at most 2 groups of 2; (X OR Y) AND (W OR Z) expands to 4 groups of 2.
    // The caps catch malformed definitions at write time and bound the
    // student-paid unlock loop in allocateBadges(). Mirrors the
    // MAX_NODES_PER_PATH pattern in SkillPath.
    uint256 public constant MAX_PREREQ_GROUPS = 4;
    uint256 public constant MAX_GROUP_SIZE = 4;

    // F5: cap on threshold skill types, same as MAX_SKILLS_PER_BADGE in
    // SkillBadge. allocateBadges() loops once per threshold skill type, so
    // this bounds the student-paid unlock cost like the prerequisite caps.
    // The cohort uses at most 3.
    uint256 public constant MAX_THRESHOLD_SKILLS = 4;

    // ═══════════════════════════════════════════
    // Calldata parameter structs
    // ═══════════════════════════════════════════
    // Wrapping function parameters in a struct compresses stack pressure.
    // defineNode previously had 7 explicit params, which caused
    // "Stack too deep" errors when combined with loop counters and locals.
    // Define and Update use separate structs because their data shapes differ:
    // updateNode cannot change seasonId (immutable post-definition).

    struct NodeDefineParams {
        bytes32 seasonId;
        bytes32 nodeCode;
        bytes32[] skillIds;            // Threshold skill identifiers
        uint8[] points;                // Threshold values, parallel to skillIds
        uint256[][] prerequisiteGroups; // DNF groups; empty outer array = base node. See NodeDef.
        bytes32 metadataCID;           // 32-byte SHA-256 digest of IPFS-pinned JSON
        uint256 versionOf;             // LINEAGE: 0 = original. Otherwise an existing node
                                       // this one is a version of. Fixed at definition,
                                       // so NodeUpdateParams does not carry it.
    }

    struct NodeUpdateParams {
        bytes32 nodeCode;
        bytes32[] skillIds;
        uint8[] points;
        uint256[][] prerequisiteGroups;
        bytes32 metadataCID;
    }

    // ═══════════════════════════════════════════
    // Storage struct
    // ═══════════════════════════════════════════
    struct NodeDef {
        bytes32 seasonId;
        bytes32 nodeCode;

        // Dual storage: the array lets indexers enumerate required skills (getThresholdSkillIds).
        // The mapping lets allocateBadges() look up required points in O(1) (getThresholdPoints).
        // Without the array, callers would have to guess which skills the node requires.
        // Without the mapping, threshold validation would loop-search instead of direct lookup.
        bytes32[] thresholdSkillIds;
        mapping(bytes32 => uint8) threshold;

        // Prerequisite logic in disjunctive normal form (DNF):
        // the outer array is an OR over groups; each inner group is an AND.
        // A student satisfies the prerequisites by fully holding ANY one group.
        //   []               -> base node, no prerequisites
        //   [[A, B]]         -> A AND B
        //   [[A, C], [B, C]] -> (A OR B) AND C, expanded to groups
        uint256[][] prerequisiteGroups;
        bytes32 metadataCID;                   // 32-byte SHA-256 digest of IPFS-pinned JSON

        // LINEAGE: the original competency this node is a version of.
        // An original points to itself. A new version points to the original,
        // never to another version, so the lookup is always one step.
        uint256 versionOf;
        bool exists;
    }

    // Counter: assigns sequential IDs to new competency nodes (1, 2, 3...).
    // Defaults to 0, meaning "unallocated".
    uint256 public nextNodeId = 1;

    // DAG structure: nodeId -> definition (thresholds, prerequisites, metadata).
    // Shared across all students.
    mapping(uint256 => NodeDef) public nodeDefinitions;

    // Badge allocation registry: student -> badgeId -> nodeId.
    // Once set to a non-zero nodeId, that badge is permanently locked to that node.
    // Answers: "Is this badge already allocated? If so, to which node?"
    mapping(address => mapping(uint256 => uint256)) public committedTo;

    // Reverse lookup: student -> nodeId -> badgeIds[].
    // Accessible only through getNodeBadges() view function (private).
    // Answers: "Which badges did this student use to unlock this competency?"
    // Stores the full provenance trail for on-chain auditability.
    mapping(address => mapping(uint256 => uint256[])) private nodeBadges;

    // Season locks: seasonId -> frozen? (blocks new node definitions and updates, not allocation)
    mapping(bytes32 => bool) public seasonFrozen;

    // LINEAGE: student -> original node ID -> holds some version of it?
    // Set at every unlock. Read only by the prerequisite check, so a frozen
    // node that requires competency X accepts any version of X, and the
    // institution never has to re-version the nodes that depend on it.
    mapping(address => mapping(uint256 => bool)) public holdsVersionOf;

    // Lean events -> indexer reads details via view functions, including getMetadataCID().

    // Exception: NodeUnlocked includes the badgeIds[] array directly in the event
    // for indexer convenience. Avoids an extra getNodeBadges() call per event
    // during historical replay. The array is typically small (3-6 badges),
    // so the additional event data cost is minimal.
    event NodeDefined(uint256 indexed nodeId, bytes32 indexed seasonId, bytes32 indexed nodeCode);
    event NodeUpdated(uint256 indexed nodeId, bytes32 nodeCode);
    event NodeUnlocked(address indexed student, uint256 indexed nodeId, uint256[] badgeIds);
    event SeasonFrozen(bytes32 indexed seasonId);
    // LINEAGE: emitted only for versions, so the existing NodeDefined handling
    // in the indexer is unchanged. Originals have versionOf == nodeId.
    event NodeVersionOf(uint256 indexed nodeId, uint256 indexed versionOf);

    constructor(address _registry, address _skillBadge, string memory _baseURI)
        ERC1155(_baseURI)
        PermissionGatekeeper(_registry)
    {
        require(_skillBadge != address(0), "Invalid SkillBadge address");
        skillBadge = ISkillBadge(_skillBadge);
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        require(from == address(0), "SkillGraph: soulbound, not transferable");
        super._update(from, to, ids, values);
    }

    /// @param params Definition parameters; see NodeDefineParams above.
    ///        params.metadataCID may be bytes32(0) if metadata has not yet been pinned.
    function defineNode(NodeDefineParams calldata params)
        external
        onlyRole(HEI_ADMIN_ROLE)
        returns (uint256)
    {
        require(!seasonFrozen[params.seasonId], "Season is frozen");
        require(params.skillIds.length == params.points.length, "Mismatched skill arrays");
        require(params.skillIds.length > 0, "Must have at least one threshold skill");
        require(params.skillIds.length <= MAX_THRESHOLD_SKILLS, "Too many threshold skills"); // F5

        // DNF validation (minimal): empty outer array = base node, loop body never runs.
        // Each inner group must be non-empty: an empty group would be trivially
        // satisfied and silently turn an advanced node into a base node.
        // Referenced prerequisites must exist but may themselves be advanced
        // nodes (chaining allowed). Node IDs are assigned sequentially, so a
        // definition can only reference earlier nodes: acyclicity by ordering.
        require(params.prerequisiteGroups.length <= MAX_PREREQ_GROUPS, "Too many prerequisite groups");
        for (uint256 g = 0; g < params.prerequisiteGroups.length; g++) {
            require(params.prerequisiteGroups[g].length > 0, "Empty prerequisite group");
            require(params.prerequisiteGroups[g].length <= MAX_GROUP_SIZE, "Prerequisite group too large");
            for (uint256 i = 0; i < params.prerequisiteGroups[g].length; i++) {
                require(
                    nodeDefinitions[params.prerequisiteGroups[g][i]].exists,
                    "Prerequisite node does not exist"
                );
            }
        }

        uint256 nodeId = nextNodeId;
        nextNodeId++;

        NodeDef storage def = nodeDefinitions[nodeId];
        def.seasonId = params.seasonId;
        def.nodeCode = params.nodeCode;
        def.metadataCID = params.metadataCID;
        def.exists = true;

        // LINEAGE: an original points to itself. A version resolves to the
        // original of the node it names, so a version of a version still
        // points to the first original.
        uint256 root = nodeId;
        if (params.versionOf != 0) {
            require(nodeDefinitions[params.versionOf].exists, "Versioned node does not exist");
            root = nodeDefinitions[params.versionOf].versionOf;
            emit NodeVersionOf(nodeId, root);
        }
        def.versionOf = root;

        // Nested calldata -> storage copy, element by element: push an empty
        // inner array, then fill it. Direct assignment of nested calldata
        // arrays to storage is not supported by the compiler.
        for (uint256 g = 0; g < params.prerequisiteGroups.length; g++) {
            def.prerequisiteGroups.push();
            uint256[] storage group = def.prerequisiteGroups[g];
            for (uint256 i = 0; i < params.prerequisiteGroups[g].length; i++) {
                group.push(params.prerequisiteGroups[g][i]);
            }
        }

        for (uint256 i = 0; i < params.skillIds.length; i++) {
            require(params.points[i] > 0, "Threshold points must be > 0");
            require(def.threshold[params.skillIds[i]] == 0, "Duplicate threshold skill");
            def.thresholdSkillIds.push(params.skillIds[i]);
            def.threshold[params.skillIds[i]] = params.points[i];
        }

        emit NodeDefined(nodeId, params.seasonId, params.nodeCode);
        return nodeId;
    }

    /// @param _nodeId The node to update (lookup key, kept outside the params struct).
    /// @param params New values; see NodeUpdateParams above.
    function updateNode(uint256 _nodeId, NodeUpdateParams calldata params)
        external
        onlyRole(HEI_ADMIN_ROLE)
    {
        NodeDef storage def = nodeDefinitions[_nodeId];
        require(def.exists, "Node not defined");
        require(!seasonFrozen[def.seasonId], "Season is frozen");
        require(params.skillIds.length == params.points.length, "Mismatched skill arrays");
        require(params.skillIds.length > 0, "Must have at least one threshold skill");
        require(params.skillIds.length <= MAX_THRESHOLD_SKILLS, "Too many threshold skills"); // F5

        for (uint256 i = 0; i < def.thresholdSkillIds.length; i++) {
            delete def.threshold[def.thresholdSkillIds[i]];
        }
        delete def.thresholdSkillIds;

        // Clear old groups via pop(): pop implicitly deletes each removed
        // element, which resets that inner array's length slot. A plain delete
        // on the outer array only zeroes the outer length and can leave stale
        // inner lengths behind in storage.
        while (def.prerequisiteGroups.length > 0) {
            def.prerequisiteGroups.pop();
        }

        def.nodeCode = params.nodeCode;
        def.metadataCID = params.metadataCID;

        // Prerequisite consistency: mirrors defineNode() validation.
        require(params.prerequisiteGroups.length <= MAX_PREREQ_GROUPS, "Too many prerequisite groups");
        for (uint256 g = 0; g < params.prerequisiteGroups.length; g++) {
            require(params.prerequisiteGroups[g].length > 0, "Empty prerequisite group");
            require(params.prerequisiteGroups[g].length <= MAX_GROUP_SIZE, "Prerequisite group too large");
            for (uint256 i = 0; i < params.prerequisiteGroups[g].length; i++) {
                require(
                    nodeDefinitions[params.prerequisiteGroups[g][i]].exists,
                    "Prerequisite node does not exist"
                );
                // F2: the order rule that defineNode gets for free. A prerequisite
                // must have a lower token ID than the node it gates, so a correction
                // can never make a node require itself, directly or in a loop.
                require(params.prerequisiteGroups[g][i] < _nodeId, "Prerequisite must be an earlier node");
            }
        }

        for (uint256 g = 0; g < params.prerequisiteGroups.length; g++) {
            def.prerequisiteGroups.push();
            uint256[] storage group = def.prerequisiteGroups[g];
            for (uint256 i = 0; i < params.prerequisiteGroups[g].length; i++) {
                group.push(params.prerequisiteGroups[g][i]);
            }
        }

        for (uint256 i = 0; i < params.skillIds.length; i++) {
            require(params.points[i] > 0, "Threshold points must be > 0");
            require(def.threshold[params.skillIds[i]] == 0, "Duplicate threshold skill");
            def.thresholdSkillIds.push(params.skillIds[i]);
            def.threshold[params.skillIds[i]] = params.points[i];
        }

        emit NodeUpdated(_nodeId, params.nodeCode);
    }

    // F2: no cycle check is needed. Every prerequisite has a lower token ID than
    // the node it gates, in defineNode by construction and in updateNode by the
    // order rule above. A depth field would store what the IDs already give.

    function allocateBadges(uint256 _nodeId, uint256[] calldata _badgeIds) external onlyRole(STUDENT_ROLE) {
        NodeDef storage node = nodeDefinitions[_nodeId];
        require(node.exists, "Node not defined");
        require(balanceOf(msg.sender, _nodeId) == 0, "Node already unlocked");

        // DNF prerequisite check: OR over groups, AND within a group.
        // The student passes by fully holding ANY one group; holding no
        // complete group reverts. Base nodes (empty outer array) skip the
        // whole block: the if-guard is what makes them pass unconditionally.
        uint256 nGroups = node.prerequisiteGroups.length;
        if (nGroups > 0) {
            bool anyGroupHeld = false;
            for (uint256 g = 0; g < nGroups && !anyGroupHeld; g++) {
                uint256[] storage group = node.prerequisiteGroups[g];
                bool allHeld = true;
                for (uint256 i = 0; i < group.length; i++) {
                    // LINEAGE: any version of the required competency satisfies it.
                    // Before: if (balanceOf(msg.sender, group[i]) == 0)
                    if (!holdsVersionOf[msg.sender][nodeDefinitions[group[i]].versionOf]) { allHeld = false; break; }
                }
                if (allHeld) { anyGroupHeld = true; }
            }
            require(anyGroupHeld, "Prerequisites not met");
        }

        // F1: each badge is stamped as soon as it passes its checks. A badge ID
        // repeated in the same call then finds its own stamp and is refused, so
        // its points can never count twice. If a later check fails, the whole
        // transaction reverts and no stamp is kept.
        for (uint256 i = 0; i < _badgeIds.length; i++) {
            require(skillBadge.balanceOf(msg.sender, _badgeIds[i]) >= 1, "Badge not owned");
            require(committedTo[msg.sender][_badgeIds[i]] == 0, "Badge already committed");
            committedTo[msg.sender][_badgeIds[i]] = _nodeId; // permanently stamps each badge to this node.
        }

        for (uint256 t = 0; t < node.thresholdSkillIds.length; t++) {
            bytes32 skillId = node.thresholdSkillIds[t];
            uint8 required = node.threshold[skillId];
            uint16 total = 0;
            for (uint256 b = 0; b < _badgeIds.length; b++) {
                total += skillBadge.getSkillPoints(_badgeIds[b], skillId);
            }
            require(total >= required, "Threshold not met");
        }

        nodeBadges[msg.sender][_nodeId] = _badgeIds; // stores the reverse lookup: "Which badges compose this competency?"

        _mint(msg.sender, _nodeId, 1, "");
        // LINEAGE: remember the competency, not only this version of it.
        // Already true if the student holds a sibling version: same value, no harm.
        holdsVersionOf[msg.sender][node.versionOf] = true;
        emit NodeUnlocked(msg.sender, _nodeId, _badgeIds);
    }

    function freezeSeason(bytes32 _seasonId) external onlyRole(HEI_ADMIN_ROLE) {
        require(!seasonFrozen[_seasonId], "Already frozen");
        seasonFrozen[_seasonId] = true;
        emit SeasonFrozen(_seasonId);
    }

    // ═══════════════════════════════════════════
    // View Functions
    // ═══════════════════════════════════════════

    /// @notice O(1) lookup: returns required points for a specific skill in a node.
    /// @dev Returns 0 if skill not in threshold (Solidity mapping default).
    function getThresholdPoints(uint256 _nodeId, bytes32 _skillId) external view returns (uint8) {
        require(nodeDefinitions[_nodeId].exists, "Node not defined");
        return nodeDefinitions[_nodeId].threshold[_skillId];
    }

    /// @notice Returns the list of threshold skill IDs required by a node.
    /// @dev Used by indexer after NodeDefined/NodeUpdated to populate node_thresholds table.
    function getThresholdSkillIds(uint256 _nodeId) external view returns (bytes32[] memory) {
        require(nodeDefinitions[_nodeId].exists, "Node not defined");
        return nodeDefinitions[_nodeId].thresholdSkillIds;
    }

    /// @notice Returns the number of threshold skill dimensions for a node.
    function getThresholdCount(uint256 _nodeId) external view returns (uint256) {
        require(nodeDefinitions[_nodeId].exists, "Node not defined");
        return nodeDefinitions[_nodeId].thresholdSkillIds.length;
    }

    /// @notice Returns the DNF prerequisite groups for a node (OR over groups, AND within).
    /// @dev Empty outer array = base node. Used by indexer after NodeDefined/
    ///      NodeUpdated to populate node_prerequisites (group_index column).
    function getPrerequisiteGroups(uint256 _nodeId) external view returns (uint256[][] memory) {
        require(nodeDefinitions[_nodeId].exists, "Node not defined");
        return nodeDefinitions[_nodeId].prerequisiteGroups;
    }

    /// @notice Returns which badges a student used to unlock a specific node.
    /// @dev Reads from private nodeBadges mapping, the on-chain provenance trail.
    function getNodeBadges(uint256 _nodeId, address _student) external view returns (uint256[] memory) {
        return nodeBadges[_student][_nodeId];
    }

    /// @notice Returns the raw 32-byte IPFS metadata digest for a node.
    /// @dev May be bytes32(0) if metadata was never pinned for this node.
    function getMetadataCID(uint256 _nodeId) external view returns (bytes32) {
        require(nodeDefinitions[_nodeId].exists, "Node not defined");
        return nodeDefinitions[_nodeId].metadataCID;
    }

    /// @notice LINEAGE: returns the original competency a node is a version of.
    /// @dev Equals _nodeId for originals.
    function getVersionOf(uint256 _nodeId) external view returns (uint256) {
        require(nodeDefinitions[_nodeId].exists, "Node not defined");
        return nodeDefinitions[_nodeId].versionOf;
    }

    /// @notice Returns whether a node ID has been defined.
    /// @dev Unlike other view functions, does NOT revert for undefined nodes —
    ///      returning false IS the intended answer. Used by SkillPath to
    ///      validate the competency nodes of paths and project slots.
    function nodeExists(uint256 _nodeId) external view returns (bool) {
        return nodeDefinitions[_nodeId].exists;
    }


    /// @notice Reconstructs the full IPFS URI from the stored 32-byte digest.
    /// @dev Format: "ipfs://f01551220<64-hex-chars>" — see proto-doc §2.4.
    ///      f=base16 multibase, 01=CIDv1, 55=raw codec, 12=SHA-256, 20=32-byte length.
    /// @dev Reverts for undefined node IDs, matching other view functions.
    function uri(uint256 _nodeId) public view override returns (string memory) {
        require(nodeDefinitions[_nodeId].exists, "Node not defined");
        bytes32 cid = nodeDefinitions[_nodeId].metadataCID;
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
