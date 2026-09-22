# 🏭 Flow Factory

A cooperative **factory-management retrospective** for a distributed software team of about six to eight people. Everyone joins a room from their own browser, logs what helped and what jammed the last few weeks, watches the factory run, and then spends ten shared Gear Coins on the experiments the team actually wants to try.

It is a facilitation toy, not a forecasting tool. The simulation is deterministic and symbolic — it exists to make the team's own observations tangible and to give the conversation somewhere to point.

---

## Contents

- [What a session looks like](#what-a-session-looks-like)
- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Scripts](#scripts)
- [How the simulation works](#how-the-simulation-works)
- [Saving the retro to GitHub](#saving-the-retro-to-github)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Project layout](#project-layout)
- [Facilitator notes](#facilitator-notes)
- [Instructions](#instructions)
  1. [Run it locally](#1-run-it-locally)
  2. [Run the tests](#2-run-the-tests)
  3. [Build for production](#3-build-for-production)
  4. [Create the ZIP](#4-create-the-zip)
  5. [Create the GitHub repository and push](#5-create-the-github-repository-and-push)
  6. [Deploy to Render](#6-deploy-to-render)
  7. [Set the Render environment variables](#7-set-the-render-environment-variables)
  8. [Create the fine-grained GitHub token](#8-create-the-fine-grained-github-token)

---

## What a session looks like

Plan for 60–75 minutes. The facilitator (whoever created the room) moves everyone between phases.

| # | Phase | What happens |
|---|-------|--------------|
| 1 | **Shift check-in** | Each person picks an avatar, an energy level 1–5, and how the factory feels: Smooth, Busy, Jammed, On Fire or Mysteriously Quiet. The room sees the aggregate, never who said what. |
| 2 | **Build the current factory** | Privately log up to **2 Boosters**, up to **2 Bottlenecks** and exactly **1 Wildcard**. Each gets a title, a description, a station (or *Across the factory*) and an impact of 1–3. Nothing is revealed until everyone is ready. |
| 3 | **First factory run** | A ~48-second animated run of the belts with those conditions applied. Pause, resume and skip are available to the facilitator. Symbolic throughput, queues, warning lights, and the strongest Boosters and Bottlenecks. |
| 4 | **Inspect the machinery** | Everyone gets **4 inspection tokens** to spend on the items worth discussing. Results are revealed, then discussed one at a time with a configurable timer (+1 minute on demand). Near-duplicates can be merged, and the originals are preserved in the merged item. |
| 5 | **Upgrade shop** | Propose upgrades — each needs a name, the problem, the experiment, an observable signal, a cost of 1–5 coins, and optionally an owner and a review date. Everyone fills a private basket within the **10 Gear Coins**, baskets are revealed, and the room buys **one or two** upgrades within budget. |
| 6 | **Improved factory run** | The same factory, the same inputs, now with the purchased upgrades fitted. A before/after dashboard shows what changed. |
| 7 | **End-of-shift report** | Everything in one place, a small celebration, and a save button. |

Submissions, votes and notes are **anonymous everywhere** — in the shared views, in the report and in the saved JSON. The server strips author ids when it projects state to clients, so the browser never receives them in the first place.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, create a factory, and share the invitation link (it carries `?room=CODE`) with the rest of the crew.

---

## Requirements

- **Node.js 22 or newer** (`node --version`)
- A modern browser — Chrome, Edge, Firefox or Safari. The client is shipped as native ES modules, so no bundler is involved.
- Nothing else. No database, no Redis, no authentication provider. Rooms live in memory and disappear when the process restarts, which is exactly what a one-hour retro needs.

---

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Clean, build both halves, then start the server. |
| `npm run build` | Compile the server to `dist/` and the browser client to `public/js/`. |
| `npm start` | Run the compiled server. This is what Render uses. |
| `npm test` | Compile the server and run the whole test suite on `node --test`. |
| `npm run clean` | Delete `dist/` and `public/js/`. |

---

## How the simulation works

The simulation is **fully deterministic**: no randomness anywhere. Given the same submissions and the same purchased upgrades, every client computes the identical run, and re-running produces the identical result. That matters for two reasons — everyone in the room sees exactly the same animation, and nobody can claim the dice were unkind.

The server computes all 60 frames up front and then plays them back on a shared clock, so a person who joins late or reconnects mid-run drops straight into the same position as everyone else.

**The rules, in full:**

- The line has seven stations by default — Ticket Intake, Ready Queue, Development, Review, Test, Deploy, Done — and the facilitator can rename them in the lobby.
- Work arrives at the first station at **2 items per tick**. There are **60 ticks**, played at 800 ms each, so a run lasts a little under 50 seconds.
- Every station starts at a base rate of **2 items per tick** and a speed multiplier of **1.0**.
- Each **Bottleneck** slows its station by `impact × 15%`. Each **Booster** speeds its station up by `impact × 12%`. Items marked *Across the factory* apply at **half strength to every station** instead of full strength to one.
- The resulting multiplier is clamped to the range **0.2 – 2.5**, so no single item can stall or rocket the line entirely.
- A station lights its **warning lamp** when its queue reaches **6 or more** items.
- **Wildcards** fire as timed events: the first at tick 10, then every 10 ticks, each lasting 5 ticks and cutting the affected station's speed to **55%** while it is active. The banner names the wildcard while it runs.
- In the second run, each purchased **upgrade** relieves **50%** of the accumulated bottleneck penalty at its station and adds a further **5% per coin spent**. An upgrade aimed *Across the factory* spreads the same relief thinly over every station.
- The dashboard's numbers — items shipped, work in progress, the waiting indicator, warning lights — are **symbolic counters**, not estimates of anything real.

Every screen that shows a number carries the line **"Game simulation—not a delivery forecast."** Please leave it there.

---

## Saving the retro to GitHub

At the end of the shift the room can commit a clean, anonymous JSON snapshot of the session to a GitHub repository.

**Who can do it.** The button appears only for a connected player whose name is exactly `Markus` — case-sensitive, verified on the server, not in the browser. The client is not trusted to decide this; the server checks the name again when the save request arrives.

> ⚠️ **This is a convenience permission, not authentication.** Anyone who types `Markus` into the name field in that room gets the button. It exists so one known person in a team that already trusts each other can file the notes, and it is not a security control. If you need real access control, put the deployment behind an authenticating proxy.

**What gets committed.**

- Path: `retro-saves/flow-factory/YYYY-MM-DD_HH-mm_room-CODE.json` (UTC).
- Commit message: `Flow Factory retro: <factory name> (room <CODE>) on <date>`.
- Contents: the check-in aggregate, the stations, all Boosters, Bottlenecks and Wildcards, merged items with their originals, inspection token totals, discussion notes, every upgrade proposal with its support count, what was purchased, and the before/after metrics.
- **Excluded by construction**: socket ids, reconnection tokens, player ids, and the author of any submission, vote or note. The snapshot is built from the same public projection the browser sees, so there is no path for those fields to leak in. Participant names appear only as a plain list of who was in the room.

**Safety details.** The button disables itself on click so a double-click cannot produce two commits. The UI never claims success before GitHub confirms the commit — on success it shows the file's URL; on failure it shows what went wrong, with the token redacted from any error text. `GITHUB_TOKEN` is never sent to the browser and never logged.

**If GitHub is not configured**, the game is completely unaffected. Markus sees a short message naming the missing variables, and the **Download JSON** button — which produces the identical snapshot as a local file — works for him regardless.

---

## Environment variables

Copy `.env.example` to `.env` for local development. All of these are read **server-side only**.

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `PORT` | no | `3000` | HTTP port. Render sets this for you; the server always reads `process.env.PORT`. |
| `NODE_ENV` | no | — | Set to `production` on a deployed instance. Enables static-asset caching. |
| `GITHUB_TOKEN` | for saving | — | Fine-grained token with **Contents: Read and write** on the target repo only. |
| `GITHUB_OWNER` | for saving | — | The user or organisation that owns the repository. |
| `GITHUB_REPO` | for saving | — | The repository name, without the owner prefix. |
| `GITHUB_BRANCH` | no | `main` | The branch that receives the commit. It must already exist. |

`/health` reports `githubConfigured` as a boolean so you can confirm a deployment picked the variables up — without revealing any of their values.

---

## Architecture

- **Server-authoritative.** Every action is validated on the server: phase, permission, length limits, budgets, token counts, duplicate names. The browser is treated as a display, never as a source of truth. A crafted socket message cannot exceed 4 tokens, spend 11 coins, buy 3 upgrades, or move a phase without being the facilitator.
- **Sanitisation.** All free text is trimmed, length-capped and stripped of control characters before it is stored. Text reaches the DOM only through `textContent`, so a submission can never be interpreted as markup.
- **Rate limiting.** Socket actions are capped per connection in a rolling window, saving has its own cooldown, and HTTP requests are capped per IP.
- **Reconnection.** Each player gets a reconnect token held in `sessionStorage`. Refreshing the page, closing the laptop lid or losing Wi-Fi puts you back in the same seat with the same submissions. The crew rail shows who is currently disconnected.
- **Facilitator transfer.** If the facilitator drops and does not return within a grace period, the role passes to the longest-connected remaining player and the room is told.
- **Room cleanup.** A janitor sweeps empty rooms after 30 minutes and idle rooms after 6 hours, so a long-running instance does not accumulate abandoned state.
- **Health check.** `GET /health` returns status, uptime, room count and GitHub configuration.
- **No build magic.** Two `tsc` invocations: one for the server (`dist/`), one for the browser (`public/js/`, emitted as native ES modules). The Socket.IO browser client is served by the server itself at `/socket.io/socket.io.js`.

---

## Project layout

```
flow-factory/
├── package.json
├── package-lock.json
├── tsconfig.json                 server build -> dist/
├── tsconfig.client.json          browser build -> public/js/
├── render.yaml
├── .env.example
├── .gitignore
├── README.md
├── scripts/
│   └── clean.js
├── public/
│   ├── index.html
│   └── styles.css
└── src/
    ├── shared/                   imported by both sides
    │   ├── constants.ts          phases, limits, simulation tuning
    │   ├── events.ts             socket event names
    │   └── types.ts
    ├── server/
    │   ├── index.ts              Express, headers, /health, static, PORT
    │   ├── sockets.ts            event wiring, broadcast, playback clock
    │   ├── game.ts               every action and the phase engine
    │   ├── state.ts              room model, store, janitor
    │   ├── view.ts               per-player projection (hides authors)
    │   ├── simulation.ts         the deterministic engine
    │   ├── snapshot.ts           anonymous JSON, path and commit message
    │   ├── github.ts             Contents API client
    │   ├── sanitize.ts
    │   ├── rateLimit.ts
    │   └── ids.ts
    ├── client/
    │   ├── main.ts               shell, phase router, facilitator bar
    │   ├── net.ts                socket store, session persistence
    │   ├── dom.ts                textContent-only element helpers
    │   ├── factory.ts            the animated factory floor
    │   └── views/                one module per phase
    └── tests/
        ├── rooms.test.ts
        ├── game.test.ts
        ├── simulation.test.ts
        ├── save.test.ts
        └── sanitize.test.ts
```

---

## Facilitator notes

- **Keyboard:** `Space` pauses and resumes a run (ignored while you are typing in a field).
- **Going back** a phase is allowed and non-destructive — useful when someone joins late during check-in.
- **Reset** wipes every submission, vote, note and upgrade in the room and asks for confirmation first. There is no undo.
- **Renaming stations** in the lobby is worth 60 seconds if your workflow does not look like the default seven.
- The app respects `prefers-reduced-motion`: belts, gears and confetti stop animating for anyone who has asked their system for that.

---

## Instructions

### 1. Run it locally

```bash
cd flow-factory
npm install
npm run dev
```

Then open <http://localhost:3000>. To test it as a group on one machine, open a second browser profile or a private window — each window is a separate player.

To pick a different port:

```bash
PORT=4000 npm run dev
```

### 2. Run the tests

```bash
npm test
```

This compiles the server and runs the suite with Node's built-in test runner — no test framework dependency. It covers room creation and codes, duplicate and invalid names, reconnection, phase transitions and permissions, simulation determinism and clamping, budget and purchase enforcement, snapshot anonymity, the filename and commit message, the Markus-only save rule, behaviour with missing GitHub configuration, and text sanitisation.

**Every GitHub request in the suite is mocked.** No test touches the network or needs a token.

### 3. Build for production

```bash
npm run build
npm start
```

`npm run build` compiles the server into `dist/` and the browser client into `public/js/`. `npm start` runs `dist/server/index.js`, which listens on `process.env.PORT`.

Verify it is healthy:

```bash
curl http://localhost:3000/health
```

### 4. Create the ZIP

From the directory **above** `flow-factory`, so the archive contains the project folder:

```bash
cd ..
zip -r flow-factory.zip flow-factory \
  -x "flow-factory/node_modules/*" \
  -x "flow-factory/dist/*" \
  -x "flow-factory/public/js/*" \
  -x "flow-factory/.git/*" \
  -x "flow-factory/.env"
```

On Windows PowerShell:

```powershell
Compress-Archive -Path .\flow-factory -DestinationPath .\flow-factory.zip
```

(Delete `node_modules`, `dist` and `public\js` first, or the archive will be enormous.)

Whoever receives the ZIP unzips it, runs `npm install`, then `npm run dev`.

### 5. Create the GitHub repository and push

Create an **empty** repository on GitHub — no README, no `.gitignore`, no licence, so the first push is not rejected. Then:

```bash
cd flow-factory
git init
git add .
git commit -m "Flow Factory: cooperative retrospective game"
git branch -M main
git remote add origin https://github.com/<OWNER>/<REPO>.git
git push -u origin main
```

`package-lock.json` **is** committed — Render needs it for `npm ci`. `node_modules/`, `dist/`, `public/js/` and `.env` are ignored.

If you intend to use the GitHub saving feature, this is also a fine repository to save the retros into; the app creates the `retro-saves/flow-factory/` folder on its first commit.

### 6. Deploy to Render

The repository includes `render.yaml`, so Render can configure itself.

**Using the blueprint:**

1. Sign in at <https://render.com>.
2. **New → Blueprint**, connect your GitHub account, and pick the repository.
3. Render reads `render.yaml` and proposes a web service named `flow-factory`. Apply it.
4. Fill in the secret environment variables when prompted (see step 7), or skip them — the game runs fine without them.

**Configuring by hand instead:**

1. **New → Web Service** and connect the repository.
2. Runtime **Node**, Build command `npm ci && npm run build`, Start command `npm start`.
3. Health check path `/health`.
4. Add an environment variable `NODE_VERSION` = `22`.
5. Create the service.

Do **not** set `PORT` yourself — Render provides it, and the server reads it.

The free plan sleeps after inactivity and wakes on the next request, which takes a few seconds. Since rooms live in memory, a sleep or a redeploy ends any session in progress. Save the retro before you finish, and for a scheduled session, wake the instance a minute early.

### 7. Set the Render environment variables

In the service, open **Environment → Environment Variables** and add:

| Key | Value |
|-----|-------|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `GITHUB_TOKEN` | the fine-grained token from step 8 |
| `GITHUB_OWNER` | the repo owner, e.g. `markus-example` |
| `GITHUB_REPO` | the repo name, e.g. `team-retros` |
| `GITHUB_BRANCH` | `main`, or whichever branch should receive the commits |

Save; Render redeploys automatically. Confirm it worked by opening `https://<your-service>.onrender.com/health` — `githubConfigured` should now be `true`.

Never commit these values. `render.yaml` marks the three secrets `sync: false` precisely so they stay out of the repository.

### 8. Create the fine-grained GitHub token

1. Go to <https://github.com/settings/personal-access-tokens> and choose **Generate new token → Fine-grained token**.
2. **Token name**: something recognisable, e.g. `flow-factory-retro-saves`.
3. **Expiration**: pick the shortest period you can live with. Set a reminder to rotate it.
4. **Resource owner**: your user, or the organisation that owns the target repository. (Organisations may require an owner to approve the token.)
5. **Repository access**: **Only select repositories**, and select just the one repository that will hold the retro files.
6. **Permissions → Repository permissions**: set **Contents** to **Read and write**. Leave **everything else at "No access"** — Contents is all the app uses, and it should not be able to do anything more. Metadata is read-only and gets included automatically.
7. Generate the token and copy it immediately; GitHub shows it once.
8. Paste it into `GITHUB_TOKEN` on Render (step 7), or into your local `.env` for testing. Never commit it, never paste it into a chat, and revoke it at <https://github.com/settings/personal-access-tokens> if it is ever exposed.

The branch in `GITHUB_BRANCH` must already exist — the app commits to a branch, it does not create one. If the repository is brand new and empty, push at least one commit first.

---

## Licence

Internal team tool. Use it, fork it, rename the stations, change the numbers.
