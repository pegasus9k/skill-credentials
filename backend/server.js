require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ethers } = require("ethers");
const { SiweMessage } = require("siwe");

const app = express();
const PORT = process.env.PORT || 3001;
const IPFS_API = process.env.IPFS_API || "http://127.0.0.1:5001";
app.use(cors());
// Keep the exact request bytes next to the parsed body: POST /metadata/pin
// hashes and pins what it received, never a re-serialization. The limit
// lets documents up to one IPFS block reach the route, which enforces it.
app.use(express.json({ limit: "256kb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME || "hei_ecosystem",
  user: process.env.DB_USER || "hei_admin",
  password: process.env.DB_PASSWORD || "hei_local",
});

// ═══════════════════════════════════════════
// Oracle signer: only initialized when chain config is present.
//
// Address resolution mirrors the indexer: prefer the deployment JSON written
// by `yarn deploy` so the backend stays in sync after every redeploy. The
// SKILL_BADGE_ADDRESS env var is still honoured as an override for non-local
// chains where no deployment artifact lives on disk.
// ═══════════════════════════════════════════
const DEPLOYMENTS_PATH =
  process.env.DEPLOYMENTS_PATH || path.resolve(__dirname, "../packages/hardhat/deployments/localhost");

function loadDeploymentAddress(name) {
  // 1. Deployment JSON wins — written fresh by every `yarn deploy`, so a
  //    redeploy auto-propagates without anyone editing .env.
  const p = path.resolve(DEPLOYMENTS_PATH, `${name}.json`);
  if (fs.existsSync(p)) {
    try {
      const addr = JSON.parse(fs.readFileSync(p, "utf8")).address;
      if (addr) return addr;
    } catch {
      /* fall through to env var */
    }
  }
  // 2. Env var fallback for non-local chains (no on-disk deployment artifact).
  if (name === "SkillBadge" && process.env.SKILL_BADGE_ADDRESS) return process.env.SKILL_BADGE_ADDRESS;
  return null;
}

let oracleSigner = null;
let skillBadgeContract = null;

const skillBadgeAddress = loadDeploymentAddress("SkillBadge");

if (process.env.RPC_URL && process.env.ORACLE_PRIVATE_KEY && skillBadgeAddress) {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  // Wrap the wallet in a NonceManager so consecutive txs increment the nonce
  // locally instead of re-querying the node — Hardhat automine confirms faster
  // than `getTransactionCount("pending")` updates, which causes "Nonce too low"
  // races even with `await tx.wait()` between calls.
  const wallet = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, provider);
  oracleSigner = new ethers.NonceManager(wallet);
  const SKILL_BADGE_ABI = [
    "function mintBadge(address student, uint256 tokenId, bytes32 gradeCommitment) external",
    "function balanceOf(address account, uint256 id) external view returns (uint256)",
    "function gradeCommitments(address student, uint256 tokenId) external view returns (bytes32)",
    "event BadgeMinted(address indexed student, uint256 indexed tokenId, bytes32 gradeCommitment)"
  ];
  skillBadgeContract = new ethers.Contract(skillBadgeAddress, SKILL_BADGE_ABI, oracleSigner);
  console.log("  Oracle:    ", wallet.address);
  console.log("  SkillBadge:", skillBadgeAddress);
} else {
  console.log("  Oracle:   NOT CONFIGURED (chain minting disabled)");
  console.log("            Need RPC_URL + ORACLE_PRIVATE_KEY in .env, plus either");
  console.log("            packages/hardhat/deployments/localhost/SkillBadge.json or SKILL_BADGE_ADDRESS");
}

// ═══════════════════════════════════════════
// Registrar signer — anchors students on-chain after FenixEdu OAuth.
// Same pattern as the Oracle signer above.
// ═══════════════════════════════════════════
let registrarSigner = null;
let identityRegistryContract = null;

const identityRegistryAddress = loadDeploymentAddress("IdentityRegistry");

if (process.env.RPC_URL && process.env.REGISTRAR_PRIVATE_KEY && identityRegistryAddress) {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.REGISTRAR_PRIVATE_KEY, provider);
  registrarSigner = new ethers.NonceManager(wallet);
  const IDENTITY_ABI = [
    "function anchorStudent(address studentWallet) external",
    "function hasRole(bytes32 role, address account) external view returns (bool)"
  ];
  identityRegistryContract = new ethers.Contract(identityRegistryAddress, IDENTITY_ABI, registrarSigner);
  console.log("  Registrar:", wallet.address);
  console.log("  IdentityRegistry:", identityRegistryAddress);
} else {
  console.log("  Registrar: NOT CONFIGURED (student anchoring disabled)");
}

// Reconstruct the IPFS URI from a 32-byte digest, mirroring the on-chain
// uri() override (proto-doc §2.4). Format: "ipfs://f01551220<64-hex-chars>".
// f=base16 multibase, 01=CIDv1, 55=raw codec, 12=SHA-256, 20=32-byte length.
// Returns null when the digest is missing or zero-valued.
function cidToUri(cid) {
  if (!cid || cid === "0x" + "0".repeat(64)) return null;
  return "ipfs://f01551220" + cid.replace(/^0x/, "").toLowerCase();
}

// ═══════════════════════════════════════════
// Health
// ═══════════════════════════════════════════
app.get("/health", async (req, res) => {
  try { const r = await pool.query("SELECT NOW()"); res.json({ status: "ok", time: r.rows[0].now }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// Registration, thesis 4.5.2
// ═══════════════════════════════════════════
// Three steps: the identity (FenixEdu for a student, declared by a third
// party), a SIWE signature (EIP-4361) from the wallet, then the anchor.
// Nonces and sessions live in the database. A nonce serves one signed message
// and expires after NONCE_TTL. A session keeps the identity FenixEdu confirmed,
// tied to the browser by the session cookie. docs/REPLAY.md gives the exact
// text of every signed message.
const NONCE_TTL = "10 minutes";
const SESSION_TTL_MS = 10 * 60 * 1000;
const CLIENT_URL = "http://localhost:3000";

// The roles of the identity contract: keccak256 of their names, as it
// declares them, and the zero root role of OpenZeppelin AccessControl.
const STUDENT_ROLE = ethers.id("STUDENT_ROLE");
const THIRD_PARTY_ROLE = ethers.id("THIRD_PARTY_ROLE");
const ROLES = [ethers.ZeroHash, ...["HEI_ADMIN_ROLE", "REGISTRAR_ROLE", "ORACLE_ROLE"].map(r => ethers.id(r)), THIRD_PARTY_ROLE, STUDENT_ROLE];

// The statements of the SIWE messages: each names the identity of step 1.
const studentStatement = username => `Skill Credentials: register this wallet for the FenixEdu username ${username}.`;
const thirdPartyStatement = nif => `Skill Credentials: apply as a third party with the NIF ${nif}.`;

function cookieOf(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Uses up a nonce. False if the backend never issued it, it is used, or it expired.
async function useNonce(nonce) {
  const r = await pool.query(
    `UPDATE auth_nonces SET used_at = NOW()
     WHERE nonce = $1 AND used_at IS NULL AND issued_at > NOW() - INTERVAL '${NONCE_TTL}'`,
    [String(nonce)]
  );
  return r.rowCount === 1;
}

async function holdsAnyRole(wallet) {
  for (const role of ROLES) if (await identityRegistryContract.hasRole(role, wallet)) return true;
  return false;
}

// A SIWE message whose signature recovers its address and whose statement is the expected one, else null.
async function verifiedSiwe(message, signature, statement) {
  try {
    const siwe = new SiweMessage(String(message));
    await siwe.verify({ signature });
    return siwe.statement === statement ? siwe : null;
  } catch {
    return null;
  }
}

app.get("/auth/nonce", async (req, res) => {
  try {
    const nonce = crypto.randomBytes(16).toString("hex");
    await pool.query("INSERT INTO auth_nonces (nonce) VALUES ($1)", [nonce]);
    res.json({ nonce });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Step 1 for a student: FenixEdu login. The state ties the callback to this browser.
app.get("/auth/fenix", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie("fenix_state", state, { httpOnly: true, sameSite: "lax", maxAge: SESSION_TTL_MS });

  const url = `https://fenix.tecnico.ulisboa.pt/oauth/userdialog`
    + `?client_id=${process.env.FENIX_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(process.env.FENIX_REDIRECT_URI)}`
    + `&state=${state}`;

  res.redirect(url);
});

// The identity FenixEdu confirmed goes into a short-lived session, never with a wallet.
app.get("/auth/fenix/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== cookieOf(req, "fenix_state")) {
    return res.status(400).json({ error: "Missing code, or a state from another browser" });
  }

  try {
    const tokenRes = await fetch(
      `https://fenix.tecnico.ulisboa.pt/oauth/access_token`
      + `?client_id=${process.env.FENIX_CLIENT_ID}`
      + `&client_secret=${encodeURIComponent(process.env.FENIX_CLIENT_SECRET)}`//+ `&client_secret=${process.env.FENIX_CLIENT_SECRET}`
      + `&redirect_uri=${encodeURIComponent(process.env.FENIX_REDIRECT_URI)}`
      + `&code=${code}`
      + `&grant_type=authorization_code`,
      { method: "POST" }
    );
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("  FenixEdu token exchange failed:", tokenData);
      return res.status(401).json({ error: "Failed to get access token" });
    }

    const personRes = await fetch(
      `https://fenix.tecnico.ulisboa.pt/api/fenix/v1/person`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const person = await personRes.json();

    const sessionId = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO auth_sessions (session_id, fenix_username, student_name, email, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, person.username, person.name, person.email, new Date(Date.now() + SESSION_TTL_MS)]
    );
    res.clearCookie("fenix_state");
    res.cookie("session", sessionId, { httpOnly: true, sameSite: "lax", maxAge: SESSION_TTL_MS });
    console.log("  FenixEdu: login confirmed, session open for the wallet signature");
    res.redirect(`${CLIENT_URL}/profile?fenix=verified`);

  } catch (e) {
    console.error("  FenixEdu callback error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Steps 2 and 3 for a student: the SIWE signature names the username of the
// session. One wallet per username, and only a wallet with no role. The record
// is committed only if anchorStudent succeeds.
app.post("/auth/wallet", async (req, res) => {
  if (!identityRegistryContract) return res.status(503).json({ error: "Registrar not configured" });
  try {
    const sessionId = cookieOf(req, "session");
    const session = sessionId && (await pool.query(
      "SELECT fenix_username, student_name, email FROM auth_sessions WHERE session_id = $1 AND expires_at > NOW()",
      [sessionId]
    )).rows[0];
    if (!session) return res.status(401).json({ error: "No FenixEdu session: sign in with FenixEdu first" });

    const siwe = await verifiedSiwe(req.body?.message, req.body?.signature, studentStatement(session.fenix_username));
    if (!siwe) return res.status(401).json({ error: "The SIWE message is not signed by its wallet, or does not name this FenixEdu username" });
    if (!(await useNonce(siwe.nonce))) return res.status(401).json({ error: "The nonce is unknown, used or expired" });
    const wallet = siwe.address;

    if ((await pool.query("SELECT 1 FROM student_ids WHERE fenix_id = $1", [session.fenix_username])).rowCount > 0) {
      return res.status(409).json({ error: "This FenixEdu username already has a wallet" });
    }
    // Read the roles before anchoring.
    if (await identityRegistryContract.hasRole(STUDENT_ROLE, wallet)) {
      return res.status(409).json({ error: "This wallet is already registered as a student" });
    }
    if (await holdsAnyRole(wallet)) return res.status(409).json({ error: "This wallet already holds a role" });

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        `INSERT INTO student_ids (wallet_address, fenix_id, student_name, email, master_salt)
         VALUES ($1, $2, $3, $4, $5)`,
        [wallet, session.fenix_username, session.student_name, session.email, crypto.randomBytes(32).toString("hex")]
      );
      const receipt = await (await identityRegistryContract.anchorStudent(wallet)).wait();
      await db.query("UPDATE student_ids SET on_chain_tx_hash = $2 WHERE wallet_address = $1", [wallet, receipt.hash]);
      await db.query("COMMIT");
      console.log(`  Registered student wallet ${wallet} (tx: ${receipt.hash})`);
      res.json({ wallet, status: "registered", tx_hash: receipt.hash });
    } catch (e) {
      await db.query("ROLLBACK");
      try { registrarSigner.reset(); } catch {}
      if (e.code === "23505") return res.status(409).json({ error: "This FenixEdu username or wallet is already registered" });
      console.error(`  Registration of ${wallet} failed: ${e.reason || e.message}`);
      res.status(500).json({ error: `Registration failed, no record kept: ${e.reason || e.message}` });
    } finally {
      db.release();
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Steps 1 to 3 for a third party: its declared name and NIF, and the SIWE
// signature naming the NIF. One wallet per NIF, and only a wallet with no role.
// Nothing is anchored: the application is pending while its wallet has no role
// on the ledger, until the administrator calls anchorThirdParty.
app.post("/third-party/apply", async (req, res) => {
  if (!identityRegistryContract) return res.status(503).json({ error: "Registrar not configured" });
  try {
    const { name, nif, message, signature } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || name.length > 200) return res.status(400).json({ error: "Give the name of the organization" });
    if (!/^\d{9}$/.test(String(nif))) return res.status(400).json({ error: "The NIF has nine digits" });

    const siwe = await verifiedSiwe(message, signature, thirdPartyStatement(nif));
    if (!siwe) return res.status(401).json({ error: "The SIWE message is not signed by its wallet, or does not name this NIF" });
    if (!(await useNonce(siwe.nonce))) return res.status(401).json({ error: "The nonce is unknown, used or expired" });
    const wallet = siwe.address;

    if ((await pool.query("SELECT 1 FROM third_party_ids WHERE nif = $1", [nif])).rowCount > 0) {
      return res.status(409).json({ error: "This NIF already has a wallet" });
    }
    if (await holdsAnyRole(wallet)) return res.status(409).json({ error: "This wallet already holds a role" });
    try {
      await pool.query("INSERT INTO third_party_ids (wallet_address, nif, name) VALUES ($1, $2, $3)", [wallet, nif, name.trim()]);
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ error: "This wallet or NIF has already applied" });
      throw e;
    }
    console.log(`  Third party application from ${wallet}, pending`);
    res.json({ wallet, status: "pending" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// Disclosure and erasure, thesis 4.4.2 and 4.6
// ═══════════════════════════════════════════
// The messages a student or a third party signs with EIP-191, one field per
// line after the action. docs/REPLAY.md gives their exact text.
const SIGNED = {
  "disclose grade": ["Wallet", "Token ID", "Nonce"],
  "disclose identity": ["Student", "Third party", "Nonce"],
  "erase grades": ["Wallet", "Nonce"],
};

// The fields of a signed message, or null if it is not exactly the text of the action.
function signedFields(message, action) {
  const lines = typeof message === "string" ? message.split("\n") : [];
  const names = SIGNED[action];
  if (lines.length !== names.length + 1 || lines[0] !== `Skill Credentials: ${action}`) return null;
  const fields = {};
  for (const [i, name] of names.entries()) {
    if (!lines[i + 1].startsWith(`${name}: `)) return null;
    fields[name] = lines[i + 1].slice(name.length + 2);
  }
  return fields;
}

// The checksummed address, or null.
function addressOf(text) {
  try { return ethers.getAddress(text); } catch { return null; }
}

// The wallet that signed the message, or null.
function signerOf(message, signature) {
  try { return ethers.verifyMessage(message, signature); } catch { return null; }
}

// A student's own grade and badge salt, to a request the student signs. The
// student hands them to a third party, which recomputes the commitment.
app.post("/disclose/grade", async (req, res) => {
  try {
    const { message, signature } = req.body ?? {};
    const fields = signedFields(message, "disclose grade");
    const wallet = fields && addressOf(fields.Wallet);
    if (!wallet || !/^\d+$/.test(fields["Token ID"])) return res.status(400).json({ error: "Not a grade disclosure message" });
    if (signerOf(message, signature) !== wallet) return res.status(401).json({ error: "The message is not signed by the wallet it names" });
    if (!(await useNonce(fields.Nonce))) return res.status(401).json({ error: "The nonce is unknown, used or expired" });

    const tokenId = Number(fields["Token ID"]);
    const r = await pool.query("SELECT raw_grade, badge_salt FROM grade_records WHERE wallet_address = $1 AND token_id = $2", [wallet, tokenId]);
    if (r.rows.length === 0) return res.status(404).json({ error: "No grade record for this wallet and badge" });
    res.json({ wallet, token_id: tokenId, grade: r.rows[0].raw_grade, badge_salt: r.rows[0].badge_salt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// A student's identity, as FenixEdu confirmed it, to the third party the
// student names in a signed consent, on a request that third party signs.
app.post("/disclose/identity", async (req, res) => {
  if (!identityRegistryContract) return res.status(503).json({ error: "Registrar not configured" });
  try {
    const { message, studentSignature, thirdPartySignature } = req.body ?? {};
    const fields = signedFields(message, "disclose identity");
    const student = fields && addressOf(fields.Student);
    const thirdParty = fields && addressOf(fields["Third party"]);
    if (!student || !thirdParty) return res.status(400).json({ error: "Not an identity consent" });
    if (signerOf(message, studentSignature) !== student) return res.status(401).json({ error: "The consent is not signed by the student it names" });
    if (signerOf(message, thirdPartySignature) !== thirdParty) {
      return res.status(401).json({ error: "The request is not signed by the third party the consent names" });
    }
    if (!(await identityRegistryContract.hasRole(THIRD_PARTY_ROLE, thirdParty))) {
      return res.status(403).json({ error: "The consent names a wallet without the third party role" });
    }
    if (!(await useNonce(fields.Nonce))) return res.status(401).json({ error: "The nonce is unknown, used or expired" });

    const r = await pool.query("SELECT student_name, email FROM student_ids WHERE wallet_address = $1", [student]);
    if (r.rows.length === 0) return res.status(404).json({ error: "No identity for this wallet" });
    res.json({ student, name: r.rows[0].student_name, email: r.rows[0].email });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Erasure, to a request the student signs: the grade records go and the master
// salt becomes NULL. The commitments stay on the ledger, matched to no grade.
app.post("/student/erase", async (req, res) => {
  try {
    const { message, signature } = req.body ?? {};
    const fields = signedFields(message, "erase grades");
    const wallet = fields && addressOf(fields.Wallet);
    if (!wallet) return res.status(400).json({ error: "Not an erasure message" });
    if (signerOf(message, signature) !== wallet) return res.status(401).json({ error: "The message is not signed by the wallet it names" });
    if (!(await useNonce(fields.Nonce))) return res.status(401).json({ error: "The nonce is unknown, used or expired" });

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const deleted = await db.query("DELETE FROM grade_records WHERE wallet_address = $1", [wallet]);
      const updated = await db.query("UPDATE student_ids SET master_salt = NULL WHERE wallet_address = $1", [wallet]);
      if (updated.rowCount === 0) {
        await db.query("ROLLBACK");
        return res.status(404).json({ error: "No student record for this wallet" });
      }
      await db.query("COMMIT");
      console.log(`  Erased the grade records of ${wallet}`);
      res.json({ wallet, grade_records_deleted: deleted.rowCount });
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    } finally {
      db.release();
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// Skill reference list: skill_types, written by setup.js from skillTypes.json
// ═══════════════════════════════════════════
app.get("/skills", async (req, res) => {
  try {
    const r = await pool.query("SELECT skill_id, code, label, learning_outcomes FROM skill_types ORDER BY code");
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// Badges
// ═══════════════════════════════════════════
app.get("/badges", async (req, res) => {
  try {
    const badges = await pool.query("SELECT token_id, season_id, course_id, badge_code, metadata_cid, spec_id, badge_name, description, course_code, course_name, assessment, defined_block, updated_block FROM badges ORDER BY token_id");
    const skills = await pool.query("SELECT bs.token_id, bs.skill_id, st.code AS skill_label, bs.points FROM badge_skills bs LEFT JOIN skill_types st ON bs.skill_id = st.skill_id ORDER BY bs.token_id, st.code");
    const byBadge = {};
    for (const r of skills.rows) { if (!byBadge[r.token_id]) byBadge[r.token_id] = []; byBadge[r.token_id].push({ skill_label: r.skill_label || "UNKNOWN", points: r.points }); }
    res.json(badges.rows.map(b => ({
      ...b,
      metadata_uri: cidToUri(b.metadata_cid),
      skills: byBadge[b.token_id] || [],
      total_points: (byBadge[b.token_id] || []).reduce((s, x) => s + x.points, 0),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// Competency Nodes (DAG)
// ═══════════════════════════════════════════
app.get("/nodes", async (req, res) => {
  try {
    const nodes = await pool.query("SELECT node_id, season_id, node_code, metadata_cid, version_of, node_name, tier, description, defined_block, updated_block FROM nodes ORDER BY node_id");
    const thresh = await pool.query("SELECT nt.node_id, nt.skill_id, st.code AS skill_label, nt.min_points FROM node_thresholds nt LEFT JOIN skill_types st ON nt.skill_id = st.skill_id ORDER BY nt.node_id");
    const prereqs = await pool.query("SELECT node_id, group_index, prerequisite_node_id FROM node_prerequisites ORDER BY node_id, group_index, prerequisite_node_id");
    const thByNode = {}, prByNode = {};
    for (const r of thresh.rows) { if (!thByNode[r.node_id]) thByNode[r.node_id] = []; thByNode[r.node_id].push({ skill_id: r.skill_id, skill_label: r.skill_label || null, min_points: r.min_points }); }
    // Prerequisite groups as a list of lists: any one group, every node in it.
    for (const r of prereqs.rows) { const groups = (prByNode[r.node_id] ??= []); (groups[r.group_index] ??= []).push(r.prerequisite_node_id); }
    res.json(nodes.rows.map(n => ({
      ...n,
      metadata_uri: cidToUri(n.metadata_cid),
      thresholds: thByNode[n.node_id] || [],
      prerequisite_groups: prByNode[n.node_id] || [],
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// Student Profile & Portfolio
// ═══════════════════════════════════════════
app.get("/student/:wallet", async (req, res) => {
  const { wallet } = req.params;
  try {
    // No name and no email. What the ledger shows of a wallet stays public.
    const sr = await pool.query("SELECT wallet_address, degree, status FROM student_ids WHERE wallet_address = $1", [wallet]);
    if (sr.rows.length === 0) return res.status(404).json({ error: "Student not found" });
    const br = await pool.query("SELECT sb.token_id, b.badge_name, b.course_name, b.assessment, sb.grade_commitment, sb.committed_to_node, CASE WHEN sb.committed_to_node=0 THEN 'free' ELSE 'committed' END AS allocation_status, sb.minted_at FROM student_badges sb JOIN badges b ON sb.token_id=b.token_id WHERE sb.wallet_address=$1 ORDER BY sb.token_id", [wallet]);
    const tids = br.rows.map(b => b.token_id);
    let bSkills = {};
    if (tids.length > 0) {
      const sk = await pool.query("SELECT bs.token_id, st.code AS skill_label, bs.points FROM badge_skills bs LEFT JOIN skill_types st ON bs.skill_id=st.skill_id WHERE bs.token_id=ANY($1) ORDER BY bs.token_id", [tids]);
      for (const r of sk.rows) { if (!bSkills[r.token_id]) bSkills[r.token_id] = []; bSkills[r.token_id].push({ skill_label: r.skill_label || "UNKNOWN", points: r.points }); }
    }
    const cr = await pool.query("SELECT sc.node_id, n.node_name, sc.badge_ids, sc.unlocked_at FROM student_competencies sc JOIN nodes n ON sc.node_id=n.node_id WHERE sc.wallet_address=$1 ORDER BY sc.node_id", [wallet]);
    res.json({ student: sr.rows[0], badges: br.rows.map(b => ({ ...b, skills: bSkills[b.token_id] || [] })), competencies: cr.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/student/:wallet/available", async (req, res) => {
  const { wallet } = req.params;
  try {
    const br = await pool.query("SELECT sb.token_id, b.badge_name, b.course_name, b.assessment FROM student_badges sb JOIN badges b ON sb.token_id=b.token_id WHERE sb.wallet_address=$1 AND sb.committed_to_node=0 ORDER BY sb.token_id", [wallet]);
    const tids = br.rows.map(b => b.token_id);
    let bSkills = {};
    if (tids.length > 0) {
      const sk = await pool.query("SELECT bs.token_id, st.code AS skill_label, bs.points FROM badge_skills bs LEFT JOIN skill_types st ON bs.skill_id=st.skill_id WHERE bs.token_id=ANY($1) ORDER BY bs.token_id", [tids]);
      for (const r of sk.rows) { if (!bSkills[r.token_id]) bSkills[r.token_id] = []; bSkills[r.token_id].push({ skill_label: r.skill_label || "UNKNOWN", points: r.points }); }
    }
    res.json(br.rows.map(b => ({ ...b, skills: bSkills[b.token_id] || [] })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/student/:wallet/skills", async (req, res) => {
  const { wallet } = req.params;
  try {
    // Confirm student exists; without this, "no badges" and "unknown wallet"
    // would return the same 404 — useful distinction for clients.
    const exists = await pool.query("SELECT 1 FROM student_ids WHERE wallet_address=$1", [wallet]);
    if (exists.rows.length === 0) return res.status(404).json({ error: "Student not found" });

    const r = await pool.query("SELECT code, total_points, badge_count FROM student_skill_totals WHERE wallet_address=$1 ORDER BY total_points DESC", [wallet]);
    const skills = {}; let tp = 0;
    for (const row of r.rows) { skills[row.code] = parseInt(row.total_points); tp += parseInt(row.total_points); }
    const cnt = await pool.query("SELECT COUNT(*) as c FROM student_badges WHERE wallet_address=$1", [wallet]);
    res.json({ wallet_address: wallet, total_badges: parseInt(cnt.rows[0].c), total_points: tp, skills });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════
// Metadata documents on IPFS
// ═══════════════════════════════════════════
// The documents live only on the local IPFS node (Kubo RPC API at IPFS_API).
// POST /metadata/pin takes the request's exact bytes, never re-serializes
// them, hashes them with SHA-256, pins the same bytes as one raw block and
// checks that the returned CID (CIDv1, raw codec, sha2-256) holds that hash.
// The ledger stores the hash as metadataCID. GET /metadata/:id takes that
// hash, or the CID, reads the bytes back from IPFS, checks them against the
// hash and returns them unchanged.
const MAX_DOCUMENT_BYTES = 256 * 1024; // one IPFS block; a larger file would be chunked into another CID
const IPFS_TIMEOUT_MS = 10_000;
const CID_PREFIX = Buffer.from([0x01, 0x55, 0x12, 0x20]); // CIDv1, raw codec, sha2-256, 32-byte digest
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567"; // RFC 4648, lowercase, no padding: multibase "b"

function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of text) {
    const i = BASE32.indexOf(ch);
    if (i < 0) return null;
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// The CID IPFS gives one raw block, as build_metadata.py computes it.
function cidOf(digest) {
  return "b" + base32Encode(Buffer.concat([CID_PREFIX, digest]));
}

// The ledger's 0x hash, or a CIDv1 raw sha2-256 ("bafkrei..."): the 32-byte digest, else null.
function digestOf(id) {
  if (/^0x[0-9a-fA-F]{64}$/.test(id)) return Buffer.from(id.slice(2), "hex");
  if (/^b[a-z2-7]{58}$/.test(id)) {
    const bytes = base32Decode(id.slice(1));
    if (bytes && bytes.length === 36 && bytes.subarray(0, 4).equals(CID_PREFIX)) return bytes.subarray(4);
  }
  return null;
}

function kubo(command, init = {}) {
  return fetch(`${IPFS_API}/api/v0/${command}`, { method: "POST", ...init, signal: AbortSignal.timeout(IPFS_TIMEOUT_MS) });
}

app.post("/metadata/pin", async (req, res) => {
  const bytes = req.rawBody;
  if (!bytes) return res.status(400).json({ error: "Send the document as a JSON body (Content-Type: application/json)" });
  if (bytes.length >= MAX_DOCUMENT_BYTES) return res.status(413).json({ error: "Document is 256 KiB or more" });
  const digest = crypto.createHash("sha256").update(bytes).digest();
  try {
    const form = new FormData();
    form.append("file", new Blob([bytes]), "document.json");
    const r = await kubo("add?cid-version=1&raw-leaves=true&pin=true", { body: form });
    if (!r.ok) return res.status(502).json({ error: `IPFS add failed: ${await r.text()}` });
    const added = JSON.parse((await r.text()).trim().split("\n").pop());
    if (added.Hash !== cidOf(digest)) {
      return res.status(502).json({ error: `IPFS returned ${added.Hash}, not the CID of the SHA-256 ${cidOf(digest)}` });
    }
    res.json({ metadataCID: "0x" + digest.toString("hex"), cid: added.Hash });
  } catch (e) { res.status(502).json({ error: `IPFS add failed: ${e.message}` }); }
});

app.get("/metadata/:id", async (req, res) => {
  const digest = digestOf(req.params.id);
  if (!digest) return res.status(400).json({ error: "Expected a 0x SHA-256 hash or a CIDv1 raw sha2-256 (bafkrei...)" });
  let bytes;
  try {
    const r = await kubo(`cat?arg=${cidOf(digest)}`);
    if (!r.ok) return res.status(404).json({ error: "Document not on IPFS" });
    bytes = Buffer.from(await r.arrayBuffer());
  } catch (e) {
    if (e.name === "TimeoutError") return res.status(404).json({ error: "Document not on IPFS (read timed out)" });
    return res.status(502).json({ error: `IPFS unreachable: ${e.message}` });
  }
  if (!crypto.createHash("sha256").update(bytes).digest().equals(digest)) {
    return res.status(502).json({ error: "IPFS returned bytes that do not match the hash" });
  }
  res.type("application/json").send(bytes);
});

// ═══════════════════════════════════════════
// Oracle: Process Mock Academic Records
// ═══════════════════════════════════════════
// Reads unprocessed passing grades from mock_academic_records, computes
// grade commitments per proto-doc §5.2, and mints badges on-chain.
//
// Flow: mock_academic_records → join student_ids (fenix_id → wallet + salt)
//       → derive BadgeSalt = SHA-256(MasterSalt || TokenID)
//       → derive gradeCommitment = SHA-256(Grade || BadgeSalt)
//       → call SkillBadge.mintBadge(student, tokenId, gradeCommitment)
//       → write grade_records (private vault) → mark processed
//
// After a network error, a mint may or may not be on the ledger. The
// oracle reads gradeCommitments there: if the commitment is on the ledger, the
// mint went through, and only the grade record is written. If not, it retries
// the mint once. The contract refuses a second copy of a badge ("Already
// minted"), and a normal mint reads nothing extra.
const NETWORK_ERRORS = new Set([
  "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "EPIPE", "EHOSTUNREACH", "ENETUNREACH", "EAI_AGAIN",
  "NETWORK_ERROR", "TIMEOUT", "SERVER_ERROR", // ethers
]);
const isNetworkError = e => NETWORK_ERRORS.has(e?.code) || NETWORK_ERRORS.has(e?.error?.code);

async function mintOnce(row, gradeCommitment) {
  const tx = await skillBadgeContract.mintBadge(row.wallet_address, row.token_id, gradeCommitment);
  return (await tx.wait()).hash;
}

// The hash of the transaction that minted the badge, from its BadgeMinted event, or null.
async function mintHashOf(row) {
  try {
    const [event] = await skillBadgeContract.queryFilter(skillBadgeContract.filters.BadgeMinted(row.wallet_address, row.token_id));
    return event ? event.transactionHash : null;
  } catch {
    return null;
  }
}

app.post("/oracle/process-grades", async (req, res) => {
  if (!skillBadgeContract) {
    return res.status(503).json({
      error: "Oracle not configured — set RPC_URL, ORACLE_PRIVATE_KEY, SKILL_BADGE_ADDRESS in .env"
    });
  }

  try {
    // 1. Fetch unprocessed passing grades, joined with student wallet + salt
    const pending = await pool.query(`
      SELECT mar.fenix_id, mar.token_id, mar.raw_grade,
             s.wallet_address, s.master_salt
      FROM mock_academic_records mar
      JOIN student_ids s ON mar.fenix_id = s.fenix_id
      WHERE mar.processed = FALSE AND mar.raw_grade >= 10
        AND s.master_salt IS NOT NULL -- erased: no salt to commit a grade with
      ORDER BY mar.token_id, mar.fenix_id
    `);

    if (pending.rows.length === 0) {
      return res.json({ message: "No unprocessed grades", minted: 0, failed: 0, results: [] });
    }

    console.log(`\n  Oracle: Processing ${pending.rows.length} pending grade(s)...`);
    const results = [];

    for (const row of pending.rows) {
      // 2. Derive BadgeSalt = SHA-256(MasterSalt || TokenID)
      const badgeSalt = crypto
        .createHash("sha256")
        .update(row.master_salt + row.token_id.toString())
        .digest("hex");

      // 3. Derive gradeCommitment = SHA-256(Grade || BadgeSalt)
      const gradeCommitment = "0x" + crypto
        .createHash("sha256")
        .update(row.raw_grade.toString() + badgeSalt)
        .digest("hex");

      // 4. Mint on-chain
      // Let ethers manage nonces automatically — await tx.wait() below
      // serializes confirmations, so manual getNonce() races automining.
      try {
        let txHash;
        let onLedger = false; // minted, but the response was lost
        try {
          txHash = await mintOnce(row, gradeCommitment);
        } catch (e) {
          if (!isNetworkError(e)) throw e;
          // The nonce manager may count a transaction that was never sent.
          try { oracleSigner.reset(); } catch {}
          const committed = await skillBadgeContract.gradeCommitments(row.wallet_address, row.token_id);
          if (committed === gradeCommitment) {
            onLedger = true;
            console.log(`    ! Badge ${row.token_id} → ${row.wallet_address}: network error (${e.message}), the mint is on the ledger`);
          } else if (committed !== ethers.ZeroHash) {
            throw new Error("A different grade commitment is on the ledger");
          } else {
            console.log(`    ! Badge ${row.token_id} → ${row.wallet_address}: network error (${e.message}), not on the ledger, minting again`);
            txHash = await mintOnce(row, gradeCommitment);
          }
        }

        // 5. Write to grade_records (private vault)
        await pool.query(
          `INSERT INTO grade_records (wallet_address, token_id, raw_grade, badge_salt)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (wallet_address, token_id) DO NOTHING`,
          [row.wallet_address, row.token_id, row.raw_grade, badgeSalt]
        );

        // 6. Mark as processed
        await pool.query(
          `UPDATE mock_academic_records SET processed = TRUE, processed_at = NOW()
           WHERE fenix_id = $1 AND token_id = $2`,
          [row.fenix_id, row.token_id]
        );

        if (onLedger) txHash = await mintHashOf(row);
        results.push({
          fenix_id: row.fenix_id,
          token_id: row.token_id,
          tx_hash: txHash,
          status: "minted"
        });

        // No grade in the log: the token, the wallet and the transaction are on the ledger anyway.
        console.log(`    ✓ Badge ${row.token_id} → ${row.wallet_address} (tx: ${txHash})`);
      } catch (mintErr) {
        // Badge already minted (duplicate) or other chain error — log and skip
        // Reset NonceManager so any nonce poisoning doesn't leak into the next iteration.
        try { oracleSigner.reset(); } catch {}
        results.push({
          fenix_id: row.fenix_id,
          token_id: row.token_id,
          status: "failed",
          error: mintErr.reason || mintErr.message
        });
        console.error(`    ✗ Badge ${row.token_id} → ${row.wallet_address}: ${mintErr.reason || mintErr.message}`);
      }
    }

    console.log(`  Oracle: Done — ${results.filter(r => r.status === "minted").length} minted, ${results.filter(r => r.status === "failed").length} failed\n`);

    res.json({
      message: `Processed ${results.length} grades`,
      minted: results.filter(r => r.status === "minted").length,
      failed: results.filter(r => r.status === "failed").length,
      results
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════
// Oracle: Pending grades count (for dashboard)
// ═══════════════════════════════════════════
app.get("/oracle/pending", async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE raw_grade >= 10) as passing
      FROM mock_academic_records
      WHERE processed = FALSE
    `);
    res.json({ pending_total: parseInt(r.rows[0].total), pending_passing: parseInt(r.rows[0].passing) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Body parser errors as JSON instead of Express's HTML page.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Body is not valid JSON" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Body is 256 KiB or more" });
  next(err);
});

// ═══════════════════════════════════════════
// Start
// ═══════════════════════════════════════════
// Refuse to start if a loaded contract address has no code, as after a chain
// restart with stale deployment files: a call to an empty address succeeds and
// does nothing (decision 7, 23 Oct).
async function checkContractCode() {
  if (!process.env.RPC_URL) return;
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer from ${process.env.RPC_URL}`)), 10_000);
  });
  try {
    for (const [name, address] of [["SkillBadge", skillBadgeAddress], ["IdentityRegistry", identityRegistryAddress]]) {
      if (address && (await Promise.race([provider.getCode(address), timeout])) === "0x") {
        throw new Error(`${name} at ${address} has no code on ${process.env.RPC_URL}. Deploy again, or set DEPLOYMENTS_PATH.`);
      }
    }
  } finally {
    clearTimeout(timer);
    provider.destroy();
  }
}

checkContractCode().then(() => app.listen(PORT, () => {
  console.log("===========================================");
  console.log("  Skill Credentials: backend API");
  console.log("===========================================");
  console.log(`  Server:  http://localhost:${PORT}`);
  console.log(`  IPFS:    ${IPFS_API}`);
  console.log("  Endpoints:");
  console.log("    GET  /health");
  console.log("    GET  /skills");
  console.log("    GET  /badges");
  console.log("    GET  /nodes");
  console.log("    GET  /student/:wallet");
  console.log("    GET  /student/:wallet/available");
  console.log("    GET  /student/:wallet/skills");
  console.log("    POST /oracle/process-grades");
  console.log("    GET  /oracle/pending");
  console.log("    POST /metadata/pin");
  console.log("    GET  /metadata/:id");
  console.log("    GET  /auth/nonce");
  console.log("    GET  /auth/fenix");
  console.log("    GET  /auth/fenix/callback");
  console.log("    POST /auth/wallet");
  console.log("    POST /third-party/apply");
  console.log("    POST /disclose/grade");
  console.log("    POST /disclose/identity");
  console.log("    POST /student/erase");
  console.log("===========================================");
})).catch(e => {
  console.error(`  Backend not started: ${e.message}`);
  process.exit(1);
});