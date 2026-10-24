# Student Archetypes

Simulated year of the MEEC, CRAI and Energy areas. Filipe Oliveira, October 2026.

Course sets and target nodes are written by hand. `archetypes.json` holds the content of this file.

Each archetype takes five courses in Season 1 and four in Season 2, worth at most 540 skill points. The transversal course of the second semester is the same for every student, so it is left out.

Students per archetype: 20.

## Courses

| Archetype | P1 | P2 | P3 | P4 | CRAI | Energy |
|---|---|---|---|---|---|---|
| A1 | AAut, OA, CSCib | AProf, PIV | PDS, SCDTR | PBDat, SAut | 9 | 0 |
| A2 | PCEEle, EEner, MEle | ARed, EMEne | ADRI, ERPD | COSE, MAPI | 0 | 9 |
| A3 | AAut, MEle | PIV, Rob, AVE | PDS, SCDTR | PBDat, SAut | 7 | 2 |
| A4 | OA, CSCib, MEle | Rob, AVE | PDS, SCDTR | SAut, MAPI | 6 | 3 |
| A5 | AAut, OA, PCEEle | ARed, EMEne | ADRI, ERPD | PBDat, COSE | 3 | 6 |

## Target nodes

In allocation order. Fundamentals nodes first, then Specialist nodes, then the Architect node, in number order within each tier. Node numbers as in `competencyGraph.md`.

| Archetype | Fundamentals | Specialist | Architect |
|---|---|---|---|
| A1 | 2, 3, 11 | 14, 15 | 24 |
| A2 | 4, 5, 9, 10 | 18, 20 | 22 |
| A3 | 1, 6, 8 | 12, 13 | 21 |
| A4 | 1, 2, 4, 7 | 16, 17 | 23 |
| A5 | 3, 5, 10 | 19, 20 | 22 |

## Supply

Skill points per type over the nine courses, every badge earned. Computed from `courseSkillPoints.md`.

| Archetype | CODE | DATA | ML | DL | OPT | CTR | SIG | PWR | GRID | REN | THERMO | SIM | MATH | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 78 | 71 | 64 | 39 | 59 | 48 | 37 | 0 | 0 | 2 | 0 | 22 | 120 | 540 |
| A2 | 28 | 41 | 5 | 0 | 24 | 47 | 15 | 97 | 76 | 32 | 26 | 10 | 139 | 540 |
| A3 | 81 | 76 | 48 | 17 | 30 | 52 | 38 | 47 | 6 | 7 | 5 | 24 | 109 | 540 |
| A4 | 70 | 59 | 22 | 0 | 35 | 102 | 48 | 47 | 6 | 7 | 5 | 31 | 108 | 540 |
| A5 | 27 | 53 | 43 | 9 | 61 | 21 | 8 | 45 | 66 | 29 | 21 | 9 | 148 | 540 |
