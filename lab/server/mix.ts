/* lab :: mix
   A mixed bot: one source runs the economy (Tkachs, yard, bidding, scan,
   pacts, cries), another - the Klinoks. Sources are external bots (lab/ext,
   with settings after @) or our mirror head полудень with the battle tactics (ours;
   ours@duck+dawn:40 - plus more tactics). Name: "e=a3,k=ours".

   Both sources see the same frame and think on their own; from their orders
   the frame takes Tkach orders and all orders without a unit from the economy
   source, Klinok orders - from the Klinok source. Order: Klinok rams, then the
   economy, then the other Klinok orders; the frame is trimmed by the order cap
   and the channel (ears - for the scan). Each source gets verdicts only for
   its own sent orders, under its own numbers. */

import { decodeManifest, decodeObserve, decodeOrders, decodeVerdicts, encodeOrders, encodeVerdicts, orderCap, orderCost, orderScale } from '@zoria/protocol';
import type { ChannelCfg, Hex, Manifest, Order, SlotName, Verdict } from '@zoria/protocol';
import type { WireBot } from '@zoria/sdk';
import { costAt, createStrategy, DEFAULT_TACTICS, HEAD_PRESET, parseTactics } from '../../bot/dist/strategy.js';
import { isExtBot, makeExtBot } from './ext.ts';

interface MixSpec {
  e: string;
  k: string;
}

export function parseMix(name: string): MixSpec | null {
  const parts = Object.fromEntries(name.split(',').map((x) => x.split('=') as [string, string]));
  const e = parts['e'];
  const k = parts['k'];
  if (!e || !k || Object.keys(parts).length !== 2) return null;
  const ok = (s: string) => s === 'ours' || (s.startsWith('ours@') && oursTactics(s) !== null) || isExtBot(s);
  return ok(e) && ok(k) ? { e, k } : null;
}

export const isMix = (name: string): boolean => parseMix(name) !== null;

/* "ours@duck+dawn:40" - the battle's default tactics plus these; an unknown one - null */
function oursTactics(name: string): string | null {
  const extra = name === 'ours' ? [] : name.slice(5).split('+').filter(Boolean);
  let bad = false;
  parseTactics(extra, () => {
    bad = true;
  });
  return bad ? null : [DEFAULT_TACTICS, ...extra].join(',');
}

function source(name: string): WireBot {
  const ours = name === 'ours' || name.startsWith('ours@') ? oursTactics(name) : null;
  return ours !== null ? createStrategy(HEAD_PRESET, () => undefined, parseTactics(ours)) : makeExtBot(name);
}

export function makeMixBot(name: string): WireBot {
  const spec = parseMix(name);
  if (!spec) throw new Error('could not parse the mixed bot ' + name);
  return spec.e === spec.k ? source(spec.e) : new MixBot(source(spec.e), source(spec.k));
}

/* a Klinok unit: by the frame, and a new one (not in the frame yet) - by the id prefix (K-A12) */
function klinok(order: Order, cls: ReadonlyMap<string, string>): boolean {
  if (!('unit' in order)) return false;
  const c = cls.get(order.unit);
  return c ? c === 'клинок' : order.unit.startsWith('K');
}

class MixBot implements WireBot {
  private cfg: ChannelCfg | null = null;
  private storms: Manifest['storms'] = [];
  private hearth: Hex = { q: 0, r: 0 };
  /* number in the frame -> source and its number */
  private map: { from: 'e' | 'k'; i: number }[] = [];
  private readonly e: WireBot;
  private readonly k: WireBot;

  constructor(e: WireBot, k: WireBot) {
    this.e = e;
    this.k = k;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.e.init(manifest, slot);
    this.k.init(manifest, slot);
    const m = decodeManifest(manifest);
    if (m) {
      this.cfg = m.cfg as unknown as ChannelCfg;
      this.storms = m.storms;
      this.hearth = m.seats[m.perm.indexOf(slot)] ?? this.hearth;
    }
  }

  tick(bytes: Uint8Array): Uint8Array {
    const fromE = decodeOrders(this.e.tick(bytes)) ?? [];
    const fromK = decodeOrders(this.k.tick(bytes)) ?? [];
    const obs = decodeObserve(bytes);
    if (!obs || !this.cfg) {
      this.map = fromE.map((_, i) => ({ from: 'e' as const, i }));
      return encodeOrders(fromE);
    }
    const cls = new Map(obs.mine.units.map((u) => [u.id, u.cls as string]));
    const eTake = fromE.flatMap((o, i) => (klinok(o, cls) ? [] : [{ o, from: 'e' as const, i }]));
    const kTake = fromK.flatMap((o, i) => (klinok(o, cls) ? [{ o, from: 'k' as const, i }] : []));
    const queue = [...kTake.filter((x) => x.o.kind === 'ram'), ...eTake, ...kTake.filter((x) => x.o.kind !== 'ram')];
    const cap = orderCap(this.cfg, obs.pulse.chanAt);
    let chan = obs.pulse.chan;
    let ear = obs.pulse.ear;
    const sent: typeof queue = [];
    for (const x of queue) {
      if (sent.length >= cap) break;
      const cost = orderCost(this.cfg, x.o.kind, costAt(x.o, obs, this.hearth), obs.t, this.storms);
      if (orderScale(x.o.kind) === 'ear') {
        if (cost > ear) continue;
        ear -= cost;
      } else {
        if (cost > chan) continue;
        chan -= cost;
      }
      sent.push(x);
    }
    /* the frame is empty, but the sources said something: their "slot keepers"
       (halt to a free unit, watch) are often addressed to a unit of the other
       class and filtered out - then six such ticks in a row give the slot to the
       nakaz. Keep one safe order: halt to a unit without a task or watch, from any source */
    if (!sent.length) {
      const idle = new Set(obs.mine.units.filter((u) => !u.task && u.wait === 0).map((u) => u.id));
      const all = [...fromE.map((o, i) => ({ o, from: 'e' as const, i })), ...fromK.map((o, i) => ({ o, from: 'k' as const, i }))];
      const keep = all.find((x) => x.o.kind === 'halt' && idle.has(x.o.unit)) ?? all.find((x) => x.o.kind === 'watch');
      if (keep && orderCost(this.cfg, keep.o.kind, costAt(keep.o, obs, this.hearth), obs.t, this.storms) <= obs.pulse.chan) sent.push(keep);
    }
    this.map = sent.map((x) => ({ from: x.from, i: x.i }));
    return encodeOrders(sent.map((x) => x.o));
  }

  feedback(bytes: Uint8Array): void {
    const rows = decodeVerdicts(bytes) ?? [];
    const e: Verdict[] = [];
    const k: Verdict[] = [];
    for (const row of rows) {
      const m = this.map[row[0]];
      if (!m) continue;
      (m.from === 'e' ? e : k).push([m.i, row[1], row[2]] as Verdict);
    }
    this.e.feedback?.(encodeVerdicts(e));
    this.k.feedback?.(encodeVerdicts(k));
  }
}
