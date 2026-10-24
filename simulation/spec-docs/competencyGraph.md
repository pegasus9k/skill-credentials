# Competency Graph

Simulated year of the MEEC, CRAI and Energy areas. Filipe Oliveira, October 2026.

Nodes, prerequisites, threshold types and derivation parameters are written by hand. `graphStructure.json` holds the content of this file. `thresholds.py` reads `graphStructure.json`, `courses.json` and `archetypes.json`, derives the threshold amounts and writes `graph.json`.

All 24 nodes are defined in Season 1, before week 1.

## Tiers

| Tier | Nodes | Prerequisites | Weight |
|---|---|---|---|
| Fundamentals | 1 to 11 | none | 1.0 |
| Specialist | 12 to 20 | two Fundamentals nodes, both held | 1.5 |
| Architect | 21 to 24 | one fixed Specialist node and one of two others | 2.0 |

## Nodes

| ID | Node | Tier | Prerequisites | Threshold types |
|---|---|---|---|---|
| 1 | Control and Signals Fundamentals | Fundamentals | none | CTR, SIG |
| 2 | Machine Learning Fundamentals | Fundamentals | none | ML, DATA |
| 3 | Software and Data Fundamentals | Fundamentals | none | CODE, DATA |
| 4 | Optimization Fundamentals | Fundamentals | none | OPT, MATH |
| 5 | Power Grid Fundamentals | Fundamentals | none | GRID, PWR |
| 6 | Sensor Data Fundamentals | Fundamentals | none | DATA, SIG |
| 7 | Simulation Fundamentals | Fundamentals | none | SIM, CODE |
| 8 | Electromechanics Fundamentals | Fundamentals | none | CTR, PWR |
| 9 | Electrical Power Fundamentals | Fundamentals | none | PWR, MATH |
| 10 | Renewable Energy Fundamentals | Fundamentals | none | REN, THERMO |
| 11 | Deep Learning Fundamentals | Fundamentals | none | DL, CODE |
| 12 | Perception Specialist | Specialist | 1 and 6 | CTR, SIG, DATA |
| 13 | Electric Vehicle Specialist | Specialist | 1 and 8 | CTR, PWR |
| 14 | Deep Learning Specialist | Specialist | 2 and 11 | DL, ML, CODE |
| 15 | Data Science Specialist | Specialist | 2 and 3 | ML, DATA, CODE |
| 16 | Engineering ML Specialist | Specialist | 2 and 4 | ML, OPT, DATA |
| 17 | Control Systems Specialist | Specialist | 1 and 7 | CTR, SIM, OPT |
| 18 | Energy Optimization Specialist | Specialist | 4 and 9 | OPT, PWR |
| 19 | Grid Analytics Specialist | Specialist | 3 and 5 | GRID, DATA, ML |
| 20 | Energy Infrastructure Specialist | Specialist | 5 and 10 | GRID, PWR, REN |
| 21 | Autonomous Mobility Architect | Architect | 13 and (12 or 14) | CTR, PWR, CODE |
| 22 | Smart Energy Architect | Architect | 20 and (18 or 19) | PWR, GRID, OPT |
| 23 | Intelligent Automation Architect | Architect | 16 and (17 or 18) | CTR, OPT |
| 24 | Applied ML Architect | Architect | 15 and (14 or 16) | ML, DATA, CODE |

Contract limits of `SkillGraph.sol`:

| Limit | Value |
|---|---|
| MAX_THRESHOLD_SKILLS | 4 |
| MAX_PREREQ_GROUPS | 4 |
| MAX_GROUP_SIZE | 4 |

## Derivation

Equation 5.1, for each node and each type of its threshold:

| Parameter | Value |
|---|---|
| Supply | points of the type over every badge of the nine courses of an archetype |
| Share | supply split among the target nodes of the archetype that ask for the type, in proportion to the tier weights |
| Margin | 0.7 of the share, rounded down |
| Minimum | lowest value over the archetypes that target the node |
| Cap per type | 20 |
| Cap for MATH | 10 |
| Completion check | every archetype unlocks all its target nodes, with the allocation helper of `allocate.py` |
