# EPISODE

Evening 3 (2026-10-17, 15:00 UTC), match 3 of 3 (`match-3.runlog`), our slot **B** (hearth 6,6), ticks **192-291**. Rivals: diadkoshmek in A, rockhatabar in C. Code: the final submission `a1c82c4`; every path below is a line of that commit.

## How this was checked

We replayed the journal with the SDK: slots A and C send their recorded frames, and slot B is our bot built from `a1c82c4` (`createStrategy('сплав')`). On all 1200 ticks our bot sends the recorded frame of slot B byte for byte (a silent tick is an empty frame), and the final scores equal `pack.json`. So the bot of `a1c82c4` is the bot of this match, and the following are read from its own state in the replay:
- which part of the frame each order came from: the pulse, the economy head or the Klinok head;
- the jobs of both heads;
- the economy head's `hunted` / `wantKlinok`.

Events, captures, jams and positions are those of the journal.

## In short

In the bot's frame of tick 192 we have one Tkach (T-B25), one Klinok (K-B22), 14 needles, 18.8 energy and 27.7 minutes. In these hundred ticks:
1. T-B25 captures the three cells of the contract "Hold the Line". After 12 ticks of hold the contract pays +30 minutes at 246.
2. The bot takes six needles (14 to 20).
3. On our west side our rams kill T-C10 (a clean ram, 225) and K-C27 (a trade, 268). At 232 rockhatabar's K-C23 rams K-B22 and both die. We lose two Klinoks; rockhatabar loses one Tkach and two Klinoks to us.
4. The bot builds a second Tkach and two Klinoks.

After tick 291 we have 77.3 minutes.

## What happened and why

| Ticks | What the bot did | Why | Code path (`a1c82c4`) |
|---|---|---|---|
| 192-234 | T-B25 takes the three contract cells one after another: it captures 10,-2 at 210, then gets `move 8,-1` at 211 (captured at 221) and `move 10,-4` at 222 (captured at 234). | The contract of ticks 180-270 asks to hold 10,-2, 8,-1 and 10,-4 for 12 ticks. `contractPlan` makes the open cells `cap` tasks and assigns them to the Tkachs greedily by finish time. Each Tkach takes its first task as a `cap` job with `pin: 2`. With one Tkach the cells go in the contract's order: the jobs were set at 187 (10,-2), 211 (8,-1) and 222 (10,-4). | `bot/src/combo/economy.ts`: `contractPlan` (1662), assignment by finish time (1784-1808), "each Tkach takes its first task" (1819-1842, `setJob` 1832, `pin: 2` 1836); the job becomes a `move` order in `jobOrder` (2526, `move` 2552). |
| 235-246 | The hold: the three cells are ours and lit from 234. The contract's hold counter runs from 235 and pays `orderDone` +30 at 246 (38.2 → 68.4 minutes). No Tkach has to stand on the cells. | At 235 `reconcile` drops T-B25's `cap` job on 10,-4 as done, because the cell is ours. `contractPlan`, which runs after it, finds all three cells lit and returns without a new job. | `economy.ts`: `reconcile` (1072) before `contractPlan` (1079); job done (1508, dropped at 1487); all lit → return (1690-1692). |
| 192-213 | K-B22 holds a jam on the Keeper's needle 5,1 from 6,1. | The Klinok head's job `jam` (priority 2) on a Keeper needle: loot. | `bot/src/combo/blades.ts`: `planKlinoks` (1421), idle Klinoks: cache, then jam (from 1568). |
| 214-225 | `ram T-C10` for K-B22 at 214; K-B22 follows it. The ram happens at 225 on -7,13: rockhatabar loses T-C10, K-B22 survives (a clean ram: T-C10 was heating -7,13). | At 214 T-C10 stood on our lit needle -4,10, passing over it towards the free ruin -7,13. A rival Tkach on a needle of ours is the highest threat, priority 10, and the free Klinok gets it. | `blades.ts`: threat priorities in `planKlinoks` (priority 10: 1448), sorted by priority (1466), the ram order (1503). |
| 223, 225, 227 | `jam` without a target for K-B22 (223, 225), then `halt` for K-B22 (227). | The Klinok head's own slot keeper. At 223 no order of that head had been accepted since the ram at 214: its keeper's halts to T-B25 (216-221) and its watch (222) were dropped by the combo, which takes only Klinok orders from this head. At 225 and 227, 2 ticks had passed since its previous keeper jam. Each time it sends a free command that changes nothing: a jam with no target to a Klinok that jams nothing, or a halt to a unit without a task. | `blades.ts`: `step` (980), `freeKeepalive` (993, 1004, 1013); `bot/src/combo.ts`: `ComboHead.tick` takes only the Klinok head's Klinok orders (79). |
| 228-232 | `ram T-C7` for K-B22 (priority 5). At 232, on its way, K-B22 is rammed on -6,7 by rockhatabar's K-C23 (which had been jamming our needle -7,8 from -8,8). Both Klinoks die. | T-C7 had stood still on -7,7 since 212: buildable ground without a needle, next to our needle -7,8. That is the hunt rule, priority 5. | `blades.ts`: `planKlinoks`, priority 5 (1450-1452). |
| 228 | `yard ткач` with 90.8 energy (a Tkach costs 90). T-B29 comes out at 232 and gets `move -7,13`; it captures there at 265. | One Tkach and energy for a Tkach: the yard's Tkach branch (fewer than 3 Tkachs, enough energy after the lot reserve). -7,13 is the free ruin T-C10 had been heating. | `economy.ts`: `doYard` (2630), Tkach branch (2658), `yard` order (2663); the job by `assignTkachs` (2398) / `bestTkach` (2420). |
| 233-256 | `hunted = 233`; from 234 to 256 `wantKlinok` is true every tick. | At 233 the ram on K-B22 and its loss set `hunted`. `wantKlinok` is reset each tick and set again when a threat of severity 2.3 or more has no free Klinok. Here the threat is K-C27 on or next to our jammed needles (on -7,8 at 234, next to it at 235, then next to -5,9), severity 2.5, and we have no Klinok. | `economy.ts`: `case 'ram'` / `case 'lost'` (1245-1250); `wantKlinok = false` each tick (1063); threat severity (1949-1967); `wantKlinok = true` (2001-2002). |
| 235-275 | T-B25: `move 4,4` (235, captured 257), `move -1,8` (258, captured 274), `move -8,6` (275). | From 235 T-B25 has no job. Each Tkach without a job takes the one with the best value per tick of its time. | `economy.ts`: `assignTkachs` (2398), `bestTkach` (2420), `jobOrder` (2526). |
| 253-268 | `yard клинок` at 253 with 50.8 energy (a Klinok costs 50). K-B31 comes out at 257 and gets `ram K-C27` (priority 7). At 268 K-B31 rams K-C27 on -6,9: both die (a trade). | `wantKlinok` is set and there is no Klinok: the yard's first branch. There the Tkach's 90 is waived with at least 2 Tkachs or a recent loss to a ram, and both held. From 235 K-C27 jammed our needle -5,9 from -6,9. A rival Klinok next to a jammed needle of ours is priority 7. | `economy.ts`: `doYard`, first branch (2655). `blades.ts`: priority 7 (1456-1461). |
| 266 | `needle 13,3` for T-B29 (build a needle). | The economy head's best job for T-B29 after its capture at -7,13. | `economy.ts`: `bestTkach` (2420), `needle` order in `jobOrder` (2534). |
| 278-290 | `yard клинок` at 278. K-B33 comes out at 282 and walks to -1,10 to guard -2,10 (282-289). At 290 it leaves for `ram K-C24` (priority 7). | At 278 `hunted` is 269 (K-B31 lost in its ram at 268) and there is no Klinok: the yard's "hunted" branch (fewer Klinoks than wanted, at least one Tkach, energy for a Klinok). The guard is the Klinok head's escort job (priority 4) for its own plan of T-B29, a `cap` at -2,10. | `economy.ts`: `doYard`, `hunted` (2652), second branch (2656). `blades.ts`: escorts (1518, job at 1556); priority 7 (1456-1461). |
| all the range | `watch 6,6` and `halt` to T-B25 / T-B29 at the head of many frames. | (1) The pulse: after 2 ticks without an accepted order it puts first an order that changes nothing. That is a free halt to a unit without a task that the head did not address this frame (T-B25 and T-B29 while heating, at 206, 210, 218, 231, 256, 261, 265, 270, 273), otherwise a repeat of the accepted focus `watch 6,6`, which costs channel bytes (the halt is free). (2) The economy head's own slot keeper: a `watch` on the hearth 4 ticks after its last accepted order. | `bot/src/strategy.ts`: `PULSE_AFTER = 2` (59), `pulseOrder` (95-108), pulse first in the frame (416-419). `economy.ts`: `keepAlive` (2764-2780). |

## How the frame is put together

Every tick both heads of `сплав` think on the same observe frame. The frame takes, in this order:
1. the Klinok head's rams;
2. the economy head's orders for Tkachs and orders without a unit;
3. the Klinok head's other Klinok orders.

Then the frame is cut to the order cap and the channel (`bot/src/combo.ts`: `ComboHead.tick` 69-84, the class test of a unit `klinok` 35-39).

So in this range:
- Tkach orders, the yard and the economy's `watch` come from the economy head, except the pulse's halts listed above;
- all Klinok orders come from the Klinok head;
- the pulse is added on top by `PulseStrategy`.

## What this episode shows about the bot

- **The economy plays the contract well.** T-B25 captures the three cells in turn. The hold then needs no Tkach on them: +30 minutes, the largest single gain of the range.
- **Klinoks are spent and rebuilt.** One fight was clean (225). Two were trades: at 232 K-C23 rammed K-B22 on its way to T-C7, and at 268 K-B31 rammed K-C27, the jammer of -5,9. After each loss the yard ordered a new Klinok as soon as there was energy for one (253, 278). No needle of ours was lost in the range (14 → 20), but rockhatabar's jams kept -7,11 dark throughout and -5,9 dark from 235 to 287 (that jam outlived its Klinok, dead at 268, by 20 ticks).
- **The heads do not share intent.** At 282-289 K-B33 guards -2,10, where the Klinok head expects T-B29 (its own plan). Meanwhile the economy head has T-B29 walking east to build at 13,3; at 289 it is 6 cells from K-B33. This is the limitation named in `DECISIONS.md`.

## Corrections to DECISIONS.md

Found while checking this episode against `a1c82c4`:

1. **Decision 2** says neither head has a pulse and both are silent when they have nothing to order. Neither head has `PulseStrategy`'s pulse, but neither is silent: each has its own slot keeper: `keepAlive` in the economy head (`economy.ts` 2764-2780) and `freeKeepalive` / `watchKeep` in the Klinok head (`blades.ts` 993-1029). The combo drops the economy keeper's orders to Klinoks, and every order of the Klinok head's keeper except those to Klinoks (its halts to Tkachs and its watch). Then that head sees no accepted order and keeps sending its keeper, as at 216-227 above, and the pulse covers the gaps.
2. **The map** says the economy head runs pacts and cries. It does not: its orders are halt, move, needle, feed, ram, jam, yard, bid, scan and watch. Neither head ever sends a `pact` or `cry` order.
3. **Decision 3** says the HQ writes down only what changed, including the score. Ownership, lit needles and units are change rows (`hq/src/worker/pass.ts` 141-188), while the score and the needle counts are kept for every tick (`pass.ts` 120, 132-135).
