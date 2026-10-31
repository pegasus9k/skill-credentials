/*
 * Replay of the simulated year. See docs/REPLAY.md.
 *
 *   yarn replay        ->   hardhat run scripts/replay.ts --network hardhat     contracts-only mode
 *   yarn replay:full   ->   hardhat run scripts/replay.ts --network localhost   full mode
 *
 * Deploys the four contracts with the repo's deploy scripts, anchors the
 * wallets, defines the 97 badges and 24 nodes of simulation/metadata/index.json,
 * walks the events of simulatedYear.json in order, checks the ledger against
 * `expected`, counts the reads of a third party, and writes
 * simulation/replay/<mode>/.
 *
 * The contracts-only mode runs on the in-process Hardhat network and nothing
 * else. The full mode runs the same walk on a freshly started yarn chain with
 * the whole stack. It plugs in through Hooks: beforeDefine pins each document
 * through the backend, beforeWeek hands the week's grades to the backend's
 * oracle pipeline, and mint returns the receipt of the backend's transaction.
 * Its code is in scripts/replayFull.ts, which only the full mode loads.
 */
import { createHash } from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";
import type { TransactionReceipt } from "ethers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { FullMode, LedgerView } from "./replayFull";

const { ethers, deployments } = hre;

const MODE = hre.network.name === "localhost" ? "full" : "contracts";
const ROOT = path.resolve(__dirname, "..", "..", "..");
const SPEC = path.join(ROOT, "simulation", "spec");
const METADATA = path.join(ROOT, "simulation", "metadata");
const OUT = path.join(ROOT, "simulation", "replay", MODE);
const YEAR_SHA256 = "0c88b5fc231bf680f09bda32fd67a78b40b99dc9a404e17e654e3f618ae9baca";
const SIZE_LIMIT = 24576; // EIP-170 limit on runtime bytecode
const PROJECT = 1; // the year has one project

// Totals and spot checks, computed independently of the replay.
const TOTALS = { badges: 3703, nodes: 545, applications: 37, teamMembers: 51, teams: 15, yearTransactions: 4347 };
const SPOT = {
  student: "S027",
  badge: "COSE-2",
  tokenId: 91,
  grade: 13,
  week: 28,
  commitment: "0x9c78aff5d1b4cc2fd77e400f256a94201dd8dcbee35a71e6b80530db54692eeb",
  node: 22,
  nodeBadges: [20, 41, 56, 75, 79, 91],
  calls: 23,
};

const TIERS = ["Fundamentals", "Specialist", "Architect"];
const GROUPS = ["reference", "regular-15-30", "regular-30", "skips", "dropout"];
const YEAR_OPS = [
  "mintBadge",
  "freezeSeason (SkillBadge)",
  "freezeSeason (SkillGraph)",
  "allocateBadges",
  "definePath",
  "defineProject",
  "approvePath",
  "approveProject",
  "applyToPath",
  "startTeam",
  "joinTeam",
  "joinTeam (forms the team)",
  "selectTeam",
];
const PAYERS = ["oracle", "students", "administrator", "third parties"];
const PAYER: Record<string, string> = {
  mintBadge: "oracle",
  freezeSeason: "administrator",
  approvePath: "administrator",
  approveProject: "administrator",
  definePath: "third parties",
  defineProject: "third parties",
  selectTeam: "third parties",
  allocateBadges: "students",
  applyToPath: "students",
  startTeam: "students",
  joinTeam: "students",
};

export type IndexEntry = { kind: string; id: string | number; file: string; sha256: string; cid: string };
export type Doc = { entry: IndexEntry; bytes: Buffer; doc: any };
type Student = { id: string; archetype: string; class: string; allocationWeeks: number[]; masterSalt: string };
type Expected = {
  student: string;
  badges: string[];
  nodes: Record<string, number>;
  applications: number[];
  team: { team: number; slot: number; formed: boolean; selected: boolean } | null;
};
type Row = {
  seq: number;
  phase: "setup" | "year";
  week: number | "";
  event: string;
  signer: string;
  contract: string;
  fn: string;
  gas: number | "";
  status: "ok" | "refused";
  reason: string;
  block: number | "";
  // Not in txlog.csv: what the summary groups by.
  op?: string;
  payer?: string;
  student?: string;
  tier?: string;
  badges?: number;
};
type Meta = Omit<Row, "seq" | "gas" | "status" | "reason" | "block">;
type Stats = { count: number; min: number; mean: number; max: number; total: number };
type Check =
  | "inputs"
  | "prerequisites"
  | "setup"
  | "ledger"
  | "spot"
  | "reads"
  | "same"
  | "documents"
  | "view"
  | "private"
  | "disclosure"
  | "registration";
type Failures = Record<Check, string[]>;
export type Hooks = {
  // Before each define call (badge, node, path, project). Full mode: pin the document's bytes.
  beforeDefine: (doc: Doc) => Promise<void>;
  // Before the first event of each week. Full mode: the backend's oracle pipeline mints the week's grades.
  beforeWeek: (week: number) => Promise<string[]>;
  // Each mint, by student ID. Full mode: the receipt of the backend's transaction.
  mint: (student: string, tokenId: number, gradeCommitment: string) => Promise<TransactionReceipt | null>;
};

// The console lines of each mode, in order. Reproduced comes last in both.
const CHECKS: [Check, string][] = [
  ["inputs", "inputs"],
  ...(MODE === "full" ? [["prerequisites", "prerequisites"] as [Check, string]] : []),
  ["setup", "setup"],
  ["ledger", "ledger against expected"],
  ["spot", "spot checks"],
  ["reads", "reads"],
  ...(MODE === "full"
    ? ([
        ["same", "same transactions"],
        ["documents", "documents"],
        ["view", "ledger view"],
        ["private", "private data"],
        ["disclosure", "no disclosure"],
        ["registration", "registration and disclosure"],
      ] as [Check, string][])
    : []),
];

let full: FullMode | null = null; // set by main() in the full mode

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const seasonLabel = (n: number) => `2025/2026-S${n}`;
const seasonId = (n: number) => ethers.id(seasonLabel(n));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// As server.js computes it: UTF-8 strings, hex digests.
const gradeCommitment = (masterSalt: string, tokenId: number, grade: number) =>
  "0x" + sha256Hex(String(grade) + sha256Hex(masterSalt + String(tokenId)));

function stats(values: number[], decimals = 0): Stats {
  if (values.length === 0) return { count: 0, min: 0, mean: 0, max: 0, total: 0 };
  const total = sum(values);
  const f = 10 ** decimals;
  const mean = Math.round((total / values.length) * f) / f;
  return { count: values.length, min: Math.min(...values), mean, max: Math.max(...values), total };
}

// Behavior group, from class and allocationWeeks.
function groupOf(s: Student): string {
  if (s.class !== "regular") return s.class;
  return s.allocationWeeks.join(",") === "15,30" ? "regular-15-30" : "regular-30";
}

function reasonOf(e: any): string {
  return String(e?.reason ?? e?.revert?.name ?? e?.shortMessage ?? e?.message ?? e).split("\n")[0];
}

function csv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(",")).join("\n") + "\n";
}

function flatten(v: any, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = JSON.stringify(v);
  return out;
}

function packageVersion(name: string): string {
  try {
    return JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;
  } catch {
    return "unknown";
  }
}

async function main() {
  const startedAt = Date.now();
  const fail: Failures = {
    inputs: [],
    prerequisites: [],
    setup: [],
    ledger: [],
    spot: [],
    reads: [],
    same: [],
    documents: [],
    view: [],
    private: [],
    disclosure: [],
    registration: [],
  };

  // ─── Inputs ────────────────────────────────────────────────────────────────
  const yearBytes = fs.readFileSync(path.join(SPEC, "simulatedYear.json"));
  const yearSha = sha256Hex(yearBytes);
  if (yearSha !== YEAR_SHA256) fail.inputs.push(`simulatedYear.json SHA-256 is ${yearSha}, not ${YEAR_SHA256}`);
  const year = JSON.parse(yearBytes.toString("utf8"));
  const indexBytes = fs.readFileSync(path.join(METADATA, "index.json"));
  const index: IndexEntry[] = JSON.parse(indexBytes.toString("utf8")).documents;
  const docs = new Map<string, Doc>();
  for (const entry of index) {
    const bytes = fs.readFileSync(path.join(METADATA, entry.file));
    if (sha256Hex(bytes) !== entry.sha256) fail.inputs.push(`${entry.file}: SHA-256 differs from index.json`);
    docs.set(`${entry.kind}:${entry.id}`, { entry, bytes, doc: JSON.parse(bytes.toString("utf8")) });
  }
  const docsOf = (kind: string) => index.filter(e => e.kind === kind).map(e => docs.get(`${kind}:${e.id}`)!);
  const badgeDocs = docsOf("badge");
  const nodeDocs = docsOf("node");

  const courses: any[] = readJson(path.join(SPEC, "courses.json")).courses;
  const graphFile = readJson(path.join(SPEC, "graph.json"));
  const archetypes = new Map<string, any>(
    readJson(path.join(SPEC, "archetypes.json")).archetypes.map((a: any) => [a.id, a]),
  );
  const badgeSpec = new Map<string, { course: any; badge: any }>();
  for (const course of courses) for (const badge of course.badges) badgeSpec.set(badge.id, { course, badge });
  const nodeSpec = new Map<number, any>(graphFile.nodes.map((n: any) => [n.id, n]));
  const students: Student[] = year.students;
  const studentOf = new Map(students.map(s => [s.id, s]));
  const expectedOf = new Map<string, Expected>(year.expected.map((x: Expected) => [x.student, x]));

  if (badgeDocs.length !== 97 || nodeDocs.length !== 24)
    fail.inputs.push(`index.json lists ${badgeDocs.length} badges and ${nodeDocs.length} nodes, not 97 and 24`);
  for (const d of badgeDocs)
    if (!badgeSpec.has(String(d.entry.id))) fail.inputs.push(`badge ${d.entry.id} not in courses.json`);
  for (const d of nodeDocs)
    if (!nodeSpec.has(Number(d.entry.id))) fail.inputs.push(`node ${d.entry.id} not in graph.json`);
  // The posts on the ledger must be the ones their documents describe.
  for (const e of year.events) {
    if (e.type === "definePath") {
      const d = docs.get(`path:${e.path}`);
      const checked = d
        ? Object.values(d.doc.nodes)
            .flat()
            .filter((n: any) => n.required === "checked")
        : [];
      const ids = checked.map((n: any) => n.id).sort((a: number, b: number) => a - b);
      if (
        !d ||
        !same(
          ids,
          [...e.nodes].sort((a: number, b: number) => a - b),
        )
      )
        fail.inputs.push(`definePath ${e.path}: nodes differ from posts/path-${e.path}.json`);
    }
    if (e.type === "defineProject") {
      const d = docs.get(`project:${e.project}`);
      const slots = d ? d.doc.slots.map((s: any) => s.nodes.map((n: any) => n.id)) : [];
      if (!d || JSON.stringify(slots) !== JSON.stringify(e.slots) || d.doc.maxTeams !== e.maxTeams)
        fail.inputs.push(`defineProject ${e.project}: slots or maxTeams differ from posts/project-${e.project}.json`);
    }
  }
  if (fail.inputs.length) return finish(fail, startedAt, null, "inputs");
  console.log(`Inputs: simulatedYear.json and the ${index.length} documents of index.json match their SHA-256.`);

  // ─── Full mode: prerequisites ─────────────────────────────────────────────
  if (MODE === "full") {
    const { FullMode } = await import("./replayFull");
    full = new FullMode(ROOT, hre);
    fail.prerequisites.push(...(await full.prerequisites()));
    if (fail.prerequisites.length) return finish(fail, startedAt, null, "prerequisites");
    console.log("Prerequisites: a fresh chain with 120 accounts, Postgres, the IPFS API, the keys of #5 and #6.");
  }

  // ─── Setup: accounts and deployment ───────────────────────────────────────
  const signers = await ethers.getSigners();
  const [deployer, admin] = signers;
  const oracle = signers[5];
  const registrar = signers[6];
  const thirdParties: Record<string, HardhatEthersSigner> = { TP1: signers[7], TP2: signers[8], TP3: signers[9] };
  const wallet = new Map(students.map((s, i) => [s.id, signers[10 + i]]));
  const label = new Map<string, string>([
    [deployer.address, "deployer"],
    [admin.address, "administrator"],
    [oracle.address, "oracle"],
    [registrar.address, "registrar"],
    ...Object.entries(thirdParties).map(([k, s]) => [s.address, k] as [string, string]),
    ...students.map(s => [wallet.get(s.id)!.address, s.id] as [string, string]),
  ]);

  if (full) {
    try {
      console.log(`Setup: hei_replay recreated from DB/schema.sql. ${await full.freshDatabase()}`);
    } catch (e) {
      fail.setup.push(`fresh database: ${reasonOf(e)}`);
      return finish(fail, startedAt, null, "setup");
    }
    // The chain is fresh, so every earlier file in deployments/localhost is stale.
    console.log("Setup: the repo's deploy scripts, through deployments.run(), written to deployments/localhost");
    await deployments.run(undefined, {
      resetMemory: true,
      deletePreviousDeployments: true,
      writeDeploymentsToFiles: true,
    });
  } else {
    console.log("Setup: the repo's deploy scripts, through deployments.fixture()");
    await deployments.fixture();
  }
  const names = ["IdentityRegistry", "SkillBadge", "SkillGraph", "SkillPath"];
  const address: Record<string, string> = {};
  for (const n of names) address[n] = (await deployments.get(n)).address;
  const registry = await ethers.getContractAt("IdentityRegistry", address.IdentityRegistry);
  const skillBadge = await ethers.getContractAt("SkillBadge", address.SkillBadge);
  const skillGraph = await ethers.getContractAt("SkillGraph", address.SkillGraph);
  const skillPath = await ethers.getContractAt("SkillPath", address.SkillPath);
  const contractOf: Record<string, any> = {
    IdentityRegistry: registry,
    SkillBadge: skillBadge,
    SkillGraph: skillGraph,
    SkillPath: skillPath,
  };
  const nameOf = new Map(names.map(n => [address[n].toLowerCase(), n]));

  const rows: Row[] = [];
  const push = (meta: Meta, rc: TransactionReceipt | null, reason = "") =>
    rows.push({
      seq: rows.length + 1,
      ...meta,
      gas: rc ? Number(rc.gasUsed) : "",
      status: rc && rc.status === 1 ? "ok" : "refused",
      reason,
      block: rc ? rc.blockNumber : "",
    });
  const send = async (meta: Meta, run: () => Promise<TransactionReceipt | null>) => {
    try {
      const rc = await run();
      push(meta, rc, rc ? "" : "no receipt");
      return rc && rc.status === 1 ? rc : null;
    } catch (e) {
      push(meta, null, reasonOf(e));
      return null;
    }
  };
  const emitted = (rc: TransactionReceipt | null, contract: string, event: string): number[] =>
    (rc?.logs ?? [])
      .filter(l => nameOf.get(l.address.toLowerCase()) === contract)
      .map(l => contractOf[contract].interface.parseLog(l))
      .filter(p => p?.name === event)
      .map(p => Number(p.args[0]));

  // The deploy scripts' transactions: every block mined so far.
  const latest = await ethers.provider.getBlockNumber();
  for (let n = 1; n <= latest; n++) {
    const block = await ethers.provider.getBlock(n, true);
    for (const tx of block!.prefetchedTransactions) {
      const rc = await ethers.provider.getTransactionReceipt(tx.hash);
      const contract = nameOf.get((tx.to ?? rc!.contractAddress ?? "").toLowerCase()) ?? "?";
      const fn = tx.to ? (contractOf[contract]?.interface.parseTransaction({ data: tx.data })?.name ?? "?") : "deploy";
      push(
        { phase: "setup", week: "", event: "deploy scripts", signer: label.get(tx.from) ?? tx.from, contract, fn },
        rc,
      );
    }
  }

  const role: Record<string, string> = {};
  for (const r of [
    "DEFAULT_ADMIN_ROLE",
    "HEI_ADMIN_ROLE",
    "REGISTRAR_ROLE",
    "ORACLE_ROLE",
    "THIRD_PARTY_ROLE",
    "STUDENT_ROLE",
  ])
    role[r] = await (registry as any)[r]();
  for (const [r, id] of Object.entries(role))
    if (await registry.hasRole(id, deployer.address)) fail.setup.push(`the deployer holds ${r}`);
  if (!(await registry.hasRole(role.HEI_ADMIN_ROLE, admin.address))) fail.setup.push("#1 is not the administrator");
  if (!(await registry.hasRole(role.ORACLE_ROLE, oracle.address))) fail.setup.push("#5 is not the oracle");
  if (!(await registry.hasRole(role.REGISTRAR_ROLE, registrar.address))) fail.setup.push("#6 is not the registrar");

  if (full) {
    try {
      await full.startBackend();
      await full.startIndexer();
      await full.privateRows(
        students.map(s => ({ id: s.id, masterSalt: s.masterSalt, wallet: wallet.get(s.id)!.address })),
      );
      // The third parties apply through the backend before the administrator anchors them.
      fail.setup.push(
        ...(await full.applyThirdParties(Object.entries(thirdParties).map(([id, signer]) => ({ id, signer })))),
      );
    } catch (e) {
      fail.setup.push(reasonOf(e));
      return finish(fail, startedAt, null, "setup");
    }
    console.log(
      `Setup: the backend on hei_replay, port 3101, and the indexer, logs in ${path.relative(ROOT, full.logs)}/. ` +
        "student_ids for S001 to S100, TP1 to TP3 applied through POST /third-party/apply.",
    );
  }

  // Contracts-only mode. The full mode replaces the three hooks (scripts/replayFull.ts).
  const badgeToken = new Map<string, number>();
  const hooks: Hooks = full
    ? full.hooks(year, badgeToken)
    : {
        beforeDefine: async () => {
          // Nothing to pin: the hash goes on the ledger, the document stays in simulation/metadata.
        },
        beforeWeek: async () => [],
        mint: async (student, tokenId, commitment) =>
          (await skillBadge.connect(oracle).mintBadge(wallet.get(student)!.address, tokenId, commitment)).wait(),
      };

  // ─── Setup: wallets and definitions ───────────────────────────────────────
  for (const [tp, s] of Object.entries(thirdParties))
    await send(
      {
        phase: "setup",
        week: "",
        event: "anchorThirdParty",
        signer: "administrator",
        contract: "IdentityRegistry",
        fn: "anchorThirdParty",
      },
      async () => (await registry.connect(admin).anchorThirdParty(s.address)).wait(),
    ).then(rc => rc || fail.setup.push(`anchorThirdParty ${tp} refused`));
  for (const s of students)
    await send(
      {
        phase: "setup",
        week: "",
        event: "anchorStudent",
        signer: "registrar",
        contract: "IdentityRegistry",
        fn: "anchorStudent",
      },
      async () => (await registry.connect(registrar).anchorStudent(wallet.get(s.id)!.address)).wait(),
    ).then(rc => rc || fail.setup.push(`anchorStudent ${s.id} refused`));

  console.log("Setup: 97 badges and 24 nodes, in index.json order");
  for (const d of badgeDocs) {
    const { course, badge } = badgeSpec.get(String(d.entry.id))!;
    await hooks.beforeDefine(d);
    const rc = await send(
      {
        phase: "setup",
        week: "",
        event: "defineBadge",
        signer: "administrator",
        contract: "SkillBadge",
        fn: "defineBadge",
      },
      async () =>
        (
          await skillBadge.connect(admin).defineBadge({
            seasonId: seasonId(course.season),
            courseId: ethers.id(course.code),
            badgeCode: ethers.id(badge.id),
            skillIds: Object.keys(badge.skillPoints).map(t => ethers.id(t)),
            points: Object.values(badge.skillPoints) as number[],
            metadataCID: "0x" + d.entry.sha256,
          })
        ).wait(),
    );
    const [tokenId] = emitted(rc, "SkillBadge", "BadgeDefined");
    if (tokenId) badgeToken.set(badge.id, tokenId);
  }
  for (const d of nodeDocs) {
    const node = nodeSpec.get(Number(d.entry.id));
    await hooks.beforeDefine(d);
    const rc = await send(
      {
        phase: "setup",
        week: "",
        event: "defineNode",
        signer: "administrator",
        contract: "SkillGraph",
        fn: "defineNode",
      },
      async () =>
        (
          await skillGraph.connect(admin).defineNode({
            seasonId: seasonId(graphFile.definedInSeason),
            nodeCode: ethers.id(node.name),
            skillIds: Object.keys(node.threshold).map(t => ethers.id(t)),
            points: Object.values(node.threshold) as number[],
            prerequisiteGroups: node.prerequisiteGroups,
            metadataCID: "0x" + d.entry.sha256,
            versionOf: 0,
          })
        ).wait(),
    );
    const [nodeId] = emitted(rc, "SkillGraph", "NodeDefined");
    if (nodeId !== node.id) fail.setup.push(`node ${node.id} was defined as token ${nodeId ?? "none"}`);
  }

  // Token IDs, uri() and every definition read back against its document.
  for (const [i, d] of badgeDocs.entries()) {
    const id = i + 1;
    const doc = d.doc;
    if (badgeToken.get(doc.specId) !== id)
      fail.setup.push(`badge ${doc.specId} is token ${badgeToken.get(doc.specId)}, not ${id}`);
    if ((await skillBadge.uri(id)) !== `ipfs://f01551220${d.entry.sha256}`)
      fail.setup.push(`badge ${id}: uri() differs`);
    const def = await skillBadge.badgeDefinitions(id);
    if (def.seasonId !== seasonId(doc.season.number)) fail.setup.push(`badge ${id}: season differs from its document`);
    if (def.courseId !== ethers.id(doc.course.code) || def.badgeCode !== ethers.id(doc.specId))
      fail.setup.push(`badge ${id}: course or code differs from its document`);
    const ids = await skillBadge.getSkillIds(id);
    if (
      !same(
        [...ids],
        doc.skillPoints.map((p: any) => ethers.id(p.skillType)),
      )
    )
      fail.setup.push(`badge ${id}: skill types differ from its document`);
    for (const p of doc.skillPoints)
      if (Number(await skillBadge.getSkillPoints(id, ethers.id(p.skillType))) !== p.points)
        fail.setup.push(`badge ${id}: ${p.skillType} points differ from its document`);
  }
  for (const [i, d] of nodeDocs.entries()) {
    const id = i + 1;
    const doc = d.doc;
    if (Number(d.entry.id) !== id) fail.setup.push(`index.json lists node ${d.entry.id} in position ${id}`);
    if ((await skillGraph.uri(id)) !== `ipfs://f01551220${d.entry.sha256}`)
      fail.setup.push(`node ${id}: uri() differs`);
    const def = await skillGraph.nodeDefinitions(id);
    if (def.seasonId !== seasonId(doc.season.number)) fail.setup.push(`node ${id}: season differs from its document`);
    if (def.nodeCode !== ethers.id(doc.name)) fail.setup.push(`node ${id}: code differs from its document`);
    const ids = await skillGraph.getThresholdSkillIds(id);
    if (
      !same(
        [...ids],
        doc.threshold.map((p: any) => ethers.id(p.skillType)),
      )
    )
      fail.setup.push(`node ${id}: threshold types differ from its document`);
    for (const p of doc.threshold)
      if (Number(await skillGraph.getThresholdPoints(id, ethers.id(p.skillType))) !== p.points)
        fail.setup.push(`node ${id}: ${p.skillType} threshold differs from its document`);
    const groups = (await skillGraph.getPrerequisiteGroups(id)).map(g => g.map(Number));
    if (JSON.stringify(groups) !== JSON.stringify(doc.prerequisiteGroups.map((g: any[]) => g.map(n => n.id))))
      fail.setup.push(`node ${id}: prerequisite groups differ from its document`);
    if (Number(await skillGraph.getVersionOf(id)) !== (doc.versionOf || id))
      fail.setup.push(`node ${id}: versionOf differs from its document`);
  }
  // The deploy scripts anchor no student: the setup anchors exactly the students of the year.
  const studentAnchors = rows.filter(r => r.fn === "anchorStudent").length;
  if (studentAnchors !== students.length)
    fail.setup.push(`${studentAnchors} students anchored, not ${students.length}`);
  if (fail.setup.length) return finish(fail, startedAt, null, "setup");
  const setupCount = rows.length;
  console.log(`Setup: ${setupCount} transactions, every definition matches its document.`);

  // ─── The year ──────────────────────────────────────────────────────────────
  console.log(`Year: ${year.events.length} events`);
  const signerOf = (by: string): HardhatEthersSigner =>
    by === "oracle" ? oracle : by === "admin" ? admin : (thirdParties[by] ?? wallet.get(by)!);
  const labelOf = (by: string) => (by === "admin" ? "administrator" : by);
  const allocations = new Map<string, { week: number; tokenIds: number[] }>();
  const mints: { student: string; tokenId: number; commitment: string }[] = [];
  const pathIds: number[] = [];
  const walkProblems: string[] = [];
  const checkId = (rc: TransactionReceipt | null, contract: string, event: string, want: number, what: string) => {
    const got = emitted(rc, contract, event)[0];
    if (rc && got !== want) walkProblems.push(`${what}: the contract emitted ${event} ${got}, the event says ${want}`);
  };

  let week = 0;
  for (const [k, e] of year.events.entries()) {
    if (e.week !== week) {
      week = e.week;
      walkProblems.push(...(await hooks.beforeWeek(week)));
    }
    const base = {
      phase: "year" as const,
      week: e.week as number,
      event: e.type as string,
      signer: labelOf(e.by),
      payer: PAYER[e.type],
    };
    const by = signerOf(e.by);
    switch (e.type) {
      case "mintBadge": {
        const tokenId = badgeToken.get(e.badge)!;
        const commitment = gradeCommitment(studentOf.get(e.student)!.masterSalt, tokenId, e.grade);
        const rc = await send(
          { ...base, contract: "SkillBadge", fn: "mintBadge", op: "mintBadge", student: e.student },
          () => hooks.mint(e.student, tokenId, commitment),
        );
        if (rc) mints.push({ student: e.student, tokenId, commitment });
        break;
      }
      case "freezeSeason":
        await send({ ...base, contract: "SkillBadge", fn: "freezeSeason", op: "freezeSeason (SkillBadge)" }, async () =>
          (await skillBadge.connect(by).freezeSeason(seasonId(e.season))).wait(),
        );
        await send({ ...base, contract: "SkillGraph", fn: "freezeSeason", op: "freezeSeason (SkillGraph)" }, async () =>
          (await skillGraph.connect(by).freezeSeason(seasonId(e.season))).wait(),
        );
        break;
      case "allocateBadges": {
        const tokenIds: number[] = e.badges.map((b: string) => badgeToken.get(b)!);
        const tier = nodeSpec.get(e.node).tier;
        const meta = {
          ...base,
          contract: "SkillGraph",
          fn: "allocateBadges",
          op: "allocateBadges",
          tier,
          badges: tokenIds.length,
        };
        const rc = await send(meta, async () => (await skillGraph.connect(by).allocateBadges(e.node, tokenIds)).wait());
        if (rc) allocations.set(`${e.by}:${e.node}`, { week: e.week, tokenIds });
        break;
      }
      case "definePath": {
        const d = docs.get(`path:${e.path}`)!;
        await hooks.beforeDefine(d);
        const rc = await send({ ...base, contract: "SkillPath", fn: "definePath", op: "definePath" }, async () =>
          (await skillPath.connect(by).definePath(e.nodes, "0x" + d.entry.sha256)).wait(),
        );
        checkId(rc, "SkillPath", "PathDefined", e.path, `definePath ${e.path}`);
        pathIds.push(e.path);
        break;
      }
      case "defineProject": {
        const d = docs.get(`project:${e.project}`)!;
        await hooks.beforeDefine(d);
        const rc = await send({ ...base, contract: "SkillPath", fn: "defineProject", op: "defineProject" }, async () =>
          (await skillPath.connect(by).defineProject(e.slots, e.maxTeams, "0x" + d.entry.sha256)).wait(),
        );
        checkId(rc, "SkillPath", "ProjectDefined", e.project, `defineProject ${e.project}`);
        break;
      }
      case "approvePath":
        await send({ ...base, contract: "SkillPath", fn: "approvePath", op: "approvePath" }, async () =>
          (await skillPath.connect(by).approvePath(e.path)).wait(),
        );
        break;
      case "approveProject":
        await send({ ...base, contract: "SkillPath", fn: "approveProject", op: "approveProject" }, async () =>
          (await skillPath.connect(by).approveProject(e.project)).wait(),
        );
        break;
      case "applyToPath":
        await send({ ...base, contract: "SkillPath", fn: "applyToPath", op: "applyToPath" }, async () =>
          (await skillPath.connect(by).applyToPath(e.path)).wait(),
        );
        break;
      case "startTeam": {
        const rc = await send({ ...base, contract: "SkillPath", fn: "startTeam", op: "startTeam" }, async () =>
          (await skillPath.connect(by).startTeam(e.project, e.slot - 1)).wait(),
        );
        checkId(rc, "SkillPath", "TeamStarted", e.team, `startTeam by ${e.by}`);
        break;
      }
      case "joinTeam": {
        const rc = await send({ ...base, contract: "SkillPath", fn: "joinTeam", op: "joinTeam" }, async () =>
          (await skillPath.connect(by).joinTeam(e.team, e.slot - 1)).wait(),
        );
        if (emitted(rc, "SkillPath", "TeamFormed").length) rows[rows.length - 1].op = "joinTeam (forms the team)";
        break;
      }
      case "selectTeam":
        await send({ ...base, contract: "SkillPath", fn: "selectTeam", op: "selectTeam" }, async () =>
          (await skillPath.connect(by).selectTeam(e.team)).wait(),
        );
        break;
      default:
        walkProblems.push(`event ${k}: unknown type ${e.type}`);
    }
    if ((k + 1) % 1000 === 0) console.log(`  ${k + 1} events`);
  }
  const yearRows = rows.filter(r => r.phase === "year");
  const refused = rows.filter(r => r.status === "refused");
  console.log(`Year: ${yearRows.length} transactions, ${refused.length} refused.`);

  // ─── Ledger against expected ──────────────────────────────────────────────
  const badgeIds = range(1, badgeDocs.length);
  const nodeIds = range(1, nodeDocs.length);
  const mismatches: string[] = [...walkProblems];
  if (yearRows.length !== TOTALS.yearTransactions)
    mismatches.push(`${yearRows.length} year transactions, not ${TOTALS.yearTransactions}`);
  for (const r of refused) mismatches.push(`refused: #${r.seq} ${r.event} by ${r.signer}: ${r.reason}`);

  const held = new Map<string, { badges: number[]; nodes: number[]; applications: number[]; team: number }>();
  const teamFlags = new Map<number, { formed: boolean; selected: boolean }>();
  for (const s of students) {
    const w = wallet.get(s.id)!.address;
    const x = expectedOf.get(s.id)!;
    const badgeBalances = (
      await skillBadge.balanceOfBatch(
        badgeIds.map(() => w),
        badgeIds,
      )
    ).map(Number);
    const nodeBalances = (
      await skillGraph.balanceOfBatch(
        nodeIds.map(() => w),
        nodeIds,
      )
    ).map(Number);
    const wantBadges = new Set(x.badges.map(b => badgeToken.get(b)));
    for (const id of badgeIds)
      if (badgeBalances[id - 1] !== (wantBadges.has(id) ? 1 : 0))
        mismatches.push(
          `${s.id}: badge token ${id}, balance ${badgeBalances[id - 1]}, expected ${wantBadges.has(id) ? 1 : 0}`,
        );
    for (const id of nodeIds) {
      const want = String(id) in x.nodes;
      if (nodeBalances[id - 1] !== (want ? 1 : 0))
        mismatches.push(`${s.id}: node ${id}, balance ${nodeBalances[id - 1]}, expected ${want ? 1 : 0}`);
      if (!want) continue;
      const a = allocations.get(`${s.id}:${id}`);
      if (!a || a.week !== x.nodes[String(id)])
        mismatches.push(`${s.id}: node ${id} unlocked in week ${a?.week ?? "none"}, expected ${x.nodes[String(id)]}`);
      const onLedger = (await skillGraph.getNodeBadges(id, w)).map(Number);
      if (!a || !same(onLedger, a.tokenIds))
        mismatches.push(`${s.id}: getNodeBadges(${id}) differs from the allocation`);
    }
    const applications: number[] = [];
    for (const p of pathIds) {
      const applied = (await skillPath.getPathApplication(p, w)) > 0n;
      if (applied) applications.push(p);
      if (applied !== x.applications.includes(p))
        mismatches.push(`${s.id}: application to path ${p} is ${applied}, expected ${!applied}`);
    }
    const team = Number(await skillPath.teamOf(PROJECT, w));
    if (x.team === null) {
      if (team !== 0) mismatches.push(`${s.id}: in team ${team}, expected none`);
    } else {
      if (team !== x.team.team) mismatches.push(`${s.id}: in team ${team}, expected ${x.team.team}`);
      const t = await skillPath.getProjectTeam(x.team.team);
      if (t.members[x.team.slot - 1] !== w)
        mismatches.push(`${s.id}: not in slot ${x.team.slot} of team ${x.team.team}`);
      if (t.formed !== x.team.formed || t.selected !== x.team.selected)
        mismatches.push(
          `${s.id}: team ${x.team.team} formed ${t.formed} selected ${t.selected}, expected ${x.team.formed} ${x.team.selected}`,
        );
      teamFlags.set(x.team.team, { formed: x.team.formed, selected: x.team.selected });
    }
    held.set(s.id, {
      badges: badgeIds.filter(id => badgeBalances[id - 1] === 1),
      nodes: nodeIds.filter(id => nodeBalances[id - 1] === 1),
      applications,
      team,
    });
  }
  for (const m of mints) {
    const onLedger = await skillBadge.gradeCommitments(wallet.get(m.student)!.address, m.tokenId);
    if (onLedger !== m.commitment) mismatches.push(`${m.student}: grade commitment of token ${m.tokenId} differs`);
  }
  const all = [...held.values()];
  const ledgerTotals = {
    badges: sum(all.map(h => h.badges.length)),
    nodes: sum(all.map(h => h.nodes.length)),
    applications: sum(all.map(h => h.applications.length)),
    teamMembers: all.filter(h => h.team !== 0).length,
    teams: Number(await skillPath.nextTeamId()) - 1,
    mints: mints.length,
  };
  const expectedTotals = {
    badges: sum(year.expected.map((x: Expected) => x.badges.length)),
    nodes: sum(year.expected.map((x: Expected) => Object.keys(x.nodes).length)),
    applications: sum(year.expected.map((x: Expected) => x.applications.length)),
    teamMembers: year.expected.filter((x: Expected) => x.team !== null).length,
    teams: new Set(year.expected.filter((x: Expected) => x.team).map((x: Expected) => x.team!.team)).size,
  };
  for (const [k, v] of Object.entries(expectedTotals)) {
    const onLedger = (ledgerTotals as Record<string, number>)[k];
    const given = (TOTALS as Record<string, number>)[k];
    if (onLedger !== v || v !== given) mismatches.push(`total ${k}: ledger ${onLedger}, expected ${v}, script ${given}`);
  }
  if (ledgerTotals.mints !== TOTALS.badges)
    mismatches.push(`${ledgerTotals.mints} grade commitments checked, not ${TOTALS.badges}`);
  for (const p of pathIds)
    if ((await skillPath.getCompetencyPath(p)).status !== 1n) mismatches.push(`path ${p} is not open`);
  if ((await skillPath.getProject(PROJECT)).status !== 2n) mismatches.push(`project ${PROJECT} has not started`);
  for (const id of range(1, ledgerTotals.teams)) {
    const t = await skillPath.getProjectTeam(id);
    const want = teamFlags.get(id) ?? { formed: false, selected: false };
    if (t.formed !== want.formed || t.selected !== want.selected)
      mismatches.push(
        `team ${id}: formed ${t.formed} selected ${t.selected}, expected ${want.formed} ${want.selected}`,
      );
  }
  fail.ledger.push(...mismatches);

  // ─── Reads: recompute every competency from the ledger alone ──────────────
  const reads: { student: string; node: number; tier: string; calls: number }[] = [];
  for (const s of students) {
    const w = wallet.get(s.id)!.address;
    for (const node of held.get(s.id)!.nodes) {
      let calls = 0;
      const tokens = (await skillGraph.getNodeBadges(node, w)).map(Number);
      calls++;
      const types = await skillGraph.getThresholdSkillIds(node);
      calls++;
      const amounts: number[] = [];
      for (const t of types) {
        amounts.push(Number(await skillGraph.getThresholdPoints(node, t)));
        calls++;
      }
      const sums = types.map(() => 0);
      for (const b of tokens)
        for (const [i, t] of types.entries()) {
          sums[i] += Number(await skillBadge.getSkillPoints(b, t));
          calls++;
        }
      if (sums.some((v, i) => v < amounts[i])) fail.reads.push(`${s.id}, node ${node}: a threshold is not met`);
      reads.push({ student: s.id, node, tier: nodeSpec.get(node).tier, calls });
    }
  }
  if (reads.length !== TOTALS.nodes) fail.reads.push(`${reads.length} nodes recomputed, not ${TOTALS.nodes}`);

  // ─── Spot checks ──────────────────────────────────────────────────────────
  const spotWallet = wallet.get(SPOT.student)!.address;
  const spotMint = year.events.find(
    (e: any) => e.type === "mintBadge" && e.student === SPOT.student && e.badge === SPOT.badge,
  );
  if (badgeToken.get(SPOT.badge) !== SPOT.tokenId) fail.spot.push(`${SPOT.badge} is not token ${SPOT.tokenId}`);
  if (!spotMint || spotMint.grade !== SPOT.grade || spotMint.week !== SPOT.week)
    fail.spot.push(`${SPOT.student} ${SPOT.badge}: not graded ${SPOT.grade} in week ${SPOT.week}`);
  const spotCommitment = await skillBadge.gradeCommitments(spotWallet, SPOT.tokenId);
  if (spotCommitment !== SPOT.commitment)
    fail.spot.push(`gradeCommitments(${SPOT.student}, ${SPOT.tokenId}) is ${spotCommitment}`);
  const spotBadges = (await skillGraph.getNodeBadges(SPOT.node, spotWallet)).map(Number);
  if (!same(spotBadges, SPOT.nodeBadges))
    fail.spot.push(`getNodeBadges(${SPOT.node}, ${SPOT.student}) is [${spotBadges}]`);
  const spotReads = reads.find(r => r.student === SPOT.student && r.node === SPOT.node)?.calls;
  if (spotReads !== SPOT.calls)
    fail.spot.push(`recomputing node ${SPOT.node} of ${SPOT.student} took ${spotReads} calls`);

  // ─── Summary ──────────────────────────────────────────────────────────────
  const ok = (r: Row) => r.status === "ok";
  const gasOf = (rs: Row[]) => rs.filter(ok).map(r => r.gas as number);
  const setupRows = rows.filter(r => r.phase === "setup");
  const deployment = [];
  for (const n of names) {
    const runtime = (ethers.getBytes(await ethers.provider.getCode(address[n])) as Uint8Array).length;
    const gas = setupRows.find(r => r.contract === n && r.fn === "deploy")?.gas;
    deployment.push({ contract: n, gas, runtimeBytes: runtime, marginBytes: SIZE_LIMIT - runtime });
  }
  const byKey = (rs: Row[], key: (r: Row) => string, order: string[] = []) => {
    const keys = [...order, ...new Set(rs.map(key))].filter((k, i, a) => a.indexOf(k) === i);
    return keys.map(k => ({ key: k, ...stats(gasOf(rs.filter(r => key(r) === k))) })).filter(s => s.count > 0);
  };
  const yearGas = byKey(yearRows, r => r.op!, YEAR_OPS).map(({ key, ...s }) => ({ operation: key, ...s }));
  const allocRows = yearRows.filter(r => r.op === "allocateBadges");
  const allocateByTier = byKey(allocRows, r => r.tier!, TIERS).map(({ key, ...s }) => ({ tier: key, ...s }));
  const allocateByBadges = byKey(allocRows, r => String(r.badges), range(1, 12).map(String)).map(({ key, ...s }) => ({
    badges: Number(key),
    ...s,
  }));

  const perStudent = students.map(s => {
    const paid = sum(gasOf(yearRows.filter(r => r.signer === s.id)));
    const mintsGas = sum(gasOf(yearRows.filter(r => r.op === "mintBadge" && r.student === s.id)));
    return { s, group: groupOf(s), paid, mints: mintsGas, both: paid + mintsGas };
  });
  const studentGas = (filter: (p: (typeof perStudent)[number]) => boolean) => {
    const ps = perStudent.filter(filter);
    const pick = (k: "paid" | "mints" | "both") => {
      const { min, mean, max } = stats(ps.map(p => p[k]));
      return { min, mean, max };
    };
    return { students: ps.length, student: pick("paid"), oracleMints: pick("mints"), both: pick("both") };
  };
  const archetypeIds = [...archetypes.keys()];
  const studentYearGas = {
    byGroup: GROUPS.map(g => ({ group: g, ...studentGas(p => p.group === g) })),
    byArchetype: archetypeIds.map(a => ({ archetype: a, ...studentGas(p => p.s.archetype === a) })),
    all: studentGas(() => true),
  };
  const payerTotals = (rs: Row[], payers: string[], payerOf: (r: Row) => string) =>
    payers.map(p => {
      const g = gasOf(rs.filter(r => payerOf(r) === p));
      return { payer: p, transactions: g.length, gas: sum(g) };
    });
  const cohortYearGas = {
    year: { transactions: gasOf(yearRows).length, gas: sum(gasOf(yearRows)) },
    yearByPayer: payerTotals(yearRows, PAYERS, r => r.payer!),
  };
  // The setup in two parts: the repo's deploy scripts, then the cohort of the simulated year.
  const setupPart = (rs: Row[], payers: string[]) => ({
    transactions: gasOf(rs).length,
    gas: sum(gasOf(rs)),
    byPayer: payerTotals(rs, payers, r => r.signer),
    byFunction: byKey(rs, r => `${r.contract}.${r.fn}`).map(({ key, ...s }) => ({ function: key, ...s })),
  });
  const deployRows = setupRows.filter(r => r.event === "deploy scripts");
  const cohortRows = setupRows.filter(r => r.event !== "deploy scripts");
  const setup = {
    deployScripts: setupPart(deployRows, ["deployer", "administrator"]),
    cohortSetup: setupPart(cohortRows, ["administrator", "registrar"]),
  };
  const outcome = (filter: (s: Student) => boolean) => {
    const ss = students.filter(filter);
    const h = ss.map(s => held.get(s.id)!);
    const mean = (xs: number[]) => Math.round((sum(xs) / Math.max(xs.length, 1)) * 10) / 10;
    const allTargets = ss.filter(s =>
      archetypes.get(s.archetype).targetNodes.every((n: number) => held.get(s.id)!.nodes.includes(n)),
    ).length;
    return {
      students: ss.length,
      meanBadges: mean(h.map(x => x.badges.length)),
      meanNodes: mean(h.map(x => x.nodes.length)),
      allTargetNodes: allTargets,
      applications: sum(h.map(x => x.applications.length)),
      teamSlots: h.filter(x => x.team !== 0).length,
    };
  };
  const outcomes = {
    byArchetype: archetypeIds.map(a => ({ archetype: a, ...outcome(s => s.archetype === a) })),
    byGroup: GROUPS.map(g => ({ group: g, ...outcome(s => groupOf(s) === g) })),
  };
  const readStats = (rs: typeof reads) => {
    const { count, min, mean, max, total } = stats(
      rs.map(r => r.calls),
      2,
    );
    return { nodes: count, min, mean, max, calls: total };
  };
  const config = hre.config.solidity.compilers[0];
  const summary = {
    mode: MODE,
    provenance: {
      contractsCommit: execSync("git log -1 --format=%H -- packages/hardhat/contracts", { cwd: ROOT })
        .toString()
        .trim(),
      solc: config.version,
      optimizerRuns: config.settings?.optimizer?.runs,
      evmVersion: config.settings?.evmVersion,
      openzeppelin: packageVersion("@openzeppelin/contracts"),
      hardhat: packageVersion("hardhat"),
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      simulatedYearSha256: yearSha,
      metadataIndexSha256: sha256Hex(indexBytes),
    },
    transactions: {
      deployScripts: deployRows.length,
      cohortSetup: cohortRows.length,
      year: yearRows.length,
      refused: refused.length,
    },
    deployment,
    setup,
    yearGas,
    allocateBadgesByTier: allocateByTier,
    allocateBadgesByBadgeCount: allocateByBadges,
    studentYearGas,
    cohortYearGas,
    outcomes,
    reads: {
      all: readStats(reads),
      byTier: TIERS.map(t => ({ tier: t, ...readStats(reads.filter(r => r.tier === t)) })),
      allThresholdsMet: fail.reads.length === 0,
      spotCheck: { student: SPOT.student, node: SPOT.node, calls: spotReads },
    },
    refused: refused.map(r => ({ seq: r.seq, week: r.week, event: r.event, signer: r.signer, reason: r.reason })),
    mismatches,
  };

  // ─── Outputs ──────────────────────────────────────────────────────────────
  const txlog = csv([
    ["seq", "phase", "week", "event", "signer", "contract", "function", "gas_used", "status", "revert_reason", "block"],
    ...rows.map(r => [r.seq, r.phase, r.week, r.event, r.signer, r.contract, r.fn, r.gas, r.status, r.reason, r.block]),
  ]);
  const studentsCsv = csv([
    [
      "student",
      "archetype",
      "group",
      "badges",
      "nodes",
      "target_nodes_held",
      "target_nodes",
      "applications",
      "team",
      "slot",
      "gas_student",
      "gas_oracle_mints",
    ],
    ...perStudent.map(p => {
      const h = held.get(p.s.id)!;
      const targets: number[] = archetypes.get(p.s.archetype).targetNodes;
      const slot = expectedOf.get(p.s.id)!.team?.slot ?? "";
      return [
        p.s.id,
        p.s.archetype,
        p.group,
        h.badges.length,
        h.nodes.length,
        targets.filter(n => h.nodes.includes(n)).length,
        targets.length,
        h.applications.join(" "),
        h.team || "",
        h.team ? slot : "",
        p.paid,
        p.mints,
      ];
    }),
  ]);

  // ─── Full mode: the checks of the whole stack ─────────────────────────────
  let fullMode: any = null;
  if (full) {
    // The same transactions as the contracts-only mode, signed by the same accounts, with the same gas.
    for (const [file, text] of [
      ["txlog.csv", txlog],
      ["students.csv", studentsCsv],
    ]) {
      const other = path.join(ROOT, "simulation", "replay", "contracts", file);
      if (!fs.existsSync(other))
        fail.same.push(`simulation/replay/contracts/${file} is missing: run yarn replay first`);
      else fail.same.push(...differingLines(file, fs.readFileSync(other, "utf8"), text, ["contracts-only", "full"]));
    }
    console.log(
      `Documents: ${full.pinned} pinned through the backend, ${index.length} read back with GET /metadata/:id`,
    );
    fail.documents.push(
      ...(await full.checkDocuments(index, async e => {
        const id = Number(e.id);
        if (e.kind === "badge") return (await skillBadge.badgeDefinitions(badgeToken.get(String(e.id))!)).metadataCID;
        if (e.kind === "node") return (await skillGraph.nodeDefinitions(id)).metadataCID;
        if (e.kind === "path") return (await skillPath.getCompetencyPath(id)).metadataCID;
        return (await skillPath.getProject(id)).metadataCID;
      })),
    );
    // The ledger view, once the indexer has handled the last block.
    const head = await ethers.provider.getBlockNumber();
    const indexed = await full.waitForIndexer(head);
    console.log(`Ledger view: the indexer reached block ${head} after a wait of ${indexed.seconds} s`);
    fail.view.push(...indexed.problems);
    if (!indexed.problems.length) {
      const freezeBlock = (contract: string, season: number) => {
        const e = year.events.find((x: any) => x.type === "freezeSeason" && x.season === season);
        return (yearRows.find(r => r.event === "freezeSeason" && r.contract === contract && r.week === e?.week)
          ?.block ?? null) as number | null;
      };
      const want: LedgerView = {
        seasons: [...new Set([...courses.map(c => c.season), graphFile.definedInSeason])]
          .sort((a, b) => a - b)
          .map(n => ({
            seasonId: seasonId(n),
            label: seasonLabel(n),
            badgesFrozenBlock: freezeBlock("SkillBadge", n),
            nodesFrozenBlock: freezeBlock("SkillGraph", n),
          })),
        badges: badgeDocs.map((d, i) => {
          const { course, badge } = badgeSpec.get(String(d.entry.id))!;
          return {
            tokenId: i + 1,
            specId: badge.id,
            courseCode: course.code,
            assessment: badge.assessment,
            seasonId: seasonId(course.season),
            metadataCID: "0x" + d.entry.sha256,
            skills: Object.entries(badge.skillPoints).map(([t, p]) => [ethers.id(t), p as number]),
          };
        }),
        nodes: [],
        studentBadges: [],
        competencies: [],
        paths: [],
        applications: [],
        projects: [],
        teams: [],
        weekOfBlock: new Map(yearRows.filter(ok).map(r => [r.block as number, r.week as number])),
      };
      // Thresholds and prerequisite groups as the ledger holds them.
      for (const d of nodeDocs) {
        const id = Number(d.entry.id);
        const threshold: [string, number][] = [];
        for (const t of await skillGraph.getThresholdSkillIds(id))
          threshold.push([t, Number(await skillGraph.getThresholdPoints(id, t))]);
        want.nodes.push({
          nodeId: id,
          name: nodeSpec.get(id).name,
          tier: nodeSpec.get(id).tier,
          seasonId: seasonId(graphFile.definedInSeason),
          metadataCID: "0x" + d.entry.sha256,
          versionOf: id,
          threshold,
          groups: (await skillGraph.getPrerequisiteGroups(id)).map(g => g.map(Number)),
        });
      }
      // Each student's badges, minted in the week of the assessment, and nodes, unlocked in the week expected gives.
      for (const s of students) {
        const w = wallet.get(s.id)!.address;
        const x = expectedOf.get(s.id)!;
        for (const b of x.badges) {
          const tokenId = badgeToken.get(b)!;
          const week = year.assessments.find(
            (a: any) => a.student === s.id && a.badge === b && a.status === "taken",
          ).week;
          want.studentBadges.push({
            wallet: w,
            tokenId,
            gradeCommitment: await skillBadge.gradeCommitments(w, tokenId),
            week,
          });
        }
        for (const [node, week] of Object.entries(x.nodes))
          want.competencies.push({
            wallet: w,
            nodeId: Number(node),
            badgeIds: allocations.get(`${s.id}:${node}`)?.tokenIds ?? [],
            week,
          });
      }
      // The posts as their events and documents, the applications and teams as expected gives.
      const post = (kind: string, id: number) => docs.get(`${kind}:${id}`)!;
      const projectOfTeam = new Map<number, number>(
        year.events.filter((e: any) => e.type === "startTeam").map((e: any) => [e.team, e.project]),
      );
      for (const e of year.events.filter((x: any) => x.type === "definePath"))
        want.paths.push({
          pathId: e.path,
          status: "open",
          nodeIds: e.nodes,
          metadataCID: "0x" + post("path", e.path).entry.sha256,
          name: post("path", e.path).doc.name,
        });
      for (const e of year.events.filter((x: any) => x.type === "defineProject")) {
        const selected = year.events.filter(
          (x: any) => x.type === "selectTeam" && projectOfTeam.get(x.team) === e.project,
        );
        want.projects.push({
          projectId: e.project,
          status: selected.length === e.maxTeams ? "started" : "open",
          maxTeams: e.maxTeams,
          selectedCount: selected.length,
          slots: e.slots,
          metadataCID: "0x" + post("project", e.project).entry.sha256,
          name: post("project", e.project).doc.name,
        });
      }
      const teams = new Map<number, LedgerView["teams"][number]>();
      for (const s of students) {
        const w = wallet.get(s.id)!.address;
        const x = expectedOf.get(s.id)!;
        for (const p of x.applications)
          want.applications.push({ pathId: p, wallet: w, appliedAt: Number(await skillPath.getPathApplication(p, w)) });
        if (!x.team) continue;
        const team: LedgerView["teams"][number] = teams.get(x.team.team) ?? {
          teamId: x.team.team,
          projectId: projectOfTeam.get(x.team.team)!,
          formed: x.team.formed,
          selected: x.team.selected,
          members: [],
        };
        team.members.push([x.team.slot - 1, w]);
        teams.set(x.team.team, team);
      }
      want.teams = [...teams.values()].sort((a, b) => a.teamId - b.teamId);
      for (const t of want.teams) t.members.sort((a, b) => a[0] - b[0]);
      fail.view.push(...(await full.checkLedgerView(want)));
    }
    const privateData = await full.checkPrivateData(year, mints, (w, t) => skillBadge.gradeCommitments(w, t), SPOT);
    fail.private.push(...privateData.problems);
    console.log(privateData.example);
    fail.disclosure.push(...(await full.checkNoDisclosure(spotWallet)));
    // The counts of the stack for the summary, before the next check registers a student and erases S100.
    fullMode = await full.counts();

    // Registration and disclosure, after every other check and after the counts of the summary.
    const registration = await full.checkRegistrationAndDisclosure({
      student: id => wallet.get(id)!,
      thirdParty: id => thirdParties[id],
      account: i => signers[i],
      isStudent: w => registry.hasRole(role.STUDENT_ROLE, w),
      commitmentOf: (w, t) => skillBadge.gradeCommitments(w, t),
      mintedTo: id => mints.filter(m => m.student === id).map(m => m.tokenId),
      spot: SPOT,
    });
    for (const line of registration.lines) console.log(`Registration and disclosure: ${line}`);
    fail.registration.push(...registration.problems);
    fullMode.registrationAndDisclosure = registration.lines;
  }
  const finalSummary = fullMode ? { ...summary, fullMode } : summary;
  const summaryJson = JSON.stringify(finalSummary, null, 2) + "\n";

  const reproduced = compareWithCommitted(txlog, summaryJson);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "txlog.csv"), txlog);
  fs.writeFileSync(path.join(OUT, "students.csv"), studentsCsv);
  fs.writeFileSync(path.join(OUT, "summary.json"), summaryJson);
  fs.writeFileSync(path.join(OUT, "summary.md"), summaryMarkdown(finalSummary));
  console.log(`Outputs: ${path.relative(ROOT, OUT)}/ txlog.csv, students.csv, summary.json, summary.md`);
  return finish(fail, startedAt, reproduced, null);
}

// Compares the new txlog.csv and summary.json with the files already in OUT.
function compareWithCommitted(
  txlog: string,
  summaryJson: string,
): { status: "pass" | "fail" | "none"; lines: string[] } {
  const oldTxlogFile = path.join(OUT, "txlog.csv");
  const oldSummaryFile = path.join(OUT, "summary.json");
  if (!fs.existsSync(oldTxlogFile) && !fs.existsSync(oldSummaryFile)) return { status: "none", lines: [] };
  const oldTxlog = fs.existsSync(oldTxlogFile) ? fs.readFileSync(oldTxlogFile, "utf8") : "";
  const lines = differingLines("txlog.csv", oldTxlog, txlog, ["committed", "now"]);
  const oldSummary = fs.existsSync(oldSummaryFile) ? fs.readFileSync(oldSummaryFile, "utf8") : "";
  if (oldSummary !== summaryJson) {
    const a = flatten(oldSummary ? JSON.parse(oldSummary) : {});
    const b = flatten(JSON.parse(summaryJson));
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
    for (const k of keys.slice(0, 5)) lines.push(`summary.json ${k}: committed ${a[k] ?? "-"}, now ${b[k] ?? "-"}`);
    if (keys.length === 0) lines.push("summary.json differs in formatting only");
  }
  return { status: lines.length ? "fail" : "pass", lines };
}

// The first lines where two texts differ, each with its label.
function differingLines(file: string, a: string, b: string, [labelA, labelB]: [string, string], max = 3): string[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(x.length, y.length) && out.length < max; i++)
    if (x[i] !== y[i]) out.push(`${file} line ${i + 1}: ${labelA} "${x[i] ?? ""}", ${labelB} "${y[i] ?? ""}"`);
  return out;
}

function finish(
  fail: Failures,
  startedAt: number,
  reproduced: { status: "pass" | "fail" | "none"; lines: string[] } | null,
  stoppedAt: Check | null,
) {
  const yarn = /yarn\/(\S+)/.exec(process.env.npm_config_user_agent ?? "")?.[1] ?? "unknown";
  console.log(`\nNode ${process.version}, Yarn ${yarn}, run time ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  let failed = false;
  let stopped = false;
  for (const [k, title] of CHECKS) {
    if (stopped) {
      console.log(`---- ${title}: not run`);
      continue;
    }
    if (fail[k].length === 0) console.log(`PASS ${title}`);
    else {
      failed = true;
      console.log(`FAIL ${title}: ${fail[k].length} problem(s)`);
      for (const m of fail[k].slice(0, 10)) console.log(`     ${m}`);
    }
    if (stoppedAt === k) stopped = true;
  }
  if (!reproduced) console.log("---- reproduced: not run");
  else if (reproduced.status === "none") console.log("---- reproduced: no committed outputs yet");
  else if (reproduced.status === "pass") console.log("PASS reproduced");
  else {
    failed = true;
    console.log("FAIL reproduced");
    for (const l of reproduced.lines) console.log(`     ${l}`);
  }
  if (failed || stoppedAt) process.exitCode = 1;
}

function summaryMarkdown(s: any): string {
  const table = (head: string[], rows: (string | number)[][]) =>
    [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map(r => `| ${r.join(" | ")} |`)].join(
      "\n",
    );
  const statCols = (x: Stats) => [fmt(x.count), fmt(x.min), fmt(x.mean), fmt(x.max), fmt(x.total)];
  const triple = (x: { min: number; mean: number; max: number }) => `${fmt(x.min)} / ${fmt(x.mean)} / ${fmt(x.max)}`;
  const p = s.provenance;
  const out: string[] = [];
  const fullMode = s.mode === "full";
  out.push(`# Replay of the simulated year, ${fullMode ? "full" : "contracts-only"} mode`, "");
  out.push(
    `Written by \`packages/hardhat/scripts/replay.ts\` (\`${fullMode ? "yarn replay:full" : "yarn replay"}\`). See \`docs/REPLAY.md\`. Gas in gas units.`,
    "",
  );
  out.push("## Provenance", "");
  out.push(
    table(
      ["Item", "Value"],
      [
        ["Contracts", `\`${p.contractsCommit}\`, the last commit that touched \`packages/hardhat/contracts\``],
        ["Solidity", `${p.solc}, optimizer ${p.optimizerRuns} runs, EVM ${p.evmVersion}`],
        ["OpenZeppelin Contracts", p.openzeppelin],
        ["Hardhat", `${p.hardhat}, ${fullMode ? "`yarn chain` node" : "in-process network"}, chain ID ${p.chainId}`],
        ["`simulatedYear.json` SHA-256", `\`${p.simulatedYearSha256}\``],
        ["`metadata/index.json` SHA-256", `\`${p.metadataIndexSha256}\``],
      ],
    ),
    "",
  );
  out.push("## Transactions", "");
  out.push(
    table(
      ["Deploy scripts", "Cohort setup", "Year", "Refused", "Mismatches with expected"],
      [
        [
          fmt(s.transactions.deployScripts),
          fmt(s.transactions.cohortSetup),
          fmt(s.transactions.year),
          s.transactions.refused,
          s.mismatches.length,
        ],
      ],
    ),
    "",
  );
  out.push("## Deployment", "");
  out.push(
    table(
      ["Contract", "Deployment gas", "Runtime bytecode (bytes)", "Margin to 24,576 bytes"],
      s.deployment.map((d: any) => [
        d.contract,
        fmt(d.gas),
        fmt(d.runtimeBytes),
        `${fmt(d.marginBytes)} (${((d.runtimeBytes / SIZE_LIMIT) * 100).toFixed(1)}% used)`,
      ]),
    ),
    "",
  );
  out.push("## Setup", "");
  out.push(
    "Before week 1. The deploy scripts (`packages/hardhat/deploy/`) deploy the four contracts, anchor the registrar and the oracle, and renounce the root role. The cohort setup anchors the third parties and the students, and defines the badges and the nodes.",
    "",
  );
  const part = (name: string, x: any) => [
    ...x.byPayer.map((p: any) => [name, p.payer, fmt(p.transactions), fmt(p.gas)]),
    [`**${name}**`, "", fmt(x.transactions), fmt(x.gas)],
  ];
  out.push(
    table(
      ["Part", "Payer", "Transactions", "Gas"],
      [
        ...part("Deploy scripts", s.setup.deployScripts),
        ...part("Cohort setup", s.setup.cohortSetup),
        [
          "**Setup total**",
          "",
          fmt(s.setup.deployScripts.transactions + s.setup.cohortSetup.transactions),
          fmt(s.setup.deployScripts.gas + s.setup.cohortSetup.gas),
        ],
      ],
    ),
    "",
  );
  for (const [name, x] of [
    ["Deploy scripts", s.setup.deployScripts],
    ["Cohort setup", s.setup.cohortSetup],
  ]) {
    out.push(`### ${name}, gas per function`, "");
    out.push(
      table(
        ["Function", "Count", "Min", "Mean", "Max", "Total"],
        x.byFunction.map((g: any) => [g.function, ...statCols(g)]),
      ),
      "",
    );
  }
  out.push("## Year gas per operation", "");
  out.push(
    table(
      ["Operation", "Count", "Min", "Mean", "Max", "Total"],
      [
        ...s.yearGas.map((g: any) => [g.operation, ...statCols(g)]),
        [
          "**All year transactions**",
          fmt(s.cohortYearGas.year.transactions),
          "",
          "",
          "",
          fmt(s.cohortYearGas.year.gas),
        ],
      ],
    ),
    "",
  );
  out.push("### allocateBadges by tier of the node", "");
  out.push(
    table(
      ["Tier", "Count", "Min", "Mean", "Max", "Total"],
      s.allocateBadgesByTier.map((g: any) => [g.tier, ...statCols(g)]),
    ),
    "",
  );
  out.push("### allocateBadges by number of badges", "");
  out.push(
    table(
      ["Badges", "Count", "Min", "Mean", "Max", "Total"],
      s.allocateBadgesByBadgeCount.map((g: any) => [g.badges, ...statCols(g)]),
    ),
    "",
  );
  out.push("## Gas per student-year", "");
  out.push(
    "Paid by the student (allocations, applications, team slots), the oracle's mints for the student, and both. Min / mean / max over the students of each row.",
    "",
  );
  const studentRow = (name: string, x: any) => [
    name,
    x.students,
    triple(x.student),
    triple(x.oracleMints),
    triple(x.both),
  ];
  const studentHead = ["", "Students", "Paid by the student", "Oracle's mints", "Both"];
  out.push(
    table(
      ["Behavior group", ...studentHead.slice(1)],
      [
        ...s.studentYearGas.byGroup.map((x: any) => studentRow(x.group, x)),
        studentRow("**all**", s.studentYearGas.all),
      ],
    ),
    "",
  );
  out.push(
    table(
      ["Archetype", ...studentHead.slice(1)],
      s.studentYearGas.byArchetype.map((x: any) => studentRow(x.archetype, x)),
    ),
    "",
  );
  out.push("## Gas per cohort-year", "");
  out.push(
    table(
      ["Payer", "Transactions", "Gas"],
      [
        ...s.cohortYearGas.yearByPayer.map((x: any) => [x.payer, fmt(x.transactions), fmt(x.gas)]),
        ["**Year total**", fmt(s.cohortYearGas.year.transactions), fmt(s.cohortYearGas.year.gas)],
      ],
    ),
    "",
  );
  out.push("## Outcomes", "");
  const outcomeHead = ["Students", "Mean badges", "Mean nodes", "All target nodes", "Applications", "Team slots"];
  const outcomeRow = (name: string, x: any) => [
    name,
    x.students,
    x.meanBadges,
    x.meanNodes,
    x.allTargetNodes,
    x.applications,
    x.teamSlots,
  ];
  out.push(
    table(
      ["Archetype", ...outcomeHead],
      s.outcomes.byArchetype.map((x: any) => outcomeRow(x.archetype, x)),
    ),
    "",
  );
  out.push(
    table(
      ["Behavior group", ...outcomeHead],
      s.outcomes.byGroup.map((x: any) => outcomeRow(x.group, x)),
    ),
    "",
  );
  out.push("## Reads of a third party", "");
  out.push(
    "View calls to recompute one competency from the ledger alone: `getNodeBadges`, `getThresholdSkillIds`, `getThresholdPoints` per type, `getSkillPoints` per badge and type.",
    "",
  );
  const readRow = (name: string, x: any) => [name, x.nodes, x.min, x.mean, x.max, fmt(x.calls)];
  out.push(
    table(
      ["Tier", "Nodes held", "Min calls", "Mean", "Max", "Total calls"],
      [...s.reads.byTier.map((x: any) => readRow(x.tier, x)), readRow("**all**", s.reads.all)],
    ),
    "",
  );
  out.push(
    `Every threshold met: ${s.reads.allThresholdsMet ? "yes" : "no"}. Spot check: node ${s.reads.spotCheck.node} of ${s.reads.spotCheck.student}, ${s.reads.spotCheck.calls} calls.`,
    "",
  );
  out.push("## Refused transactions", "");
  out.push(
    s.refused.length
      ? table(
          ["Seq", "Week", "Event", "Signer", "Reason"],
          s.refused.map((r: any) => [r.seq, r.week, r.event, r.signer, r.reason]),
        )
      : "None.",
    "",
  );
  out.push("## Mismatches with expected", "");
  out.push(s.mismatches.length ? s.mismatches.map((m: string) => `- ${m}`).join("\n") : "None.", "");
  if (s.fullMode) {
    const f = s.fullMode;
    out.push("## The stack, full mode", "");
    out.push(
      `Documents: ${f.documents.pinned} pinned through \`POST /metadata/pin\` before their define calls, ` +
        `${f.documents.checked} read back through \`GET /metadata/:id\`, each with the hash on the ledger and in \`index.json\`.`,
      "",
    );
    out.push(
      table(
        ["Private table", "Rows"],
        [
          ["`student_ids`", fmt(f.privateRows.student_ids)],
          ["`third_party_ids`", fmt(f.privateRows.third_party_ids)],
          [
            "`mock_academic_records`",
            `${fmt(f.privateRows.mock_academic_records)}: ${fmt(f.privateRows.processed)} processed, ` +
              `${fmt(f.privateRows.unprocessed)} below 10 unprocessed`,
          ],
          [
            "`grade_records`",
            `${fmt(f.privateRows.grade_records)}, ${fmt(f.gradeRecordsChecked)} checked against their badge salt and the ledger`,
          ],
        ],
      ),
      "",
    );
    out.push(
      table(
        ["Ledger view table", "Rows"],
        Object.entries(f.ledgerViewRows).map(([t, n]) => [`\`${t}\``, fmt(n as number)]),
      ),
      "",
    );
    out.push(
      `Indexer: ${f.mismatches.documents} document mismatches, ${f.mismatches.seasons} season mismatches. ` +
        "The counts are taken before the registration and disclosure check, which erases S100 and registers T001.",
      "",
    );
    out.push("### Registration and disclosure", "");
    out.push(f.registrationAndDisclosure.map((l: string) => `- ${l}`).join("\n"), "");
  }
  return out.join("\n");
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => full?.stop());
