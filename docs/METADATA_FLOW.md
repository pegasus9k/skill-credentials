# Metadata flow: one badge through the simulated year

How the metadata documents, IPFS, the ledger and the ledger view work together, followed on one real badge of the simulated year.

The badge is COSE-2, Dispatch and Scheduling, earned by student S027 (archetype A2, regular, allocates in weeks 15 and 30). Every value below is the real one from the files.

## The pieces

| Piece | Job |
|---|---|
| `simulation/spec/*.json` | The inputs. `courses.json` (badges), `graph.json` (nodes), `thirdPartyPosts.json` (posts), `skillTypes.json` (code and label of each skill type). |
| `simulation/catalogue/build_metadata.py` | Writes one document per badge, node and post from those JSON files. Standard library only, deterministic. |
| `simulation/metadata/` | The documents: `badges/`, `nodes/`, `posts/`. Each file is the exact bytes IPFS stores. |
| `simulation/metadata/index.json` | One line per document, in the order of definition on the ledger: kind, ID, file, SHA-256, CID. The replay reads only this file to know which hash goes with which token. |
| Ledger | Holds only the 32-byte SHA-256 of each document (`metadataCID`). `uri()` rebuilds `ipfs://f01551220<hex>` from it. |
| IPFS (Kubo, local) | Holds the documents. The CID of a file (CIDv1, raw codec, sha2-256) contains the same SHA-256. |
| Indexer and ledger view | Read the hash on the ledger, fetch the document through the backend (`GET /metadata/:id`), hash the bytes again, and store the readable fields in Postgres only if they match. |

The ledger holds the hash, IPFS holds the meaning, and the ledger view is filled from both.

## 1. Before the replay, once: the document is written

`build_metadata.py` reads the COSE-2 entry of `courses.json` (name, assessment, content, skill points, course) and the labels of `skillTypes.json`, and writes `simulation/metadata/badges/COSE-2.json`:

```json
{
  "type": "badge",
  "specId": "COSE-2",
  "name": "Dispatch and Scheduling",
  "description": "Economic dispatch, OPF and Lagrange multipliers, unit commitment via dynamic programming, hydro-thermal coordination, min-cost network flow hydro scheduling.",
  "course": {"code": "COSE", "name": "Controlo e Optimizacao de Sistemas de Energia", "ects": 6, "page": "https://fenix.tecnico.ulisboa.pt/disciplinas/COSE3610/2025-2026/2-semestre"},
  "assessment": "Test 2",
  "season": {"number": 2, "academicYear": "2025/2026", "semester": "2nd semester"},
  "skillPoints": [
    {"skillType": "OPT", "label": "Convex optimization, algorithms and gradient methods", "points": 7},
    {"skillType": "PWR", "label": "Power electronics, electrical machines and power generation", "points": 3},
    {"skillType": "GRID", "label": "Network topology, power flow, protection and state estimation", "points": 3},
    {"skillType": "MATH", "label": "Linear algebra, probability and calculus", "points": 2}
  ]
}
```

It hashes the file's bytes and adds a line to `index.json`:

```json
{"kind": "badge", "id": "COSE-2", "file": "badges/COSE-2.json", "sha256": "659bd63d048b108cd1e68f409db04448b2231fd73f666c832adc73a48817d6ea", "cid": "bafkreidftpld2belccgndzupico3arciwirr7vz7mzwigkw4oosiqf6w5i"}
```

## 2. Replay setup, before week 1: the badge is defined

- The replay walks `index.json` in order. COSE-2 is the 91st badge, so it becomes token 91.
- The replay reads the file and checks that its SHA-256 equals the `sha256` of the index.
- Full mode only: the replay sends the file's bytes, unchanged, to the backend, `POST /metadata/pin`. The backend adds them to the IPFS node (`cid-version=1`, `raw-leaves=true`), gets back `bafkreidftpld2belccgndzupico3arciwirr7vz7mzwigkw4oosiqf6w5i`, checks that the digest inside the CID equals the SHA-256 of the bytes it received, and returns `0x659bd63d...`.
- Both modes: the administrator calls `SkillBadge.defineBadge` for COSE-2 with `metadataCID = 0x659bd63d...`. The ledger now says `getMetadataCID(91) = 0x659bd63d...` and `uri(91) = ipfs://f01551220659bd63d...`.
- Full mode: the indexer sees `BadgeDefined(91)` and reads the definition with `badgeDefinitions(91)`, the hash included. It fetches the document through the backend, `GET /metadata/0x659bd63d...`, and hashes the bytes it receives. They match, so it writes "Dispatch and Scheduling", the course COSE and the assessment "Test 2" into the ledger view. A document that cannot be fetched, or whose SHA-256 is not the hash on the ledger, leaves those fields NULL and counts as a document mismatch.

Node 22, Smart Energy Architect, goes the same way: `nodes/22.json`, SHA-256 `599b9818...`, through `SkillGraph.defineNode`.

## 3. Week 28: the mint, with no document

S027 is graded 13 in COSE Test 2. The oracle calls `SkillBadge.mintBadge(S027, 91, gradeCommitment)`, in the full mode from the backend's oracle pipeline. The commitment comes from S027's master salt and the grade, as `server.js` computes it. No document is pinned: token 91 points to a badge type whose hash is on the ledger since setup.

## 4. Week 30: allocation and the path

- S027 calls `SkillGraph.allocateBadges(22, [20, 41, 56, 75, 79, 91])`, the badges EEner-2, ARed-4, EMEne-10, ERPD-6, ERPD-10 and COSE-2.
- Their points give PWR 4+1+3+3+3 = 14, GRID 12+3 = 15 and OPT 7, exactly the threshold of node 22: PWR 14, GRID 15, OPT 7.
- TP1 defines path 1 with `posts/path-1.json` (SHA-256 `eca82290...`), pinned the same way in full mode. The administrator approves it. S027 applies.

## 5. Reading it back: what a third party does

- Is the competency real? `getNodeBadges(22, S027)` returns the six tokens. `getThresholdSkillIds(22)` and `getThresholdPoints` give the amounts, and `getSkillPoints` gives each badge's points. The sums meet the threshold. That is 23 view calls, from the ledger alone. The replay reports this count for every node held.
- What does badge 91 mean? `uri(91)` gives `ipfs://f01551220659bd63d...`. Fetch it from IPFS: "Dispatch and Scheduling, COSE, Test 2, OPT 7, PWR 3, GRID 3, MATH 2". The SHA-256 of those bytes is `659bd63d...`, the hash written at setup, so the document has not changed since the badge was defined.

Anyone can check the link between the file, IPFS and the ledger:

```bash
sha256sum simulation/metadata/badges/COSE-2.json        # 659bd63d...d6ea
ipfs add --cid-version=1 --raw-leaves simulation/metadata/badges/COSE-2.json
ipfs cid format -b base16 bafkreidftpld2belccgndzupico3arciwirr7vz7mzwigkw4oosiqf6w5i   # f01551220659bd63d...
```

## Rules that keep the flow true

- The bytes are never re-serialized. The backend pins the bytes it receives and hashes those same bytes. `GET /metadata/:id`, with the hash on the ledger or the CID, returns the bytes IPFS holds, and the indexer hashes them again before it uses them.
- IPFS is the only store of documents. There is no copy in Postgres (`metadata_payloads` is dropped). The ledger view keeps only the fields it displays.
- A document never holds its own token ID: the contract assigns it after the document is pinned.
- The ledger is the source of truth. A document repeats node IDs only for its readers.
