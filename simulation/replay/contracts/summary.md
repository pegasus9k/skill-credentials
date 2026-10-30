# Replay of the simulated year, contracts-only mode

Written by `packages/hardhat/scripts/replay.ts` (`yarn replay`). See `docs/REPLAY.md`. Gas in gas units.

## Provenance

| Item | Value |
|---|---|
| Contracts | `ac99029302a452edcc3166b966109383861c762c`, the last commit that touched `packages/hardhat/contracts` |
| Solidity | 0.8.30, optimizer 200 runs, EVM cancun |
| OpenZeppelin Contracts | 5.6.1 |
| Hardhat | 2.28.6, in-process network, chain ID 31337 |
| `simulatedYear.json` SHA-256 | `0c88b5fc231bf680f09bda32fd67a78b40b99dc9a404e17e654e3f618ae9baca` |
| `metadata/index.json` SHA-256 | `0bdb33ffd469d55572200f54f2f176b50ab725b8774f5271d3b607fe13cadf13` |

## Transactions

| Deploy scripts | Cohort setup | Year | Refused | Mismatches with expected |
|---|---|---|---|---|
| 7 | 224 | 4,347 | 0 | 0 |

## Deployment

| Contract | Deployment gas | Runtime bytecode (bytes) | Margin to 24,576 bytes |
|---|---|---|---|
| IdentityRegistry | 938,931 | 3,347 | 21,229 (13.6% used) |
| SkillBadge | 2,244,923 | 9,969 | 14,607 (40.6% used) |
| SkillGraph | 3,145,686 | 14,126 | 10,450 (57.5% used) |
| SkillPath | 2,995,686 | 13,300 | 11,276 (54.1% used) |

## Setup

Before week 1. The deploy scripts (`packages/hardhat/deploy/`) deploy the four contracts, anchor the registrar and the oracle, and renounce the root role. The cohort setup anchors the third parties and the students, and defines the badges and the nodes.

| Part | Payer | Transactions | Gas |
|---|---|---|---|
| Deploy scripts | deployer | 5 | 9,349,504 |
| Deploy scripts | administrator | 2 | 100,819 |
| **Deploy scripts** |  | 7 | 9,450,323 |
| Cohort setup | administrator | 124 | 40,830,420 |
| Cohort setup | registrar | 100 | 5,044,116 |
| **Cohort setup** |  | 224 | 45,874,536 |
| **Setup total** |  | 231 | 55,324,859 |

### Deploy scripts, gas per function

| Function | Count | Min | Mean | Max | Total |
|---|---|---|---|---|---|
| IdentityRegistry.deploy | 1 | 938,931 | 938,931 | 938,931 | 938,931 |
| SkillBadge.deploy | 1 | 2,244,923 | 2,244,923 | 2,244,923 | 2,244,923 |
| SkillGraph.deploy | 1 | 3,145,686 | 3,145,686 | 3,145,686 | 3,145,686 |
| SkillPath.deploy | 1 | 2,995,686 | 2,995,686 | 2,995,686 | 2,995,686 |
| IdentityRegistry.anchorRegistrar | 1 | 50,399 | 50,399 | 50,399 | 50,399 |
| IdentityRegistry.anchorOracle | 1 | 50,420 | 50,420 | 50,420 | 50,420 |
| IdentityRegistry.renounceAdmin | 1 | 24,278 | 24,278 | 24,278 | 24,278 |

### Cohort setup, gas per function

| Function | Count | Min | Mean | Max | Total |
|---|---|---|---|---|---|
| IdentityRegistry.anchorThirdParty | 3 | 50,353 | 50,353 | 50,353 | 151,059 |
| IdentityRegistry.anchorStudent | 100 | 50,430 | 50,441 | 50,442 | 5,044,116 |
| SkillBadge.defineBadge | 97 | 220,441 | 331,563 | 362,272 | 32,161,645 |
| SkillGraph.defineNode | 24 | 268,145 | 354,905 | 492,100 | 8,517,716 |

## Year gas per operation

| Operation | Count | Min | Mean | Max | Total |
|---|---|---|---|---|---|
| mintBadge | 3,703 | 86,348 | 86,382 | 86,384 | 319,871,216 |
| freezeSeason (SkillBadge) | 2 | 51,169 | 51,169 | 51,169 | 102,338 |
| freezeSeason (SkillGraph) | 2 | 51,125 | 51,125 | 51,125 | 102,250 |
| allocateBadges | 545 | 178,723 | 375,934 | 750,716 | 204,884,084 |
| definePath | 2 | 155,037 | 155,037 | 155,037 | 310,074 |
| defineProject | 1 | 457,507 | 457,507 | 457,507 | 457,507 |
| approvePath | 2 | 33,758 | 33,758 | 33,758 | 67,516 |
| approveProject | 1 | 33,822 | 33,822 | 33,822 | 33,822 |
| applyToPath | 37 | 72,008 | 72,008 | 72,008 | 2,664,296 |
| startTeam | 15 | 159,314 | 159,314 | 159,314 | 2,389,710 |
| joinTeam | 28 | 116,001 | 116,001 | 116,001 | 3,248,028 |
| joinTeam (forms the team) | 8 | 117,856 | 117,856 | 117,856 | 942,848 |
| selectTeam | 1 | 44,301 | 44,301 | 44,301 | 44,301 |
| **All year transactions** | 4,347 |  |  |  | 535,117,990 |

### allocateBadges by tier of the node

| Tier | Count | Min | Mean | Max | Total |
|---|---|---|---|---|---|
| Fundamentals | 326 | 178,723 | 316,544 | 579,882 | 103,193,468 |
| Specialist | 158 | 252,446 | 471,516 | 750,716 | 74,499,491 |
| Architect | 61 | 309,763 | 445,756 | 629,090 | 27,191,125 |

### allocateBadges by number of badges

| Badges | Count | Min | Mean | Max | Total |
|---|---|---|---|---|---|
| 1 | 22 | 178,723 | 178,723 | 178,723 | 3,931,906 |
| 2 | 108 | 236,031 | 239,071 | 252,446 | 25,819,648 |
| 3 | 85 | 293,340 | 295,782 | 325,006 | 25,141,483 |
| 4 | 122 | 350,648 | 362,391 | 385,823 | 44,211,731 |
| 5 | 89 | 407,957 | 431,487 | 455,921 | 38,402,332 |
| 6 | 59 | 465,265 | 492,421 | 516,738 | 29,052,865 |
| 7 | 15 | 522,574 | 556,081 | 568,273 | 8,341,219 |
| 8 | 23 | 579,882 | 611,970 | 629,090 | 14,075,318 |
| 9 | 10 | 689,899 | 689,899 | 689,899 | 6,898,990 |
| 10 | 12 | 750,716 | 750,716 | 750,716 | 9,008,592 |

## Gas per student-year

Paid by the student (allocations, applications, team slots), the oracle's mints for the student, and both. Min / mean / max over the students of each row.

| Behavior group | Students | Paid by the student | Oracle's mints | Both |
|---|---|---|---|---|
| reference | 5 | 2,166,122 / 2,484,583 / 2,773,047 | 3,023,008 / 3,748,907 / 4,664,664 | 5,189,130 / 6,233,491 / 7,437,711 |
| regular-15-30 | 30 | 1,247,082 / 2,379,912 / 2,979,586 | 2,764,240 / 3,567,592 / 4,664,640 | 4,585,231 / 5,947,504 / 7,644,226 |
| regular-30 | 35 | 1,337,395 / 2,553,259 / 2,965,553 | 2,591,472 / 3,563,859 / 4,664,652 | 4,692,104 / 6,117,118 / 7,515,528 |
| skips | 15 | 1,058,742 / 1,758,950 / 2,737,508 | 1,727,404 / 2,631,752 / 3,714,428 | 2,917,178 / 4,390,702 / 5,963,719 |
| dropout | 15 | 293,340 / 970,691 / 1,597,731 | 1,295,736 / 1,992,505 / 2,591,484 | 2,175,755 / 2,963,197 / 4,102,795 |
| **all** | 100 | 293,340 / 2,141,290 / 2,979,586 | 1,295,736 / 3,198,712 / 4,664,664 | 2,175,755 / 5,340,002 / 7,644,226 |

| Archetype | Students | Paid by the student | Oracle's mints | Both |
|---|---|---|---|---|
| A1 | 20 | 937,327 / 2,168,659 / 2,680,477 | 1,468,504 / 2,574,165 / 3,023,416 | 2,405,831 / 4,742,823 / 5,531,943 |
| A2 | 20 | 1,230,667 / 2,360,853 / 2,979,586 | 2,245,924 / 3,943,330 / 4,664,640 | 3,476,592 / 6,304,183 / 7,644,226 |
| A3 | 20 | 781,817 / 1,996,421 / 2,496,113 | 1,727,404 / 2,781,507 / 3,282,568 | 2,682,205 / 4,777,928 / 5,664,064 |
| A4 | 20 | 880,019 / 1,989,969 / 2,794,816 | 1,295,736 / 2,686,471 / 3,109,764 | 2,175,755 / 4,676,440 / 5,818,196 |
| A5 | 20 | 293,340 / 2,190,548 / 2,848,563 | 2,418,740 / 4,008,088 / 4,664,664 | 2,712,080 / 6,198,636 / 7,513,191 |

## Gas per cohort-year

| Payer | Transactions | Gas |
|---|---|---|
| oracle | 3,703 | 319,871,216 |
| students | 633 | 214,128,966 |
| administrator | 7 | 305,926 |
| third parties | 4 | 811,882 |
| **Year total** | 4,347 | 535,117,990 |

## Outcomes

| Archetype | Students | Mean badges | Mean nodes | All target nodes | Applications | Team slots |
|---|---|---|---|---|---|---|
| A1 | 20 | 29.8 | 5.5 | 15 | 14 | 15 |
| A2 | 20 | 45.7 | 6.2 | 13 | 12 | 13 |
| A3 | 20 | 32.2 | 5.3 | 12 | 0 | 15 |
| A4 | 20 | 31.1 | 5.6 | 9 | 0 | 8 |
| A5 | 20 | 46.4 | 4.8 | 12 | 11 | 0 |

| Behavior group | Students | Mean badges | Mean nodes | All target nodes | Applications | Team slots |
|---|---|---|---|---|---|---|
| reference | 5 | 43.4 | 6.4 | 5 | 0 | 0 |
| regular-15-30 | 30 | 41.3 | 5.9 | 22 | 17 | 17 |
| regular-30 | 35 | 41.3 | 6.2 | 32 | 19 | 28 |
| skips | 15 | 30.5 | 4.8 | 2 | 1 | 6 |
| dropout | 15 | 23.1 | 3.1 | 0 | 0 | 0 |

## Reads of a third party

View calls to recompute one competency from the ledger alone: `getNodeBadges`, `getThresholdSkillIds`, `getThresholdPoints` per type, `getSkillPoints` per badge and type.

| Tier | Nodes held | Min calls | Mean | Max | Total calls |
|---|---|---|---|---|---|
| Fundamentals | 326 | 6 | 10.81 | 20 | 3,524 |
| Specialist | 158 | 8 | 20.46 | 35 | 3,233 |
| Architect | 61 | 10 | 19.28 | 29 | 1,176 |
| **all** | 545 | 6 | 14.56 | 35 | 7,933 |

Every threshold met: yes. Spot check: node 22 of S027, 23 calls.

## Refused transactions

None.

## Mismatches with expected

None.
