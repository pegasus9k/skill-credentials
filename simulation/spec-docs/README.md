# Specification of the Simulated Year

Inputs of the simulated year of Chapter 5 of the master's thesis of Filipe Oliveira (MEEC, Instituto Superior Tecnico, 2026). The documents, in this folder, are written by hand. Each JSON file, in `simulation/spec`, holds the content of its document, in the form the scripts read.

| Input | Document | JSON file |
|---|---|---|
| Courses and badges | `courseSkillPoints.md` | `courses.json` |
| Skill reference list | none, written as JSON | `skillTypes.json` |
| Student archetypes | `archetypes.md` | `archetypes.json` |
| Competency graph | `competencyGraph.md` | `graphStructure.json` |
| Third party posts | `thirdPartyPosts.md` | `thirdPartyPosts.json` |

`skillTypes.json` is the skill reference list. For each skill type it gives the code, the skill ID (keccak-256 of the code, as `ethers.id` computes it), the label, and three learning outcome statements. Its codes and labels are those of the Skill types table of `courseSkillPoints.md`. The skill points of the simulation are assigned from the content of each assessment. They are not matched task by task to the learning outcome statements, a matching that belongs to the institution.

The threshold amounts of the competency graph are not written by hand. `thresholds.py` derives them with Equation 5.1 and writes `graph.json`. It stops if a student who earns every badge of an archetype cannot unlock all its target nodes.

    graphStructure.json + courses.json + archetypes.json -> thresholds.py -> graph.json

`allocate.py` is the allocation helper. Given the badges of a student and its target nodes, it proposes which badges to allocate to which node.

## Simulated year

`generate_year.py` draws the grades of the 100 students from one seed (42) and wrote `simulatedYear.json`: the students, every assessment they take or miss, the transactions of the year in replay order, and the outcome expected for each student. It reads `courses.json`, `archetypes.json`, `graph.json` and `thirdPartyPosts.json`. The replay reads the events and the master salts, takes the badge and node definitions and the posts from the specification files, and has no randomness.

`simulatedYear.json` was generated with Python 3.13.16 and SciPy 1.18.1. SHA-256 `0c88b5fc231bf680f09bda32fd67a78b40b99dc9a404e17e654e3f618ae9baca`. Running `generate_year.py` again rewrites the file, and its `meta` line records the Python and SciPy versions, so another machine gives another hash. The check to run is `check_year.py`, which replays the file with the checks the contracts make and prints a summary (Python 3.8 or later, NumPy, SciPy 1.9 or later):

    python3 simulation/scripts/check_year.py

## Metadata documents

`build_metadata.py` reads `courses.json`, `graph.json`, `thirdPartyPosts.json` and `skillTypes.json`, and writes one JSON document per badge, node and post to `metadata/`, and `metadata/index.json` with the SHA-256 and the IPFS CID of each file. Every field comes from the specification files. The replay puts the SHA-256 of each file on the ledger as the metadata hash of its badge, node or post, and in the full mode pins the file on IPFS. Standard library only.

    python3 simulation/scripts/build_metadata.py
