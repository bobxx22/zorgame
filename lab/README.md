# Bot lab

A local panel for analysing and comparing the part 2 bot's tactics. Matches are played by the same `@zoria/engine` as the node, in process without a network; every seat is wrapped in the SDK nakaz guard (`NakazGuard`), as on the node: six ticks of silence - and the seat's nakaz runs the slot. So a lab pack matches `zaria-kit pack` on the same lot to tenths of the score.

Our bot is the built `bot/dist` (archetype head and pulse), opponents - SDK archetype mirrors, nakaz samples or external bots (`lab/ext`); on the node an archetype in silence is run by "черепаха", as in `zaria-kit pack`.

Style names (`полудень`, `світанок`, `рівний`, ...) and the engine's words (`ткач`, `клинок`, nakaz sample names) stay in Ukrainian: they are names and values of the game.

## Running

You need Node.js 24 and `ZORIA_NPM_AUTH` to install the `@zoria/*` packages (repository root, the "Bot" section).

```bash
cd lab
npm install
npm start
```

`npm start` builds the bot (`bot/dist`) and the panel (`dist-web`) and starts the server at http://127.0.0.1:4747 (port - `LAB_PORT`). The server listens on the local address only. For panel development: `npm run serve` in one terminal and `npm run dev` in another (Vite with an `/api` proxy).

## What's there

- **Runs.** Valley lot, match length, a pack of three matches with seat rotation (rules 25.1) or a single match, three participants: our bot with any head preset, an SDK archetype, a nakaz sample, our `nakaz.yaml` or an external bot. Matches are played by threads, up to the number of cores minus one at a time; records go to `lab/runs/` (not committed).
- **Match viewer.** The valley map tick by tick: terrain and levels, coverage (who pulls a cell), threads, needles (lit, dark, jammed, crown, feeding, ring), heating with progress, units and their targets, storms, lots before opening, contract, finds, the seat's focus and scan. A timeline with playback (2 ticks per second - the node's tempo), marks of captures, losses, lots, contracts, dawn and nakaz episodes. Keys: space, ← →, Shift - 25 ticks.
- **Journal.** All engine events with filters by type and player; every seat's orders on every tick with the gatekeeper's verdicts (rejections in red, our bot's pulse - dashed).
- **Our bot** unchanged in the form plays the battle configuration: the default style is marked "(battle)", tactics - the defaults (`fill:own:6,...`); a bare head is set by turning all tactics off (`none`).
- **Our bot's tactics** - when choosing a participant: filling the head's idle time with a nakaz (an SDK sample or ours, after N ticks of silence) and refusing pacts (`bot/README.md`, "Tactics"). In the orders journal the filler nakaz's orders are green.
- **Tournaments.** Up to eight variants in participant 1's seat (our bot with different tactics or anyone as a reference) play packs on the same valleys against the same opponent pairs from the pool. Summary: average share per pack with standard error, paired difference vs variant 1 (green - more than two errors, i.e. not chance), places, score components, rejections, filled ticks and ticks under the nakaz; a grid of shares by valley, a click opens the pack on the map.
- **Summary.** Places and shares, the score and what it's made of (network, contracts, jamming loot, pact tax), needles, charge, orders, rejections, pulses and ticks when the nakaz ran the slot.
- **Play** (`#/play`). You take a seat against two bots (by default the two strongest combinations: our economy + a2 Klinoks, a4 economy + a3 Klinoks); the match waits for your move on every decision tick. Orders: pick your unit (in the list or on the map), pick a cell - go, build a needle, feed, jam, ram; the yard, focus, scan, cries, pacts and lot bids are always at hand. Play one tick or several: the seat stays silent (units keep their tasks, a free keep-alive keeps the nakaz away) or the advisor plays them; a run stops early on a loss, a captured needle, a new unit, dawn or a rejection. The **advisor** is any lab bot in your seat's shadow: it sees exactly your observe frame and proposes its orders, each with a reason read off the game state (`server/advise.ts`: target, owner, distance, prices from the manifest, the rule behind it); our battle bot also says which part of it chose the order. Fog of war shows only what the seat sees. A finished game is saved as an ordinary run and opens in the viewer. Under the hood: `server/human.ts` (the match in a thread that sleeps on shared memory while you think), `server/sessions.ts` (the games and the long poll), `shared/play.ts` (the types).
- **Language.** EN / УК in the header; the choice is remembered in the browser. Style names and engine words stay as they are.

## Night search

A search for our bot's head style (`bot/src/styles.ts`) without the panel, on all cores minus one:

```bash
cd lab
npm run search -- --hours 8
npm run search -- --hours 5 --start "широблог;зоряний;різчик"
```

- Our bot with the default tactics plays every style on the same valleys (5000-5119) against pairs of SDK archetypes in turn; the measure is the paired share difference per pack vs the battle style (`DEFAULT_PRESET`, now `полудень`).
- A generation is halving: all candidates on 30 valleys, the better half on 60, then 120. On 10 valleys the halving would be a lottery: the noise of the paired difference is 1.1-1.8 share per pack. Generation 0 - `--start` (styles separated by `;`) or the whole catalogue; after that - 8 mutations and crossings of the four best of all time.
- `klinok` mutates in steps (reachable Klinok shares in a small swarm), `guard` and `pact` - in steps of 0.1 (these are lot thresholds), `land` appears and disappears.
- When time is left only for the check, the five best and the base play 60 fresh valleys the search hasn't seen: selection on the same valleys inflates the winner's difference.
- A pack takes 22-40 s per thread, depending on the load.
- The report is `runs/search/<id>/report.md`, updated after every step; every pack is a line in `results.ndjson`. The "as base" column - how many packs the style played exactly like the base. Ctrl+C is safe, `--resume <id> --hours N` continues without repeats.
- `--pool strong` - the strong pool: our battle bot and `світанок` / `зоряний` / `широблог` without feeding, `облягач`, the `експансія` nakaz. `--pool foreign` - not a single head of ours without feeding: the archetypes `рівний`, `облягач`, `проривник`, `опортуніст` and `рейдер` with `fill:own:6` only, the `експансія` nakaz - checks whether a tactic works not only against copies of ours. `--pool ext` - all external bots from `lab/ext`.
- `--pool mixed` - a mixed pool of opponents instead of SDK archetypes: our bot in battle configuration, the archetypes `рівний` and `облягач`, the engine styles `опортуніст` and `рейдер` and a bot whose slot is run by the `експансія` nakaz. A style strong only against SDK archetypes will show it here. The pool is fixed in `config.json` at start.
- A `--start` candidate is a preset of our bot (a style, a style string or a nakaz head `nakaz:<nakaz>`) and, after `|`, its own tactics instead of the defaults: `світанок|fill:own:6,ram:6`, `nakaz:експансія|none`. Only the style mutates, tactics are inherited. With `--eval` a candidate can also be an external bot `ext:<name>` (`ext:a3@order=TTKKK` - with a preset) or a mixed bot `mix:e=<source>,k=<source>` (`server/mix.ts`: the economy of one source, the Klinoks of another; sources - external bots, `ours` or `ours@duck+dawn:40`).
- The check's winner (both in the search and in `--eval`) plays once more on a second fresh set together with the base: it was chosen on the first one, so its difference there is inflated.
- The mixed pool: a copy of our battle bot (`DEFAULT_PRESET` with `DEFAULT_TACTICS`), `рівний`, `облягач`, `опортуніст` and `рейдер` in our wrapper with `fill:own:6` (fixed so the pool doesn't drift with our finds), a bot under the `експансія` nakaz. The pool's composition with tactics is in the report header.
- `--eval 1` - a comparison without selection: all of `--start` and the base on `--validate` fresh valleys, with the difference against each opponent of the pool. For checking hypotheses when generations aren't needed.
- The engine and the bot commit are written into `config.json` and the report header; `--resume` on another engine refuses.
- Flags: `--hours`, `--workers`, `--from` (first valley), `--validate` (fresh valleys), `--base`, `--ticks`, `--start`, `--pool`, `--eval`.
- On a remote server: `scripts/worker.sh` (deploy, start, queue, status, report, pull, stop; see the header of the script).

A style string from the report (`широблог+raid=1.5,...`) can be given to the bot as `ZARIA_PRESET` or added to the catalogue under a name.

## External bots

`lab/ext/<name>/strategy.ts` - opponents built by the kit template contract (`createStrategy`, `presets`), compiled next to it into `strategy.js` by `node scripts/ext-build.mjs <name>=<path to strategy.ts>`. They appear in the seat choice, the random opponents, the tournament pool and `--pool ext`.

## Record format

`shared/record.ts`: the static valley from the manifest and a frame per tick - players, owned needles, units, heating, events, orders and rejections of all seats, eyes, contract, and for our seat - what the bot saw and when the pulse fired. A match record is `runs/<run>/match-<n>.json.gz`, about 160 KB.
