# Contract Tests

Files: `packages/hardhat/test/SkillGraph_SkillPath.test.js` and `packages/hardhat/test/IdentityRegistry_SkillBadge.test.js`. Run with `yarn test`.

38 tests in total: 8 for SkillGraph, 19 for SkillPath (9 on competency paths, 10 on projects and teams), 5 for IdentityRegistry and 6 for SkillBadge and the season freeze. All pass on solc 0.8.30, OpenZeppelin 5.6.1, Hardhat 2.28.6.

## What kind of tests

Each test checks one rule of the contracts. Each test deploys fresh contracts on one shared test chain, the in-process Hardhat network, which is not restarted between tests. In `SkillGraph_SkillPath.test.js`, every test deploys the four contracts together: IdentityRegistry, SkillBadge, SkillGraph and SkillPath. `IdentityRegistry_SkillBadge.test.js` deploys only the contracts each rule needs. No contract is replaced by a mock. So the tests check each rule through the real calls between the contracts. They are contract-level tests, closer to integration tests than to unit tests of a single function.

The replay of the simulated year (Chapter 5) is the test of the whole system.

## Test setup

Setup of `SkillGraph_SkillPath.test.js`. The other file describes its setup with its tests.

| Item | Value |
|---|---|
| Accounts | administrator, registrar, oracle, 2 third parties, 5 students, 1 outsider |
| Badges | 12, each with 10 points of PWR, CTR and CODE |
| Nodes | 9: node 1 (PWR 10), node 2 (CTR 10), node 3 (CODE 10, needs 1 and 2), node 4 (CTR 10, a version of node 2), nodes 5 to 8 (PWR 10), node 9 (PWR 20) |

## SkillGraph (8 tests)

| # | Test | What it checks |
|---|---|---|
| 1 | Soulbound | A node token cannot be transferred to another address. |
| 2 | Repeated badge in one call | Allocating the same badge twice in one call is refused, and the badge stays free. The correct call then unlocks the node and records which badges were used. |
| 3 | Badge already allocated | A badge allocated to one node cannot be allocated to another. |
| 4 | Order of prerequisites | A correction of a node cannot make it require itself or a later node. A valid correction is stored. |
| 5 | Versions of a node | Holding a version of a prerequisite node meets the prerequisite. Without it, the allocation is refused. |
| 6 | Threshold of a node | Only the administrator defines a node. The threshold needs matching arrays, 1 to 4 skill types, no repeated type and no zero points. |
| 7 | Prerequisite groups | A node has at most 4 prerequisite groups, each of 1 to 4 nodes that already exist, so a node cannot require itself. The limits themselves are accepted. |
| 8 | Versions of versions | `versionOf` must name an existing node. A version of a version points to the first original, and holding it meets a prerequisite on that original. An original emits no `NodeVersionOf`. |

## SkillPath: competency paths (9 tests)

| # | Test | What it checks |
|---|---|---|
| 9 | Who defines a path | Only a registered third party can define a path. A new path is pending, and is stored with its owner and nodes. |
| 10 | Node checks | A path needs a metadata hash, at least one node, existing nodes, no node twice (two versions of one node count as the same node), and at most 7 nodes. |
| 11 | One active path | A third party cannot define a second path while one is pending or open. After cancelling, it can. |
| 12 | Administrator | Only the seasonal administrator approves a pending path. It can also reject a pending path or withdraw an open one. |
| 13 | Cancel | Only the owner can cancel its path, and only once. |
| 14 | Applying | A student applies only to an open path, only when holding every node, and only once. The application records its time. |
| 15 | Versions | A version of a listed node meets the requirement of the path. |
| 16 | Removed third party | When a third party loses its role, students can no longer apply to its path, and the administrator can close it. |
| 17 | Gas with 7 nodes | Measures the gas of an application to a path with the maximum of 7 nodes. |

## SkillPath: projects and teams (10 tests)

| # | Test | What it checks |
|---|---|---|
| 18 | Project definition | A project needs a metadata hash, 1 to 4 slots, 1 to 4 existing nodes per slot with no repeats, and between 1 and 10 teams to select. The same node can appear in two slots. One active project per third party. |
| 19 | Forming a team | A student takes a slot only when the project is open and it holds the slot's nodes. A slot cannot be taken twice. A student sits in one team per project. The team forms when every slot is filled, and then no one can leave or join. A second team can form under the same project. |
| 20 | Leaving a slot | A member can leave before the team forms, and another student can take the free slot. |
| 21 | Selecting a team | Only the owner selects, and only a formed team. When the selections reach the most teams allowed, the project starts and no new team can start. A started project cannot be cancelled. |
| 22 | Ending recruitment | With at least one team selected, ending recruitment starts the project. With none, it closes it. After a selection, the owner cannot cancel the project. |
| 23 | Started project | No slot can be left once the project has started. |
| 24 | Administrator withdraws | The administrator can withdraw an open project, even with teams selected. |
| 25 | One-slot project | The team forms with its first student. |
| 26 | Reject and cancel | The administrator rejects a pending project. Only the owner cancels an open one. |
| 27 | Removed third party | When a third party loses its role, students can no longer take slots in its project. |

## IdentityRegistry (5 tests)

File: `IdentityRegistry_SkillBadge.test.js`, like the next section. Tests 28 to 30 start from the registry as deployed, where only the deployer (root role) and the administrator hold a role. Tests 31 to 38 anchor a registrar, an oracle, a third party and 2 students, and deploy SkillBadge and SkillGraph on that registry.

| # | Test | What it checks |
|---|---|---|
| 28 | No direct grants | `grantRole` and `revokeRole` always revert, for every caller and every role, the root role included. |
| 29 | Anchoring | Only the administrator anchors the registrar, the oracle and third parties. Only the registrar anchors students. The zero address and a second anchor of the same wallet are refused. Each anchor emits its event. |
| 30 | Renouncing the root role | After `renounceAdmin`, no address holds the root role, and it cannot be called again. The administrator still anchors. |
| 31 | No renouncing a role | `renounceRole` always reverts, for every role, the root role included, and each holder keeps its role. `renounceAdmin` still removes the root role. |
| 32 | Removing a role | Only the administrator removes a role, and only from a wallet that holds it. Each removal emits its event. A removed oracle can no longer mint. |

## SkillBadge and the season freeze (6 tests)

| # | Test | What it checks |
|---|---|---|
| 33 | Badge definition | Only the administrator defines a badge. The skill vector needs matching arrays, 1 to 4 skill types, no repeated type and no zero points. Token IDs are sequential from 1. |
| 34 | Minting | Only the oracle mints, only a defined badge, only to a registered student, and only once per student and badge. The grade commitment, computed as the backend does, is stored and emitted. |
| 35 | Soulbound | A badge cannot be transferred, not even by an approved operator. |
| 36 | Freezing a SkillBadge season | Only the administrator freezes a season, and only once. A correction made before the freeze is stored. Once frozen, the season refuses new badges and corrections, while the other season stays open and minting continues. |
| 37 | Freezing a SkillGraph season | A frozen season refuses new nodes and corrections. With both contracts frozen, a student still allocates badges to a node of that season. |
| 38 | Metadata URI | `uri()` returns `ipfs://f01551220` followed by the hex of the metadata hash, and refuses an undefined badge. |

## Gas measured by the tests

Local Hardhat network, optimizer on with 200 runs.

| Operation | Gas |
|---|---|
| allocateBadges, 2 badges, 1 threshold type | 224,296 |
| allocateBadges, with 2 prerequisites | 186,911 |
| definePath, 7 nodes | 332,104 |
| applyToPath, 3 nodes | 93,252 |
| applyToPath, 7 nodes | 135,740 |
| defineProject, 2 slots, 3 nodes | 258,296 |
| startTeam, slot with 2 nodes | 159,314 |
| joinTeam, last slot, forms the team | 107,234 |
| selectTeam, starts the project | 44,301 |

## Not covered by these tests

- `updateBadge` is tested only around the freeze. Its checks of the skill vector are the same as in `defineBadge` and are not tested again.
- The known limits of SkillPath are documented, not tested: a removed student stays in its slot, a team whose members all leave stays open, and one wallet can hold both the student and the third party role.
