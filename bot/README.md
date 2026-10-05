# Zorya bot

The part 2 bot template. The part 2 documents are in the `@zoria/kit` package:
`npx zaria-kit docs` prints where they are.

## Commands

| Command | What it does |
|---|---|
| `npm install` | installs the `@zoria/*` packages from the registry (needs the `ZORIA_NPM_AUTH` variable, `02-path.md`) |
| `npm run build` | builds the bot into `dist/` |
| `npm run play -- --fast` | builds and plays a local pack: three matches, your bot at vertices A, B, C |
| `npm run play` | the same at 500 ms per tick, as in the scoring |
| `npm run lint:nakaz` | the three stages of the nakaz linter |
| `npm test` | builds the bot and runs the `test/` tests (built-in `node --test`, no network): pulse, wire, diary, service port and three end-to-end packs on a local node - a normal one, one with a foreign engine (P2-03) and one with a 1.5 s wire drop |
| `npm run play:win -- --fast` | the same as `play`, on Windows (see below) |
| `npx zaria-kit replay records/<pack>` | replay a record and check the score |
| `npx zaria-kit version` | engine hash and package versions |

Pack flags: `--seed`, `--packs`, `--ticks`, `--vs`, `--bot`; all of them -
`npx zaria-kit help`.

The commands' output language is Ukrainian: it is set by the `zaria.lang` field in `package.json`
(`uk` or `en`). For a single run - the `--lang` flag or the `ZARIA_LANG` variable. The end-to-end
tests match the node's Ukrainian log lines, so switching it to `en` needs the tests updated too.

## Files

| File | What's in it |
|---|---|
| `src/strategy.ts` | strategy: a mirror head with a style (`ZARIA_PRESET`, `полудень` by default) and a pulse - a safe order first in the frame after 2 ticks without an accepted order (the head is silent or was rejected), so the slot doesn't pass to the nakaz (P2-04) |
| `src/tactics.ts` | tactics inside the head and after it (see the index at the top of the file) |
| `src/styles.ts` | head styles: the catalogue (5 SDK archetypes, 3 engine styles, our mixes) and the string `base+knob=number,...` |
| `src/wire.ts` | everything around the strategy: connection and reconnect options, belief diary, head snapshot for the service port |
| `src/main.ts` | startup: environment, oath with entry retries, service port; the rest is in `wire.ts` |
| `src/jitter.ts` | the pause before retrying the first entry |
| `src/status.ts` | the head's internal service port (`STATUS_PORT`); the stack reads it |
| `nakaz.yaml` | our charter; sample - the SDK's `minutes.yaml` |
| `.npmrc` | the `@zoria` registry and a reference to the `ZORIA_NPM_AUTH` variable; there is no secret in the file |

`records/` - local pack records; not committed to the repository.

Style names (`полудень`, `світанок`, `рівний`, ...) and the engine's words (`ткач`, `клинок`, `різчик`, nakaz sample names) stay in Ukrainian: they are names and values of the game, not text.

## Head styles

There is one head - the engine mirror (`MirrorBot`); a style is only the weights of its estimates: what costs how much (ruin, foreign needle, jamming, contract, building, spare path, siege, pact). `ZARIA_PRESET` is a name from the `src/styles.ts` catalogue or a string `base+knob=number,...`, for example `рівний+raid=1.5,pact=1` or `облягач+mind=`. Knob bounds - `KNOB_MAX`, the `land` knob (0-2) - only when set explicitly; an invalid string - we play the default style.

Default - `полудень` with the tactics `nofeed:1200` and `ram:6`: the winner of the 01.10 search, where the style was searched together with these tactics (`світанок` with `grow 2.25`, `order 1.55`, `raid 1.35`, `scout 1.35`, `siege 1.2`, `build 0.25`, `land 1`). Vs `світанок` with `fill:own:6`, which played in battle before: **+1.55 ± 0.21** share per pack on 60 fresh valleys vs the mixed pool, 84 % first places, 0.2 rejections per pack; better against every opponent in the pool (+1.1…+2.75). It's the best of five finalists on the same 60 valleys (the rest +1.27…+1.50), so the selection inflates it a little. What it's made of: `nofeed:1200` - about +1.05, `ram:6` - +0.17, the style itself - about +0.2 (vs `світанок` with the same tactics: +0.23 ± 0.10 on 120 search valleys).

Earlier steps, paired share difference per pack on valleys the selection didn't see:

| style | vs pairs of SDK archetypes | vs the mixed pool | 1st places |
|---|---|---|---|
| `світанок` | +0.83 ± 0.15 vs `широблог` (60 valleys) | +1.06 ± 0.12 vs `широблог` (120 valleys) | 54-60% |
| `широблог` | +0.53 ± 0.17 vs `рівний` (80 valleys) | 0 | 35-43% |
| `рівний` | 0 | - | 30% |

The mixed pool - our bot in battle configuration, the archetypes `рівний` and `облягач`, the engine styles `опортуніст` and `рейдер`, a bot under the `експансія` nakaz. Against every opponent in the pool `світанок` beats `широблог` by +0.8…+1.3 share per pack. +1.06 ± 0.12 is 120 search valleys where `світанок` was the starting style, not a selected one, so the selection doesn't inflate this number. The strongest in the pool is still not a head, but the bot under the `експансія` nakaz (4 Tkachs, no Klinoks, pacts or feeding): on 30 check packs on 30.09-01.10 it scored 7.6 share per pack. Re-measure after the 05.10 world shift. The best style is searched by the lab's night search (`lab/README.md`, "Night search").

## Tactics

On top of the head - tactics. By default (the `ZARIA_TACTICS` variable is unset or empty) the bot plays with `fill:own:6,nofeed:1200,nohook,cherta,hunt:12`. Since 02.10 - `cherta` and ram v2 `hunt` (instead of `ram:6`). Three pools: strong (our battle bot, `світанок` / `зоряний` / `широблог` without feeding, `облягач`, the `експансія` nakaz), foreign (archetypes `рівний` / `облягач` / `проривник`, styles `опортуніст` / `рейдер` with the filler only, the `експансія` nakaz - no copy of ours) and mixed. Re-measure 2×2 after the 02.10 fixes (120-150 fresh valleys per pool): without `cherta` the battle bot loses 13-35 minutes per pack on the strong pool, 77-90 on the foreign one and 55-60 on the mixed one; with `cherta` the rams `hunt:6` and `ram:6` are equal. Hunter radius 12 instead of 6: foreign pool +0.13 ± 0.04 share (+57 minutes) and +0.13 ± 0.04 (+51) on the second set, strong +0.23 ± 0.08 and +0.39 ± 0.09, mixed +0.16 ± 0.06 - a plus against every opponent, no more rejections. The filler fires rarely, about one tick per match: on 60 fresh valleys the bot without tactics vs `fill:own:6` - −0.10 ± 0.15 share per pack, within the error. It is kept because it does no harm, and in a long idle stretch it gives a Tkach. Another set is given by `ZARIA_TACTICS`, comma separated, `none` - no tactics:

| Tactic | What it does |
|---|---|
| `fill:<nakaz>[:N]` | the head's idle time is filled by a nakaz: an SDK sample (`черепаха`, `експансія`, `економка`, `хвилини`, `замовлення`, `тиск`) or `own` (`nakaz.yaml`; the old name `наш` still works). The nakaz runs inside the bot every tick; its orders go into the frame when the head is silent for more than N ticks (0 by default). The slot stays with the bot - this is not the node's nakaz episode |
| `nopact` | never offer or accept pacts: the pact tax is a tenth of the income of every tick (rules 19.5). Harmful: −0.55 ± 0.23 share per pack on 40 fresh valleys |
| `nofeed:T` | the head doesn't put Tkachs on feeding before tick T (1200 - never). In its decision queue feeding comes before the target, and the first free Tkach after 4 lit needles goes feeding for good. For the time of the head's decision the tactic marks all our lit needles as already fed (`src/tactics.ts`) |
| `k0:T` | no Klinoks from the yard before tick T: the head reads the `klinok` knob every tick, the tactic keeps it at zero |
| `ram:R` | ram: a free Klinok within R steps rams an enemy Tkach standing on a needle that isn't his. The ram is clean (the Klinok lives, rules 11.7) only if the Tkach is heating or building at the moment of impact; otherwise it's a trade of a Klinok (50) for a Tkach (90). Tkachs on our needles first; not the Keeper and not a pact partner; channel and frame cap are checked; a rejected "hunter - target" pair isn't repeated for 15 ticks |
| `hunt:R` | ram v2 (battle - `hunt:12`, R - the largest hunter-prey distance): the hunter is a Klinok in the zone that the head gave nothing or only an "empty" `jam` (the ram takes its place); a siege holder - only for our needle within 3 steps. The prey has stood on the cell ≥ 3 ticks, not on a start needle, not on its pact partner's needle, not on our needle in the pause after a capture; the Klinok makes it before the heating ends. A chase that lost its point (the prey stepped off, the needle became its own) is dropped with a free `halt` |
| `cherta` | before dawn and without mercy the head, for the time of the decision, doesn't see needles inside the cherta: the Keeper rams the Tkachs that heat them, and there are almost no captures there. A Tkach already heading inside the line is stopped; a Klinok that would jam the ring from inside the line - without a target |
| `stay:K` | don't recall home a Tkach that is ≤ K ticks from capturing a foreign or unowned needle if the leash holds (`away` + remainder + way back + 4 ≤ `autonomy`); inside the line before dawn - don't hold |
| `nohook` | a find's hook (rules 16.8) leads a unit to a cache or flare and back to the point where it turned, even when the Tkach already stands on its target needle. Then the tactic gives a `move` to the same cell: the path is empty, the target is the same, heating isn't interrupted (`simHeat` looks at the cell, not the task). On valley 45092 the capture is 3 ticks earlier, the cache is picked up all the same. Cuts only the trail where the find gives nothing any more (taken, or a cache under the cap would leave < 50); a cache that still pays is delivered by the hook. On two sets of 60 valleys ±0.03 - within the noise, no risk. On in battle |
| `cache:N` | a cache gives the full 150 (charge + 150 ≤ 360) - the nearest-in-time free unit within N cells goes for it: an idle Klinok (steps twice as fast) or a Tkach without a task; a Tkach that heats or walks to its target is never taken off; one unit per cache. Off: +0.02 ± 0.04 and +0.03 ± 0.06 on two sets of 60 valleys, but ~0.1 rejections per pack |
| `yardcap` | don't order a unit above the swarm weight: units in the field and hulls in the yard queue plus the new one ≤ `squadWeight` (the "swarm weight" rejection, the most frequent for a nakaz head) |
| `dawn:N`, `loot:K`, `duck` | experimental (ideas from external bots, 03-04.10): a Tkach waits for dawn next to a ring needle; Klinoks jam a lit ring needle from beyond the line for loot; a working Tkach steps aside from an enemy Klinok. Not in battle: `duck` measured 0…+0.2 ± 0.17 |

The 01.10 check (`--eval`, 60 fresh valleys, mixed pool, vs `світанок` with `fill:own:6`): `nofeed:1200` +1.05 ± 0.19, `nofeed:600` +0.78 ± 0.20, `k0:400` +0.28 ± 0.17, `ram:6` +0.17 ± 0.09. In battle at that time - `nofeed:1200` and `ram:6`; `k0` off.

### Nakaz head

`ZARIA_PRESET=nakaz:<nakaz>` (an SDK sample or `own`) - instead of the engine mirror, a nakaz thinks inside the bot. The pulse and the tactics after the head work as always, so the slot stays with the bot: a bare nakaz in its place is silent in ticks without business, and the node gives the slot to the nakaz (rules 23.2). Such a head's belief diary is empty.

Which tactic is stronger is decided by the lab's tournament (`lab/`): the same valleys and opponents, a paired comparison with the reference.

## Windows

- `@zoria/server` syncs the directory (`fsync`) after every write, and Windows can't do that (`EPERM`), so the pack stops after the first match. `npm run play:win` runs the pack with `scripts/win-fsync.mjs`: on Windows the directory sync becomes a no-op, files are synced as before; on Linux and macOS nothing changes. The flag applies only to the pack process, so it doesn't touch `node` and `npm` in other directories:

  ```powershell
  npm run play:win -- --fast
  ```

- The `--bot` command goes through `cmd`, so an environment variable is set like this (the P2-03 check):

  ```powershell
  npm run play:win -- --fast --ticks 60 --bot "set ZARIA_ENGINE=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&& node dist/main.js"
  ```

- The level 3 provocateur (`--provoke 3`) checks nothing on Windows: the kit starts the bot through a shell, and `SIGKILL` kills `cmd.exe`, not `node`. Level 3 - in WSL or Linux; on Windows only levels 1 and 2 are meaningful.

## Service port

`STATUS_PORT` turns on the head's internal port: `GET /state` returns a snapshot
of the wire (tick, frames, counters, diary), `POST /preset` changes the preset
between matches. The local pack doesn't need it and it is off by default;
the part 4 stack turns it on (`npx zaria-kit init stack`), and from this snapshot
its control-plane builds `/health` and `/metrics` of the service contract.
With the port on, the head doesn't exit after a match but stays alive and
reports its end.
