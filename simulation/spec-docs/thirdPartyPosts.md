# Third Party Posts

Simulated year of the MEEC, CRAI and Energy areas. Filipe Oliveira, October 2026.

Posts are written by hand. `thirdPartyPosts.json` holds the content of this file.

Each third party is approved by the seasonal administrator, who registers its wallet. Each post is defined by its third party and opens to students once the seasonal administrator approves it. Posts are defined and approved in week 30, before students apply and form teams.

Contract limits of `SkillPath.sol`:

| Limit | Value |
|---|---|
| MAX_NODES_PER_PATH | 7 |
| MAX_SLOTS_PER_PROJECT | 4 |
| MAX_NODES_PER_SLOT | 4 |
| MAX_TEAMS_PER_PROJECT | 10 |

A third party has at most one active path and one active project, pending ones included.

## Third parties

| Third party | Posts |
|---|---|
| TP1 | Path 1 |
| TP2 | Path 2 |
| TP3 | Project 1 |

## Competency paths

A student can apply to a path when they hold every node it lists.

| Path | Third party | Title | Nodes | Targeted by |
|---|---|---|---|---|
| 1 | TP1 | Smart energy systems | 22 Smart Energy Architect | A2, A5 |
| 2 | TP2 | Applied machine learning | 24 Applied ML Architect | A1 |

## Projects

A team forms when every slot is filled by a student who holds all the nodes of that slot. A student fills at most one slot of a project.

| Project | Third party | Title | Most teams selected |
|---|---|---|---|
| 1 | TP3 | Autonomous electric vehicle charging depot | 1 |

Slots of Project 1:

| Slot | Role | Nodes | Targeted by |
|---|---|---|---|
| 1 | Data and learning | 14 Deep Learning Specialist, 15 Data Science Specialist | A1 |
| 2 | Energy systems | 18 Energy Optimization Specialist, 20 Energy Infrastructure Specialist | A2 |
| 3 | Vehicle perception | 12 Perception Specialist, 13 Electric Vehicle Specialist | A3 |
| 4 | Control and automation | 16 Engineering ML Specialist, 17 Control Systems Specialist | A4 |

"Targeted by" lists the archetypes whose target nodes include every node of the path or slot. Which students qualify comes from the simulation.
