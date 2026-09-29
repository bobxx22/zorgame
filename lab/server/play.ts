/* lab :: play
   Пакет без запису кадрів: ті самі місця, пересадка і вартовий наказу, що й
   у recordMatch, але лише підсумок - для нічного пошуку, де пакетів тисячі. */

import { createEngine } from '@zoria/engine';
import { openMatch, placementShares } from '@zoria/sdk';
import type { WireBot } from '@zoria/sdk';
import { NakazGuard } from '@zoria/sdk/nakaz';
import { SLOTS } from '../shared/record.ts';
import type { SeatSpec, Slot } from '../shared/record.ts';
import { makeBot, seatNakaz } from './recorder.ts';

/* підсумок учасника за пакет */
export interface PackSeat {
  share: number;
  places: number[];
  score: number;
  denials: number;
  nakazTicks: number;
}

export function playPack(seed: number, ticks: number, lineup: readonly [SeatSpec, SeatSpec, SeatSpec]): PackSeat[] {
  const out: PackSeat[] = lineup.map(() => ({ share: 0, places: [], score: 0, denials: 0, nakazTicks: 0 }));
  for (let index = 0; index < 3; index++) {
    const seatOf = {} as Record<Slot, number>;
    const bots: Partial<Record<Slot, WireBot>> = {};
    const guards = new Map<Slot, NakazGuard>();
    for (let k = 0; k < 3; k++) {
      const slot = SLOTS[(k + index) % 3]!;
      const spec = lineup[k]!;
      const guard = new NakazGuard(makeBot(spec), seatNakaz(spec));
      seatOf[slot] = k;
      guards.set(slot, guard);
      bots[slot] = guard;
    }
    const match = openMatch(createEngine, {
      seed,
      ticks,
      bots,
      tapDenies: (_t, slot, denies) => {
        out[seatOf[slot as Slot]]!.denials += denies.filter(([, code]) => code !== 0).length;
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
      seat.nakazTicks += guards.get(s)?.nakazTicks ?? 0;
    }
  }
  return out;
}
