# Skill Credentials

The prototype and the simulation of the master's thesis of Filipe Oliveira, Master in Electrical and Computer Engineering (MEEC), Instituto Superior Técnico, 2026. The thesis cites tag `v1.0`.

Each assessment a student passes gives a badge, with skill points of up to four skill types. The student allocates badges to the competency nodes of a graph. A node is recognized once its threshold is met and its prerequisite nodes are held. Badges and recognized competencies are ERC-1155 tokens that cannot be transferred. Third parties read them to find candidates for competency paths and project teams.

## Folders

| Folder | What it holds |
|---|---|
| `packages/hardhat` | The smart contracts, their tests, the deploy scripts and the two replay scripts |
| `backend` | The server of the platform: metadata documents, ledger view routes, registration, disclosure, and the oracle that mints badges. `tools/fenix-login.js` tests the FenixEdu login by hand |
| `indexer` | Copies the contract events into the ledger view |
| `DB` | The database schema and its setup script |
| `simulation/spec` | The inputs of the simulated year, as JSON files. The scripts and the replay read only these |
| `simulation/spec-docs` | The same inputs written as documents, for reading, and a guide to the inputs (`README.md`) |
| `simulation/catalogue` | The Python scripts: thresholds, allocation, generation and check of the year, metadata documents, and the checks and analyses of Chapter 5 |
| `simulation/metadata` | The 124 metadata documents of the badges, nodes and posts |
| `simulation/replay` | The outputs of both replays |
| `simulation/analysis` | The results of the margin sensitivity analysis, and the Polygon PoS gas prices behind the fees |
| `packages/nextjs` | The client app, started from the Scaffold-ETH 2 template. The replays do not use it |
| `docs` | How the replay, the metadata documents, the FenixEdu login and the contract tests work |

## Run it

`REPRODUCE.md` has every step.

- Node.js 20.18.3 or later and Yarn: `yarn install`, then `yarn test` (38 tests) and `yarn replay`, about a minute.
- With PostgreSQL 16 and Kubo 0.29.0 as well: `yarn chain` in one terminal, then `yarn replay:full` in another, about 10 minutes.
- Python 3.8 or later with NumPy and SciPy 1.9 or later, only to rerun the scripts of `simulation/catalogue`.
- The client: `yarn chain`, `yarn deploy`, the backend (`npm start` in `backend`), then `yarn start`, at http://localhost:3000.

## Licence

The files that come from the Scaffold-ETH 2 template keep its MIT licence, in `LICENCE-scaffold-eth`. The rest is not licensed for reuse.
