# Zoria HQ: the show

The second entry point of the application (part 3). The dashboard in `client/`
talks to the network API; the show opens with no network at all - at
acceptance, on the broadcast, and locally under the driver - and is fed by the
show host through `window.ZARIA_HQ` (`part3/01-hq-contract.md`).

It shows a pack record or a match in progress: the valley with the truth of the
world and the belief of the focus bot, the score, the channel of the focus by
tick, the comparison of two presets and the promotion request.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | installs the dependencies (needs `ZORIA_NPM_AUTH`, as the bot does) |
| `npm run build` | builds `dist/index.html`: one self-contained file |
| `npm test` | unit tests of the model; with `records/` present, also the pass over the reference journal against the engine |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npx zaria-kit records` | puts the acceptance material into `records/` (not committed) |
| `npm run host` | the kit's host page with the built show in its sandbox: http://localhost:8790/host/ |
| `npm run host -- --live 2` | match 2 of the reference record as a broadcast |
| `npx zaria-kit hq-check --seed 4242` | the acceptance driver: twenty tasks and the frame |

`zaria-kit hq-check` needs Chrome or Chromium (`CHROME` names the binary). The
driver of kit 1.1.4 compares file paths with `/` and serves nothing on Windows:
run it under Linux or WSL.

## How it works

The journal of a match carries commands, not the world; the world is computed
by the engine (`part3/03-record.md`, 3.1). The show does this once per match,
in a worker, in one forward pass, and writes down what it needs - the score,
the lit needles, the owner of every needle, the place of every unit - as
changes by tick. The page keeps these and answers any tick from memory: a jump
is a binary search, and no frame ever waits for the engine.

| File | What is in it |
|---|---|
| `src/main.ts` | the show: controls, the view, one paint per animation frame |
| `src/app/answers.ts` | the value of every anchor of the contract at the tick the show stands on |
| `src/app/library.ts` | packs, journals, diaries and the pool of workers |
| `src/app/local.ts` | a record opened by hand, when there is no host |
| `src/model/match.ts` | one match by tick: the truth and the channel |
| `src/model/belief.ts` | the belief diary by tick |
| `src/model/pack.ts` | the pack summary and the comparison of two presets |
| `src/model/changes.ts` | a value that changes over ticks |
| `src/worker/` | the worker: the pass of the engine over a journal, recorded or live |
| `src/view/` | anchors and controls in the markup, the map, the channel strip |
| `src/host/guest.js` | the kit's wrapper of the show host, as shipped |
| `build.mjs` | the build: the worker bundle as text inside the page bundle inside `index.html` |
| `dev-host.mjs` | a show host for the desk; not part of the built show |
| `Dockerfile`, `serve.mjs` | the `hq` service of the submission stack |

Three workers are started when the page loads and are reused: starting one
later would be a request from the show. The pack the show opens with is
computed whole, three matches side by side, before the show tells the host it
is ready (and no later than 8 s after the page started: the opening budget is
15 s). After `ready` every answer about that pack is a lookup, on any machine,
and no engine runs while frames are measured. A pack opened later is computed
match by match, when the show first stands on one, and in the pauses.

The page repaints only for what shows: a chunk of the truth for a match that is
not on screen costs no frame. The valley is one opaque canvas, and the boxes
with rounded corners have no paint containment: without a graphics card the
compositor pays for every blended layer and every rounded clip on every frame.

On the broadcast the same pass runs over a journal that grows with every tick.
The show stands on the last tick whose truth has arrived, so the tick and the
numbers next to it always belong together.
