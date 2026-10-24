/*
 * Full mode of the replay. See docs/REPLAY.md.
 *
 *   yarn replay:full   ->   hardhat run scripts/replay.ts --network localhost
 *
 * scripts/replay.ts loads this module in the full mode only, so `yarn replay`
 * imports no database client and reaches no database, IPFS node or backend.
 *
 * The full mode runs the walk of replay.ts on a freshly started `yarn chain`,
 * with the whole stack. It recreates the database hei_replay from
 * DB/schema.sql, starts the backend on it (port 3101) and the event indexer,
 * pins each document through the backend before its define call, and lets the
 * backend's oracle pipeline mint the grades of each week. After the walk it
 * reads every document back, waits for the indexer to reach the last block,
 * checks the ledger view and the private tables against the ledger, and checks
 * that the routes disclose no name, email, grade or salt. Last, it exercises
 * registration and disclosure as a client would: signed requests, nonces and
 * the refusals of the routes.
 *
 * Settings come from backend/.env, the environment winning, as dotenv gives
 * them to the backend itself. pg and dotenv are the backend's own packages.
 */
import { ChildProcess, execFileSync, spawn } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import { createRequire } from "module";
import * as path from "path";
import { getAddress, Wallet } from "ethers";
import type { HardhatRuntimeEnvironment, HttpNetworkConfig } from "hardhat/types";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { Doc, Hooks, IndexEntry } from "./replay";

const DB_NAME = "hei_replay";
const PORT = 3101;
const BACKEND_URL = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 31337;
const ACCOUNTS = 120;
// The texts a client signs, as server.js expects them (docs/REPLAY.md).
const studentStatement = (username: string) => `Skill Credentials: register this wallet for the FenixEdu username ${username}.`;
const thirdPartyStatement = (nif: string) => `Skill Credentials: apply as a third party with the NIF ${nif}.`;
const signedMessage = (action: string, fields: [string, string | number][]) =>
  [`Skill Credentials: ${action}`, ...fields.map(([name, value]) => `${name}: ${value}`)].join("\n");
// Keys no route may return.
const PRIVATE_KEYS = ["name", "student_name", "email", "grade", "raw_grade", "salt", "badge_salt", "master_salt"];

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const messageOf = (e: any) => String(e?.message ?? e).split("\n")[0];

// The ledger view the indexer must write, from the ledger, the spec files and
// expected. replay.ts builds it.
export type LedgerView = {
  seasons: { seasonId: string; label: string; badgesFrozenBlock: number | null; nodesFrozenBlock: number | null }[];
  badges: {
    tokenId: number;
    specId: string;
    courseCode: string;
    assessment: string;
    seasonId: string;
    metadataCID: string;
    skills: [string, number][];
  }[];
  nodes: {
    nodeId: number;
    name: string;
    tier: string;
    seasonId: string;
    metadataCID: string;
    versionOf: number;
    threshold: [string, number][];
    groups: number[][];
  }[];
  studentBadges: { wallet: string; tokenId: number; gradeCommitment: string; week: number }[];
  competencies: { wallet: string; nodeId: number; badgeIds: number[]; week: number }[];
  paths: { pathId: number; status: string; nodeIds: number[]; metadataCID: string; name: string }[];
  applications: { pathId: number; wallet: string; appliedAt: number }[]; // appliedAt in seconds, from the ledger
  projects: {
    projectId: number;
    status: string;
    maxTeams: number;
    selectedCount: number;
    slots: number[][];
    metadataCID: string;
    name: string;
  }[];
  teams: { teamId: number; projectId: number; formed: boolean; selected: boolean; members: [number, string][] }[];
  weekOfBlock: Map<number, number>; // the year's blocks, from the txlog
};

// Every key of a JSON value, at any depth.
function keysOf(v: any, out: string[] = []): string[] {
  if (v !== null && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (!Array.isArray(v)) out.push(k);
      keysOf(x, out);
    }
  return out;
}

export class FullMode {
  readonly logs: string;
  private readonly backendDir: string;
  private readonly deployments: string;
  private readonly rpcUrl: string;
  private settings: Record<string, string> = {};
  private pg: any = null; // the backend's pg package
  private SiweMessage: any = null; // the backend's siwe package
  private pool: any = null; // hei_replay
  private children = new Map<string, ChildProcess>(); // "backend", "indexer"
  private logFiles = new Map<string, string>();
  private pinProblems: string[] = [];
  private minted = new Map<string, any>(); // "S001:12" -> its result in POST /oracle/process-grades
  private gradeResponses: any[] = []; // every response of POST /oracle/process-grades
  pinned = 0;
  private documentsChecked = 0;
  private gradeRecordsChecked = 0;

  constructor(
    private readonly root: string,
    private readonly hre: HardhatRuntimeEnvironment,
  ) {
    this.logs = path.join(root, "simulation", "replay", "logs");
    this.backendDir = path.join(root, "backend");
    this.deployments = path.join(root, "packages", "hardhat", "deployments", "localhost");
    this.rpcUrl = (hre.network.config as HttpNetworkConfig).url;
  }

  private setting(key: string): string | undefined {
    return process.env[key] ?? this.settings[key];
  }

  // The backend's defaults (server.js).
  private db(database: string) {
    return {
      host: this.setting("DB_HOST") || "localhost",
      port: parseInt(this.setting("DB_PORT") || "5432"),
      database,
      user: this.setting("DB_USER") || "hei_admin",
      password: this.setting("DB_PASSWORD") || "hei_local",
    };
  }

  private get ipfsApi() {
    return this.setting("IPFS_API") || "http://127.0.0.1:5001";
  }

  // Before the setup: a fresh chain, Postgres, IPFS, the service keys, and the database hei_replay.
  async prerequisites(): Promise<string[]> {
    const envFile = path.join(this.backendDir, ".env");
    if (!fs.existsSync(envFile)) return ["backend/.env is missing: copy backend/.env.example to backend/.env"];
    const backendRequire = createRequire(path.join(this.backendDir, "package.json"));
    try {
      this.pg = backendRequire("pg");
      this.SiweMessage = backendRequire("siwe").SiweMessage;
      this.settings = backendRequire("dotenv").parse(fs.readFileSync(envFile));
    } catch {
      return ["the backend's packages are missing: run npm install in backend/"];
    }
    const problems: string[] = [];

    const provider = this.hre.ethers.provider;
    try {
      const block = await provider.getBlockNumber();
      const chainId = Number(await provider.send("eth_chainId", []));
      const accounts: string[] = (await provider.send("eth_accounts", [])).map(getAddress);
      if (block !== 0) problems.push(`the chain at ${this.rpcUrl} is at block ${block}, not 0: restart yarn chain`);
      if (chainId !== CHAIN_ID) problems.push(`the chain ID is ${chainId}, not ${CHAIN_ID}`);
      if (accounts.length !== ACCOUNTS) problems.push(`the chain has ${accounts.length} accounts, not ${ACCOUNTS}`);
      else if ((await provider.getTransactionCount(accounts[0])) !== 0) problems.push("the deployer's nonce is not 0");
      for (const [key, i] of [
        ["ORACLE_PRIVATE_KEY", 5],
        ["REGISTRAR_PRIVATE_KEY", 6],
      ] as const) {
        let address = "";
        try {
          address = new Wallet(this.setting(key) ?? "").address;
        } catch {
          // not a private key
        }
        if (address !== accounts[i]) problems.push(`${key} of backend/.env is not the key of account #${i}`);
      }
    } catch (e) {
      problems.push(`no chain answers at ${this.rpcUrl}: start yarn chain (${messageOf(e)})`);
    }

    const { user } = this.db("");
    const client = new this.pg.Client(this.db(this.setting("DB_NAME") || "hei_ecosystem"));
    try {
      await client.connect();
      if ((await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME])).rowCount === 0) {
        try {
          await client.query(`CREATE DATABASE ${DB_NAME}`);
        } catch (e) {
          problems.push(
            `the database ${DB_NAME} is missing, and ${user} cannot create it (${messageOf(e)}). ` +
              `Create it once: sudo -u postgres createdb -O ${user} ${DB_NAME}`,
          );
        }
      }
    } catch (e) {
      problems.push(`Postgres does not answer with the credentials of backend/.env: ${messageOf(e)}`);
    } finally {
      await client.end().catch(() => undefined);
    }

    try {
      const r = await fetch(`${this.ipfsApi}/api/v0/version`, { method: "POST", signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      problems.push(`the IPFS API at ${this.ipfsApi} does not answer: start ipfs daemon --offline (${messageOf(e)})`);
    }

    if (
      await fetch(`${BACKEND_URL}/health`).then(
        () => true,
        () => false,
      )
    )
      problems.push(`something already answers on port ${PORT}: stop the backend of an earlier run`);
    return problems;
  }

  // hei_replay recreated from DB/schema.sql, then the skill reference list (yarn backend:setup).
  async freshDatabase(): Promise<string> {
    const client = new this.pg.Client(this.db(DB_NAME));
    await client.connect();
    try {
      await client.query(fs.readFileSync(path.join(this.root, "DB", "schema.sql"), "utf8"));
    } finally {
      await client.end();
    }
    const out = execFileSync(process.execPath, [path.join(this.backendDir, "setup.js")], {
      env: { ...process.env, DB_NAME },
    });
    this.pool = new this.pg.Pool(this.db(DB_NAME));
    return out.toString().trim();
  }

  // A service of the platform as a child process, its output in simulation/replay/logs/<name>.log.
  private async startService(
    name: string,
    dir: string,
    script: string,
    env: Record<string, string>,
    ready: () => Promise<boolean>,
  ): Promise<void> {
    fs.mkdirSync(this.logs, { recursive: true });
    const logFile = path.join(this.logs, `${name}.log`);
    const log = fs.openSync(logFile, "w");
    const child = spawn(process.execPath, [script], {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: ["ignore", log, log],
    });
    fs.closeSync(log);
    this.children.set(name, child);
    this.logFiles.set(name, logFile);
    process.once("exit", () => child.kill());
    for (let waited = 0; waited < 20_000; waited += 250) {
      if (child.exitCode !== null)
        throw new Error(`the ${name} exited with code ${child.exitCode}: ${this.tail(name)}`);
      if (await ready()) return;
      await sleep(250);
    }
    throw new Error(`the ${name} was not ready within 20 s, see ${path.relative(this.root, logFile)}`);
  }

  private tail(name: string): string {
    return fs.readFileSync(this.logFiles.get(name)!, "utf8").trim().split("\n").slice(-3).join(" / ");
  }

  // The backend, on hei_replay and port 3101, with the deployment just written.
  async startBackend(): Promise<void> {
    await this.startService(
      "backend",
      this.backendDir,
      "server.js",
      { DB_NAME, PORT: String(PORT), RPC_URL: this.rpcUrl, DEPLOYMENTS_PATH: this.deployments },
      () =>
        fetch(`${BACKEND_URL}/health`).then(
          r => r.ok,
          () => false,
        ),
    );
  }

  // The event indexer, on hei_replay, reading the documents through this backend. Ready once it has stored a block.
  async startIndexer(): Promise<void> {
    const db = this.db(DB_NAME);
    await this.startService(
      "indexer",
      path.join(this.root, "indexer"),
      "indexer.js",
      {
        DB_HOST: db.host,
        DB_PORT: String(db.port),
        DB_NAME,
        DB_USER: db.user,
        DB_PASSWORD: db.password,
        RPC_URL: this.rpcUrl,
        DEPLOYMENTS_PATH: this.deployments,
        METADATA_API: BACKEND_URL,
      },
      async () => (await this.pool.query("SELECT 1 FROM indexer_state")).rowCount > 0,
    );
  }

  // student_ids of the simulated identities (decision 15), written directly:
  // the FenixEdu login is outside the replay.
  async privateRows(students: { id: string; masterSalt: string; wallet: string }[]): Promise<void> {
    for (const s of students)
      await this.pool.query(
        `INSERT INTO student_ids (wallet_address, fenix_id, student_name, email, degree, master_salt)
         VALUES ($1, $2, $2, $3, 'MEEC', $4)`,
        [s.wallet, s.id, `${s.id}@replay.invalid`, s.masterSalt],
      );
  }

  private async nonce(): Promise<string> {
    return (await (await fetch(`${BACKEND_URL}/auth/nonce`)).json()).nonce;
  }

  // A SIWE message (EIP-4361) from the client at localhost:3000.
  private siwe(address: string, statement: string, nonce: string): string {
    return new this.SiweMessage({
      domain: "localhost:3000",
      address,
      statement,
      uri: "http://localhost:3000",
      version: "1",
      chainId: CHAIN_ID,
      nonce,
      issuedAt: new Date().toISOString(),
    }).prepareMessage();
  }

  private post(route: string, body: any, cookie?: string): Promise<Response> {
    return fetch(BACKEND_URL + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  }

  // TP1 to TP3 apply through the backend, NIFs 000000001 to 000000003, before
  // the administrator anchors them. Pending: no role on the ledger yet.
  async applyThirdParties(thirdParties: { id: string; signer: HardhatEthersSigner }[]): Promise<string[]> {
    const problems: string[] = [];
    for (const [i, tp] of thirdParties.entries()) {
      const nif = String(i + 1).padStart(9, "0");
      const message = this.siwe(tp.signer.address, thirdPartyStatement(nif), await this.nonce());
      const r = await this.post("/third-party/apply", {
        name: tp.id,
        nif,
        message,
        signature: await tp.signer.signMessage(message),
      });
      const body: any = await r.json();
      if (r.status !== 200 || body.status !== "pending")
        problems.push(`${tp.id}: POST /third-party/apply answered ${r.status}, ${body.error ?? body.status}`);
    }
    return problems;
  }

  hooks(year: any, badgeToken: Map<string, number>): Hooks {
    return {
      beforeDefine: async (d: Doc) => {
        try {
          const r = await fetch(`${BACKEND_URL}/metadata/pin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: new Uint8Array(d.bytes), // the exact bytes of the file
          });
          const body: any = await r.json();
          if (!r.ok) this.pinProblems.push(`${d.entry.file}: POST /metadata/pin answered ${r.status}, ${body.error}`);
          else if (body.metadataCID !== "0x" + d.entry.sha256 || body.cid !== d.entry.cid)
            this.pinProblems.push(`${d.entry.file}: pinned as ${body.metadataCID} ${body.cid}, not as in index.json`);
          else this.pinned++;
        } catch (e) {
          this.pinProblems.push(`${d.entry.file}: POST /metadata/pin failed, ${messageOf(e)}`);
        }
      },
      // The week's grades go to mock_academic_records, below 10 included, then the oracle pipeline mints them.
      beforeWeek: async (week: number) => {
        for (const a of year.assessments.filter((x: any) => x.week === week && x.status === "taken"))
          await this.pool.query(
            "INSERT INTO mock_academic_records (fenix_id, token_id, raw_grade) VALUES ($1, $2, $3)",
            [a.student, badgeToken.get(a.badge), a.grade],
          );
        const r = await fetch(`${BACKEND_URL}/oracle/process-grades`, { method: "POST" });
        const body: any = await r.json();
        this.gradeResponses.push(body);
        const results: any[] = body.results ?? [];
        for (const x of results) this.minted.set(`${x.fenix_id}:${x.token_id}`, x);
        const want = year.events
          .filter((e: any) => e.week === week && e.type === "mintBadge")
          .map((e: any) => `${e.student}:${badgeToken.get(e.badge)}`);
        const got = results.filter(x => x.status === "minted").map(x => `${x.fenix_id}:${x.token_id}`);
        const problems: string[] = [];
        if (!r.ok) problems.push(`week ${week}: POST /oracle/process-grades answered ${r.status}, ${body.error}`);
        if (body.minted !== want.length)
          problems.push(`week ${week}: the oracle pipeline minted ${body.minted}, the week has ${want.length} mints`);
        if (body.failed !== 0) problems.push(`week ${week}: the oracle pipeline failed ${body.failed} mints`);
        if (got.join() !== want.join())
          problems.push(`week ${week}: the mints did not come back in the order of the week's mint events`);
        return problems;
      },
      // The replay never signs as the oracle: the receipt of the backend's transaction.
      mint: async (student: string, tokenId: number) => {
        const x = this.minted.get(`${student}:${tokenId}`);
        if (!x) throw new Error("the oracle pipeline did not mint it");
        if (x.status !== "minted") throw new Error(x.error);
        return this.hre.ethers.provider.getTransactionReceipt(x.tx_hash);
      },
    };
  }

  // Each document read back through GET /metadata/:id with the hash on the ledger.
  async checkDocuments(index: IndexEntry[], ledgerHash: (e: IndexEntry) => Promise<string>): Promise<string[]> {
    const problems = [...this.pinProblems];
    for (const e of index) {
      const hash = await ledgerHash(e);
      if (hash !== "0x" + e.sha256) {
        problems.push(`${e.file}: the ledger holds ${hash}, index.json 0x${e.sha256}`);
        continue;
      }
      try {
        const r = await fetch(`${BACKEND_URL}/metadata/${hash}`);
        const bytes = Buffer.from(await r.arrayBuffer());
        if (!r.ok) problems.push(`${e.file}: GET /metadata/${hash} answered ${r.status}`);
        else if (sha256Hex(bytes) !== e.sha256) problems.push(`${e.file}: GET /metadata/${hash} returned other bytes`);
        else this.documentsChecked++;
      } catch (err) {
        problems.push(`${e.file}: GET /metadata/${hash} failed, ${messageOf(err)}`);
      }
    }
    return problems;
  }

  // Row counts, and every grade record against its salt and the commitment on the ledger.
  async checkPrivateData(
    year: any,
    mints: { student: string; tokenId: number }[],
    commitmentOf: (wallet: string, tokenId: number) => Promise<string>,
    spot: { student: string; tokenId: number; grade: number; commitment: string },
  ): Promise<{ problems: string[]; example: string }> {
    const problems: string[] = [];
    const count = async (sql: string) => Number((await this.pool.query(sql)).rows[0].n);
    const taken = year.assessments.filter((a: any) => a.status === "taken");
    const below10 = taken.filter((a: any) => a.grade < 10).length;
    const want: [string, string, number][] = [
      ["student_ids", "SELECT count(*) AS n FROM student_ids", year.students.length],
      ["third_party_ids", "SELECT count(*) AS n FROM third_party_ids", 3],
      ["mock_academic_records", "SELECT count(*) AS n FROM mock_academic_records", taken.length],
      ["processed", "SELECT count(*) AS n FROM mock_academic_records WHERE processed", taken.length - below10],
      [
        "unprocessed, all below 10",
        "SELECT count(*) AS n FROM mock_academic_records WHERE NOT processed AND raw_grade < 10",
        below10,
      ],
      ["unprocessed", "SELECT count(*) AS n FROM mock_academic_records WHERE NOT processed", below10],
      ["grade_records", "SELECT count(*) AS n FROM grade_records", mints.length],
    ];
    for (const [what, sql, n] of want) {
      const got = await count(sql);
      if (got !== n) problems.push(`${what}: ${got} rows, expected ${n}`);
    }

    const rows = (
      await this.pool.query(
        `SELECT s.fenix_id, g.wallet_address, g.token_id, g.raw_grade, g.badge_salt, s.master_salt
         FROM grade_records g JOIN student_ids s ON s.wallet_address = g.wallet_address
         ORDER BY s.fenix_id, g.token_id`,
      )
    ).rows;
    const minted = new Set(mints.map(m => `${m.student}:${m.tokenId}`));
    let example = `Private data, worked example: no grade record of ${spot.student}, token ${spot.tokenId}`;
    this.gradeRecordsChecked = rows.length;
    for (const g of rows) {
      const what = `${g.fenix_id}, token ${g.token_id}`;
      if (!minted.has(`${g.fenix_id}:${g.token_id}`)) problems.push(`${what}: a grade record with no mint`);
      if (g.badge_salt !== sha256Hex(g.master_salt + String(g.token_id)))
        problems.push(`${what}: badge_salt is not sha256_hex(master_salt + token ID)`);
      const commitment = "0x" + sha256Hex(String(g.raw_grade) + g.badge_salt);
      if (commitment !== (await commitmentOf(g.wallet_address, g.token_id)))
        problems.push(`${what}: grade and badge salt do not give the commitment on the ledger`);
      if (g.fenix_id === spot.student && g.token_id === spot.tokenId) {
        if (g.raw_grade !== spot.grade || commitment !== spot.commitment)
          problems.push(
            `${what}: grade ${g.raw_grade} and commitment ${commitment}, not ${spot.grade} and ${spot.commitment}`,
          );
        example =
          `Private data, worked example: ${g.fenix_id}, token ${g.token_id}, grade ${g.raw_grade}, ` +
          `badge salt ${g.badge_salt}, "0x" + sha256_hex("${g.raw_grade}" + badge salt) = ${commitment} = ` +
          `gradeCommitments on the ledger.`;
      }
    }
    return { problems, example };
  }

  // The wallet routes of one student, the pending count, and every response of process-grades:
  // no private key at any depth, and no email, master salt or badge salt anywhere.
  async checkNoDisclosure(wallet: string): Promise<string[]> {
    const problems: string[] = [];
    const students = (await this.pool.query("SELECT wallet_address, student_name, email, master_salt FROM student_ids"))
      .rows;
    const salts = (await this.pool.query("SELECT badge_salt FROM grade_records")).rows.map((r: any) => r.badge_salt);
    const secrets = [...students.flatMap((s: any) => [s.email, s.master_salt]), ...salts].filter(Boolean);
    const look = (what: string, body: any, more: string[] = []) => {
      const keys = keysOf(body).filter(k => PRIVATE_KEYS.includes(k));
      if (keys.length) problems.push(`${what} returns ${[...new Set(keys)].join(", ")}`);
      const text = JSON.stringify(body);
      if ([...secrets, ...more].some(s => text.includes(s))) problems.push(`${what} returns a name, email or salt`);
    };
    const name = students.find((s: any) => s.wallet_address === wallet)?.student_name;
    for (const route of [`/student/${wallet}`, `/student/${wallet}/available`, `/student/${wallet}/skills`]) {
      const r = await fetch(BACKEND_URL + route);
      if (r.status !== 200) problems.push(`GET ${route} answered ${r.status}, not 200`);
      look(`GET ${route}`, await r.json(), name ? [name] : []);
    }
    look("GET /oracle/pending", await (await fetch(`${BACKEND_URL}/oracle/pending`)).json());
    for (const [i, body] of this.gradeResponses.entries()) look(`POST /oracle/process-grades, call ${i + 1}`, body);
    return problems;
  }

  // Waits until the indexer has handled every block up to head, for at most 600 s.
  async waitForIndexer(head: number): Promise<{ problems: string[]; seconds: number }> {
    const started = Date.now();
    const seconds = () => Math.round((Date.now() - started) / 100) / 10;
    for (;;) {
      const last = (await this.pool.query("SELECT last_block FROM indexer_state")).rows[0]?.last_block ?? -1;
      if (last >= head) return { problems: [], seconds: seconds() };
      const indexer = this.children.get("indexer");
      if (!indexer) return { problems: ["the indexer was not started"], seconds: seconds() };
      if (indexer.exitCode !== null)
        return {
          problems: [`the indexer exited with code ${indexer.exitCode}: ${this.tail("indexer")}`],
          seconds: seconds(),
        };
      if (Date.now() - started > 600_000)
        return { problems: [`the indexer reached block ${last} of ${head} in 600 s`], seconds: seconds() };
      await sleep(500);
    }
  }

  // Every table of the ledger view against what the ledger, the spec files and expected give.
  async checkLedgerView(want: LedgerView): Promise<string[]> {
    const problems: string[] = [];
    const rows = async (sql: string): Promise<any[]> => (await this.pool.query(sql)).rows;
    const differ = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    const pairs = (xs: [string, number][]) => [...xs].sort((a, b) => a[0].localeCompare(b[0]));
    const byKey = <T>(xs: T[], key: (x: T) => string | number) => new Map(xs.map(x => [key(x), x]));
    const listsOf = async (sql: string) => {
      const out = new Map<number, any[]>();
      for (const r of await rows(sql)) out.set(r.id, [...(out.get(r.id) ?? []), r]);
      return out;
    };
    const count = (table: string, got: number, n: number) => {
      if (got !== n) problems.push(`${table}: ${got} rows, expected ${n}`);
    };

    const seasons = byKey(await rows("SELECT * FROM seasons"), r => r.season_id);
    count("seasons", seasons.size, want.seasons.length);
    for (const w of want.seasons) {
      const r = seasons.get(w.seasonId);
      if (!r) problems.push(`season ${w.label}: no row`);
      else if (
        r.season_label !== w.label ||
        r.badges_frozen_block !== w.badgesFrozenBlock ||
        r.nodes_frozen_block !== w.nodesFrozenBlock ||
        !r.badges_frozen_at !== (w.badgesFrozenBlock === null) ||
        !r.nodes_frozen_at !== (w.nodesFrozenBlock === null)
      )
        problems.push(
          `season ${w.label}: label ${r.season_label}, frozen at blocks ${r.badges_frozen_block} and ` +
            `${r.nodes_frozen_block}, the txlog has ${w.badgesFrozenBlock} and ${w.nodesFrozenBlock}`,
        );
    }

    const badges = byKey(await rows("SELECT * FROM badges"), r => r.token_id);
    const badgeSkills = await listsOf("SELECT token_id AS id, skill_id, points FROM badge_skills");
    count("badges", badges.size, want.badges.length);
    for (const w of want.badges) {
      const r = badges.get(w.tokenId);
      const got = r && [r.spec_id, r.course_code, r.assessment, r.season_id, r.metadata_cid];
      const exp = [w.specId, w.courseCode, w.assessment, w.seasonId, w.metadataCID];
      if (differ(got, exp))
        problems.push(`badge ${w.tokenId}: ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`);
      const skills = (badgeSkills.get(w.tokenId) ?? []).map(x => [x.skill_id, x.points] as [string, number]);
      if (differ(pairs(skills), pairs(w.skills)))
        problems.push(`badge ${w.tokenId}: badge_skills differ from its skill points`);
    }

    const nodes = byKey(await rows("SELECT * FROM nodes"), r => r.node_id);
    const thresholds = await listsOf("SELECT node_id AS id, skill_id, min_points FROM node_thresholds");
    const prerequisites = await listsOf(
      "SELECT node_id AS id, group_index, prerequisite_node_id FROM node_prerequisites",
    );
    count("nodes", nodes.size, want.nodes.length);
    for (const w of want.nodes) {
      const r = nodes.get(w.nodeId);
      const got = r && [r.node_name, r.tier, r.season_id, r.metadata_cid, r.version_of];
      const exp = [w.name, w.tier, w.seasonId, w.metadataCID, w.versionOf];
      if (differ(got, exp)) problems.push(`node ${w.nodeId}: ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`);
      const threshold = (thresholds.get(w.nodeId) ?? []).map(x => [x.skill_id, x.min_points] as [string, number]);
      if (differ(pairs(threshold), pairs(w.threshold)))
        problems.push(`node ${w.nodeId}: node_thresholds differ from the ledger`);
      const groups: number[][] = [];
      for (const x of prerequisites.get(w.nodeId) ?? []) (groups[x.group_index] ??= []).push(x.prerequisite_node_id);
      const sorted = (gs: number[][]) => gs.map(g => [...g].sort((a, b) => a - b));
      if (differ(sorted(groups), sorted(w.groups)))
        problems.push(
          `node ${w.nodeId}: prerequisite groups ${JSON.stringify(groups)}, the ledger has ${JSON.stringify(w.groups)}`,
        );
    }

    // committed_to_node: the node a badge unlocked, 0 for a free badge.
    const committed = new Map<string, number>();
    for (const c of want.competencies) for (const t of c.badgeIds) committed.set(`${c.wallet}:${t}`, c.nodeId);
    const studentBadges = byKey(await rows("SELECT * FROM student_badges"), r => `${r.wallet_address}:${r.token_id}`);
    count("student_badges", studentBadges.size, want.studentBadges.length);
    for (const w of want.studentBadges) {
      const key = `${w.wallet}:${w.tokenId}`;
      const r = studentBadges.get(key);
      if (!r) problems.push(`student_badges: no row for ${key}`);
      else if (
        r.grade_commitment !== w.gradeCommitment ||
        want.weekOfBlock.get(r.minted_block) !== w.week ||
        !r.minted_at ||
        r.committed_to_node !== (committed.get(key) ?? 0)
      )
        problems.push(
          `student_badges ${key}: minted in week ${want.weekOfBlock.get(r.minted_block)}, not ${w.week}, ` +
            `or its commitment or committed_to_node ${r.committed_to_node} differs`,
        );
    }

    const competencies = byKey(
      await rows("SELECT * FROM student_competencies"),
      r => `${r.wallet_address}:${r.node_id}`,
    );
    count("student_competencies", competencies.size, want.competencies.length);
    for (const w of want.competencies) {
      const key = `${w.wallet}:${w.nodeId}`;
      const r = competencies.get(key);
      if (!r) problems.push(`student_competencies: no row for ${key}`);
      else if (differ(r.badge_ids, w.badgeIds) || want.weekOfBlock.get(r.unlocked_block) !== w.week || !r.unlocked_at)
        problems.push(
          `student_competencies ${key}: badges ${r.badge_ids} in week ${want.weekOfBlock.get(r.unlocked_block)}, ` +
            `expected ${w.badgeIds} in week ${w.week}`,
        );
    }

    const paths = byKey(await rows("SELECT * FROM competency_paths"), r => r.path_id);
    count("competency_paths", paths.size, want.paths.length);
    for (const w of want.paths) {
      const r = paths.get(w.pathId);
      const got = r && [r.status, r.node_ids, r.metadata_cid, r.name];
      const exp = [w.status, w.nodeIds, w.metadataCID, w.name];
      if (differ(got, exp)) problems.push(`path ${w.pathId}: ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`);
    }

    const applications = byKey(await rows("SELECT * FROM path_applications"), r => `${r.path_id}:${r.wallet_address}`);
    count("path_applications", applications.size, want.applications.length);
    for (const w of want.applications) {
      const r = applications.get(`${w.pathId}:${w.wallet}`);
      if (!r) problems.push(`path_applications: no row for path ${w.pathId}, ${w.wallet}`);
      else if (r.applied_at.getTime() !== w.appliedAt * 1000)
        problems.push(
          `path_applications: path ${w.pathId}, ${w.wallet} applied at ${r.applied_at.toISOString()}, not as the ledger`,
        );
    }

    const projects = byKey(await rows("SELECT * FROM projects"), r => r.project_id);
    const slots = await listsOf("SELECT project_id AS id, slot, node_ids FROM project_slots ORDER BY project_id, slot");
    count("projects", projects.size, want.projects.length);
    for (const w of want.projects) {
      const r = projects.get(w.projectId);
      const got = r && [r.status, r.max_teams, r.selected_count, r.metadata_cid, r.name];
      const exp = [w.status, w.maxTeams, w.selectedCount, w.metadataCID, w.name];
      if (differ(got, exp))
        problems.push(`project ${w.projectId}: ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`);
      const gotSlots = (slots.get(w.projectId) ?? []).map(x => [x.slot, x.node_ids]);
      if (
        differ(
          gotSlots,
          w.slots.map((nodeIds, slot) => [slot, nodeIds]),
        )
      )
        problems.push(
          `project ${w.projectId}: slots ${JSON.stringify(gotSlots)}, the event has ${JSON.stringify(w.slots)}`,
        );
    }

    const teams = byKey(await rows("SELECT * FROM project_teams"), r => r.team_id);
    const members = await listsOf(
      "SELECT team_id AS id, slot, wallet_address FROM team_members ORDER BY team_id, slot",
    );
    count("project_teams", teams.size, want.teams.length);
    for (const w of want.teams) {
      const r = teams.get(w.teamId);
      const got = r && [r.project_id, r.formed, r.selected];
      const exp = [w.projectId, w.formed, w.selected];
      if (differ(got, exp)) problems.push(`team ${w.teamId}: ${JSON.stringify(got)}, expected ${JSON.stringify(exp)}`);
      const gotMembers = (members.get(w.teamId) ?? []).map(x => [x.slot, x.wallet_address]);
      if (differ(gotMembers, w.members))
        problems.push(`team ${w.teamId}: members ${JSON.stringify(gotMembers)}, expected ${JSON.stringify(w.members)}`);
    }

    const [state] = await rows("SELECT document_mismatches, season_mismatches FROM indexer_state");
    if (state?.document_mismatches !== 0) problems.push(`${state?.document_mismatches} document mismatches`);
    if (state?.season_mismatches !== 0) problems.push(`${state?.season_mismatches} season mismatches`);
    return problems;
  }

  // The counts of the stack for the summary: documents, private rows, grade
  // records, ledger view rows per table, and the mismatches the indexer counted.
  async counts(): Promise<any> {
    const n = async (sql: string) => Number((await this.pool.query(sql)).rows[0].n);
    const ledgerViewRows: Record<string, number> = {};
    for (const table of [
      "seasons",
      "badges",
      "badge_skills",
      "nodes",
      "node_thresholds",
      "node_prerequisites",
      "student_badges",
      "student_competencies",
      "competency_paths",
      "path_applications",
      "projects",
      "project_slots",
      "project_teams",
      "team_members",
    ])
      ledgerViewRows[table] = await n(`SELECT count(*) AS n FROM ${table}`);
    const state = (await this.pool.query("SELECT document_mismatches, season_mismatches FROM indexer_state")).rows[0];
    return {
      documents: { pinned: this.pinned, checked: this.documentsChecked },
      privateRows: {
        student_ids: await n("SELECT count(*) AS n FROM student_ids"),
        third_party_ids: await n("SELECT count(*) AS n FROM third_party_ids"),
        mock_academic_records: await n("SELECT count(*) AS n FROM mock_academic_records"),
        processed: await n("SELECT count(*) AS n FROM mock_academic_records WHERE processed"),
        unprocessed: await n("SELECT count(*) AS n FROM mock_academic_records WHERE NOT processed"),
        grade_records: await n("SELECT count(*) AS n FROM grade_records"),
      },
      gradeRecordsChecked: this.gradeRecordsChecked,
      ledgerViewRows,
      mismatches: { documents: state?.document_mismatches ?? null, seasons: state?.season_mismatches ?? null },
    };
  }

  // Registration and disclosure, as a client would use the
  // routes, after every other check. Returns the problems and one line per step.
  async checkRegistrationAndDisclosure(c: {
    student: (id: string) => HardhatEthersSigner;
    thirdParty: (id: string) => HardhatEthersSigner;
    account: (index: number) => HardhatEthersSigner;
    isStudent: (wallet: string) => Promise<boolean>;
    commitmentOf: (wallet: string, tokenId: number) => Promise<string>;
    mintedTo: (student: string) => number[];
    spot: { student: string; tokenId: number; grade: number; commitment: string };
  }): Promise<{ problems: string[]; lines: string[] }> {
    const problems: string[] = [];
    const lines: string[] = [];
    const count = async (sql: string, args: any[]) => Number((await this.pool.query(sql, args)).rows[0].n);
    const refused = async (what: string, r: Response) => {
      const body: any = await r.json();
      const leaked = keysOf(body).filter(k => PRIVATE_KEYS.includes(k));
      if (r.status < 400 || leaked.length) problems.push(`${what}: answered ${r.status}, not refused`);
      else lines.push(`refused, ${what}: ${r.status}, ${body.error}`);
    };
    const s027 = c.student(c.spot.student);
    const [s028, s100, tp1, tp2] = [c.student("S028"), c.student("S100"), c.thirdParty("TP1"), c.thirdParty("TP2")];

    // Grade: S027 asks for its grade of token 91, and the commitment recomputed from it is the one on the ledger.
    const gradeRequest = signedMessage("disclose grade", [
      ["Wallet", s027.address],
      ["Token ID", c.spot.tokenId],
      ["Nonce", await this.nonce()],
    ]);
    const r1 = await this.post("/disclose/grade", {
      message: gradeRequest,
      signature: await s027.signMessage(gradeRequest),
    });
    const g: any = await r1.json();
    const recomputed = r1.ok ? "0x" + sha256Hex(String(g.grade) + g.badge_salt) : "";
    const onLedger = await c.commitmentOf(s027.address, c.spot.tokenId);
    if (!r1.ok || g.grade !== c.spot.grade || recomputed !== c.spot.commitment || onLedger !== c.spot.commitment)
      problems.push(`grade: answered ${r1.status}, grade ${g.grade}, recomputed commitment ${recomputed}`);
    else
      lines.push(
        `grade: ${c.spot.student} gets grade ${g.grade} of token ${c.spot.tokenId} and its badge salt, ` +
          `"0x" + sha256_hex("${g.grade}" + badge salt) = ${recomputed} = gradeCommitments on the ledger`,
      );

    // Identity: S027 consents to TP1, and TP1 signs the request.
    const consent = signedMessage("disclose identity", [
      ["Student", s027.address],
      ["Third party", tp1.address],
      ["Nonce", await this.nonce()],
    ]);
    const r2 = await this.post("/disclose/identity", {
      message: consent,
      studentSignature: await s027.signMessage(consent),
      thirdPartySignature: await tp1.signMessage(consent),
    });
    const id: any = await r2.json();
    if (!r2.ok || id.name !== c.spot.student || id.email !== `${c.spot.student}@replay.invalid`)
      problems.push(`identity: answered ${r2.status}, ${JSON.stringify(id)}`);
    else lines.push(`identity: with ${c.spot.student}'s consent and TP1's signature, ${id.name}, ${id.email}`);

    // Refused requests.
    const byOther = signedMessage("disclose grade", [
      ["Wallet", s027.address],
      ["Token ID", c.spot.tokenId],
      ["Nonce", await this.nonce()],
    ]);
    await refused(
      `a grade request of ${c.spot.student} signed by S028`,
      await this.post("/disclose/grade", { message: byOther, signature: await s028.signMessage(byOther) }),
    );
    const notThirdParty = signedMessage("disclose identity", [
      ["Student", s027.address],
      ["Third party", s028.address],
      ["Nonce", await this.nonce()],
    ]);
    await refused(
      "a consent naming S028, a wallet without the third party role",
      await this.post("/disclose/identity", {
        message: notThirdParty,
        studentSignature: await s027.signMessage(notThirdParty),
        thirdPartySignature: await s028.signMessage(notThirdParty),
      }),
    );
    const forTp1 = signedMessage("disclose identity", [
      ["Student", s027.address],
      ["Third party", tp1.address],
      ["Nonce", await this.nonce()],
    ]);
    await refused(
      "an identity request signed by TP2 for a consent naming TP1",
      await this.post("/disclose/identity", {
        message: forTp1,
        studentSignature: await s027.signMessage(forTp1),
        thirdPartySignature: await tp2.signMessage(forTp1),
      }),
    );
    await refused(
      "the grade request again, its nonce used",
      await this.post("/disclose/grade", { message: gradeRequest, signature: await s027.signMessage(gradeRequest) }),
    );

    // Erasure of S100: its grade records go, its master salt is NULL, the grade route refuses it, the commitments stay.
    const minted = c.mintedTo("S100");
    const before = await count("SELECT count(*) AS n FROM grade_records WHERE wallet_address = $1", [s100.address]);
    const erase = signedMessage("erase grades", [
      ["Wallet", s100.address],
      ["Nonce", await this.nonce()],
    ]);
    const r3 = await this.post("/student/erase", { message: erase, signature: await s100.signMessage(erase) });
    const e: any = await r3.json();
    const after = await count("SELECT count(*) AS n FROM grade_records WHERE wallet_address = $1", [s100.address]);
    const salts = await count("SELECT count(master_salt) AS n FROM student_ids WHERE wallet_address = $1", [
      s100.address,
    ]);
    let kept = 0;
    for (const t of minted) if ((await c.commitmentOf(s100.address, t)) !== "0x" + "0".repeat(64)) kept++;
    if (!r3.ok || e.grade_records_deleted !== before || before !== minted.length || after !== 0 || salts !== 0)
      problems.push(`erasure: answered ${r3.status}, ${before} grade records before, ${after} after`);
    else if (kept !== minted.length) problems.push(`erasure: ${kept} of ${minted.length} commitments on the ledger`);
    else
      lines.push(
        `erasure: S100's ${before} grade records deleted, its master salt NULL, its ${kept} commitments still on the ledger`,
      );
    const afterErasure = signedMessage("disclose grade", [
      ["Wallet", s100.address],
      ["Token ID", minted[0]],
      ["Nonce", await this.nonce()],
    ]);
    await refused(
      `a grade request of S100 after the erasure, token ${minted[0]}`,
      await this.post("/disclose/grade", { message: afterErasure, signature: await s100.signMessage(afterErasure) }),
    );

    // Student registration without FenixEdu: a session in auth_sessions, then the real nonce, SIWE and anchor steps.
    const session = async (username: string) => {
      const sessionId = createHash("sha256").update(`${username}:${Date.now()}:${Math.random()}`).digest("hex");
      await this.pool.query(
        `INSERT INTO auth_sessions (session_id, fenix_username, student_name, email, expires_at)
         VALUES ($1, $2, $2, $3, NOW() + INTERVAL '10 minutes')`,
        [sessionId, username, `${username}@replay.invalid`],
      );
      return `session=${sessionId}`;
    };
    const register = async (cookie: string, username: string, signer: HardhatEthersSigner, nonce?: string) => {
      const used = nonce ?? (await this.nonce());
      const message = this.siwe(signer.address, studentStatement(username), used);
      const r = await this.post("/auth/wallet", { message, signature: await signer.signMessage(message) }, cookie);
      return { r, nonce: used };
    };
    const t001 = await session("T001");
    const account110 = c.account(110);
    const first = await register(t001, "T001", account110);
    const registered: any = await first.r.json();
    const rows = await count("SELECT count(*) AS n FROM student_ids WHERE wallet_address = $1 AND fenix_id = 'T001'", [
      account110.address,
    ]);
    if (!first.r.ok || !(await c.isStudent(account110.address)) || rows !== 1)
      problems.push(`registration: answered ${first.r.status}, ${registered.error ?? ""}, ${rows} private rows`);
    else lines.push("registration: session T001, account #110 anchored as a student by the registrar, one private row");
    await refused("a second wallet for T001, account #111", (await register(t001, "T001", c.account(111))).r);
    await refused(
      "TP1's wallet, which holds the third party role",
      (await register(await session("T002"), "T002", tp1)).r,
    );
    await refused(
      "S001's wallet, already a student",
      (await register(await session("T003"), "T003", c.student("S001"))).r,
    );
    await refused(
      "account #112 with the nonce of the T001 registration",
      (await register(await session("T004"), "T004", c.account(112), first.nonce)).r,
    );
    const secondNif = this.siwe(c.account(113).address, thirdPartyStatement("000000001"), await this.nonce());
    await refused(
      "a second wallet for TP1's NIF, account #113",
      await this.post("/third-party/apply", {
        name: "TP1 again",
        nif: "000000001",
        message: secondNif,
        signature: await c.account(113).signMessage(secondNif),
      }),
    );
    return { problems, lines };
  }

  // Stops the backend and the indexer, and closes the database pool, also after a failure.
  async stop(): Promise<void> {
    for (const child of this.children.values())
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise(resolve => child.once("exit", resolve));
        child.kill("SIGTERM");
        await exited;
      }
    await this.pool?.end().catch(() => undefined);
    this.pool = null;
  }
}
