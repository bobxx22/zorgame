# DECISIONS

The bot that plays is the `сплав` preset (`bot/src/strategy.ts:517`, `:558`): an economy head and a Klinok head in one seat, wrapped in our pulse. The economy head plays with the memory of deadly roads (`COMBO_ECONOMY = 'roads=480'`, `bot/src/strategy.ts:525`). The show (HQ, part 3) is one self-contained page in `hq/`.

## Map

### Bot (`bot/`)

| Module | Responsibility |
|---|---|
| `bot/src/main.ts` | Process entry: reads the environment, connects to the node, retries the first entry, reconnects, writes the belief diary. |
| `bot/src/wire.ts` | Everything around the strategy that can be checked without a node: connection options, belief diary, the WireBot for `connectBot`, head snapshot and preset change for the service port. |
| `bot/src/jitter.ts` | Full jitter on top of exponential backoff for the first connection, the same law the SDK uses for reconnects. |
| `bot/src/status.ts` | The bot's internal service port; the control plane builds `/health` and `/metrics` from its snapshot. |
| `bot/src/strategy.ts` | Preset catalogue and `createStrategy`; `PulseStrategy` (keeps the slot with the bot); the mirror head `полудень` and the tactics string parser. |
| `bot/src/combo.ts` | The `сплав` preset: runs both heads on the same frame, merges their orders (Klinok rams first, then economy, then other Klinok orders), fits the frame to the order cap and channel, routes verdicts back. |
| `bot/src/combo/economy.ts` | Economy head (from the lab sparring bot `a4`): Tkachs, yard, lot bids, scans, pacts, cries, belief diary. |
| `bot/src/combo/blades.ts` | Klinok head (from the lab sparring bot `a3`): rams, jams, guards, caches. |
| `bot/src/tactics.ts` | Tactics that act inside or after the mirror head (`k0`, `hunt`, `duck`, `scout`, ...). |
| `bot/src/styles.ts` | Knob catalogue (styles) for the mirror head. |
| `bot/src/faults.ts` | Counts and logs the errors the bot survives on purpose (a head that throws on one tick). |
| `bot/src/errors.ts` | Error text for the log. |
| `bot/scripts/win-fsync.mjs` | Makes the local pack run on Windows (directory fsync becomes a no-op); not used by the stack. |
| `bot/test/*.test.mjs` | `npm test`: golden matches, combo, pulse, tactics, wire, jitter, status, end-to-end against a local node. |
| `bot/nakaz.yaml` | Our own nakaz (the charter the node plays for us if the bot is silent). |
| `control-plane/src/main.mjs` | The stack's control plane: `/health`, `/metrics`, `/presets/promote` over the bot's service port. |

### HQ (`hq/`)

| Module | Responsibility |
|---|---|
| `hq/src/main.ts` | The show: wiring of host, library, view and controls; paints once per animation frame; says `ready`. |
| `hq/src/app/library.ts` | What has been read (packs, journals, diaries) and the pool of workers that turn a journal into the truth of the world. |
| `hq/src/app/answers.ts` | One value per contract anchor at the current tick, as a pure function of the view and the data. |
| `hq/src/app/local.ts` | A pack opened by hand from files, when there is no host. |
| `hq/src/model/changes.ts` | A value over the ticks as a list of its changes; any tick is a binary search. |
| `hq/src/model/match.ts` | One match: truth by tick (from the worker) and the channel of every slot (from the journal). |
| `hq/src/model/pack.ts` | `pack.json` and what is read from summaries alone (focus slot, preset comparison). |
| `hq/src/model/belief.ts` | The focus bot's belief diary as an index by tick. |
| `hq/src/model/wire.ts` | Messages between the page and the worker. |
| `hq/src/model/guards.ts` | Shape checks for data from outside. |
| `hq/src/worker/indexer.ts` | The worker: owns the engine, runs the pass, posts truth in chunks. |
| `hq/src/worker/pass.ts` | One forward pass of the engine over a journal, written down as change rows. |
| `hq/src/view/map.ts` | The valley on one opaque canvas with an offscreen base layer. |
| `hq/src/view/strip.ts` | The focus channel over the whole match on one strip (bytes, denials, score). |
| `hq/src/view/dom.ts` | Anchors and controls in the markup (`data-zaria`). |
| `hq/src/i18n.ts` | Ukrainian and English texts. |
| `hq/src/host/guest.js` | The kit's guest wrapper (`window.ZARIA_HQ` over postMessage), as shipped. |
| `hq/src/index.html`, `hq/src/style.css` | Markup and styles of the show. |
| `hq/build.mjs` | Builds `dist/index.html` as one file with the worker inlined. |
| `hq/serve.mjs` | Static server of the `hq` service with a CSP computed from the page. |
| `hq/dev-host.mjs` | A host for the desk (the kit's host page with records); not part of the show. |
| `hq/test/*.test.ts` | Model, answers and record tests. |

## Three decisions

### 1. Two foreign heads in one seat instead of our own mirror head

**Chosen.** The battle preset is `сплав`: the economy head from the lab sparring bot `a4` and the Klinok head from `a3`, both written from the part 2 documents, run on the same observe frame. `ComboHead.tick` takes the economy's Tkach orders and orders without a unit, and the Klinok head's Klinok orders. Klinok rams go first, because a ram cannot wait a tick. Then the frame is fitted to the order cap and the channel.

**Alternatives considered.**
- Our mirror head `полудень`: the engine's own `botOrders` on a mirror world, with the tactics in `tactics.ts`.
- Each external bot whole.
- Other pairs of heads: a 40-pair sweep on 13.10, economies `a1`-`a5` and ours × Klinok heads `a1`-`a7` and ours.

On fresh lab valleys the pair beat `полудень` with its battle tactics on every pool. The numbers are in the header of `bot/src/combo.ts:8-12`: strong +0.99 ± 0.11 share per pack, mixed +0.41 ± 0.09, foreign +0.32 ± 0.06, external bots +1.57 ± 0.19. Of the 40 pairs, none beat `сплав` on all pools. Our economy with the `a7` Klinoks was +0.13…+0.23 on our own pools but -0.25 ± 0.08 on the external pool.

**Cost.**
- Two planners think every tick. In the local pack: think time p50 0.4 ms, p99 1.6-1.8 ms per tick.
- About 5,200 lines of brought-in code (`combo/economy.ts`, `combo/blades.ts`).
- The two heads keep separate pictures of the valley and do not share intent. The belief diary is the economy head's only.
- The tactics catalogue of `tactics.ts` was built for the mirror head; `сплав` plays without tactics (`COMBO_TACTICS = 'none'`, `bot/src/strategy.ts:519`).

**Where.**
- `bot/src/combo.ts:69-84`: merge order.
- `bot/src/combo.ts:87-106`: fitting the frame.
- `bot/src/combo.ts:108-119`: verdicts back to their head.
- `bot/src/strategy.ts:600-608`: `createStrategy` builds `ComboStrategy` for the preset.

### 2. A pulse that keeps the slot with the bot

**Chosen.** The node's nakaz takes the slot from the seventh tick without an accepted order (rules 23.2). Neither head has a pulse: both are silent when they have nothing to order, or when they get rejections. `PulseStrategy` counts ticks without an accepted order. After `PULSE_AFTER = 2` such ticks it puts first in the frame an order that changes nothing in the world:
- a `halt` to a unit without a task that the head did not address this frame;
- a `jam` without a target to a busy Klinok;
- a repeat of the accepted focus.

The pulse is sent only if the channel covers it together with the head's orders and the frame stays under the cap.

**Alternatives considered.**
- Let the node's nakaz play the silent ticks; we also wrote our own nakaz, `bot/nakaz.yaml`.
- A fixed `watch` every tick.

**Cost.**
- `halt` and the empty `jam` are free (rules 13.4); the focus repeat costs 32 channel bytes. One order slot in the frame on a pulse tick.
- The ordering is subtle: a `halt` to a unit the head addressed in the same frame would cancel the head's order, because the gatekeeper executes in turn. `pulseOrder` excludes such units.
- In the lab, the pair without the pulse gave the slot to the nakaz for 0.2-1.4 ticks per pack (`bot/src/combo.ts:19-21`). On the group stage code sheet the nakaz did not take the slot in any of the 12 matches.

**Where.**
- `bot/src/strategy.ts:10-23`: the rule.
- `bot/src/strategy.ts:59`: `PULSE_AFTER`.
- `bot/src/strategy.ts:95`: `pulseOrder`.
- `bot/src/strategy.ts:308`: `PulseStrategy`.
- `bot/src/strategy.ts:416-422`: the pulse goes first, and the frame is cut to the cap.

### 3. The show answers from change lists computed in a worker pool

**Chosen.** A journal carries commands, not the world. The show runs one forward pass of the engine over each match journal in a worker. After every tick the pass writes down only what changed: who owns a needle, which needles are lit, where units stand, the score. The page keeps these as change lists, so any tick, including a jump backwards, is a binary search over memory, never an engine call inside a frame. Three workers (`POOL = 3`) start before the show says `ready`, and are reused for every match.

**Alternatives considered.**
- Replay the journal up to the asked tick on every jump.
- Keep engine snapshots every N ticks and replay from the nearest one.
- Run the engine on the main thread.
- Start a worker per match when the match is opened.

**Cost.**
- A whole engine pass per match before its answers are complete; three matches of a pack are computed side by side.
- Memory for the change rows of a whole match.
- Three engine copies in memory.
- The worker code is inlined into `index.html`, because the show runs under `connect-src 'none'`.

In exchange, the frame stays cheap. On the kit driver `hq-check` (seed 7): frame p95 1.2 ms against the reference's 1.3 ms, 20 of 20 tasks.

**Where.**
- `hq/src/worker/pass.ts:115-138`: the pass writes change rows.
- `hq/src/model/changes.ts:28-59`: `pushChange`, `indexAt`, `valueAt`.
- `hq/src/app/library.ts:35`, `:96-140`: the pool started before `ready`.
- `hq/build.mjs`: the worker inlined.

## Limitations

- **The bot loses Tkachs far from home.** In the 12 group stage matches (played before the road memory) `сплав` lost 133 Tkachs: 91 to rival rams, 33 to the Keeper, 9 to lost comms. 102 of them died 10 or more cells from the bot's hearth, and in one match five Tkachs in a row were rammed at the same cell by the same rival post. The road memory (`roads`, `bot/src/combo/economy.ts`) now discounts jobs at or past a cell where a Tkach of ours was rammed within 480 ticks. It only changes which job a Tkach picks: the server chooses the path, so a Tkach sent to a safe job can still walk past a deadly cell. It knows only the deaths it has seen, not the rival's guards that have not killed yet.
- **It builds Klinoks with too few Tkachs.** 115 of its 215 Klinoks were ordered with fewer than two Tkachs alive. In the three group matches it did not win, it had no Tkach for 27-42 % of the match; in the nine it won, 1-20 %. A yard rule that held Klinoks below two Tkachs was measured in the lab and lost 0.9 share per pack, so it was not shipped; neither was an ambush of idle Klinoks on cells where a ram of ours had killed (-0.11 and -0.12 on two pools). The lab has no opponent of that disciplined style, so the trade-off against such opponents is not measured.
- **The heads do not share intent.** The economy head does not know which Klinok guards which Tkach; the Klinok head does not know where the economy will send a Tkach next.
- **Tactics do not reach `сплав`.** Tactics that act through the mirror engine (`k0`, `nofeed`, `cherta`) have no effect on `сплав`, and `сплав` plays with no tactics at all.
- **A dead HQ worker is not replaced.** When a worker of the show dies, its matches are marked failed and are not moved to another worker (`hq/src/app/library.ts:182-192`).
- **The lab measures against bots we have, not the field.** Every number above is from the lab's pools: our own presets and sixteen external bots written from the documents.
