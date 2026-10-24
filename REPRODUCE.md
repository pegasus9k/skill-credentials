# Reproducing the replay of the simulated year

## What the replay shows

- The credential model of the thesis runs on the platform's four smart contracts: a full simulated academic year of 100 MEEC students (Chapter 5) is replayed against them, 4,347 transactions.
- Every transaction is accepted, and the ledger ends exactly as the generation of the year expected: badges, grade commitments, recognized competencies with the badges behind them, path applications and project teams, for all 100 students.
- A third party can recompute every recognized competency from the ledger alone. The replay does it for all 545 and counts the view calls.
- It measures the gas of every operation, per student-year and per cohort-year.
- The full mode runs the same year through the whole platform: the documents on IPFS, the backend and its private tables, the event indexer and its ledger view, registration and disclosure.
- The same inputs give byte-identical outputs on any machine. They are committed in `simulation/replay/contracts/` and `simulation/replay/full/`.

The repository is https://github.com/pegasus9k/skill-credentials. The thesis cites tag `v1.0`.

## The contracts-only mode

### Requirements

- git
- Node.js 20.18.3 or later. The committed run used Node v24.22.1.
- Yarn. The repository carries Yarn 3.2.3 (`.yarn/releases`), and any installed `yarn` runs that version. With Node's Corepack: `corepack enable`.

No Python, IPFS node or database is needed.

### Steps

```bash
git clone https://github.com/pegasus9k/skill-credentials
cd skill-credentials
git checkout v1.0
yarn install
yarn replay
```

`git log -1 --format=%h -- simulation/replay/contracts` shows the commit that wrote the committed outputs. The run takes about a minute. It ends with:

```
PASS inputs
PASS setup
PASS ledger against expected
PASS spot checks
PASS reads
PASS reproduced
```

`PASS reproduced` means the new `txlog.csv` and `summary.json` are identical to the committed ones. Then `git status --short` is empty: the replay rewrote its outputs with the same bytes.

The results are in `simulation/replay/contracts/summary.md`. `docs/REPLAY.md` describes what the replay does, step by step.

## The full mode

### Requirements

Everything above, and:

- PostgreSQL 16, with the role `hei_admin` and the databases `hei_ecosystem` and `hei_replay`. `DB/setup.sh` installs Postgres on Ubuntu and creates all three. If only `hei_replay` is missing: `sudo -u postgres createdb -O hei_admin hei_replay`.
- Kubo 0.29.0, the IPFS node, initialized once with `ipfs init` and run as `ipfs daemon --offline`.
- `backend/.env`, copied from `backend/.env.example`, with the password of `hei_admin` in `DB_PASSWORD`. The two service keys of the example are those of accounts #5 and #6 of the local chain.
- The backend's packages: `npm install` in `backend/`. The indexer uses the packages of `yarn install`.

### Steps

In one terminal, a freshly started chain. Every full run needs one, at block 0:

```bash
yarn chain
```

In a second terminal:

```bash
yarn replay:full
```

The run takes about 10 minutes and ends with:

```
PASS inputs
PASS prerequisites
PASS setup
PASS ledger against expected
PASS spot checks
PASS reads
PASS same transactions
PASS documents
PASS ledger view
PASS private data
PASS no disclosure
PASS registration and disclosure
PASS reproduced
```

`PASS same transactions` means its `txlog.csv` and `students.csv` are byte-identical to the contracts-only ones. The results are in `simulation/replay/full/summary.md`, and the logs of the backend and the indexer in `simulation/replay/logs/`, which git ignores. To run it again, stop `yarn chain` (Ctrl-C) and start it again first.

The FenixEdu login needs an IST account and the application's credentials, so it is outside the replay. See `docs/FENIX_LOGIN.md`.

## Run it by hand

Every command in order, from a fresh terminal, then what a full run leaves to look at.

| Command | Where | Prints | Time |
|---|---|---|---|
| `sudo systemctl start postgresql` | once, if Postgres is not running | nothing | seconds |
| `ipfs daemon --offline` | its own terminal | `Daemon is ready` | seconds |
| `yarn chain` | its own terminal | `Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/`, the 120 accounts, then one line per request | seconds |
| `yarn test` | any | the 38 contract tests on the in-process network, `38 passing` | about 30 s |
| `yarn replay` | any | the contracts-only mode, its six PASS lines | about 40 s |
| `yarn replay:full` | any, on a freshly started `yarn chain` | the setup, the year, one line per registration and disclosure step, its thirteen PASS lines | about 10 minutes |

A full run takes about 10 minutes. If it is interrupted, run it again: every run starts from a fresh chain and database.

### After a full run

While `yarn chain` still holds the year, the ledger, IPFS and `hei_replay` can be read by hand. Two things differ from the end of the year: the registration and disclosure check erased S100's grades (no grade records, master salt NULL, its badges and commitments still on the ledger), and it registered one more student, T001, on account #110 (`0x51953940F874eFa94F92EB2d6Aed023617A07222`). That anchor is block 4583, after the year and outside `txlog.csv`. The indexer stopped at block 4582, the last of the year.

The indexer and the ledger view belong to one chain. After restarting `yarn chain`, run `yarn replay:full` again, which recreates `hei_replay`.

Start the backend on `hei_replay`, on port 3101. It reads the contract addresses the run wrote to `packages/hardhat/deployments/localhost`:

```bash
cd backend && DB_NAME=hei_replay PORT=3101 node server.js
```

The ledger view and the private tables, with the password of `backend/.env`:

```bash
psql -h localhost -U hei_admin -d hei_replay
```

```sql
-- The ledger view, written by the indexer.
SELECT last_block, document_mismatches, season_mismatches FROM indexer_state;   -- 4582, 0, 0
SELECT token_id, spec_id, badge_name, assessment, course_code, metadata_cid FROM badges WHERE token_id = 91;
                                       -- 91, COSE-2, Dispatch and Scheduling, Test 2, COSE, 0x659bd63d...d6ea
SELECT node_id, node_name, tier, version_of FROM nodes WHERE node_id = 22;      -- 22, Smart Energy Architect, Architect, 22
SELECT group_index, prerequisite_node_id FROM node_prerequisites WHERE node_id = 22 ORDER BY 1, 2;
                                       -- group 0: 18 and 20, group 1: 19 and 20
-- The private tables, written by the backend.
SELECT fenix_id, wallet_address, master_salt IS NULL AS erased FROM student_ids WHERE fenix_id IN ('S027', 'S100', 'T001');
                                       -- S027 and T001 not erased, S100 erased
SELECT count(*) FROM grade_records;    -- 3,673: the 3,703 of the year less S100's 30
```

The routes of the backend:

```bash
curl -s http://127.0.0.1:3101/student/0x1003ff39d25F2Ab16dBCc18EcE05a9B6154f65F4 | python3 -m json.tool | head -30
curl -s http://127.0.0.1:3101/nodes | python3 -m json.tool | head -40
```

The student route gives S027's wallet, degree and status, and its badges with their grade commitments and allocations: no name, email or grade. The node route gives each node with its thresholds and its prerequisite groups as a list of lists.

The COSE-2 document on IPFS, by its CID:

```bash
ipfs cat bafkreidftpld2belccgndzupico3arciwirr7vz7mzwigkw4oosiqf6w5i               # the document of simulation/metadata/badges/COSE-2.json
ipfs cat bafkreidftpld2belccgndzupico3arciwirr7vz7mzwigkw4oosiqf6w5i | sha256sum   # 659bd63d...d6ea
```

### The trace of S027

S027 is account #36, wallet `0x1003ff39d25F2Ab16dBCc18EcE05a9B6154f65F4`. Its node 22, Smart Energy Architect, rests on six badges, one of them COSE-2, token 91, graded 13.

On the ledger, in the Hardhat console on the chain, which prints each result:

```bash
yarn workspace @se-2/hardhat hardhat console --network localhost
```

```js
const at = async name => ethers.getContractAt(name, (await deployments.get(name)).address)
const graph = await at("SkillGraph"), badge = await at("SkillBadge")
const s027 = (await ethers.getSigners())[36]
;(await graph.getNodeBadges(22, s027.address)).map(Number)   // [ 20, 41, 56, 75, 79, 91 ]
await badge.getMetadataCID(91)                               // '0x659bd63d...d6ea'
await badge.gradeCommitments(s027.address, 91)               // '0x9c78aff5...2eeb'
```

In the ledger view, the same six badges:

```sql
SELECT sc.badge_ids, sc.unlocked_block FROM student_competencies sc JOIN student_ids s USING (wallet_address)
WHERE s.fenix_id = 'S027' AND sc.node_id = 22;                -- {20,41,56,75,79,91}, block 4188
```

The document of token 91 is the one on IPFS: `ipfs cat` of its CID, above, hashes to the `getMetadataCID(91)` of the ledger.

Grade 13 through the grade route, checked against its commitment, in the same console, with the backend running:

```js
const api = "http://127.0.0.1:3101"
const { nonce } = await (await fetch(`${api}/auth/nonce`)).json()
const message = ["Skill Credentials: disclose grade", `Wallet: ${s027.address}`, "Token ID: 91", `Nonce: ${nonce}`].join("\n")
const signature = await s027.signMessage(message)
const g = await (await fetch(`${api}/disclose/grade`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, signature }) })).json()
g.grade                                                      // 13
ethers.sha256(ethers.toUtf8Bytes(String(g.grade) + g.badge_salt)) === (await badge.gradeCommitments(s027.address, 91))   // true
```

## Optional checks of the inputs

- The simulated year file: `sha256sum simulation/spec/simulatedYear.json` gives `0c88b5fc231bf680f09bda32fd67a78b40b99dc9a404e17e654e3f618ae9baca`, the hash the replay checks.
- The year against the rules of the contracts, without a chain: `python3 simulation/catalogue/check_year.py` prints `CHECKS: all passed`. It needs Python 3.8 or later, NumPy, and SciPy 1.9 or later.
- The metadata documents: `python3 simulation/catalogue/build_metadata.py` writes them again from the specification files, then `git status --short simulation/metadata` is empty. Standard library only.
- The content identifiers: with Kubo (IPFS), `ipfs add --only-hash --cid-version=1 --raw-leaves` on any file of `simulation/metadata/` gives its `cid` in `simulation/metadata/index.json`.
