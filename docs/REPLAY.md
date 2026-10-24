# Replay of the simulated year

The replay drives the platform with the simulated year of Chapter 5. It has two modes, both run by `packages/hardhat/scripts/replay.ts`. To run them as a reviewer, see `REPRODUCE.md`.

| Mode | Command | Runs on | Writes | Time |
|---|---|---|---|---|
| Contracts-only | `yarn replay` | the in-process Hardhat network, nothing else | `simulation/replay/contracts/` | about 40 s |
| Full | `yarn replay:full` | a freshly started `yarn chain`, Postgres, IPFS, the backend and the event indexer | `simulation/replay/full/` | about 10 minutes |

Both modes put the same transactions on the ledger, signed by the same accounts, with the same gas: their `txlog.csv` and `students.csv` are byte-identical. The full mode also checks what the rest of the platform does with them: the documents on IPFS, the ledger view the indexer fills, the private tables of the backend, and the routes of the backend.

The full mode's code is in `packages/hardhat/scripts/replayFull.ts`, which only `yarn replay:full` loads. `yarn replay` imports no database client and reaches no database, IPFS node or backend.

## Inputs

| File | Use |
|---|---|
| `simulation/spec/simulatedYear.json` | Students, assessments, events in replay order, expected outcomes. The replay stops if its SHA-256 is not `0c88b5fc231bf680f09bda32fd67a78b40b99dc9a404e17e654e3f618ae9baca`. |
| `simulation/metadata/index.json` and the 124 documents it lists | The order of the definitions and the hash of each document. The replay hashes every file and stops if one differs from the index. |
| `simulation/spec/courses.json`, `graph.json`, `archetypes.json` | The fields of each badge and node, and the target nodes of each archetype. |

The replay also stops if a path or project of the events differs from its document (`posts/path-N.json`, `posts/project-1.json`).

## Accounts

The `hardhat` network has 120 accounts, from the default test mnemonic (`hardhat.config.ts`). `yarn chain` starts a node with the same accounts.

| Signer | Role |
|---|---|
| #0 | deployer |
| #1 | seasonal administrator |
| #5 | oracle. In the full mode, the backend's key (`ORACLE_PRIVATE_KEY`) |
| #6 | registrar. In the full mode, also the backend's key (`REGISTRAR_PRIVATE_KEY`) |
| #7 to #9 | TP1 to TP3 |
| #10 to #109 | S001 to S100, in order |
| #110 to #113 | the full mode's registration check, after the year |

## Full mode: prerequisites and fresh state

Before the setup, the full mode stops with a message if one of these fails:

- the chain at `127.0.0.1:8545` is at block 0, chain ID 31337, with 120 accounts, and the deployer's nonce is 0
- Postgres answers with the credentials of `backend/.env`, and the database `hei_replay` exists or can be created
- the IPFS API answers (`IPFS_API`, default `127.0.0.1:5001`)
- the oracle and registrar keys of `backend/.env` are those of accounts #5 and #6
- nothing answers on port 3101 yet

Settings come from `backend/.env`, the environment winning, as dotenv gives them to the backend itself. Then every run starts from fresh state:

1. `hei_replay` is recreated from `DB/schema.sql`, and `backend/setup.js` (`yarn backend:setup`) writes the skill reference list.
2. The deploy scripts run through hardhat-deploy (`deployments.run`), which writes `packages/hardhat/deployments/localhost`. `deployedContracts.ts` is not regenerated.
3. The backend starts as a child process on `hei_replay` and port 3101, then the event indexer, on the same database, reading the documents through that backend. Their logs go to `simulation/replay/logs/`, which git ignores. Both stop at the end, also after a failure.

## Setup, before week 1

In the steps below, `id(x)` is `ethers.id(x)`, the keccak-256 of the UTF-8 string.

1. The repo's deploy scripts, as `yarn deploy` runs them: IdentityRegistry, SkillBadge, SkillGraph and SkillPath, then the bootstrap. The bootstrap anchors the registrar (#6) and the oracle (#5), and the deployer renounces the root role. It anchors no student. Contracts-only, through `deployments.fixture()`. Check: the deployer holds no role, #1 is the administrator, #5 the oracle, #6 the registrar.
2. Full mode: the private rows. `student_ids` gets S001 to S100 directly, since the FenixEdu login is outside the replay: FenixEdu ID and name the student ID, email `S001@replay.invalid` and so on, degree MEEC, and the master salts of the year file. TP1 to TP3 apply through `POST /third-party/apply`, each with a nonce and a SIWE signature from its wallet, NIFs `000000001` to `000000003`. Their applications are pending: no role on the ledger yet.
3. The administrator anchors TP1 to TP3. The registrar anchors S001 to S100.
4. The administrator defines the 97 badges in `index.json` order. `seasonId` is `id("2025/2026-S1")` or `id("2025/2026-S2")`, from the season of the course. `courseId` is `id(course code)`, `badgeCode` is `id(badge ID)`, for example `id("COSE-2")`. The skill types are `id(type)` with their points, in file order. `metadataCID` is `0x` and the SHA-256 of the document.
5. The administrator defines the 24 nodes in `index.json` order: Season 1, `nodeCode` `id(node name)`, the threshold in file order, the prerequisite groups as in the file, `versionOf` 0, and `metadataCID` from the index.
6. Full mode: before each define call, the document's exact bytes go to `POST /metadata/pin`. The hash and the CID it returns must equal the entry of `index.json`.
7. Checks, and the replay stops if one fails: badge token IDs are 1 to 97 and node IDs 1 to 24, in index order. `uri(id)` is `ipfs://f01551220` followed by the SHA-256 of the document, for all 121. Each definition read back from the ledger matches its document: season, course and code, skill points or threshold, prerequisite groups and `versionOf`. Exactly the 100 students of the year are anchored.

The setup is 231 transactions, all in `txlog.csv`: 7 from the deploy scripts (4 deployments, 2 anchors, `renounceAdmin`) and 224 for the cohort (3 third parties, 100 students, 97 badges, 24 nodes).

## Events

The replay walks `events` in order. One transaction per event, two for `freezeSeason`: 4,347 transactions for the 4,345 events. Badge IDs of the year file (such as `COSE-2`) map to the token IDs of setup step 4.

| Event | Signer | Call |
|---|---|---|
| mintBadge | oracle | `SkillBadge.mintBadge(student, tokenId, gradeCommitment)` |
| freezeSeason | administrator | `SkillBadge.freezeSeason(seasonId)`, then `SkillGraph.freezeSeason(seasonId)` |
| allocateBadges | student | `SkillGraph.allocateBadges(node, tokenIds)`, badges in event order |
| definePath | third party | `SkillPath.definePath(nodes, hash of posts/path-N.json)` |
| defineProject | third party | `SkillPath.defineProject(slots, maxTeams, hash of posts/project-1.json)` |
| approvePath, approveProject | administrator | `approvePath(path)`, `approveProject(project)` |
| applyToPath | student | `applyToPath(path)` |
| startTeam | student | `startTeam(project, slot - 1)` |
| joinTeam | student | `joinTeam(team, slot - 1)` |
| selectTeam | third party | `selectTeam(team)` |

The grade commitment is computed as `server.js` does, from UTF-8 strings and hex digests: `badgeSalt = sha256_hex(masterSalt + String(tokenId))`, then `gradeCommitment = "0x" + sha256_hex(String(grade) + badgeSalt)`.

The path, project and team IDs the contract emits (`PathDefined`, `ProjectDefined`, `TeamStarted`) must equal the numbers in the events. A refused transaction is logged with its reason, and the walk goes on.

The 4,578 transactions of the run end at block 4,582. The four extra blocks are empty: the deploy scripts pass `autoMine` to hardhat-deploy, which mines one more block after each of the four deployments, after Hardhat's automine has already mined the deployment itself. The other transactions take one block each.

### Mints in the full mode

The replay never signs as the oracle in the full mode: the backend's oracle pipeline owns that key. Before the first event of each week, the replay writes every assessment taken that week into `mock_academic_records`, grades below 10 included, and calls `POST /oracle/process-grades` once. The oracle mints the grades of 10 or more, in token then student order, which is the order of the week's mint events. The replay checks the count, that none failed and the order, and logs each mint from its receipt.

After a network error on a mint, the oracle reads `gradeCommitments(student, token)` on the ledger. If the commitment is there, the mint went through: it writes the grade record, marks the record processed, and takes the transaction from the `BadgeMinted` event. If not, it retries the mint once, and a second failure is reported as failed. The contract refuses a second copy of a badge, and a normal mint reads nothing extra.

### Hooks

The walk calls three hooks, so the two modes share it:

| Hook | Contracts-only | Full mode |
|---|---|---|
| `beforeDefine`, before each `defineBadge`, `defineNode`, `definePath`, `defineProject` | nothing: the hash goes on the ledger | pins the document through `POST /metadata/pin` and checks the hash and the CID |
| `beforeWeek`, before the first event of each week | nothing | writes the week's grades and calls `POST /oracle/process-grades` |
| `mint`, at each mint event | the oracle (#5) signs `mintBadge` | returns the receipt of the backend's transaction |

## Checks after the last event

Both modes, per student, against `expected`:

- badges: SkillBadge balance 1 for the expected badges, 0 for the rest of the 97
- grade commitments: `gradeCommitments(student, tokenId)` equals the recomputed value, for every mint
- nodes: SkillGraph balance 1 exactly for the expected nodes, unlocked in the week `expected` gives, and `getNodeBadges` equals the token IDs of the allocation event
- applications: `getPathApplication` non-zero exactly for the expected paths
- team: `teamOf(1, student)`, the slot in `getProjectTeam`, and whether the team is formed and selected

Totals: 3,703 badges, 545 nodes, 37 applications, 51 students in 15 teams, each equal on the ledger, in `expected` and in the brief. Paths 1 and 2 are open, project 1 has started, and of the 15 teams only team 1 is selected.

Spot checks, computed outside the repo: `gradeCommitments(S027, 91)` is `0x9c78aff5d1b4cc2fd77e400f256a94201dd8dcbee35a71e6b80530db54692eeb` (COSE-2, grade 13, week 28), and `getNodeBadges(22, S027)` is `[20, 41, 56, 75, 79, 91]`.

The full mode adds, in this order:

| Check | What it compares |
|---|---|
| same transactions | `txlog.csv` and `students.csv` against the ones in `simulation/replay/contracts/`, byte for byte |
| documents | each of the 124 documents read back through `GET /metadata/:id` with the hash on the ledger: its SHA-256 equals the index and the ledger |
| ledger view | once `indexer_state` reaches the last block (600 s at most), every table of the ledger view against the ledger, the spec files and `expected`: the 97 badges and their skill points, the 2 seasons and their freeze blocks, the 24 nodes with their thresholds, prerequisite groups and `version_of`, the 3,703 badges and 545 competencies of the students with their weeks and `committed_to_node`, the 2 paths, 37 applications, the project, its 4 slots and the 15 teams with their members. No document or season mismatch |
| private data | 100 `student_ids`, 3 `third_party_ids`, 3,897 assessments of which 3,703 processed and the 194 below 10 not, and 3,703 grade records, each matching its badge salt and the commitment on the ledger |
| no disclosure | the wallet routes of S027, `GET /oracle/pending` and every response of `POST /oracle/process-grades` hold no name, email, grade or salt |
| registration and disclosure | the routes below, used as a client would, with their refusals: S027 discloses grade 13 of token 91, S027 consents to TP1, S100 erases its grades, and the session T001 registers account #110. This check comes last, after the counts of the summary |

## The routes of the backend

| Route | Takes | Checks | Returns |
|---|---|---|---|
| `GET /health` | | the database answers | status, time |
| `GET /auth/nonce` | | | a nonce for one signed message, valid 10 minutes |
| `GET /auth/fenix` | | | a state cookie, a redirect to FenixEdu |
| `GET /auth/fenix/callback` | code, state | the state of the cookie, the FenixEdu token | a 10-minute session cookie with the confirmed identity, a redirect to the client |
| `POST /auth/wallet` | SIWE message, signature, session cookie | the session, the signature, the statement names the session's username, the nonce, the username has no wallet, the wallet holds no role. The record is committed only if `anchorStudent` succeeds | wallet, `registered`, transaction |
| `POST /third-party/apply` | name, NIF, SIWE message, signature | nine digits, the signature, the statement names the NIF, the nonce, the NIF has no wallet, the wallet holds no role | wallet, `pending` |
| `POST /disclose/grade` | signed message: wallet, token ID, nonce | signed by the wallet it names, the nonce | that grade and its badge salt |
| `POST /disclose/identity` | consent, the student's and the third party's signatures | both signatures, the third party role on the ledger, the nonce | the student's name and email |
| `POST /student/erase` | signed message: wallet, nonce | the signature, the nonce | the number of grade records deleted |
| `GET /skills`, `/badges`, `/nodes` | | | the skill reference list and the ledger view |
| `GET /student/:wallet`, `/available`, `/skills` | wallet | the first and the last: the student is registered | wallet, degree, status, badges, competencies. The badges not yet allocated. The points per skill type |
| `POST /metadata/pin` | the document's bytes | under 256 KiB, the CID holds the SHA-256 | hash, CID |
| `GET /metadata/:id` | the hash or the CID | the bytes match the hash | the exact bytes |
| `POST /oracle/process-grades` | | grades of 10 or more, of students with a master salt | minted, failed, and per mint the FenixEdu ID, token ID and transaction |
| `GET /oracle/pending` | | | two counts |

No route returns a name, an email, a grade or a salt, except a student's own grade and badge salt to a request the student signs, and a student's identity to the third party the student names in a signed consent, on a request that third party signs.

## Signed messages: registration and disclosure

The registration, disclosure and erasure routes of `backend/server.js` take messages signed by a wallet. Each carries a nonce from `GET /auth/nonce`, which serves one message and expires after 10 minutes. `0x…` stands for a checksummed address.

Registration signs a SIWE message (EIP-4361), built with the `siwe` package. Its statement names the identity of the first step, and the backend checks the signature, the statement and the nonce:

```
localhost:3000 wants you to sign in with your Ethereum account:
0x…

Skill Credentials: register this wallet for the FenixEdu username T001.

URI: http://localhost:3000
Version: 1
Chain ID: 31337
Nonce: 3f9c…
Issued At: 2026-10-23T22:43:43.550Z
```

| Route | Signed by | Statement |
|---|---|---|
| `POST /auth/wallet` | the student, with the session cookie of the FenixEdu login | `Skill Credentials: register this wallet for the FenixEdu username <username>.` |
| `POST /third-party/apply` | the third party | `Skill Credentials: apply as a third party with the NIF <nif>.` |

Disclosure and erasure sign plain text with EIP-191 (`personal_sign`): the action, then one field per line, with no newline at the end.

`POST /disclose/grade`, signed by the student. It returns that one grade and its badge salt:

```
Skill Credentials: disclose grade
Wallet: 0x…
Token ID: 91
Nonce: 3f9c…
```

`POST /disclose/identity`, the consent, signed by the student and by the third party it names, which must hold the third party role. It returns the student's name and email:

```
Skill Credentials: disclose identity
Student: 0x…
Third party: 0x…
Nonce: 3f9c…
```

`POST /student/erase`, signed by the student. It deletes the student's grade records and sets the master salt to NULL:

```
Skill Credentials: erase grades
Wallet: 0x…
Nonce: 3f9c…
```

Erasure is how a student leaves the platform. After it, the oracle issues no more badges to that wallet. The commitments stay on the ledger, matched to no grade any more. The identity record and the student role stay until the administrator removes them.

## Reads

For each of the 545 nodes held, the replay recomputes the competency from the ledger alone, as a third party would, and counts the view calls:

1. `getNodeBadges(node, student)`
2. `getThresholdSkillIds(node)`, then `getThresholdPoints(node, type)` for each type
3. `getSkillPoints(badge, type)` for each badge and each threshold type

That is 2 + T + B × T calls for T threshold types and B badges. Every sum must meet its amount. Node 22 of S027 takes 23 calls. `summary.md` gives the minimum, mean and maximum, overall and per tier.

## Outputs

In `simulation/replay/contracts/` and `simulation/replay/full/`:

| File | Content |
|---|---|
| `txlog.csv` | One row per transaction, setup included: sequence, phase, week, event, signer, contract, function, gas used, status, revert reason, block |
| `students.csv` | One row per student: archetype, behavior group, badges, nodes, target nodes held, applications, team and slot, gas the student pays, gas of the oracle's mints for the student |
| `summary.json`, `summary.md` | Provenance, transactions, deployment gas and bytecode size, the setup in two parts (deploy scripts, cohort setup) with payers and gas per function, year gas per operation, gas per student-year and per cohort-year, outcomes, reads, refused transactions, mismatches |

The full mode's summary adds the stack: the documents pinned and read back, the rows of the private tables, the grade records checked, the rows of each ledger view table, the indexer's document and season mismatches, and the outcome of each registration and disclosure step. Its counts are taken before the registration and disclosure check, which erases S100 and registers T001.

The behavior groups come from `class` and `allocationWeeks`: `reference`, `regular-15-30`, `regular-30`, `skips`, `dropout`. The student pays its allocations, applications and team slots. The oracle pays the mints, the administrator the freezes and approvals, the third parties their posts and the selection.

The files hold no dates, paths or machine data, so two runs on two machines give the same bytes. The provenance records the last commit that touched `packages/hardhat/contracts`, the compiler and library versions, the chain ID and the SHA-256 of the inputs. There are no fees: they come later, from these gas figures and a dated gas price.

## Reproducibility and the console

Before writing, the replay compares its `txlog.csv` and `summary.json` with the files already in its output folder, which on a fresh clone are the committed ones. It prints `PASS reproduced` if they are identical, the first rows or fields that differ if not, and "no committed outputs yet" if there are none. Then it writes the four files.

The console prints the Node and Yarn versions and the run time, then one line per check. Contracts-only: inputs, setup, ledger against expected, spot checks, reads, reproduced. Full mode: inputs, prerequisites, setup, ledger against expected, spot checks, reads, same transactions, documents, ledger view, private data, no disclosure, registration and disclosure, reproduced. The script exits non-zero if a check fails.
