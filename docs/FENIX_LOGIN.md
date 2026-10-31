# FenixEdu login by hand

`yarn fenix:login` runs the registration of thesis 4.5.2 once with a real IST account, outside the replay. The replay writes its student records directly, so this is where the FenixEdu login itself is exercised. The tool, `backend/tools/fenix-login.js`, plays the client app.

## What it shows

1. Identity: you log in at FenixEdu in the browser. The backend exchanges the code, reads your FenixEdu username, name and email, and keeps them in a 10-minute session in `auth_sessions`. It then sends the browser to the client's `/profile` page, which the tool serves on port 3000.
2. Wallet: the tool takes that session, gets a nonce from `GET /auth/nonce`, and signs a SIWE message that names a Hardhat account, your FenixEdu username and the nonce. It sends it to `POST /auth/wallet` with the session cookie.
3. Anchor: the backend checks the signature, the username and the nonce, stores your username, name and email with the wallet and a new master salt in `student_ids`, and calls `anchorStudent` from the registrar wallet. The record is kept only if the anchor succeeds.

The tool prints, on the terminal only, the backend's answer, the wallet, whether the wallet holds the student role on the ledger, and the `student_ids` row: FenixEdu username, name, email, and whether a master salt is set. It never prints the salt, and writes no file.

## What it needs

- An IST account.
- The three values of the FenixEdu application in `backend/.env`: `FENIX_CLIENT_ID`, `FENIX_CLIENT_SECRET`, and `FENIX_REDIRECT_URI=http://localhost:3001/auth/fenix/callback`, the redirect URL registered in the application. `backend/.env` stays out of git.
- Postgres, with the dev database `hei_ecosystem` loaded from the current `DB/schema.sql`, and IPFS (`ipfs daemon --offline`), as for the backend.
- A freshly started `yarn chain`, with the deploy scripts run on it (`yarn deploy`).
- The backend on port 3001: `npm start` in `backend/`.
- Port 3000 free: the tool serves the client's page there, so `yarn start` must not run.

## The commands in order

```bash
yarn chain                      # its own terminal: a freshly started chain
yarn deploy                     # the deploy scripts; also rewrites packages/nextjs/contracts/deployedContracts.ts with the same addresses
psql -h localhost -U hei_admin -d hei_ecosystem -f DB/schema.sql    # a fresh dev database
yarn backend:setup              # the skill reference list
cd backend && npm start         # its own terminal: the backend on port 3001
yarn fenix:login                # account #119, or yarn fenix:login --account N
```

`git checkout packages/nextjs/contracts/deployedContracts.ts` restores the committed file after `yarn deploy`.

The tool checks the three FenixEdu values, the backend on port 3001, the chain and the code of the identity contract, and port 3000, each with a message if it fails. Then it prints:

```
FenixEdu login by hand (docs/FENIX_LOGIN.md)
  backend    http://localhost:3001, database hei_ecosystem
  chain      http://127.0.0.1:8545, IdentityRegistry 0x5FbDB2315678afecb367f032d93F642f64180aa3
  client     http://localhost:3000/profile, served by this tool
  account    #119, 0x8D86EF40df93B1b3822bf996B972bA53E79C07c9

Open this URL in the browser and log in with your IST account:
  http://localhost:3001/auth/fenix

Waiting for the FenixEdu session, 10 minutes at most...
```

It opens the URL with `xdg-open` if it can. Log in at FenixEdu. The browser ends on "FenixEdu login done. Back to the terminal.", and the tool goes on:

```
FenixEdu session found.

Backend answer: 200 {"wallet":"0x8D86…07c9","status":"registered","tx_hash":"0x…"}
Wallet: 0x8D86EF40df93B1b3822bf996B972bA53E79C07c9
Student role on the ledger (hasRole): true
student_ids row:
  FenixEdu username  <your username>
  name               <your name>
  email              <your email>
  master salt set    yes
```

Account #119 is the default: it holds no role on a fresh chain, and neither replay uses it.

## Limits

- The tool takes the session from the database instead of the browser's cookie.
- It takes only a session opened while it waits. A login that completes after its 10 minutes is not used: run the tool again, then log in again.
- It signs with a Hardhat account, not with a wallet in the browser.
- One wallet per identity: a second run with the same IST account is refused ("This FenixEdu username already has a wallet"). Running it again needs a fresh dev database, and so does a restarted chain, whose ledger no longer holds the anchor.
- It does not run at the same time as `yarn replay:full`. Both need `yarn chain`, and the full mode rewrites the deployment files the dev backend reads. Run one, then restart the chain for the other.
