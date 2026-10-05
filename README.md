# zorgame

A client of the Зоря.нет network for the ZORIA contest. It listens to the ether and checks the station's seal, registers during the window with an application code, shows the repository access status, letters, news and the parts of the task. Later it will grow into a game HQ.

The part 2 bot is in the `bot/` directory (see [Bot](#bot-part-2)), the lab for analysing its matches and comparing tactics is in `lab/` (`lab/README.md`).

The client's interface stays in Ukrainian (it is the part 1 product); code comments and documentation are in English. Quoted interface texts below are given as they appear in the app.

Contract - the 22.09.2026 edition: registration needs a one-time application code (the `invitation` field), the repository - any of your own, but private.

## Requirements

- Node.js 24 or newer (the client is fine with 22.12, the bot needs 24 - P2-08)
- npm (dependencies are pinned by `client/package-lock.json`)
- a browser with Ed25519 in WebCrypto: Chrome 137+, Firefox 129+, Safari 17.4+
- a secure page origin: `localhost`, `https` or a file. Over `http` from an IP address the browser turns cryptography off, and the client says so

## Install and run

```bash
cd client
npm ci
npm run dev
```

The app opens at http://localhost:5173.

Build and preview the built version:

```bash
cd client
npm run build
npm run preview
```

Standalone build: a single file `client/dist-single/index.html`, everything inside (code, styles, fonts, images, sounds), opens with a double click. The file itself loads nothing extra; the client talks only to the network API. The P3-03 requirement for the HQ (not a single network request after opening) concerns part 3 and will be checked against its text; per the FAQ the HQ skeleton comes from `npx zaria-kit init hq`:

```bash
cd client
npm run build:single
```

## Bot (part 2)

The bot lives in `bot/` and is built from the `npx @zoria/kit init bot` template. The `@zoria/*` packages are in the private registry https://npm.zoria.net/, so `npm ci` needs the `ZORIA_NPM_AUTH` variable - the `auth` field of the `GET /api/v1/me/registry-token` answer (the procedure - `02-path.md` in the `@zoria/kit` package). The hub's answer lives outside the repository, in `~/.zoria-registry.json`; `bot/.npmrc` only holds the `${ZORIA_NPM_AUTH}` reference.

```bash
cd bot
export ZORIA_NPM_AUTH=$(node -p "require(process.env.HOME + '/.zoria-registry.json').auth")
npm ci
npm run build
npm test
npm run play -- --fast
```

In PowerShell the variable is set like this (there is no `export` or `HOME` there), and on Windows the pack is played by `npm run play:win` (`bot/README.md`, the "Windows" section):

```powershell
$env:ZORIA_NPM_AUTH = node -p "require(require('os').homedir() + '/.zoria-registry.json').auth"
```

An `.npmrc` with the `@zoria` registry is both in the root and in `bot/`: the checklist's `npm view @zoria/engine version` answers with a version from both places. It doesn't affect the client: `client/` has its own `package.json`.

Bot commands, files and pack flags - `bot/README.md`; the part 2 documents - `npx zaria-kit docs`.

The registry secret never gets into the repository (P2-07): before a commit

```bash
node scripts/check-secrets.mjs
```

looks for the registry's `token` and `auth` values and the application code from `client/.env.local` in the files (binary ones too), in the staged commit and in the whole history, and checks that every `.npmrc` only references the variable. It doesn't print the values.

## Submission stack (part 4)

`compose.yaml` at the root builds two images from the commit: the head (`bot/Dockerfile`, the bot from part 2 on the wire) and `control-plane/` (the service handles `/health`, `/metrics`, `/belief-stream`, `/presets/promote` on port 7801). Roles, labels and variables - `STACK.md`. The kit of parts 3 and 4 is installed at the root:

```bash
npm ci                     # @zoria/kit at the root, needs ZORIA_NPM_AUTH
npx zaria-kit preflight    # the same eleven stages as the organizers' run (Docker with compose v2)
```

The head plays its own battle style: `ZARIA_PRESET` is empty in `compose.yaml`, so the bot falls back to `DEFAULT_PRESET` and `DEFAULT_TACTICS`, and its image carries `bot/nakaz.yaml` for the `fill:own` tactic. On Docker Desktop for Windows the local preflight cannot reach the containers (it uses the Linux `docker0` bridge address); run it on Linux.

## Commands

All commands below run in the `client` directory.

| Command | What it does |
|---|---|
| `npm ci` | installs dependencies exactly per `package-lock.json` |
| `npm run dev` | Vite dev server with hot reload, http://localhost:5173 |
| `npm run build` | type check (`tsc -b`) and build into `client/dist` |
| `npm run build:single` | the same, but into one self-contained `client/dist-single/index.html`; `scripts/check-single.mjs` checks there is nothing next to it and no external links either |
| `npm run preview` | serves the built `client/dist`, http://localhost:4173 |
| `npm run typecheck` | TypeScript type check only |
| `npm run lint` | ESLint with type-aware checks (unhandled promises, empty `catch` etc.) |
| `npm test` | all tests once (Vitest) |
| `npm run test:watch` | tests in watch mode |
| `npm run gen:api` | regenerate `src/api/schema.gen.ts` from `api/part1.openapi.yaml` |
| `npm run mock` | a local stand at http://localhost:8787 (see below) |

## Server

The server address is a setting, no code changes needed.

- In the app: the «Сервер» (server) switch at the bottom of the page (the choice is remembered in the browser).
- Through environment variables: copy `client/.env.example` to `client/.env.local`.

| `VITE_ZORIA_SERVER` value | Address |
|---|---|
| `prod` (default) | https://zoria.net/api/v1 |
| `stand` | https://stand.zoria.net/api/v1 |
| `custom` | `VITE_ZORIA_API_URL`, e.g. the local stand |

The seal key fingerprints are built in (`src/config/servers.ts`): production - from the TZ, section 3 (23.09), the stand - permanent, from the specification. The client rejects a key with a different fingerprint. The variables `VITE_ZORIA_PROD_KEY_FINGERPRINT` and `VITE_ZORIA_STAND_KEY_FINGERPRINT` only override them.

If the organizers change the station key, the new fingerprint will be published as a TZ clarification and a news item. Until then the client rejects the new key («Відбиток ключа не збігається з опублікованим у ТЗ» - the key fingerprint doesn't match the one published in the TZ) and doesn't trust the frames. What to do: check the fingerprint on zoria.net (not from a letter or a chat), write it into `client/.env.local` as `VITE_ZORIA_PROD_KEY_FINGERPRINT=…` and restart `npm run dev`; later update `PROD_KEY_FINGERPRINT` in the code. There is deliberately no fingerprint field in the interface: that way it can't be swapped through a fake "news item".

The application code can be put into `client/.env.local` as `VITE_ZORIA_INVITATION`: under `npm run dev` it is prefilled in the form for the production server (not for the stand). The code never gets into builds.

Tokens, passwords and the application code never get into the repository: `.env.local` is excluded in `.gitignore`.

## After the window

- In the `after` phase the ether is polled once every 5 minutes: there is nothing new there any more, and every request without a token spends the address's ether limit. While the journal is open - as usual: the ether every 15 s, the journal once a minute. The cabinet summary - every 15 s (CL-08).
- A session lives a day. An hour before the end the client warns, and after it asks to log in again; the client doesn't store the password.
- A lost password is replaced only by a one-time code from the organizers (the FAQ of 25.09): the «Загубили пароль?» (lost your password?) form under the login sends `POST /auth/recover` with `{token, password}`. Contract 1.1.0 doesn't have this route yet.

## Local stand

`client/mock/server.mjs` - an imitation of the stand for development: the part 1 protocol (ether, registration, login, repository application, letters, news, task parts), frames sealed with a key generated at startup, interference, the limit and jamming, phases in a short cycle.

```bash
cd client
npm run mock
```

The default cycle is 10 minutes: the first half is noise (from a third of the cycle - the harbinger), then the window and after the window. In development mode the server switch gets «Локальний сервер» (local server) (`client/.env.development`).

| Variable | Default | What it does |
|---|---|---|
| `MOCK_PORT` | `8787` | port |
| `MOCK_CYCLE_MIN` | `10` | cycle length, minutes |
| `MOCK_PHASE` | `static` | where to start the cycle: `static`, `harbinger`, `window`, `after` |
| `MOCK_NOISE` | `0.6` | share of interference before the window |
| `MOCK_INVITATION` | `STAND-2026` | the application code the stand accepts (like the training one on the real stand) |
| `MOCK_CODE_ONCE` | `1` | the code works once, as on the production server; `0` - reusable |
| `MOCK_CABINET_FAIL` | `0` | share of cabinet reads (GET) that fail with 502: a check of re-reading |
| `MOCK_LOSE` | `0.15` | share of registrations whose answer is lost after the account is created |
| `MOCK_BUSY` | `0.1` | share of logins and registrations answered with `429 authentication-busy` |
| `MOCK_VERIFY_SEC` | `0` | after how many seconds the application becomes `verified` (0 - stays `pending`, as on the stand) |
| `MOCK_STAGE2_SEC` | `120` | how many seconds after registration "part 2" is issued |
| `MOCK_ERRATA_SEC` | `240` | how many seconds after registration a clarification to it arrives |

Example: the window right away and the application confirmed in a minute. The application code for the stand is `STAND-2026`.

```bash
MOCK_PHASE=window MOCK_VERIFY_SEC=60 npm run mock
```

The stand keeps everything in memory: after a restart there are no accounts, the seal key is new. The password recovery code on it is `RECOVER-<login>`, it works once.

## Structure

```
.zoria                  login in the Зоря.нет network
client/                 network client (React + TypeScript + Vite)
  api/                  part 1 OpenAPI contract (MIT, from the organizers)
  mock/                 local stand for development
  src/api/              exchange with the server: safe fetch, ether limit, 429, retries
  src/ether/            ether: Ed25519 seal, frames, station state, listening
  src/auth/             registration with recovery by login, session, field validation
  src/cabinet/          summary, letters, news, task parts, safe Markdown
  src/app/              app shell: header, footer, providers, routes, draft guard
  src/config/           server addresses and keys, season dates, application code from .env.local
  src/lib/              shared utilities (time etc.)
  src/pages/            screens
  src/ui/               shared interface elements: sign, icons, scene, document, season scale
  src/sound/            station sound: signals and voice on events, the M key
  src/assets/           fonts (OFL), scenes, sounds
  scripts/              standalone build check
compose.yaml            submission stack (STACK.md)
control-plane/          the bot's service handles in the stack
bot/                    part 2 bot (bot/README.md), its Dockerfile for the stack
lab/                    bot lab: match viewer, tournaments, night search (lab/README.md)
scripts/                repository checks (check-secrets.mjs)
```

## Sound and notifications

Sound is a sign of an event, not a background: the harbinger, the last 10 seconds before the window, the window, registration, "confirmed", a letter, a new part, jamming, session loss. After the signal - the station's voice. It is turned off by the button in the header or the `M` key. The browser allows sound only after the first click or key press on the page.

When the tab is in the background, the system (browser notifications) tells about a new letter, a new part, an access status change, the approaching end and session loss. The client asks for permission at login or when drafting the application; the state and the button are in «Налаштування» (settings) on the «Вихід на зв’язок» (going on air) page. The number of unread letters is shown in the tab title.

## Resources

- Fonts Golos Text, Unbounded, IBM Plex Mono - SIL Open Font License 1.1, the license text is in `client/src/assets/fonts/OFL.txt`.
- Sound signals - from the Sonniss GDC 2019 pack (royalty-free, no mandatory attribution).
