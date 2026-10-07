/* bot :: combo
   The сплав preset: two heads in one seat. The economy head (combo/economy.ts)
   runs the Tkachs, the yard, bidding, scans, pacts and cries; the Klinok head
   (combo/blades.ts) runs the Klinoks. Both see the same observe frame and think
   on their own; the frame takes the economy's Tkach orders and its orders
   without a unit, and the Klinok head's Klinok orders.

   Why: in the lab (04-06.10, fresh valleys, paired with our mirror head полудень
   and the battle tactics) this pair was the best of the candidates on every
   pool - strong +0.99 ± 0.11 share per pack on 120 valleys, mixed +0.41 ± 0.09,
   foreign +0.32 ± 0.06 (recheck +0.26), the external bots +1.57 ± 0.19 on 40
   (recheck +1.43) - with 0.3-0.4 rejected orders per pack.

   Order of the frame: Klinok rams first (a ram is the one order that cannot
   wait a tick), then the economy, then the other Klinok orders; the frame is
   trimmed by the order cap and the channel (ears for the scan). Each head gets
   the verdicts only of its own sent orders, under its own numbers.

   The pair is wrapped in PulseStrategy (strategy.ts): neither head has a pulse,
   and in the lab the nakaz took the slot for 0.2-1.4 ticks per pack; the pulse
   puts a free order first after two silent ticks. The belief diary is the
   economy head's: it keeps its own picture of the valley from the frames. */

import type { BeliefFrame, WireBot } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeOrders, decodeVerdicts, encodeOrders, encodeVerdicts, orderCap, orderCost, orderScale } from '@zoria/protocol';
import type { ChannelCfg, Hex, Manifest, Observe, Order, SlotName, Verdict } from '@zoria/protocol';
import { createStrategy as createBlades } from './combo/blades.js';
import { createStrategy as createEconomy } from './combo/economy.js';
import type { Strategy as EconomyHead } from './combo/economy.js';
import { setFaultLog } from './faults.js';
import { costAt, NO_TACTICS, PulseStrategy } from './strategy.js';
import type { Strategy, Tactics } from './strategy.js';

/* a unit is a Klinok: by the frame, and a new one (not in the frame yet) - by its id prefix (K-A12) */
function klinok(order: Order, cls: ReadonlyMap<string, string>): boolean {
  if (!('unit' in order)) return false;
  const c = cls.get(order.unit);
  return c ? c === 'клинок' : order.unit.startsWith('K');
}

type From = 'e' | 'k';

/* the two heads as one head for PulseStrategy: no mirror, so mirror() is null */
export class ComboHead {
  private cfg: ChannelCfg | null = null;
  private storms: Manifest['storms'] = [];
  private hearth: Hex = { q: 0, r: 0 };
  /* number in the frame -> head and its number */
  private map: { from: From; i: number }[] = [];
  readonly economy: EconomyHead;
  readonly blades: WireBot;

  constructor(economy: EconomyHead, blades: WireBot) {
    this.economy = economy;
    this.blades = blades;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.economy.init(manifest, slot);
    this.blades.init(manifest, slot);
    const m = decodeManifest(manifest);
    if (m) {
      this.cfg = m.cfg as unknown as ChannelCfg;
      this.storms = m.storms;
      this.hearth = m.seats[m.perm.indexOf(slot)] ?? this.hearth;
    }
  }

  tick(bytes: Uint8Array): Uint8Array {
    const fromE = decodeOrders(this.economy.tick(bytes)) ?? [];
    const fromK = decodeOrders(this.blades.tick(bytes)) ?? [];
    const obs = decodeObserve(bytes);
    if (!obs || !this.cfg) {
      this.map = fromE.map((_, i) => ({ from: 'e', i }));
      return encodeOrders(fromE);
    }
    const cls = new Map(obs.mine.units.map((u) => [u.id, u.cls as string]));
    const eTake = fromE.flatMap((o, i) => (klinok(o, cls) ? [] : [{ o, from: 'e' as From, i }]));
    const kTake = fromK.flatMap((o, i) => (klinok(o, cls) ? [{ o, from: 'k' as From, i }] : []));
    const queue = [...kTake.filter((x) => x.o.kind === 'ram'), ...eTake, ...kTake.filter((x) => x.o.kind !== 'ram')];
    const sent = this.fit(queue, obs);
    this.map = sent.map((x) => ({ from: x.from, i: x.i }));
    return encodeOrders(sent.map((x) => x.o));
  }

  /* the frame within the order cap and the channel; the scan pays with ears */
  private fit(queue: { o: Order; from: From; i: number }[], obs: Observe): { o: Order; from: From; i: number }[] {
    const cfg = this.cfg!;
    const cap = orderCap(cfg, obs.pulse.chanAt);
    let chan = obs.pulse.chan;
    let ear = obs.pulse.ear;
    const sent: typeof queue = [];
    for (const x of queue) {
      if (sent.length >= cap) break;
      const cost = orderCost(cfg, x.o.kind, costAt(x.o, obs, this.hearth), obs.t, this.storms);
      if (orderScale(x.o.kind) === 'ear') {
        if (cost > ear) continue;
        ear -= cost;
      } else {
        if (cost > chan) continue;
        chan -= cost;
      }
      sent.push(x);
    }
    return sent;
  }

  feedback(bytes: Uint8Array): void {
    const rows = decodeVerdicts(bytes) ?? [];
    const e: Verdict[] = [];
    const k: Verdict[] = [];
    for (const [at, ok, code] of rows) {
      const m = this.map[at];
      if (!m) continue;
      (m.from === 'e' ? e : k).push([m.i, ok, code]);
    }
    this.economy.feedback?.(encodeVerdicts(e));
    this.blades.feedback?.(encodeVerdicts(k));
  }

  mirror(): null {
    return null;
  }
}

/* сплав: the two heads under our pulse, with the economy head's belief diary */
export class ComboStrategy implements Strategy {
  private readonly head: ComboHead;
  private readonly pulse: PulseStrategy;

  /* economy - a preset of the economy head or its knobs, blades - the Klinok head's knobs
     ("jam=0;guard=1"); tactics - those after the head that need no mirror (hunt, ram, ...) */
  constructor(log: (line: string) => void = () => undefined, tactics: Tactics = NO_TACTICS, economy = '', blades = '') {
    setFaultLog(log);
    this.head = new ComboHead(createEconomy(economy || undefined), createBlades(blades || undefined));
    this.pulse = new PulseStrategy(this.head, log, { tactics });
  }

  /* diagnostics for the lab, as PulseStrategy's */
  get lastPulse(): Order | null {
    return this.pulse.lastPulse;
  }

  get lastSources(): string[] {
    return this.pulse.lastSources;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.pulse.init(manifest, slot);
  }

  tick(observe: Uint8Array): Uint8Array {
    return this.pulse.tick(observe);
  }

  feedback(verdicts: Uint8Array): void {
    this.pulse.feedback(verdicts);
  }

  belief(obs: Observe | null): BeliefFrame | null {
    return this.head.economy.belief(obs);
  }

  resetBelief(): void {
    this.head.economy.resetBelief();
  }
}
