const { expect } = require("chai");
const { ethers } = require("hardhat");

const SEASON = ethers.id("2025-S1");
const PWR = ethers.id("PWR");
const CTR = ethers.id("CTR");
const CODE = ethers.id("CODE");
const CID = ethers.id("metadata document");
const PathStatus = { PENDING: 0n, OPEN: 1n, CLOSED: 2n };
const ProjectStatus = { PENDING: 0n, OPEN: 1n, STARTED: 2n, CLOSED: 3n };

const gasLog = [];
async function gas(label, txPromise) {
  const tx = await txPromise;
  const rc = await tx.wait();
  gasLog.push([label, rc.gasUsed]);
  return rc;
}

// Competency nodes of the test graph (IDs are sequential):
//  1 base PWR 10 | 2 base CTR 10 | 3 needs 1 and 2, CODE 10
//  4 base CTR 10, a version of 2 | 5..8 base PWR 10 | 9 base PWR 20
async function setup() {
  const [deployer, admin, registrar, oracle, tp1, tp2, s1, s2, s3, s4, s5, outsider] =
    await ethers.getSigners();

  const reg = await (await ethers.getContractFactory("IdentityRegistry")).deploy(admin.address);
  await reg.connect(admin).anchorRegistrar(registrar.address);
  await reg.connect(admin).anchorOracle(oracle.address);
  for (const s of [s1, s2, s3, s4, s5]) await reg.connect(registrar).anchorStudent(s.address);
  await reg.connect(admin).anchorThirdParty(tp1.address);
  await reg.connect(admin).anchorThirdParty(tp2.address);

  const regAddr = await reg.getAddress();
  const badge = await (await ethers.getContractFactory("SkillBadge")).deploy(regAddr, "");
  const graph = await (await ethers.getContractFactory("SkillGraph")).deploy(regAddr, await badge.getAddress(), "");
  const sp = await (await ethers.getContractFactory("SkillPath")).deploy(regAddr, await graph.getAddress());

  // 12 badge definitions, each carrying 10 points of PWR, CTR and CODE.
  for (let i = 1; i <= 12; i++) {
    await badge.connect(admin).defineBadge({
      seasonId: SEASON, courseId: ethers.id("C" + i), badgeCode: ethers.id("B" + i),
      skillIds: [PWR, CTR, CODE], points: [10, 10, 10], metadataCID: CID,
    });
  }

  const node = (skill, pts, groups = [], versionOf = 0) =>
    graph.connect(admin).defineNode({
      seasonId: SEASON, nodeCode: ethers.id("N" + Math.random()), skillIds: [skill], points: [pts],
      prerequisiteGroups: groups, metadataCID: CID, versionOf,
    });
  await node(PWR, 10);              // 1
  await node(CTR, 10);              // 2
  await node(CODE, 10, [[1, 2]]);   // 3
  await node(CTR, 10, [], 2);       // 4, version of 2
  for (let i = 5; i <= 8; i++) await node(PWR, 10); // 5..8
  await node(PWR, 20);              // 9

  const mintAll = async (student) => {
    for (let i = 1; i <= 12; i++) await badge.connect(oracle).mintBadge(student.address, i, ethers.ZeroHash);
  };
  const alloc = (student, nodeId, badgeIds) => graph.connect(student).allocateBadges(nodeId, badgeIds);

  return { reg, badge, graph, sp, admin, registrar, oracle, tp1, tp2, s1, s2, s3, s4, s5, outsider, mintAll, alloc };
}

describe("SkillGraph", function () {
  it("the contract is SkillGraph and stays soulbound", async function () {
    const { graph, s1, s2, mintAll, alloc } = await setup();
    await mintAll(s1);
    await alloc(s1, 1, [1]);
    await expect(
      graph.connect(s1).safeTransferFrom(s1.address, s2.address, 1, 1, "0x")
    ).to.be.revertedWith("SkillGraph: soulbound, not transferable");
  });

  it("a badge ID repeated in one call is refused, and nothing is stamped", async function () {
    const { graph, s3, mintAll, alloc } = await setup();
    await mintAll(s3);
    await expect(alloc(s3, 9, [2, 2])).to.be.revertedWith("Badge already committed");
    expect(await graph.committedTo(s3.address, 2)).to.equal(0n);
    await gas("allocateBadges (2 badges, 1 threshold type)", alloc(s3, 9, [2, 3]));
    expect(await graph.balanceOf(s3.address, 9)).to.equal(1n);
    expect(await graph.committedTo(s3.address, 2)).to.equal(9n);
    expect(await graph.getNodeBadges(9, s3.address)).to.deep.equal([2n, 3n]);
  });

  it("a badge already allocated to another node is still refused", async function () {
    const { s1, mintAll, alloc } = await setup();
    await mintAll(s1);
    await alloc(s1, 1, [1]);
    await expect(alloc(s1, 5, [1])).to.be.revertedWith("Badge already committed");
  });

  it("a correction cannot require a later node or the node itself", async function () {
    const { graph, admin } = await setup();
    const upd = (id, groups) => graph.connect(admin).updateNode(id, {
      nodeCode: ethers.id("U"), skillIds: [PWR], points: [10], prerequisiteGroups: groups, metadataCID: CID,
    });
    await expect(upd(1, [[3]])).to.be.revertedWith("Prerequisite must be an earlier node");
    await expect(upd(3, [[3]])).to.be.revertedWith("Prerequisite must be an earlier node");
    await expect(upd(3, [[1], [9]])).to.be.revertedWith("Prerequisite must be an earlier node");
    await expect(upd(3, [[1], [2]])).to.emit(graph, "NodeUpdated");
    expect(await graph.getPrerequisiteGroups(3)).to.deep.equal([[1n], [2n]]);
  });

  it("Lineage: a version of a prerequisite satisfies it", async function () {
    const { graph, s2, s3, mintAll, alloc } = await setup();
    await mintAll(s2);
    await alloc(s2, 1, [1]);
    await alloc(s2, 4, [2]);                 // version of 2, not 2 itself
    expect(await graph.getVersionOf(4)).to.equal(2n);
    expect(await graph.holdsVersionOf(s2.address, 2)).to.equal(true);
    await gas("allocateBadges (with 2 prerequisites)", alloc(s2, 3, [3]));
    await mintAll(s3);
    await alloc(s3, 1, [1]);
    await expect(alloc(s3, 3, [3])).to.be.revertedWith("Prerequisites not met");
  });
});

describe("SkillGraph: defineNode", function () {
  const GRID = ethers.id("GRID");
  const SIG = ethers.id("SIG");
  // The setup defines nodes 1 to 9, so the next node is 10.
  const define = (graph, caller, skillIds, points, groups = [], versionOf = 0) =>
    graph.connect(caller).defineNode({
      seasonId: SEASON, nodeCode: ethers.id("N"), skillIds, points, prerequisiteGroups: groups, metadataCID: CID, versionOf,
    });

  it("only the administrator, with 1 to 4 threshold types, no repeats and no zero points", async function () {
    const { graph, admin, tp1, s1 } = await setup();
    await expect(define(graph, tp1, [PWR], [10])).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(define(graph, s1, [PWR], [10])).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(define(graph, admin, [PWR, CTR], [10])).to.be.revertedWith("Mismatched skill arrays");
    await expect(define(graph, admin, [], [])).to.be.revertedWith("Must have at least one threshold skill");
    await expect(define(graph, admin, [PWR, CTR, CODE, GRID, SIG], [1, 1, 1, 1, 1])).to.be.revertedWith("Too many threshold skills");
    await expect(define(graph, admin, [PWR, CTR], [10, 0])).to.be.revertedWith("Threshold points must be > 0");
    await expect(define(graph, admin, [PWR, CTR, PWR], [10, 5, 5])).to.be.revertedWith("Duplicate threshold skill");
    await expect(define(graph, admin, [PWR, CTR, CODE, GRID], [4, 3, 2, 1]))
      .to.emit(graph, "NodeDefined").withArgs(10n, SEASON, ethers.id("N"));
    expect(await graph.getThresholdSkillIds(10)).to.deep.equal([PWR, CTR, CODE, GRID]);
    expect(await graph.getThresholdPoints(10, GRID)).to.equal(1n);
  });

  it("at most 4 prerequisite groups, each of 1 to 4 existing nodes", async function () {
    const { graph, admin } = await setup();
    const d = groups => define(graph, admin, [PWR], [10], groups);
    await expect(d([[1], [2], [5], [6], [7]])).to.be.revertedWith("Too many prerequisite groups");
    await expect(d([[1, 2, 5, 6, 7]])).to.be.revertedWith("Prerequisite group too large");
    await expect(d([[1], []])).to.be.revertedWith("Empty prerequisite group");
    await expect(d([[1, 99]])).to.be.revertedWith("Prerequisite node does not exist");
    await expect(d([[10]])).to.be.revertedWith("Prerequisite node does not exist");   // its own ID is not defined yet
    await expect(d([[1, 2, 5, 6], [1], [2], [3]])).to.emit(graph, "NodeDefined");     // 4 groups, one of 4 nodes
    expect(await graph.getPrerequisiteGroups(10)).to.deep.equal([[1n, 2n, 5n, 6n], [1n], [2n], [3n]]);
  });

  it("versionOf names an existing node, and a version of a version points to the first original", async function () {
    const { graph, admin, s1, mintAll, alloc } = await setup();
    await expect(define(graph, admin, [CTR], [10], [], 99)).to.be.revertedWith("Versioned node does not exist");
    // Node 4 is a version of node 2, so node 10, a version of node 4, points to node 2.
    await expect(define(graph, admin, [CTR], [10], [], 4)).to.emit(graph, "NodeVersionOf").withArgs(10n, 2n);
    expect(await graph.getVersionOf(10)).to.equal(2n);
    expect(await graph.getVersionOf(2)).to.equal(2n);                                // an original points to itself
    await expect(define(graph, admin, [CTR], [10])).to.not.emit(graph, "NodeVersionOf");   // node 11, an original
    // Holding node 10 meets node 3's prerequisite on node 2.
    await mintAll(s1);
    await alloc(s1, 1, [1]);
    await alloc(s1, 10, [2]);
    await expect(alloc(s1, 3, [3])).to.emit(graph, "NodeUnlocked");
  });
});

describe("SkillPath: competency paths", function () {
  it("only a registered third party defines a path, and it starts pending", async function () {
    const { sp, tp1, outsider, s1 } = await setup();
    await expect(sp.connect(outsider).definePath([1], CID)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(sp.connect(s1).definePath([1], CID)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(sp.connect(tp1).definePath([1, 2], CID)).to.emit(sp, "PathDefined").withArgs(1n, tp1.address);
    const p = await sp.getCompetencyPath(1);
    expect(p.owner).to.equal(tp1.address);
    expect(p.nodeIds).to.deep.equal([1n, 2n]);
    expect(p.status).to.equal(PathStatus.PENDING);
    expect(await sp.activePathOf(tp1.address)).to.equal(1n);
  });

  it("checks the nodes: they exist, no repeats, versions count as one, within the cap", async function () {
    const { sp, tp1 } = await setup();
    await expect(sp.connect(tp1).definePath([1], ethers.ZeroHash)).to.be.revertedWith("Metadata document required");
    await expect(sp.connect(tp1).definePath([], CID)).to.be.revertedWith("Path needs at least one node");
    await expect(sp.connect(tp1).definePath([1, 99], CID)).to.be.revertedWith("Node does not exist");
    await expect(sp.connect(tp1).definePath([1, 1], CID)).to.be.revertedWith("Node listed twice");
    await expect(sp.connect(tp1).definePath([2, 4], CID)).to.be.revertedWith("Node listed twice");
    await expect(sp.connect(tp1).definePath([1, 2, 3, 5, 6, 7, 8, 9], CID)).to.be.revertedWith("Too many nodes in path");
    await gas("definePath (7 nodes)", sp.connect(tp1).definePath([1, 2, 3, 5, 6, 7, 8], CID));
  });

  it("one active path per third party, pending included, until it closes", async function () {
    const { sp, tp1, admin } = await setup();
    await sp.connect(tp1).definePath([1], CID);
    await expect(sp.connect(tp1).definePath([2], CID)).to.be.revertedWith("Already has an active path");
    await sp.connect(admin).approvePath(1);
    await expect(sp.connect(tp1).definePath([2], CID)).to.be.revertedWith("Already has an active path");
    await expect(sp.connect(tp1).cancelPath(1)).to.emit(sp, "PathClosed").withArgs(1n);
    expect(await sp.activePathOf(tp1.address)).to.equal(0n);
    await expect(sp.connect(tp1).definePath([2], CID)).to.emit(sp, "PathDefined").withArgs(2n, tp1.address);
  });

  it("the seasonal administrator approves pending paths, and rejects or withdraws them", async function () {
    const { sp, tp1, tp2, admin } = await setup();
    await sp.connect(tp1).definePath([1], CID);
    await sp.connect(tp2).definePath([2], CID);
    await expect(sp.connect(tp1).approvePath(1)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(sp.connect(admin).approvePath(7)).to.be.revertedWith("Path not defined");
    await expect(sp.connect(admin).approvePath(1)).to.emit(sp, "PathApproved").withArgs(1n);
    await expect(sp.connect(admin).approvePath(1)).to.be.revertedWith("Path is not pending");
    await expect(sp.connect(tp1).rejectPath(2)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(sp.connect(admin).rejectPath(2)).to.emit(sp, "PathClosed").withArgs(2n);
    await expect(sp.connect(admin).rejectPath(2)).to.be.revertedWith("Path already closed");
    await expect(sp.connect(admin).rejectPath(1)).to.emit(sp, "PathClosed").withArgs(1n);   // withdraws an open path
    expect((await sp.getCompetencyPath(2)).status).to.equal(PathStatus.CLOSED);
    expect(await sp.activePathOf(tp2.address)).to.equal(0n);
  });

  it("only the owner cancels its path", async function () {
    const { sp, tp1, tp2 } = await setup();
    await sp.connect(tp1).definePath([1], CID);
    await expect(sp.connect(tp2).cancelPath(1)).to.be.revertedWith("Not the owner of the path");
    await sp.connect(tp1).cancelPath(1);
    await expect(sp.connect(tp1).cancelPath(1)).to.be.revertedWith("Path already closed");
  });

  it("a student applies once, only to an open path, holding every node", async function () {
    const { sp, tp1, admin, s1, s3, mintAll, alloc } = await setup();
    await mintAll(s1); await mintAll(s3);
    await alloc(s1, 1, [1]); await alloc(s1, 2, [2]); await alloc(s1, 3, [3]);
    await alloc(s3, 1, [1]);
    await sp.connect(tp1).definePath([1, 2, 3], CID);
    await expect(sp.connect(s1).applyToPath(1)).to.be.revertedWith("Path is not open");
    await sp.connect(admin).approvePath(1);
    await expect(sp.connect(tp1).applyToPath(1)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(sp.connect(s3).applyToPath(1)).to.be.revertedWith("Required competency not held");
    const rc = await gas("applyToPath (3 nodes)", sp.connect(s1).applyToPath(1));
    expect(rc.logs.length).to.equal(1);
    expect(await sp.getPathApplication(1, s1.address)).to.be.greaterThan(0n);
    expect(await sp.getPathApplication(1, s3.address)).to.equal(0n);
    await expect(sp.connect(s1).applyToPath(1)).to.be.revertedWith("Already applied");
    await expect(sp.connect(s1).applyToPath(42)).to.be.revertedWith("Path is not open");
  });

  it("a version of a listed node meets the requirement", async function () {
    const { sp, tp1, admin, s2, mintAll, alloc } = await setup();
    await mintAll(s2);
    await alloc(s2, 1, [1]); await alloc(s2, 4, [2]);   // 4 is a version of 2
    await sp.connect(tp1).definePath([1, 2], CID);
    await sp.connect(admin).approvePath(1);
    await expect(sp.connect(s2).applyToPath(1)).to.emit(sp, "PathApplied").withArgs(1n, s2.address);
  });

  it("applications stop when the owner loses the third party role, and the administrator closes the post", async function () {
    const { reg, sp, tp1, admin, s1, mintAll, alloc } = await setup();
    await mintAll(s1); await alloc(s1, 1, [1]);
    await sp.connect(tp1).definePath([1], CID);
    await sp.connect(admin).approvePath(1);
    await reg.connect(admin).removeThirdParty(tp1.address);
    await expect(sp.connect(s1).applyToPath(1)).to.be.revertedWith("Owner is no longer a third party");
    await expect(sp.connect(tp1).cancelPath(1)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(sp.connect(admin).rejectPath(1)).to.emit(sp, "PathClosed").withArgs(1n);
    expect(await sp.activePathOf(tp1.address)).to.equal(0n);
  });

  it("measures applyToPath with the 7-node cap", async function () {
    const { sp, tp1, admin, s1, mintAll, alloc } = await setup();
    await mintAll(s1);
    await alloc(s1, 1, [1]); await alloc(s1, 2, [2]); await alloc(s1, 3, [3]);
    for (let n = 5; n <= 8; n++) await alloc(s1, n, [n - 1]);
    await sp.connect(tp1).definePath([1, 2, 3, 5, 6, 7, 8], CID);
    await sp.connect(admin).approvePath(1);
    await gas("applyToPath (7 nodes)", sp.connect(s1).applyToPath(1));
  });
});

describe("SkillPath: projects and teams", function () {
  // Project used in most tests: slot 0 needs nodes 1 and 2, slot 1 needs node 1.
  async function openProject(ctx, maxTeams = 1, slots = [[1, 2], [1]]) {
    await ctx.sp.connect(ctx.tp1).defineProject(slots, maxTeams, CID);
    const id = await ctx.sp.nextProjectId() - 1n;
    await ctx.sp.connect(ctx.admin).approveProject(id);
    return id;
  }
  async function ready(ctx) {
    for (const s of [ctx.s1, ctx.s2, ctx.s3, ctx.s4, ctx.s5]) await ctx.mintAll(s);
    await ctx.alloc(ctx.s1, 1, [1]); await ctx.alloc(ctx.s1, 2, [2]);   // s1 holds 1, 2
    await ctx.alloc(ctx.s2, 1, [1]); await ctx.alloc(ctx.s2, 4, [2]);   // s2 holds 1 and a version of 2
    await ctx.alloc(ctx.s3, 1, [1]);                                    // s3 holds 1
    await ctx.alloc(ctx.s4, 1, [1]);                                    // s4 holds 1
    await ctx.alloc(ctx.s5, 2, [1]);                                    // s5 holds 2 only
  }

  it("checks the definition of a project", async function () {
    const { sp, tp1 } = await setup();
    const d = (slots, maxTeams = 1) => sp.connect(tp1).defineProject(slots, maxTeams, CID);
    await expect(sp.connect(tp1).defineProject([[1]], 1, ethers.ZeroHash)).to.be.revertedWith("Metadata document required");
    await expect(d([])).to.be.revertedWith("Project needs at least one slot");
    await expect(d([[1], [1], [1], [1], [1]])).to.be.revertedWith("Too many slots");
    await expect(d([[1], []])).to.be.revertedWith("Empty slot");
    await expect(d([[1, 2, 3, 5, 6]])).to.be.revertedWith("Too many nodes in slot");
    await expect(d([[1, 99]])).to.be.revertedWith("Node does not exist");
    await expect(d([[2, 4]])).to.be.revertedWith("Node listed twice");
    await expect(d([[1]], 0)).to.be.revertedWith("maxTeams must be at least 1");
    await expect(d([[1]], 11)).to.be.revertedWith("maxTeams too large");
    await gas("defineProject (2 slots, 3 nodes)", d([[1, 2], [1]], 2));   // same node in two slots is fine
    await expect(d([[1]])).to.be.revertedWith("Already has an active project");
    const p = await sp.getProject(1);
    expect(p.slots).to.deep.equal([[1n, 2n], [1n]]);
    expect(p.maxTeams).to.equal(2n);
    expect(p.status).to.equal(ProjectStatus.PENDING);
  });

  it("students form a team slot by slot, can leave before it forms, never after", async function () {
    const ctx = await setup(); await ready(ctx);
    const { sp, tp1, admin, s1, s2, s3, s4, s5 } = ctx;
    await sp.connect(tp1).defineProject([[1, 2], [1]], 1, CID);
    await expect(sp.connect(s1).startTeam(1, 0)).to.be.revertedWith("Project is not open");
    await sp.connect(admin).approveProject(1);

    await expect(sp.connect(s3).startTeam(1, 0)).to.be.revertedWith("Required competency not held");
    await expect(sp.connect(s1).startTeam(1, 2)).to.be.revertedWith("Slot does not exist");
    const rc = await gas("startTeam (slot with 2 nodes)", sp.connect(s1).startTeam(1, 0));
    await expect(rc).to.emit(sp, "TeamStarted").withArgs(1n, 1n);
    await expect(rc).to.emit(sp, "SlotFilled").withArgs(1n, s1.address, 0);
    await expect(sp.connect(s1).startTeam(1, 1)).to.be.revertedWith("Already in a team of this project");
    await expect(sp.connect(s2).joinTeam(1, 0)).to.be.revertedWith("Slot already taken");
    await expect(sp.connect(s5).joinTeam(1, 1)).to.be.revertedWith("Required competency not held");

    await sp.connect(s3).joinTeam(1, 1);        // completes the team? two slots: yes
    let t = await sp.getProjectTeam(1);
    expect(t.formed).to.equal(true);
    expect(t.members).to.deep.equal([s1.address, s3.address]);
    await expect(sp.connect(s3).leaveSlot(1)).to.be.revertedWith("Team already formed");
    await expect(sp.connect(s4).joinTeam(1, 1)).to.be.revertedWith("Team already formed");

    // A second team under the same project: s2 (holding a version of 2) starts slot 0, s4 completes it.
    await sp.connect(s2).startTeam(1, 0);
    await sp.connect(s4).joinTeam(2, 1);
    t = await sp.getProjectTeam(2);
    expect(t.formed).to.equal(true);
  });

  it("leaveSlot frees the slot for another student", async function () {
    const ctx = await setup(); await ready(ctx);
    const { sp, tp1, admin, s1, s3, s4 } = ctx;
    await sp.connect(tp1).defineProject([[1, 2], [1], [1]], 1, CID);
    await sp.connect(admin).approveProject(1);
    await sp.connect(s1).startTeam(1, 0);
    await sp.connect(s3).joinTeam(1, 1);
    await expect(sp.connect(s4).leaveSlot(1)).to.be.revertedWith("Not in this team");
    await expect(sp.connect(s3).leaveSlot(1)).to.emit(sp, "SlotLeft").withArgs(1n, s3.address, 1);
    expect(await sp.teamOf(1, s3.address)).to.equal(0n);
    await sp.connect(s4).joinTeam(1, 1);
    await gas("joinTeam (last slot, forms the team)", sp.connect(s3).joinTeam(1, 2));
    const t = await sp.getProjectTeam(1);
    expect(t.members).to.deep.equal([s1.address, s4.address, s3.address]);
    expect(t.formed).to.equal(true);
  });

  it("the owner selects formed teams, and the project starts at maxTeams", async function () {
    const ctx = await setup(); await ready(ctx);
    const { sp, tp1, tp2, s1, s2, s3, s4 } = ctx;
    const id = await openProject(ctx, 1);
    await sp.connect(s1).startTeam(id, 0);
    await expect(sp.connect(tp1).selectTeam(1)).to.be.revertedWith("Team not formed");
    await sp.connect(s3).joinTeam(1, 1);
    await expect(sp.connect(tp2).selectTeam(1)).to.be.revertedWith("Not the owner of the project");
    const rc = await gas("selectTeam (reaches maxTeams, starts the project)", sp.connect(tp1).selectTeam(1));
    await expect(rc).to.emit(sp, "TeamSelected").withArgs(1n, id);
    await expect(rc).to.emit(sp, "ProjectStarted").withArgs(id);
    expect((await sp.getProject(id)).status).to.equal(ProjectStatus.STARTED);
    expect(await sp.activeProjectOf(tp1.address)).to.equal(0n);
    await expect(sp.connect(s2).startTeam(id, 0)).to.be.revertedWith("Project is not open");
    await expect(sp.connect(tp1).cancelProject(id)).to.be.revertedWith("Project is not pending or open");
  });

  it("endRecruitment starts the project with the teams selected, or closes it with none", async function () {
    const ctx = await setup(); await ready(ctx);
    const { sp, tp1, s1, s3 } = ctx;
    const id = await openProject(ctx, 2);
    await sp.connect(s1).startTeam(id, 0);
    await sp.connect(s3).joinTeam(1, 1);
    await sp.connect(tp1).selectTeam(1);
    expect((await sp.getProject(id)).status).to.equal(ProjectStatus.OPEN);
    await expect(sp.connect(tp1).selectTeam(1)).to.be.revertedWith("Team already selected");
    await expect(sp.connect(tp1).cancelProject(id)).to.be.revertedWith("Teams already selected");
    await expect(sp.connect(tp1).endRecruitment(id)).to.emit(sp, "ProjectStarted").withArgs(id);

    const id2 = await openProject(ctx, 2);
    await expect(sp.connect(tp1).endRecruitment(id2)).to.emit(sp, "ProjectClosed").withArgs(id2);
    expect((await sp.getProject(id2)).status).to.equal(ProjectStatus.CLOSED);
  });

  it("no slot can be left once the project has started", async function () {
    const ctx = await setup(); await ready(ctx);
    const { sp, tp1, s1, s2, s3 } = ctx;
    const id = await openProject(ctx, 1);
    await sp.connect(s1).startTeam(id, 0);
    await sp.connect(s3).joinTeam(1, 1);          // team 1 formed
    await sp.connect(s2).startTeam(id, 0);        // team 2 still forming
    await sp.connect(tp1).selectTeam(1);          // maxTeams 1: the project starts
    await expect(sp.connect(s2).leaveSlot(2)).to.be.revertedWith("Project is not open");
  });

  it("the administrator withdraws an open project, even with teams selected", async function () {
    const ctx = await setup(); await ready(ctx);
    const { sp, tp1, admin, s1, s3 } = ctx;
    const id = await openProject(ctx, 2);
    await sp.connect(s1).startTeam(id, 0);
    await sp.connect(s3).joinTeam(1, 1);
    await sp.connect(tp1).selectTeam(1);
    await expect(sp.connect(admin).rejectProject(id)).to.emit(sp, "ProjectClosed").withArgs(id);
    expect(await sp.activeProjectOf(tp1.address)).to.equal(0n);
    await expect(sp.connect(tp1).selectTeam(1)).to.be.revertedWith("Project is not open");
  });

  it("a one-slot project forms the team at the first student", async function () {
    const ctx = await setup(); await ready(ctx);
    const { sp, s3 } = ctx;
    const id = await openProject(ctx, 1, [[1]]);
    const rc = await (await sp.connect(s3).startTeam(id, 0)).wait();
    await expect(rc).to.emit(sp, "TeamFormed").withArgs(1n, id);
  });

  it("the administrator rejects a pending project, the owner cancels an open one", async function () {
    const ctx = await setup();
    const { sp, tp1, tp2, admin } = ctx;
    await sp.connect(tp1).defineProject([[1]], 1, CID);
    await expect(sp.connect(admin).rejectProject(1)).to.emit(sp, "ProjectClosed").withArgs(1n);
    await expect(sp.connect(admin).approveProject(1)).to.be.revertedWith("Project is not pending");
    await sp.connect(tp2).defineProject([[1]], 1, CID);
    await sp.connect(admin).approveProject(2);
    await expect(sp.connect(tp1).cancelProject(2)).to.be.revertedWith("Not the owner of the project");
    await expect(sp.connect(tp2).cancelProject(2)).to.emit(sp, "ProjectClosed").withArgs(2n);
    await expect(sp.connect(admin).approveProject(9)).to.be.revertedWith("Project not defined");
  });

  it("team slots stop when the owner loses the third party role", async function () {
    const ctx = await setup(); await ready(ctx);
    const { reg, sp, tp1, admin, s1 } = ctx;
    const id = await openProject(ctx, 1);
    await reg.connect(admin).removeThirdParty(tp1.address);
    await expect(sp.connect(s1).startTeam(id, 0)).to.be.revertedWith("Owner is no longer a third party");
  });
});

after(function () {
  console.log("\n  Gas used (local Hardhat network, optimizer on, 200 runs):");
  for (const [label, g] of gasLog) console.log("   ", g.toString().padStart(8), " ", label);
});
