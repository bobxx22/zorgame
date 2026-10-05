/* lab :: play
   A pack without recording frames: the same seats, rotation and nakaz guard as
   in recordMatch, but only the result - for the night search, where packs number in thousands. */

import { createEngine } from '@zoria/engine';
import { openMatch, placementShares } from '@zoria/sdk';
import type { WireBot } from '@zoria/sdk';
import { NakazGuard } from '@zoria/sdk/nakaz';
import { decodeOrders } from '@zoria/protocol';
import { SLOTS } from '../shared/record.ts';
import type { SeatSpec, Slot } from '../shared/record.ts';
import { makeBot, seatNakaz } from './recorder.ts';

/* a participant's result per pack */
export interface PackSeat {
  share: number;
  places: number[];
  score: number;
  /* the average score of the two opponents at the table, sum per pack: the
     difference in minutes is finer than places when shares hit the scale's ceiling */
  oppScore: number;
  denials: number;
  /* rejections by source, order and code: "head:needle:11" (our bot only) */
  denialKinds: Record<string, number>;
  nakazTicks: number;
}

export function playPack(seed: number, ticks: number, lineup: readonly [SeatSpec, SeatSpec, SeatSpec]): PackSeat[] {
  const out: PackSeat[] = lineup.map(() => ({ share: 0, places: [], score: 0, oppScore: 0, denials: 0, denialKinds: {}, nakazTicks: 0 }));
  for (let index = 0; index < 3; index++) {
    const seatOf = {} as Record<Slot, number>;
    const bots: Partial<Record<Slot, WireBot>> = {};
    const guards = new Map<Slot, NakazGuard>();
    /* our bot (its strategy knows the sources of the frame's orders) and the seats' last order frame */
    const ours = new Map<Slot, { strategy: { lastSources: readonly string[] } }>();
    const sent = new Map<Slot, { kind: string }[]>();
    for (let k = 0; k < 3; k++) {
      const slot = SLOTS[(k + index) % 3]!;
      const spec = lineup[k]!;
      const bot = makeBot(spec);
      if ('strategy' in bot) ours.set(slot, bot as unknown as { strategy: { lastSources: readonly string[] } });
      const guard = new NakazGuard(bot, seatNakaz(spec));
      seatOf[slot] = k;
      guards.set(slot, guard);
      bots[slot] = guard;
    }
    const match = openMatch(createEngine, {
      seed,
      ticks,
      bots,
      tapOrders: (_t, slot, bytes) => {
        sent.set(slot as Slot, (decodeOrders(bytes) ?? []) as { kind: string }[]);
      },
      tapDenies: (_t, slot, denies) => {
        const seat = out[seatOf[slot as Slot]]!;
        const frame = sent.get(slot as Slot) ?? [];
        const src = ours.get(slot as Slot)?.strategy.lastSources ?? [];
        for (const [pos, code] of denies) {
          if (code === 0) continue;
          seat.denials++;
          const key = (src[pos] ?? '?') + ':' + (frame[pos]?.kind ?? '?') + ':' + code;
          seat.denialKinds[key] = (seat.denialKinds[key] ?? 0) + 1;
        }
      },
    });
    while (!match.done()) match.step();
    const summary = match.summary();
    const rows = SLOTS.map((s) => ({ score: summary.score[s], lit: summary.lit[s], energy: summary.energy[s], needles: summary.needles[s] }));
    const shares = placementShares(rows);
    for (const [i, s] of SLOTS.entries()) {
      const seat = out[seatOf[s]]!;
      const score = summary.score[s] ?? 0;
      seat.share += shares[i] ?? 0;
      seat.places.push(1 + SLOTS.filter((o) => o !== s && (summary.score[o] ?? 0) > score).length);
      seat.score += score;
      seat.oppScore += SLOTS.filter((o) => o !== s).reduce((sum, o) => sum + (summary.score[o] ?? 0), 0) / 2;
      seat.nakazTicks += guards.get(s)?.nakazTicks ?? 0;
    }
  }
  return out;
}
