// FenixEdu login by hand (docs/FENIX_LOGIN.md).
//
//   yarn fenix:login [--account N]
//
// Plays the client app for one real registration of thesis 4.5.2, outside the
// replay. The browser logs in at FenixEdu through the dev backend (port 3001),
// which sends it back to the client's /profile page, served here on port 3000.
// The tool takes the session the callback opens in auth_sessions, in place of
// the browser's cookie, and registers Hardhat account N as the client would:
// a nonce, a SIWE message naming the session's username, the signature of
// account N, then POST /auth/wallet. It prints the backend's answer, the role
// on the ledger and the student_ids row, on the terminal only. It never prints
// the master salt, and writes no file.
//
// Account #119 by default: it holds no role on a fresh chain, and neither
// replay uses it. Settings come from backend/.env, as for the backend.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const { ethers } = require("ethers");
const { SiweMessage } = require("siwe");

const BACKEND = "http://localhost:3001"; // the backend of FENIX_REDIRECT_URI
const CLIENT_PORT = 3000; // where the FenixEdu callback sends the browser
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const DEPLOYMENTS_PATH =
  process.env.DEPLOYMENTS_PATH || path.resolve(__dirname, "../../packages/hardhat/deployments/localhost");
const MNEMONIC = "test test test test test test test test test test test junk"; // Hardhat's default accounts
const WAIT_MS = 10 * 60 * 1000;
const STUDENT_ROLE = ethers.id("STUDENT_ROLE");

// As server.js expects it (docs/REPLAY.md, signed messages).
const studentStatement = username => `Skill Credentials: register this wallet for the FenixEdu username ${username}.`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Stop extends Error {}
const stop = message => {
  throw new Stop(message);
};

function accountNumber() {
  const i = process.argv.indexOf("--account");
  if (i < 0) return 119;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n < 0 || n > 119) stop("--account takes an account of the chain, 0 to 119");
  return n;
}

// The client's /profile page, where the FenixEdu callback sends the browser.
function serveProfile() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const found = req.url.startsWith("/profile");
      res.writeHead(found ? 200 : 404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(found ? "FenixEdu login done. Back to the terminal.\n" : "Not found\n");
    });
    server.once("error", e =>
      reject(e.code === "EADDRINUSE" ? new Stop(`port ${CLIENT_PORT} is in use: stop the client (yarn start) first`) : e),
    );
    server.listen(CLIENT_PORT, () => resolve(server));
  });
}

async function main() {
  let server, pool, provider;
  try {
    const n = accountNumber();
    const account = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, `m/44'/60'/0'/0/${n}`);

    // 1. Checks, before anything is sent.
    for (const key of ["FENIX_CLIENT_ID", "FENIX_CLIENT_SECRET", "FENIX_REDIRECT_URI"])
      if (!process.env[key]) stop(`${key} is not set in backend/.env (docs/FENIX_LOGIN.md)`);
    if (!(await fetch(`${BACKEND}/health`).then(r => r.ok, () => false)))
      stop(`the backend does not answer at ${BACKEND}: start it with npm start in backend/`);
    const deployment = path.join(DEPLOYMENTS_PATH, "IdentityRegistry.json");
    if (!fs.existsSync(deployment)) stop(`${deployment} is missing: run yarn deploy on a freshly started yarn chain`);
    const registryAddress = JSON.parse(fs.readFileSync(deployment, "utf8")).address;
    provider = new ethers.JsonRpcProvider(RPC_URL);
    const code = await provider
      .getCode(registryAddress)
      .catch(e => stop(`no chain answers at ${RPC_URL}: start yarn chain (${e.message})`));
    if (code === "0x") stop(`IdentityRegistry at ${registryAddress} has no code: run yarn deploy on this chain`);
    const chainId = Number(await provider.send("eth_chainId", []));
    server = await serveProfile();

    const database = process.env.DB_NAME || "hei_ecosystem";
    if (database === "hei_replay") stop("the tool works on the dev database, hei_ecosystem, never on hei_replay");
    pool = new Pool({
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432"),
      database,
      user: process.env.DB_USER || "hei_admin",
      password: process.env.DB_PASSWORD || "hei_local",
    });
    const before = await pool.query("SELECT session_id FROM auth_sessions").catch(e =>
      stop(`${database} has no auth_sessions table: load DB/schema.sql into it (${e.message})`),
    );
    const known = new Set(before.rows.map(r => r.session_id));

    console.log("FenixEdu login by hand (docs/FENIX_LOGIN.md)");
    console.log(`  backend    ${BACKEND}, database ${database}`);
    console.log(`  chain      ${RPC_URL}, IdentityRegistry ${registryAddress}`);
    console.log(`  client     http://localhost:${CLIENT_PORT}/profile, served by this tool`);
    console.log(`  account    #${n}, ${account.address}`);

    // 2 and 3. The URL that starts the login in server.js.
    const url = `${BACKEND}/auth/fenix`;
    console.log(`\nOpen this URL in the browser and log in with your IST account:\n  ${url}`);
    const opener = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    opener.on("error", () => console.log("  (xdg-open is not available: open it by hand)"));
    opener.unref();

    // 4. The session the callback opens after this start, read from the database in place of the cookie.
    console.log(`\nWaiting for the FenixEdu session, ${WAIT_MS / 60000} minutes at most...`);
    const deadline = Date.now() + WAIT_MS;
    let session;
    while (!session) {
      if (Date.now() > deadline) stop(`no FenixEdu session in ${WAIT_MS / 60000} minutes: run the tool again`);
      const r = await pool.query(
        "SELECT session_id, fenix_username FROM auth_sessions WHERE expires_at > NOW() ORDER BY expires_at DESC",
      );
      session = r.rows.find(s => !known.has(s.session_id));
      if (!session) await sleep(1000);
    }
    console.log("FenixEdu session found.");

    // 5. Register as the client would: nonce, SIWE message, signature, POST /auth/wallet with the session cookie.
    const { nonce } = await (await fetch(`${BACKEND}/auth/nonce`)).json();
    const message = new SiweMessage({
      domain: `localhost:${CLIENT_PORT}`,
      address: account.address,
      statement: studentStatement(session.fenix_username),
      uri: `http://localhost:${CLIENT_PORT}`,
      version: "1",
      chainId,
      nonce,
      issuedAt: new Date().toISOString(),
    }).prepareMessage();
    const signature = await account.signMessage(message);
    const r = await fetch(`${BACKEND}/auth/wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `session=${session.session_id}` },
      body: JSON.stringify({ message, signature }),
    });
    const answer = await r.json();

    // 6. What the backend and the ledger hold now. Never the master salt.
    const registry = new ethers.Contract(
      registryAddress,
      ["function hasRole(bytes32 role, address account) view returns (bool)"],
      provider,
    );
    const student = await registry.hasRole(STUDENT_ROLE, account.address);
    const row = (
      await pool.query(
        "SELECT fenix_id, student_name, email, master_salt IS NOT NULL AS salted FROM student_ids WHERE wallet_address = $1",
        [account.address],
      )
    ).rows[0];
    console.log(`\nBackend answer: ${r.status} ${JSON.stringify(answer)}`);
    console.log(`Wallet: ${account.address}`);
    console.log(`Student role on the ledger (hasRole): ${student}`);
    if (!row) console.log("student_ids: no row for this wallet");
    else {
      console.log("student_ids row:");
      console.log(`  FenixEdu username  ${row.fenix_id}`);
      console.log(`  name               ${row.student_name}`);
      console.log(`  email              ${row.email}`);
      console.log(`  master salt set    ${row.salted ? "yes" : "no"}`);
    }
    if (!r.ok) process.exitCode = 1;
  } catch (e) {
    console.error(`fenix:login: ${e instanceof Stop ? e.message : e.stack}`);
    process.exitCode = 1;
  } finally {
    server?.close();
    await pool?.end().catch(() => undefined);
    provider?.destroy();
  }
}

main();
