// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PermissionGatekeeper.sol";

// SkillPath only needs three functions from SkillGraph.sol:
interface ISkillGraph {
    function nodeExists(uint256 nodeId) external view returns (bool); // is this competency node defined?
    function getVersionOf(uint256 nodeId) external view returns (uint256); // which original competency is it a version of?
    function holdsVersionOf(address student, uint256 originalId) external view returns (bool); // does the student hold some version of it?
}

/// @title SkillPath: the competency path contract (F18)
/// @notice Third parties post competency paths and projects. Students apply to
///         paths, and form teams under projects, by the recognized competencies
///         they hold. The contract reads roles from IdentityRegistry and
///         recognized competencies from SkillGraph. It mints no tokens and holds
///         no credentials or funds. It records the choices of the third party,
///         but never makes them: it never ranks students or teams and never
///         reads grades.
///
/// @dev Lifecycle shared by paths and projects:
///        defined by a third party ............................ PENDING
///        approved by the seasonal administrator .............. OPEN
///        rejected or withdrawn by the administrator,
///        or cancelled by its owner ........................... CLOSED
///      A project also reaches STARTED, when its selections reach maxTeams, or
///      when its owner ends recruitment with at least one team selected.
///      A post cannot be edited, so a student is checked against the same
///      requirements they read. To change it, the owner cancels it and defines
///      a new one. Each third party has at most one active path and one active
///      project, pending included.
///
/// @dev Every requirement is met by any version of the competency node, read
///      through SkillGraph.holdsVersionOf, as in the prerequisite check of
///      allocation. Applications and team slots also check that the owner of
///      the post still holds the third party role.
contract SkillPath is PermissionGatekeeper {

    // ═══════════════════════════════════════════
    // Role constants (same keccak256 as IdentityRegistry)
    // ═══════════════════════════════════════════
    bytes32 public constant HEI_ADMIN_ROLE   = keccak256("HEI_ADMIN_ROLE");
    bytes32 public constant STUDENT_ROLE     = keccak256("STUDENT_ROLE");
    bytes32 public constant THIRD_PARTY_ROLE = keccak256("THIRD_PARTY_ROLE");

    ISkillGraph public immutable skillGraph;

    // ═══════════════════════════════════════════
    // Prototype bounds
    // ═══════════════════════════════════════════
    // They bound the size of each post and the loops that students pay for in
    // applyToPath(), startTeam() and joinTeam(). Same pattern as
    // MAX_PREREQ_GROUPS and MAX_GROUP_SIZE in SkillGraph.
    uint256 public constant MAX_NODES_PER_PATH    = 7;  // enough to list a full branch of the graph
    uint256 public constant MAX_SLOTS_PER_PROJECT = 4;  // one slot per project role
    uint256 public constant MAX_NODES_PER_SLOT    = 4;
    uint256 public constant MAX_TEAMS_PER_PROJECT = 10; // upper bound for maxTeams

    // ═══════════════════════════════════════════
    // Storage structs
    // ═══════════════════════════════════════════
    // Fields are ordered so the small ones share a storage slot with the owner.

    enum PathStatus { PENDING, OPEN, CLOSED }
    enum ProjectStatus { PENDING, OPEN, STARTED, CLOSED }

    struct CompetencyPath {
        address owner;          // Third party that defined it. address(0) = not defined
        PathStatus status;
        bytes32 metadataCID;    // 32-byte SHA-256 digest of the IPFS-pinned metadata document
        uint256[] nodeIds;      // Required competency nodes, all of them (implicit AND)
    }

    struct Project {
        address owner;          // Third party that defined it. address(0) = not defined
        uint8 maxTeams;         // Most teams the owner can select
        uint8 selectedCount;    // Teams selected so far
        ProjectStatus status;
        bytes32 metadataCID;    // 32-byte SHA-256 digest of the IPFS-pinned metadata document
        uint256[][] slots;      // Competency nodes required by each slot, one slot per role
    }

    struct Team {
        uint256 projectId;                          // 0 = not defined
        address[MAX_SLOTS_PER_PROJECT] members;     // Student in each slot, address(0) = free
        uint8 filledCount;
        bool formed;            // Every slot filled. The team no longer changes
        bool selected;          // Chosen by the owner of the project
    }

    // ═══════════════════════════════════════════
    // State variables
    // ═══════════════════════════════════════════

    // Sequential IDs, starting at 1. Zero is the "none" sentinel below.
    uint256 public nextPathId = 1;
    uint256 public nextProjectId = 1;
    uint256 public nextTeamId = 1;

    // Read through getCompetencyPath(), getProject() and getProjectTeam().
    mapping(uint256 => CompetencyPath) private paths;
    mapping(uint256 => Project) private projects;
    mapping(uint256 => Team) private teams;

    // Third party -> its active path / project (pending or open). 0 = none.
    mapping(address => uint256) public activePathOf;
    mapping(address => uint256) public activeProjectOf;

    // pathId -> student -> time of the application. 0 = no application.
    // Read through getPathApplication(). One application per student and path.
    mapping(uint256 => mapping(address => uint256)) private appliedAt;

    // projectId -> student -> teamId. 0 = not in a team of that project.
    // A student can sit in only one team of the same project.
    mapping(uint256 => mapping(address => uint256)) public teamOf;

    // ═══════════════════════════════════════════
    // Events: lean pattern (IDs only, details through view functions)
    // ═══════════════════════════════════════════

    event PathDefined(uint256 indexed pathId, address indexed owner);
    event PathApproved(uint256 indexed pathId);
    event PathApplied(uint256 indexed pathId, address indexed student);
    event PathClosed(uint256 indexed pathId);

    event ProjectDefined(uint256 indexed projectId, address indexed owner);
    event ProjectApproved(uint256 indexed projectId);
    event ProjectStarted(uint256 indexed projectId);
    event ProjectClosed(uint256 indexed projectId);

    event TeamStarted(uint256 indexed teamId, uint256 indexed projectId);
    event SlotFilled(uint256 indexed teamId, address indexed student, uint8 slot);
    event SlotLeft(uint256 indexed teamId, address indexed student, uint8 slot);
    event TeamFormed(uint256 indexed teamId, uint256 indexed projectId);
    event TeamSelected(uint256 indexed teamId, uint256 indexed projectId);

    // ═══════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════

    constructor(address _registry, address _skillGraph)
        PermissionGatekeeper(_registry)
    {
        require(_skillGraph != address(0), "Invalid SkillGraph address");
        skillGraph = ISkillGraph(_skillGraph);
    }

    // ═══════════════════════════════════════════
    // Paths: third party
    // ═══════════════════════════════════════════

    /// @notice Defines a competency path: the competency nodes a student must
    ///         hold to match the profile the third party seeks. Starts PENDING.
    /// @dev The nodes do not have to form a branch of the graph. Each must exist,
    ///      and none can be listed twice, counting versions of the same
    ///      competency node as one.
    function definePath(uint256[] calldata _nodeIds, bytes32 _metadataCID)
        external
        onlyRole(THIRD_PARTY_ROLE)
        returns (uint256)
    {
        require(activePathOf[msg.sender] == 0, "Already has an active path");
        require(_metadataCID != bytes32(0), "Metadata document required");
        require(_nodeIds.length > 0, "Path needs at least one node");
        require(_nodeIds.length <= MAX_NODES_PER_PATH, "Too many nodes in path");
        _checkNodes(_nodeIds);

        uint256 pathId = nextPathId;
        nextPathId++;

        CompetencyPath storage path = paths[pathId];
        path.owner = msg.sender;
        path.status = PathStatus.PENDING;
        path.metadataCID = _metadataCID;
        for (uint256 i = 0; i < _nodeIds.length; i++) {
            path.nodeIds.push(_nodeIds[i]);
        }
        activePathOf[msg.sender] = pathId;

        emit PathDefined(pathId, msg.sender);
        return pathId;
    }

    /// @notice The owner cancels its pending or open path, which closes it.
    ///         Applications already recorded stay on the ledger.
    function cancelPath(uint256 _pathId) external onlyRole(THIRD_PARTY_ROLE) {
        CompetencyPath storage path = paths[_pathId];
        require(path.owner == msg.sender, "Not the owner of the path");
        require(path.status != PathStatus.CLOSED, "Path already closed");
        _closePath(_pathId, path);
    }

    // ═══════════════════════════════════════════
    // Paths: seasonal administrator
    // ═══════════════════════════════════════════

    /// @notice Approves a pending path, which opens it to students.
    function approvePath(uint256 _pathId) external onlyRole(HEI_ADMIN_ROLE) {
        CompetencyPath storage path = paths[_pathId];
        require(path.owner != address(0), "Path not defined");
        require(path.status == PathStatus.PENDING, "Path is not pending");
        path.status = PathStatus.OPEN;
        emit PathApproved(_pathId);
    }

    /// @notice Rejects a pending path, or withdraws an open one, which closes it.
    ///         The third party keeps its role. Also closes the posts of a third
    ///         party whose role was removed, which can no longer cancel them.
    function rejectPath(uint256 _pathId) external onlyRole(HEI_ADMIN_ROLE) {
        CompetencyPath storage path = paths[_pathId];
        require(path.owner != address(0), "Path not defined");
        require(path.status != PathStatus.CLOSED, "Path already closed");
        _closePath(_pathId, path);
    }

    // ═══════════════════════════════════════════
    // Paths: student
    // ═══════════════════════════════════════════

    /// @notice A student applies to an open path. The application shows two
    ///         things at once: the student chose to show interest, and holds
    ///         every competency node the path requires.
    /// @dev Gas grows with the number of nodes, capped at MAX_NODES_PER_PATH.
    function applyToPath(uint256 _pathId) external onlyRole(STUDENT_ROLE) {
        CompetencyPath storage path = paths[_pathId];
        require(path.status == PathStatus.OPEN, "Path is not open");
        require(appliedAt[_pathId][msg.sender] == 0, "Already applied");
        require(registry.hasRole(THIRD_PARTY_ROLE, path.owner), "Owner is no longer a third party");

        _checkHolds(msg.sender, path.nodeIds);

        appliedAt[_pathId][msg.sender] = block.timestamp;
        emit PathApplied(_pathId, msg.sender);
    }

    // ═══════════════════════════════════════════
    // Projects: third party
    // ═══════════════════════════════════════════

    /// @notice Defines a project: one slot per project role, each listing the
    ///         competency nodes its student must hold, and maxTeams, the most
    ///         teams the owner will select. Starts PENDING.
    /// @dev Every node must exist, and none can be listed twice in the same
    ///      slot, counting versions as one. The same node may appear in
    ///      different slots.
    function defineProject(uint256[][] calldata _slots, uint8 _maxTeams, bytes32 _metadataCID)
        external
        onlyRole(THIRD_PARTY_ROLE)
        returns (uint256)
    {
        require(activeProjectOf[msg.sender] == 0, "Already has an active project");
        require(_metadataCID != bytes32(0), "Metadata document required");
        require(_slots.length > 0, "Project needs at least one slot");
        require(_slots.length <= MAX_SLOTS_PER_PROJECT, "Too many slots");
        require(_maxTeams > 0, "maxTeams must be at least 1");
        require(_maxTeams <= MAX_TEAMS_PER_PROJECT, "maxTeams too large");
        for (uint256 s = 0; s < _slots.length; s++) {
            require(_slots[s].length > 0, "Empty slot");
            require(_slots[s].length <= MAX_NODES_PER_SLOT, "Too many nodes in slot");
            _checkNodes(_slots[s]);
        }

        uint256 projectId = nextProjectId;
        nextProjectId++;

        Project storage project = projects[projectId];
        project.owner = msg.sender;
        project.maxTeams = _maxTeams;
        project.status = ProjectStatus.PENDING;
        project.metadataCID = _metadataCID;

        // Nested calldata -> storage copy, element by element (as in SkillGraph).
        for (uint256 s = 0; s < _slots.length; s++) {
            project.slots.push();
            uint256[] storage slot = project.slots[s];
            for (uint256 i = 0; i < _slots[s].length; i++) {
                slot.push(_slots[s][i]);
            }
        }
        activeProjectOf[msg.sender] = projectId;

        emit ProjectDefined(projectId, msg.sender);
        return projectId;
    }

    /// @notice The owner cancels its pending or open project, which closes it.
    /// @dev Refused once a team is selected: from then on, the owner can only
    ///      end recruitment, which starts the project with the selected teams.
    function cancelProject(uint256 _projectId) external onlyRole(THIRD_PARTY_ROLE) {
        Project storage project = projects[_projectId];
        require(project.owner == msg.sender, "Not the owner of the project");
        require(
            project.status == ProjectStatus.PENDING || project.status == ProjectStatus.OPEN,
            "Project is not pending or open"
        );
        require(project.selectedCount == 0, "Teams already selected");
        _closeProject(_projectId, project);
    }

    /// @notice The owner selects a formed team. The choice is recorded on the
    ///         ledger. The project starts when the selections reach maxTeams.
    function selectTeam(uint256 _teamId) external onlyRole(THIRD_PARTY_ROLE) {
        Team storage team = teams[_teamId];
        require(team.projectId != 0, "Team not defined");
        Project storage project = projects[team.projectId];
        require(project.owner == msg.sender, "Not the owner of the project");
        require(project.status == ProjectStatus.OPEN, "Project is not open");
        require(team.formed, "Team not formed");
        require(!team.selected, "Team already selected");
        require(project.selectedCount < project.maxTeams, "All teams already selected");

        team.selected = true;
        project.selectedCount++;
        emit TeamSelected(_teamId, team.projectId);

        if (project.selectedCount == project.maxTeams) {
            _startProject(team.projectId, project);
        }
    }

    /// @notice The owner ends recruitment. With at least one team selected the
    ///         project starts. With none, it closes.
    function endRecruitment(uint256 _projectId) external onlyRole(THIRD_PARTY_ROLE) {
        Project storage project = projects[_projectId];
        require(project.owner == msg.sender, "Not the owner of the project");
        require(project.status == ProjectStatus.OPEN, "Project is not open");

        if (project.selectedCount > 0) {
            _startProject(_projectId, project);
        } else {
            _closeProject(_projectId, project);
        }
    }

    // ═══════════════════════════════════════════
    // Projects: seasonal administrator
    // ═══════════════════════════════════════════

    /// @notice Approves a pending project, which opens it to students.
    function approveProject(uint256 _projectId) external onlyRole(HEI_ADMIN_ROLE) {
        Project storage project = projects[_projectId];
        require(project.owner != address(0), "Project not defined");
        require(project.status == ProjectStatus.PENDING, "Project is not pending");
        project.status = ProjectStatus.OPEN;
        emit ProjectApproved(_projectId);
    }

    /// @notice Rejects a pending project, or withdraws an open one, which closes it.
    ///         The third party keeps its role. A started project is not affected.
    function rejectProject(uint256 _projectId) external onlyRole(HEI_ADMIN_ROLE) {
        Project storage project = projects[_projectId];
        require(project.owner != address(0), "Project not defined");
        require(
            project.status == ProjectStatus.PENDING || project.status == ProjectStatus.OPEN,
            "Project is not pending or open"
        );
        _closeProject(_projectId, project);
    }

    // ═══════════════════════════════════════════
    // Teams: student
    // ═══════════════════════════════════════════

    /// @notice A student starts a new team under an open project by taking one slot.
    function startTeam(uint256 _projectId, uint8 _slot)
        external
        onlyRole(STUDENT_ROLE)
        returns (uint256)
    {
        Project storage project = projects[_projectId];
        _checkCanTakeSlot(_projectId, project, _slot);

        uint256 teamId = nextTeamId;
        nextTeamId++;

        Team storage team = teams[teamId];
        team.projectId = _projectId;
        emit TeamStarted(teamId, _projectId);

        _fillSlot(teamId, team, project, _slot);
        return teamId;
    }

    /// @notice A student joins a team that is still forming, by taking a free slot.
    function joinTeam(uint256 _teamId, uint8 _slot) external onlyRole(STUDENT_ROLE) {
        Team storage team = teams[_teamId];
        require(team.projectId != 0, "Team not defined");
        require(!team.formed, "Team already formed");
        Project storage project = projects[team.projectId];
        _checkCanTakeSlot(team.projectId, project, _slot);
        require(team.members[_slot] == address(0), "Slot already taken");

        _fillSlot(_teamId, team, project, _slot);
    }

    /// @notice A student leaves their slot before the team forms, which frees it
    ///         for another student. A formed team no longer changes.
    function leaveSlot(uint256 _teamId) external onlyRole(STUDENT_ROLE) {
        Team storage team = teams[_teamId];
        require(team.projectId != 0, "Team not defined");
        require(teamOf[team.projectId][msg.sender] == _teamId, "Not in this team");
        require(!team.formed, "Team already formed");
        require(projects[team.projectId].status == ProjectStatus.OPEN, "Project is not open");

        uint8 slot = 0;
        for (uint8 s = 0; s < MAX_SLOTS_PER_PROJECT; s++) {
            if (team.members[s] == msg.sender) {
                slot = s;
                break;
            }
        }
        delete team.members[slot];
        team.filledCount--;
        delete teamOf[team.projectId][msg.sender];

        emit SlotLeft(_teamId, msg.sender, slot);
    }

    // ═══════════════════════════════════════════
    // View functions
    // ═══════════════════════════════════════════

    /// @notice Returns everything stored for a path.
    function getCompetencyPath(uint256 _pathId)
        external
        view
        returns (address owner, uint256[] memory nodeIds, bytes32 metadataCID, PathStatus status)
    {
        CompetencyPath storage path = paths[_pathId];
        require(path.owner != address(0), "Path not defined");
        return (path.owner, path.nodeIds, path.metadataCID, path.status);
    }

    /// @notice Returns when a student applied to a path, or 0 if they did not.
    function getPathApplication(uint256 _pathId, address _student) external view returns (uint256) {
        return appliedAt[_pathId][_student];
    }

    /// @notice Returns everything stored for a project.
    function getProject(uint256 _projectId)
        external
        view
        returns (
            address owner,
            uint256[][] memory slots,
            uint8 maxTeams,
            uint8 selectedCount,
            bytes32 metadataCID,
            ProjectStatus status
        )
    {
        Project storage project = projects[_projectId];
        require(project.owner != address(0), "Project not defined");
        return (
            project.owner,
            project.slots,
            project.maxTeams,
            project.selectedCount,
            project.metadataCID,
            project.status
        );
    }

    /// @notice Returns a team: its project, the student in each slot
    ///         (address(0) if free), and whether it is formed and selected.
    function getProjectTeam(uint256 _teamId)
        external
        view
        returns (uint256 projectId, address[] memory members, bool formed, bool selected)
    {
        Team storage team = teams[_teamId];
        require(team.projectId != 0, "Team not defined");
        uint256 slotCount = projects[team.projectId].slots.length;
        members = new address[](slotCount);
        for (uint256 s = 0; s < slotCount; s++) {
            members[s] = team.members[s];
        }
        return (team.projectId, members, team.formed, team.selected);
    }

    // ═══════════════════════════════════════════
    // Internal helpers
    // ═══════════════════════════════════════════

    /// @dev Every node must exist, and no two can be versions of the same
    ///      competency. O(n^2) on at most 7 nodes, cheaper than a mapping.
    function _checkNodes(uint256[] calldata _nodeIds) private view {
        uint256[] memory originals = new uint256[](_nodeIds.length);
        for (uint256 i = 0; i < _nodeIds.length; i++) {
            require(skillGraph.nodeExists(_nodeIds[i]), "Node does not exist");
            originals[i] = skillGraph.getVersionOf(_nodeIds[i]);
            for (uint256 j = 0; j < i; j++) {
                require(originals[j] != originals[i], "Node listed twice");
            }
        }
    }

    /// @dev The student must hold some version of every listed node.
    function _checkHolds(address _student, uint256[] storage _nodeIds) private view {
        for (uint256 i = 0; i < _nodeIds.length; i++) {
            uint256 original = skillGraph.getVersionOf(_nodeIds[i]);
            require(skillGraph.holdsVersionOf(_student, original), "Required competency not held");
        }
    }

    /// @dev Checks shared by startTeam() and joinTeam().
    function _checkCanTakeSlot(uint256 _projectId, Project storage _project, uint8 _slot) private view {
        require(_project.status == ProjectStatus.OPEN, "Project is not open");
        require(_slot < _project.slots.length, "Slot does not exist");
        require(teamOf[_projectId][msg.sender] == 0, "Already in a team of this project");
        require(registry.hasRole(THIRD_PARTY_ROLE, _project.owner), "Owner is no longer a third party");
        _checkHolds(msg.sender, _project.slots[_slot]);
    }

    /// @dev Seats the caller. When the last slot is filled, the team forms.
    function _fillSlot(uint256 _teamId, Team storage _team, Project storage _project, uint8 _slot) private {
        _team.members[_slot] = msg.sender;
        _team.filledCount++;
        teamOf[_team.projectId][msg.sender] = _teamId;
        emit SlotFilled(_teamId, msg.sender, _slot);

        if (_team.filledCount == _project.slots.length) {
            _team.formed = true;
            emit TeamFormed(_teamId, _team.projectId);
        }
    }

    function _closePath(uint256 _pathId, CompetencyPath storage _path) private {
        _path.status = PathStatus.CLOSED;
        delete activePathOf[_path.owner];
        emit PathClosed(_pathId);
    }

    function _startProject(uint256 _projectId, Project storage _project) private {
        _project.status = ProjectStatus.STARTED;
        delete activeProjectOf[_project.owner];
        emit ProjectStarted(_projectId);
    }

    function _closeProject(uint256 _projectId, Project storage _project) private {
        _project.status = ProjectStatus.CLOSED;
        delete activeProjectOf[_project.owner];
        emit ProjectClosed(_projectId);
    }
}
