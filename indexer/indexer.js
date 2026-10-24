// Event indexer: fills the ledger view (DB/schema.sql) from the
// events of SkillBadge, SkillGraph and SkillPath.
//
// One event stream: for each block range, one getLogs over the contracts,
// handled in block and log index order, in one database transaction that also
// stores the last block handled in indexer_state. At startup the indexer
// resumes after that block, then polls every 2 seconds.
//
// Events are lean. Each handler reads the whole current record through the
// view functions and public getters, and writes it, insert or update, so
// handling an event twice gives the same rows. A definition also takes fields
// from its metadata document, fetched through the backend (GET /metadata/:id).
// The indexer hashes the raw bytes: a document that cannot be fetched, or whose
// SHA-256 is not the hash on the ledger, leaves the document fields NULL and
// counts as a document mismatch. Every row carries the block number and block
// time of the event that wrote it. The indexer writes no reference data.
//
//   npm start       keeps polling
//   npm run sync    stops at the last block of the chain
//
// Settings from the environment or indexer/.env: RPC_URL, DEPLOYMENTS_PATH,
// METADATA_API (the backend), DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { Pool } = require("pg");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const DEPLOYMENTS_PATH =
  process.env.DEPLOYMENTS_PATH || path.resolve(__dirname, "../packages/hardhat/deployments/localhost");
const METADATA_API = process.env.METADATA_API || "http://localhost:3001";
const BLOCKS_PER_RANGE = 2000;
const POLL_MS = 2000;

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "hei_ecosystem",
  user: process.env.DB_USER || "hei_admin",
  password: process.env.DB_PASSWORD || "hei_local",
});
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contracts = {}; // "SkillBadge", "SkillGraph", "SkillPath" -> ethers.Contract, from DEPLOYMENTS_PATH
const PATH_STATUS = ["pending", "open", "closed"]; // SkillPath.PathStatus
const PROJECT_STATUS = ["pending", "open", "started", "closed"]; // SkillPath.ProjectStatus

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function loadContract(name) {
  const file = path.resolve(DEPLOYMENTS_PATH, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`${file} not found: deploy first, or set DEPLOYMENTS_PATH`);
  const { address, abi } = JSON.parse(fs.readFileSync(file, "utf8"));
  return new ethers.Contract(address, abi, provider);
}

// Block number and block time of an event. Block times are cached per block.
const blockTimes = new Map();
async function blockOf(log) {
  if (!blockTimes.has(log.blockNumber)) {
    const block = await provider.getBlock(log.blockNumber);
    blockTimes.set(log.blockNumber, new Date(block.timestamp * 1000));
  }
  return { block: log.blockNumber, time: blockTimes.get(log.blockNumber) };
}

// The metadata document with this hash, through the backend, or null. The raw
// bytes are hashed and parsed only if they match the hash on the ledger.
async function fetchDocument(hash, what, counts) {
  let problem;
  try {
    const r = await fetch(`${METADATA_API}/metadata/${hash}`, { signal: AbortSignal.timeout(10_000) });
    const bytes = Buffer.from(await r.arrayBuffer());
    if (!r.ok) problem = `GET /metadata/${hash} answered ${r.status}`;
    else if ("0x" + crypto.createHash("sha256").update(bytes).digest("hex") !== hash) problem = "its SHA-256 is not the hash on the ledger";
    else return JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    problem = e.message;
  }
  counts.documents++;
  console.log(`  document mismatch, ${what}: ${problem}`);
  return null;
}

// The season of a definition. Its label comes from the document, academicYear
// + "-S" + number, and only if keccak256 of the label is the season ID.
async function writeSeason(db, seasonId, doc, counts) {
  let label = null;
  if (doc?.season) {
    const candidate = `${doc.season.academicYear}-S${doc.season.number}`;
    if (ethers.id(candidate) === seasonId) label = candidate;
    else {
      counts.seasons++;
      console.log(`  season mismatch: keccak256("${candidate}") is not ${seasonId}`);
    }
  }
  await db.query(
    `INSERT INTO seasons (season_id, season_label) VALUES ($1, $2)
     ON CONFLICT (season_id) DO UPDATE SET season_label = COALESCE(seasons.season_label, EXCLUDED.season_label)`,
    [seasonId, label],
  );
}

// BadgeDefined, BadgeUpdated: the badge from badgeDefinitions, getSkillIds and
// getSkillPoints, and from its document.
async function writeBadge(db, ev, counts) {
  const skillBadge = contracts.SkillBadge;
  const tokenId = Number(ev.args.tokenId);
  const def = await skillBadge.badgeDefinitions(tokenId);
  const skillIds = await skillBadge.getSkillIds(tokenId);
  const points = [];
  for (const id of skillIds) points.push(Number(await skillBadge.getSkillPoints(tokenId, id)));
  const doc = await fetchDocument(def.metadataCID, `badge ${tokenId}`, counts);
  await writeSeason(db, def.seasonId, doc, counts);
  const { block, time } = await blockOf(ev.log);
  await db.query(
    `INSERT INTO badges (token_id, season_id, course_id, badge_code, metadata_cid, spec_id, badge_name, description,
                         course_code, course_name, assessment, defined_block, defined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (token_id) DO UPDATE SET
       season_id = EXCLUDED.season_id, course_id = EXCLUDED.course_id, badge_code = EXCLUDED.badge_code,
       metadata_cid = EXCLUDED.metadata_cid, spec_id = EXCLUDED.spec_id, badge_name = EXCLUDED.badge_name,
       description = EXCLUDED.description, course_code = EXCLUDED.course_code, course_name = EXCLUDED.course_name,
       assessment = EXCLUDED.assessment`,
    [tokenId, def.seasonId, def.courseId, def.badgeCode, def.metadataCID, doc?.specId ?? null, doc?.name ?? null,
     doc?.description ?? null, doc?.course?.code ?? null, doc?.course?.name ?? null, doc?.assessment ?? null, block, time],
  );
  if (ev.name === "BadgeUpdated")
    await db.query("UPDATE badges SET updated_block = $2, updated_at = $3 WHERE token_id = $1", [tokenId, block, time]);
  await db.query("DELETE FROM badge_skills WHERE token_id = $1", [tokenId]);
  for (const [i, id] of skillIds.entries())
    await db.query("INSERT INTO badge_skills (token_id, skill_id, points) VALUES ($1, $2, $3)", [tokenId, id, points[i]]);
  return `token ${tokenId}, ${doc?.specId ?? "no document"}, ${skillIds.length} skill types`;
}

// BadgeMinted: one row of student_badges. Handling it again keeps committed_to_node.
async function writeMint(db, ev) {
  const { student, tokenId, gradeCommitment } = ev.args;
  const { block, time } = await blockOf(ev.log);
  await db.query(
    `INSERT INTO student_badges (wallet_address, token_id, grade_commitment, minted_block, minted_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet_address, token_id) DO UPDATE SET
       grade_commitment = EXCLUDED.grade_commitment, minted_block = EXCLUDED.minted_block, minted_at = EXCLUDED.minted_at`,
    [student, Number(tokenId), gradeCommitment, block, time],
  );
  return `token ${tokenId} to ${student}`;
}

// NodeDefined, NodeUpdated, NodeVersionOf: the node from nodeDefinitions,
// getThresholdSkillIds, getThresholdPoints and getPrerequisiteGroups, and from
// its document. NodeVersionOf comes before NodeDefined in the same transaction,
// and both write the same record, so their order does not matter.
async function writeNode(db, ev, counts) {
  const skillGraph = contracts.SkillGraph;
  const nodeId = Number(ev.args.nodeId);
  const def = await skillGraph.nodeDefinitions(nodeId);
  const skillIds = await skillGraph.getThresholdSkillIds(nodeId);
  const points = [];
  for (const id of skillIds) points.push(Number(await skillGraph.getThresholdPoints(nodeId, id)));
  const groups = (await skillGraph.getPrerequisiteGroups(nodeId)).map(g => g.map(Number));
  const doc = await fetchDocument(def.metadataCID, `node ${nodeId}`, counts);
  await writeSeason(db, def.seasonId, doc, counts);
  const { block, time } = await blockOf(ev.log);
  await db.query(
    `INSERT INTO nodes (node_id, season_id, node_code, metadata_cid, version_of, node_name, tier, description,
                        defined_block, defined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (node_id) DO UPDATE SET
       season_id = EXCLUDED.season_id, node_code = EXCLUDED.node_code, metadata_cid = EXCLUDED.metadata_cid,
       version_of = EXCLUDED.version_of, node_name = EXCLUDED.node_name, tier = EXCLUDED.tier,
       description = EXCLUDED.description`,
    [nodeId, def.seasonId, def.nodeCode, def.metadataCID, Number(def.versionOf), doc?.name ?? null, doc?.tier ?? null,
     doc?.description ?? null, block, time],
  );
  if (ev.name === "NodeUpdated")
    await db.query("UPDATE nodes SET updated_block = $2, updated_at = $3 WHERE node_id = $1", [nodeId, block, time]);
  await db.query("DELETE FROM node_thresholds WHERE node_id = $1", [nodeId]);
  for (const [i, id] of skillIds.entries())
    await db.query("INSERT INTO node_thresholds (node_id, skill_id, min_points) VALUES ($1, $2, $3)", [nodeId, id, points[i]]);
  await db.query("DELETE FROM node_prerequisites WHERE node_id = $1", [nodeId]);
  for (const [g, group] of groups.entries())
    for (const p of group)
      await db.query(
        `INSERT INTO node_prerequisites (node_id, group_index, prerequisite_node_id) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [nodeId, g, p],
      );
  return `node ${nodeId}, ${doc?.name ?? "no document"}, version of ${def.versionOf}, ${groups.length} prerequisite groups`;
}

// NodeUnlocked: one row of student_competencies with the event's badge IDs,
// and committed_to_node on those badges.
async function writeUnlock(db, ev) {
  const student = ev.args.student;
  const nodeId = Number(ev.args.nodeId);
  const badgeIds = ev.args.badgeIds.map(Number);
  const { block, time } = await blockOf(ev.log);
  await db.query(
    `INSERT INTO student_competencies (wallet_address, node_id, badge_ids, unlocked_block, unlocked_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet_address, node_id) DO UPDATE SET
       badge_ids = EXCLUDED.badge_ids, unlocked_block = EXCLUDED.unlocked_block, unlocked_at = EXCLUDED.unlocked_at`,
    [student, nodeId, badgeIds, block, time],
  );
  await db.query(
    "UPDATE student_badges SET committed_to_node = $3 WHERE wallet_address = $1 AND token_id = ANY($2::int[])",
    [student, badgeIds, nodeId],
  );
  return `node ${nodeId} by ${student}, badges ${badgeIds.join(" ")}`;
}

// SeasonFrozen: the freeze block of the season, for the contract that emitted it.
async function writeFreeze(db, ev) {
  const column = ev.contract === "SkillBadge" ? "badges_frozen" : "nodes_frozen";
  const { block, time } = await blockOf(ev.log);
  const r = await db.query(
    `INSERT INTO seasons (season_id, ${column}_block, ${column}_at) VALUES ($1, $2, $3)
     ON CONFLICT (season_id) DO UPDATE SET ${column}_block = EXCLUDED.${column}_block, ${column}_at = EXCLUDED.${column}_at
     RETURNING season_label`,
    [ev.args.seasonId, block, time],
  );
  return `season ${r.rows[0].season_label ?? ev.args.seasonId}`;
}

// PathDefined, PathApproved, PathClosed: the path from getCompetencyPath, and
// from its document.
async function writePath(db, ev, counts) {
  const pathId = Number(ev.args.pathId);
  const path = await contracts.SkillPath.getCompetencyPath(pathId);
  const doc = await fetchDocument(path.metadataCID, `path ${pathId}`, counts);
  const status = PATH_STATUS[Number(path.status)];
  const { block, time } = await blockOf(ev.log);
  await db.query(
    `INSERT INTO competency_paths (path_id, owner, status, node_ids, metadata_cid, name, description, third_party,
                                   defined_block, defined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (path_id) DO UPDATE SET
       owner = EXCLUDED.owner, status = EXCLUDED.status, node_ids = EXCLUDED.node_ids,
       metadata_cid = EXCLUDED.metadata_cid, name = EXCLUDED.name, description = EXCLUDED.description,
       third_party = EXCLUDED.third_party`,
    [pathId, path.owner, status, path.nodeIds.map(Number), path.metadataCID, doc?.name ?? null,
     doc?.description ?? null, doc?.thirdParty ?? null, block, time],
  );
  if (ev.name !== "PathDefined")
    await db.query("UPDATE competency_paths SET updated_block = $2, updated_at = $3 WHERE path_id = $1", [pathId, block, time]);
  return `path ${pathId}, ${status}, ${doc?.name ?? "no document"}`;
}

// PathApplied: one row, with the time getPathApplication returns.
async function writeApplication(db, ev) {
  const pathId = Number(ev.args.pathId);
  const student = ev.args.student;
  const appliedAt = Number(await contracts.SkillPath.getPathApplication(pathId, student));
  await db.query(
    `INSERT INTO path_applications (path_id, wallet_address, applied_at, applied_block) VALUES ($1, $2, $3, $4)
     ON CONFLICT (path_id, wallet_address) DO UPDATE SET
       applied_at = EXCLUDED.applied_at, applied_block = EXCLUDED.applied_block`,
    [pathId, student, new Date(appliedAt * 1000), ev.log.blockNumber],
  );
  return `path ${pathId} by ${student}`;
}

// ProjectDefined, ProjectApproved, ProjectStarted, ProjectClosed, and the
// project of a TeamSelected: the project and its slots from getProject, and
// from its document.
async function writeProject(db, ev, counts) {
  const projectId = Number(ev.args.projectId);
  const project = await contracts.SkillPath.getProject(projectId);
  const doc = await fetchDocument(project.metadataCID, `project ${projectId}`, counts);
  const status = PROJECT_STATUS[Number(project.status)];
  const { block, time } = await blockOf(ev.log);
  await db.query(
    `INSERT INTO projects (project_id, owner, status, max_teams, selected_count, metadata_cid, name, description,
                           third_party, defined_block, defined_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (project_id) DO UPDATE SET
       owner = EXCLUDED.owner, status = EXCLUDED.status, max_teams = EXCLUDED.max_teams,
       selected_count = EXCLUDED.selected_count, metadata_cid = EXCLUDED.metadata_cid, name = EXCLUDED.name,
       description = EXCLUDED.description, third_party = EXCLUDED.third_party`,
    [projectId, project.owner, status, Number(project.maxTeams), Number(project.selectedCount), project.metadataCID,
     doc?.name ?? null, doc?.description ?? null, doc?.thirdParty ?? null, block, time],
  );
  if (ev.name !== "ProjectDefined")
    await db.query("UPDATE projects SET updated_block = $2, updated_at = $3 WHERE project_id = $1", [projectId, block, time]);
  await db.query("DELETE FROM project_slots WHERE project_id = $1", [projectId]);
  for (const [slot, nodeIds] of project.slots.entries())
    await db.query("INSERT INTO project_slots (project_id, slot, node_ids) VALUES ($1, $2, $3)", [
      projectId,
      slot,
      nodeIds.map(Number),
    ]);
  return `project ${projectId}, ${status}, ${project.selectedCount} of ${project.maxTeams} teams selected`;
}

// TeamStarted, SlotFilled, SlotLeft, TeamFormed, and the team of a
// TeamSelected: the team and its members from getProjectTeam.
async function writeTeam(db, ev) {
  const teamId = Number(ev.args.teamId);
  const team = await contracts.SkillPath.getProjectTeam(teamId);
  const { block, time } = await blockOf(ev.log);
  await db.query(
    `INSERT INTO project_teams (team_id, project_id, formed, selected, started_block, started_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (team_id) DO UPDATE SET
       project_id = EXCLUDED.project_id, formed = EXCLUDED.formed, selected = EXCLUDED.selected`,
    [teamId, Number(team.projectId), team.formed, team.selected, block, time],
  );
  if (ev.name !== "TeamStarted")
    await db.query("UPDATE project_teams SET updated_block = $2, updated_at = $3 WHERE team_id = $1", [teamId, block, time]);
  await db.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);
  const members = [...team.members.entries()].filter(([, wallet]) => wallet !== ethers.ZeroAddress);
  for (const [slot, wallet] of members)
    await db.query("INSERT INTO team_members (team_id, slot, wallet_address) VALUES ($1, $2, $3)", [teamId, slot, wallet]);
  return `team ${teamId}, ${members.length} of ${team.members.length} slots taken${team.formed ? ", formed" : ""}${team.selected ? ", selected" : ""}`;
}

// TeamSelected: the team, and its project, whose selected_count changed.
async function writeSelection(db, ev, counts) {
  return `${await writeTeam(db, ev)}; ${await writeProject(db, ev, counts)}`;
}

const HANDLERS = {
  BadgeDefined: writeBadge,
  BadgeUpdated: writeBadge,
  BadgeMinted: writeMint,
  NodeDefined: writeNode,
  NodeUpdated: writeNode,
  NodeVersionOf: writeNode,
  NodeUnlocked: writeUnlock,
  SeasonFrozen: writeFreeze,
  PathDefined: writePath,
  PathApproved: writePath,
  PathClosed: writePath,
  PathApplied: writeApplication,
  ProjectDefined: writeProject,
  ProjectApproved: writeProject,
  ProjectStarted: writeProject,
  ProjectClosed: writeProject,
  TeamStarted: writeTeam,
  SlotFilled: writeTeam,
  SlotLeft: writeTeam,
  TeamFormed: writeTeam,
  TeamSelected: writeSelection,
};

// One block range: one getLogs over the contracts, in block and log index
// order, and indexer_state, all in one database transaction.
async function handleRange(from, to) {
  const byAddress = new Map(Object.entries(contracts).map(([name, c]) => [c.target.toLowerCase(), name]));
  const logs = await provider.getLogs({ address: [...byAddress.keys()], fromBlock: from, toBlock: to });
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  const counts = { documents: 0, seasons: 0 };
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const log of logs) {
      const contract = byAddress.get(log.address.toLowerCase());
      const parsed = contracts[contract].interface.parseLog(log);
      const handler = parsed && HANDLERS[parsed.name];
      if (!handler) continue; // the ERC-1155 transfer events
      const line = await handler(db, { name: parsed.name, args: parsed.args, log, contract }, counts);
      console.log(`  block ${log.blockNumber} ${contract}.${parsed.name}: ${line}`);
    }
    await db.query(
      `INSERT INTO indexer_state (id, last_block, document_mismatches, season_mismatches) VALUES (TRUE, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET last_block = EXCLUDED.last_block,
         document_mismatches = indexer_state.document_mismatches + EXCLUDED.document_mismatches,
         season_mismatches = indexer_state.season_mismatches + EXCLUDED.season_mismatches`,
      [to, counts.documents, counts.seasons],
    );
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}

async function main() {
  console.log("===========================================");
  console.log("  Skill Credentials: event indexer");
  console.log("===========================================");
  for (const name of ["SkillBadge", "SkillGraph", "SkillPath"]) contracts[name] = loadContract(name);
  // Refuse to start if a contract address has no code, as after a chain
  // restart with stale deployment files (decision 7, 23 Oct).
  for (const [name, c] of Object.entries(contracts)) {
    if ((await provider.getCode(c.target)) === "0x") {
      throw new Error(`${name} at ${c.target} has no code on ${RPC_URL}. Deploy again, or set DEPLOYMENTS_PATH.`);
    }
    console.log(`  ${name}: ${c.target}`);
  }
  const state = await pool.query("SELECT last_block FROM indexer_state");
  let last = state.rows.length ? state.rows[0].last_block : -1;
  console.log(`  RPC: ${RPC_URL}, documents: ${METADATA_API}, database: ${pool.options.database}`);
  console.log(last < 0 ? "  Starting at block 0" : `  Resuming after block ${last}`);

  for (;;) {
    let head = last;
    try {
      head = await provider.getBlockNumber();
      while (last < head) {
        const to = Math.min(head, last + BLOCKS_PER_RANGE);
        await handleRange(last + 1, to);
        last = to;
      }
    } catch (e) {
      console.error(`  Blocks after ${last} not handled, retrying in ${POLL_MS / 1000} s: ${e.message}`);
    }
    if (process.argv.includes("--sync-only") && last >= head) break;
    await sleep(POLL_MS);
  }
  await pool.end();
}

main().catch(async e => {
  console.error("Failed:", e.message);
  await pool.end();
  process.exit(1);
});
