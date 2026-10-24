const { expect } = require("chai");
const { ethers } = require("hardhat");

const SEASON = ethers.id("2025-S1");
const SEASON2 = ethers.id("2025-S2");
const PWR = ethers.id("PWR");
const CTR = ethers.id("CTR");
const CODE = ethers.id("CODE");
const GRID = ethers.id("GRID");
const OPT = ethers.id("OPT");
const CID = ethers.id("metadata document");
const ROOT = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE, held by the deployer until renounceAdmin
const UNAUTHORIZED = "AccessControlUnauthorizedAccount";

// The registry as deployed: the deployer holds the root role, admin the
// seasonal administrator role, and no other role is anchored yet.
async function deployRegistry() {
  const [deployer, admin, registrar, oracle, tp, s1, s2, outsider] = await ethers.getSigners();
  const reg = await (await ethers.getContractFactory("IdentityRegistry")).deploy(admin.address);
  return { reg, deployer, admin, registrar, oracle, tp, s1, s2, outsider };
}

// Every role anchored, with SkillBadge and SkillGraph on the same registry.
async function setup() {
  const ctx = await deployRegistry();
  const { reg, admin, registrar, oracle, tp, s1, s2 } = ctx;
  await reg.connect(admin).anchorRegistrar(registrar.address);
  await reg.connect(admin).anchorOracle(oracle.address);
  await reg.connect(admin).anchorThirdParty(tp.address);
  for (const s of [s1, s2]) await reg.connect(registrar).anchorStudent(s.address);

  const regAddr = await reg.getAddress();
  const badge = await (await ethers.getContractFactory("SkillBadge")).deploy(regAddr, "");
  const graph = await (await ethers.getContractFactory("SkillGraph")).deploy(regAddr, await badge.getAddress(), "");

  const define = (skillIds, points, seasonId = SEASON) =>
    badge.connect(admin).defineBadge({
      seasonId, courseId: ethers.id("C1"), badgeCode: ethers.id("B"), skillIds, points, metadataCID: CID,
    });
  return { ...ctx, badge, graph, define };
}

describe("IdentityRegistry", function () {
  it("grantRole and revokeRole always revert, even for the root role", async function () {
    const { reg, deployer, admin, outsider } = await deployRegistry();
    const HEI_ADMIN = await reg.HEI_ADMIN_ROLE();
    const STUDENT = await reg.STUDENT_ROLE();
    for (const caller of [deployer, admin, outsider]) {
      for (const role of [ROOT, HEI_ADMIN, STUDENT]) {
        await expect(reg.connect(caller).grantRole(role, outsider.address)).to.be.revertedWith("Use dedicated anchor functions");
        await expect(reg.connect(caller).revokeRole(role, admin.address)).to.be.revertedWith("Use dedicated remove functions");
      }
    }
    expect(await reg.hasRole(STUDENT, outsider.address)).to.equal(false);
    expect(await reg.hasRole(HEI_ADMIN, admin.address)).to.equal(true);
  });

  it("the administrator anchors the registrar, the oracle and third parties, the registrar anchors students", async function () {
    const { reg, admin, registrar, oracle, tp, s1, outsider } = await deployRegistry();
    const HEI_ADMIN = await reg.HEI_ADMIN_ROLE();
    const REGISTRAR = await reg.REGISTRAR_ROLE();
    for (const fn of ["anchorRegistrar", "anchorOracle", "anchorThirdParty"]) {
      await expect(reg.connect(outsider)[fn](outsider.address))
        .to.be.revertedWithCustomError(reg, UNAUTHORIZED).withArgs(outsider.address, HEI_ADMIN);
    }
    await expect(reg.connect(admin).anchorRegistrar(registrar.address)).to.emit(reg, "RegistrarRegistered").withArgs(registrar.address);
    await expect(reg.connect(admin).anchorOracle(oracle.address)).to.emit(reg, "OracleRegistered").withArgs(oracle.address);
    await expect(reg.connect(admin).anchorThirdParty(tp.address)).to.emit(reg, "ThirdPartyRegistered").withArgs(tp.address);
    await expect(reg.connect(registrar).anchorThirdParty(outsider.address))
      .to.be.revertedWithCustomError(reg, UNAUTHORIZED).withArgs(registrar.address, HEI_ADMIN);

    await expect(reg.connect(admin).anchorStudent(s1.address))
      .to.be.revertedWithCustomError(reg, UNAUTHORIZED).withArgs(admin.address, REGISTRAR);
    await expect(reg.connect(registrar).anchorStudent(s1.address)).to.emit(reg, "StudentRegistered").withArgs(s1.address);
    expect(await reg.hasRole(await reg.STUDENT_ROLE(), s1.address)).to.equal(true);

    const anchors = [
      ["anchorRegistrar", admin, registrar], ["anchorOracle", admin, oracle],
      ["anchorThirdParty", admin, tp], ["anchorStudent", registrar, s1],
    ];
    for (const [fn, caller, wallet] of anchors) {
      await expect(reg.connect(caller)[fn](ethers.ZeroAddress)).to.be.revertedWith("Invalid address");
      await expect(reg.connect(caller)[fn](wallet.address)).to.be.revertedWith("Already registered");
    }
  });

  it("renounceAdmin leaves no one with the root role, runs once, and the administrator still anchors", async function () {
    const { reg, deployer, admin, oracle } = await deployRegistry();
    await expect(reg.connect(admin).renounceAdmin())
      .to.be.revertedWithCustomError(reg, UNAUTHORIZED).withArgs(admin.address, ROOT);
    await expect(reg.connect(deployer).renounceAdmin())
      .to.emit(reg, "RoleRevoked").withArgs(ROOT, deployer.address, deployer.address);
    // The constructor grants the root role once, to the deployer, and grantRole is
    // blocked, so once the deployer renounces it no address holds it.
    const grants = await reg.queryFilter(reg.filters.RoleGranted(ROOT));
    expect(grants.map(e => e.args.account)).to.deep.equal([deployer.address]);
    expect(await reg.hasRole(ROOT, deployer.address)).to.equal(false);
    await expect(reg.connect(deployer).renounceAdmin())
      .to.be.revertedWithCustomError(reg, UNAUTHORIZED).withArgs(deployer.address, ROOT);
    await expect(reg.connect(admin).anchorOracle(oracle.address)).to.emit(reg, "OracleRegistered").withArgs(oracle.address);
  });

  it("renounceRole always reverts, for every role, and renounceAdmin still works", async function () {
    const { reg, deployer, admin, registrar, oracle, tp, s1 } = await setup();
    const holders = [
      [ROOT, deployer], [await reg.HEI_ADMIN_ROLE(), admin], [await reg.REGISTRAR_ROLE(), registrar],
      [await reg.ORACLE_ROLE(), oracle], [await reg.THIRD_PARTY_ROLE(), tp], [await reg.STUDENT_ROLE(), s1],
    ];
    for (const [role, holder] of holders) {
      await expect(reg.connect(holder).renounceRole(role, holder.address)).to.be.revertedWith("Use dedicated remove functions");
      expect(await reg.hasRole(role, holder.address)).to.equal(true);
    }
    await expect(reg.connect(deployer).renounceAdmin())
      .to.emit(reg, "RoleRevoked").withArgs(ROOT, deployer.address, deployer.address);
    expect(await reg.hasRole(ROOT, deployer.address)).to.equal(false);
  });

  it("only the administrator removes a role, only from a wallet that holds it, and a removed oracle cannot mint", async function () {
    const { reg, badge, define, admin, registrar, oracle, tp, s1, s2, outsider } = await setup();
    await define([PWR], [10]);
    await define([CTR], [10]);
    await badge.connect(oracle).mintBadge(s2.address, 1, ethers.ZeroHash);   // the oracle mints while it holds the role

    const removals = [
      ["removeStudent", s1, "StudentDeactivated", "Not a registered student"],
      ["removeThirdParty", tp, "ThirdPartyDeactivated", "Not a registered third party"],
      ["removeRegistrar", registrar, "RegistrarDeactivated", "Not a registered registrar"],
      ["removeOracle", oracle, "OracleDeactivated", "Not a registered oracle"],
    ];
    for (const [fn, wallet, event, refusal] of removals) {
      await expect(reg.connect(registrar)[fn](wallet.address)).to.be.revertedWithCustomError(reg, UNAUTHORIZED);
      await expect(reg.connect(admin)[fn](outsider.address)).to.be.revertedWith(refusal);
      await expect(reg.connect(admin)[fn](wallet.address)).to.emit(reg, event).withArgs(wallet.address);
      await expect(reg.connect(admin)[fn](wallet.address)).to.be.revertedWith(refusal);
    }
    await expect(badge.connect(oracle).mintBadge(s2.address, 2, ethers.ZeroHash))
      .to.be.revertedWith("PermissionGatekeeper: unauthorized");
  });
});

describe("SkillBadge and the season freeze", function () {
  it("defineBadge: only the administrator, a valid skill vector, token IDs sequential from 1", async function () {
    const { badge, define, oracle, outsider } = await setup();
    const params = {
      seasonId: SEASON, courseId: ethers.id("C1"), badgeCode: ethers.id("B"), skillIds: [PWR], points: [10], metadataCID: CID,
    };
    await expect(badge.connect(oracle).defineBadge(params)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(badge.connect(outsider).defineBadge(params)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(define([PWR, CTR], [10])).to.be.revertedWith("Mismatched skill arrays");
    await expect(define([PWR, CTR, CODE, GRID, OPT], [1, 1, 1, 1, 1])).to.be.revertedWith("Too many skills (max 4)");
    await expect(define([], [])).to.be.revertedWith("Must have at least one skill");
    await expect(define([PWR, CTR], [10, 0])).to.be.revertedWith("Skill points must be > 0");
    await expect(define([PWR, CTR, PWR], [10, 5, 5])).to.be.revertedWith("Duplicate skill ID");

    expect(await badge.nextTokenId()).to.equal(1n);
    await expect(define([PWR, CTR, CODE, GRID], [6, 5, 5, 4]))
      .to.emit(badge, "BadgeDefined").withArgs(1n, SEASON, ethers.id("C1"), ethers.id("B"));
    await expect(define([CODE], [7]))
      .to.emit(badge, "BadgeDefined").withArgs(2n, SEASON, ethers.id("C1"), ethers.id("B"));
    expect(await badge.nextTokenId()).to.equal(3n);
    expect(await badge.getSkillIds(1)).to.deep.equal([PWR, CTR, CODE, GRID]);
    expect(await badge.getSkillPoints(1, GRID)).to.equal(4n);
    expect(await badge.getSkillPoints(1, OPT)).to.equal(0n);
    expect(await badge.getMetadataCID(2)).to.equal(CID);
  });

  it("mintBadge: only the oracle, a defined badge, a registered student, once; the grade commitment is stored", async function () {
    const { badge, define, admin, oracle, s1, outsider } = await setup();
    await define([PWR], [10]);
    // The oracle's encoding (server.js): a badge salt from the student's master
    // salt and the token ID, then the grade with that salt.
    const sha256Hex = s => ethers.sha256(ethers.toUtf8Bytes(s)).slice(2);
    const masterSalt = sha256Hex("S001");
    const badgeSalt = sha256Hex(masterSalt + "1");
    const commitment = "0x" + sha256Hex("16" + badgeSalt);

    await expect(badge.connect(admin).mintBadge(s1.address, 1, commitment)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(badge.connect(s1).mintBadge(s1.address, 1, commitment)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(badge.connect(oracle).mintBadge(s1.address, 2, commitment)).to.be.revertedWith("Badge type not defined");
    await expect(badge.connect(oracle).mintBadge(outsider.address, 1, commitment))
      .to.be.revertedWith("Recipient is not a registered student");
    await expect(badge.connect(oracle).mintBadge(s1.address, 1, commitment))
      .to.emit(badge, "BadgeMinted").withArgs(s1.address, 1n, commitment);
    expect(await badge.balanceOf(s1.address, 1)).to.equal(1n);
    expect(await badge.gradeCommitments(s1.address, 1)).to.equal(commitment);
    await expect(badge.connect(oracle).mintBadge(s1.address, 1, ethers.ZeroHash)).to.be.revertedWith("Already minted");
    expect(await badge.gradeCommitments(s1.address, 1)).to.equal(commitment);
  });

  it("badges are soulbound: no transfer, not even by an approved operator", async function () {
    const { badge, define, oracle, s1, s2 } = await setup();
    await define([PWR], [10]);
    await badge.connect(oracle).mintBadge(s1.address, 1, ethers.ZeroHash);
    await expect(badge.connect(s1).safeTransferFrom(s1.address, s2.address, 1, 1, "0x"))
      .to.be.revertedWith("SkillBadge: soulbound, not transferable");
    await expect(badge.connect(s1).safeBatchTransferFrom(s1.address, s2.address, [1], [1], "0x"))
      .to.be.revertedWith("SkillBadge: soulbound, not transferable");
    await badge.connect(s1).setApprovalForAll(s2.address, true);
    await expect(badge.connect(s2).safeTransferFrom(s1.address, s2.address, 1, 1, "0x"))
      .to.be.revertedWith("SkillBadge: soulbound, not transferable");
    expect(await badge.balanceOf(s1.address, 1)).to.equal(1n);
    expect(await badge.balanceOf(s2.address, 1)).to.equal(0n);
  });

  it("freezeSeason on SkillBadge: only the administrator, once; blocks definitions and corrections of that season, not minting", async function () {
    const { badge, define, admin, oracle, s1 } = await setup();
    await define([PWR], [10]);             // 1, season 1
    await define([CTR], [10], SEASON2);    // 2, season 2
    const upd = id => badge.connect(admin).updateBadge(id, {
      badgeCode: ethers.id("B"), skillIds: [PWR, CTR], points: [6, 4], metadataCID: CID,
    });
    await expect(upd(1)).to.emit(badge, "BadgeUpdated").withArgs(1n, ethers.id("B"));   // corrected while open
    expect(await badge.getSkillIds(1)).to.deep.equal([PWR, CTR]);

    await expect(badge.connect(oracle).freezeSeason(SEASON)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await expect(badge.connect(admin).freezeSeason(SEASON)).to.emit(badge, "SeasonFrozen").withArgs(SEASON);
    await expect(badge.connect(admin).freezeSeason(SEASON)).to.be.revertedWith("Already frozen");
    expect(await badge.seasonFrozen(SEASON)).to.equal(true);
    await expect(define([PWR], [10])).to.be.revertedWith("Season is frozen");
    await expect(upd(1)).to.be.revertedWith("Season is frozen");

    await expect(upd(2)).to.emit(badge, "BadgeUpdated");    // the other season stays open
    await expect(define([PWR], [10], SEASON2)).to.emit(badge, "BadgeDefined").withArgs(3n, SEASON2, ethers.id("C1"), ethers.id("B"));
    await expect(badge.connect(oracle).mintBadge(s1.address, 1, ethers.ZeroHash)).to.emit(badge, "BadgeMinted");
  });

  it("freezeSeason on SkillGraph blocks node definitions and corrections of that season, not allocation", async function () {
    const { badge, graph, define, admin, oracle, s1 } = await setup();
    await define([PWR], [10]);
    await badge.connect(oracle).mintBadge(s1.address, 1, ethers.ZeroHash);
    const node = seasonId => graph.connect(admin).defineNode({
      seasonId, nodeCode: ethers.id("N"), skillIds: [PWR], points: [10], prerequisiteGroups: [], metadataCID: CID, versionOf: 0,
    });
    const upd = id => graph.connect(admin).updateNode(id, {
      nodeCode: ethers.id("N"), skillIds: [PWR], points: [8], prerequisiteGroups: [], metadataCID: CID,
    });
    await node(SEASON);                     // node 1
    await expect(upd(1)).to.emit(graph, "NodeUpdated");

    await expect(graph.connect(oracle).freezeSeason(SEASON)).to.be.revertedWith("PermissionGatekeeper: unauthorized");
    await badge.connect(admin).freezeSeason(SEASON);    // the replay freezes both contracts
    await expect(graph.connect(admin).freezeSeason(SEASON)).to.emit(graph, "SeasonFrozen").withArgs(SEASON);
    await expect(graph.connect(admin).freezeSeason(SEASON)).to.be.revertedWith("Already frozen");
    await expect(node(SEASON)).to.be.revertedWith("Season is frozen");
    await expect(upd(1)).to.be.revertedWith("Season is frozen");
    await expect(node(SEASON2)).to.emit(graph, "NodeDefined");   // node 2, the other season stays open

    await expect(graph.connect(s1).allocateBadges(1, [1])).to.emit(graph, "NodeUnlocked");
    expect(await graph.balanceOf(s1.address, 1)).to.equal(1n);
    expect(await graph.getNodeBadges(1, s1.address)).to.deep.equal([1n]);
  });

  it("uri() is ipfs://f01551220 followed by the hex of the metadata hash", async function () {
    const { badge, admin } = await setup();
    const doc = '{"type": "badge", "specId": "COSE-2", "name": "Dispatch and Scheduling"}';
    const hash = ethers.sha256(ethers.toUtf8Bytes(doc));   // the SHA-256 the definition anchors
    await badge.connect(admin).defineBadge({
      seasonId: SEASON2, courseId: ethers.id("COSE"), badgeCode: ethers.id("COSE-2"),
      skillIds: [OPT, PWR, GRID], points: [7, 3, 3], metadataCID: hash,
    });
    expect(await badge.uri(1)).to.equal("ipfs://f01551220" + hash.slice(2));
    await expect(badge.uri(2)).to.be.revertedWith("Badge type not defined");
  });
});
