/* bot :: strategy
   The bot's strategy: a mirror head with a character (ZARIA_PRESET - a name
   from the styles.ts catalogue or a string "base+knob=number,...", полудень by
   default) and a pulse that keeps the slot with the bot.

   Contract - WireBot (manifest, observe frame -> orders frame, verdicts)
   plus a belief diary frame. There is no network here and there must not be:
   the wire, reconnects and pings live in main.ts, wire.ts and connectBot.

   Pulse. The nakaz takes the slot from the seventh tick without an accepted
   order (rules 23.2), and the mirror head stays silent when it has nothing to
   order, or gets rejections. After PULSE_AFTER such ticks the bot itself puts
   first in the frame an order that changes nothing in the world (P2-04):
     - halt to a unit without a task - free (rules 13.4), but only to a unit
       the head gave nothing in this frame: the observe frame is taken before
       the orders (6.3), and the gatekeeper executes them in turn (6.4), so a
       halt to such a unit would cancel the order just given;
     - jam without a target to a busy Klinok that neither jams nor rams -
       also free; it has no intent to jam anyway;
     - a repeat of the focus the gatekeeper already accepted - 32 channel
       bytes. It goes first, so the head's watch in the same frame, if
       accepted, overrides it.
   The pulse is sent only if the channel covers it together with the head's
   orders and the frame doesn't hit the cap: a rejection is a rejected order too. */

import { readFileSync } from 'node:fs';
import { createEngine } from '@zoria/engine';
import { BeliefTrace, MirrorBot } from '@zoria/sdk';
import { createNakazSparring, NAKAZ_SAMPLES } from '@zoria/sdk/nakaz';
import type { BeliefFrame, WireBot } from '@zoria/sdk';
import {
  decodeManifest,
  decodeObserve,
  decodeOrders,
  decodeVerdicts,
  encodeOrders,
  encodeVerdicts,
  orderCap,
  orderCost,
} from '@zoria/protocol';
import type { ChannelCfg, Hex, Manifest, Observe, Order, SlotName, Verdict } from '@zoria/protocol';
import { errText } from './errors.js';
import { fault } from './faults.js';
import { parseStyle, STYLES } from './styles.js';
import { ComboStrategy } from './combo.js';
import { bladesKnobsOk } from './combo/blades.js';
import { economyParams } from './combo/economy.js';
import { AfterHead, hookHead, ramOrder } from './tactics.js';

export interface Strategy extends WireBot {
  /* the tick's belief diary frame; null - no frame */
  belief(obs: Observe | null): BeliefFrame | null;
  /* the next diary frame is a full one: the previous line was not written */
  resetBelief(): void;
}

/* Pulse - from the third tick without an accepted order: that leaves four
   ticks of margin before the seventh for a drop and reconnect (protocol 8.4). */
export const PULSE_AFTER = 2;
/* Head failures in the log: the first one and then every FAIL_LOG_EVERY-th. */
export const FAIL_LOG_EVERY = 100;

type Watch = Extract<Order, { kind: 'watch' }>;

/* what the pulse needs to know about the world: tariffs, storms, hearth */
export interface PulseWorld {
  cfg: ChannelCfg;
  storms: Manifest['storms'];
  hearth: Hex;
}

/* where an order "stands" for the tariff: a unit order - at the unit's cell,
   focus and scan - at the target, the rest (yard, bid, pact, cry) - at the
   hearth (rules 15.3) */
export function costAt(order: Order, obs: Observe, hearth: Hex): Hex {
  if ('unit' in order) {
    const unit = obs.mine.units.find((u) => u.id === order.unit);
    return unit ? { q: unit.q, r: unit.r } : hearth;
  }
  if (order.kind === 'watch' || order.kind === 'scan') return { q: order.q, r: order.r };
  return hearth;
}

/* channel bytes left after the head's orders; a scan pays with ears */
export function channelLeft(obs: Observe, orders: readonly Order[], world: PulseWorld): number {
  let left = obs.pulse.chan;
  for (const order of orders) {
    if (order.kind === 'scan') continue;
    left -= orderCost(world.cfg, order.kind, costAt(order, obs, world.hearth), obs.t, world.storms);
  }
  return left;
}

/* the cheapest order that changes nothing, or null if there is none */
export function pulseOrder(obs: Observe, orders: readonly Order[], focus: Watch | null, world: PulseWorld): Order | null {
  if (orders.length + 1 > orderCap(world.cfg, obs.pulse.chanAt)) return null;
  const left = channelLeft(obs, orders, world);
  const busy = new Set(orders.flatMap((order) => ('unit' in order ? [order.unit] : [])));
  const idle = obs.mine.units.find((unit) => unit.task === null && unit.wait === 0 && !busy.has(unit.id));
  // halt and jam are free, but the gatekeeper accepts them only while 32 bytes are left (rules 13.4)
  if (idle && left >= world.cfg.chanOrder) return { kind: 'halt', unit: idle.id };
  /* a busy Klinok that neither jams nor rams: a jam without a target only
     drops the intent to jam, which it doesn't have anyway - the world doesn't
     change (zaria-sim-order.js, subJam) */
  const klinok = obs.mine.units.find((u) => u.cls === 'клинок' && u.task !== null && u.task.jam === null && u.task.ram === null && u.wait === 0 && !busy.has(u.id));
  if (klinok && left >= world.cfg.chanOrder) return { kind: 'jam', unit: klinok.id, target: null, hold: false };
  if (!focus) return null;
  return left >= orderCost(world.cfg, 'watch', focus, obs.t, world.storms) ? focus : null;
}

/* Tactics on top of the head. Default - DEFAULT_TACTICS. The filler fires
   rarely (about one tick per match): on 60 fresh valleys the bot without
   tactics vs fill:own:6 - -0.10 ± 0.15 share per pack, within the error. It
   is kept because it does no harm, and in a long idle stretch it gives a
   Tkach. Set by the ZARIA_TACTICS string, comma separated; none - no tactics,
   empty - the defaults:
     fill:<nakaz>[:N]  - the head's idle time is filled by a nakaz: an SDK sample
                         (черепаха, експансія, економка, хвилини, замовлення,
                         тиск) or own (bot/nakaz.yaml; the old name наш is
                         still accepted). The nakaz runs inside the bot every
                         tick and knows the world; its orders go into the frame
                         when the head has been silent for more than N ticks
                         (0 by default). The slot stays with the bot: this is
                         not the node's nakaz episode;
     nopact            - never offer or accept pacts: the pact tax is a tenth
                         of the income of every tick (rules 19.5);
     nofeed:T          - the head doesn't put Tkachs on feeding before tick T
                         (1200 - never): in its decision queue feeding comes
                         before the target and takes a growth Tkach for good;
     k0:T              - no Klinoks from the yard before tick T, then the
                         style's klinok;
     ram:R             - clean ram: a free Klinok within R steps rams an enemy
                         Tkach on a needle that is not his (heating - the ram
                         is clean, rules 11.7);
     hunt:R            - ram v2: a hunter and a Klinok with the head's "empty"
                         jam, only inside the zone; the prey has stood on the
                         needle ≥ 3 ticks, not in a pause of our capture, the
                         Klinok makes it in time; a chase that lost its point
                         is dropped;
     cherta            - before dawn the head doesn't see needles beyond the
                         cherta line (the Keeper rams, there are almost no
                         captures);
     stay:K            - don't recall home a Tkach that is ≤ K ticks from a
                         capture if the leash holds;
     yardcap           - don't order a unit above the swarm weight (rejection
                         "swarm weight");
     nohook            - the Tkach is already on the needle of its target, but
                         the server still leads it along the hook of a find
                         (rules 16.8) - a move to the same cell cuts the extra
                         loop, heating isn't interrupted. Only when the hooked
                         find gives nothing: already taken, or a cache under
                         the charge cap would leave < 50;
     surplus:E:B       - dynamic style: while the charge is ≥ E, knob build = B
                         (charge at the 360 cap burns - let it go to masts and
                         lots);
     cache:N           - a cache gives the full 150 (charge + 150 ≤ cap): the
                         nearest free unit within N cells goes for it - an idle
                         Klinok or a Tkach without a task; a heating Tkach is
                         never taken off;
     dawn:N            - N ticks before dawn a free Tkach (not heating, not
                         building) stands beyond the cherta next to the ring
                         needle our thread reaches; one tick before dawn it
                         steps on it and heats until it is ours (idea from
                         external bots, 03.10);
     loot:K            - before dawn K free Klinoks jam a lit ring needle from
                         a cell beyond the cherta: loot (rules 8.7) without
                         provoking (21.7); the jam is lifted before dawn - a
                         dark ring gives no loot;
     duck              - a working Tkach (heating or building) with an enemy
                         Klinok closer than ours steps to an adjacent cell: a
                         ram on a Tkach without work is a trade (11.7), not a
                         clean one (idea from an external bot, 04.10);
     scout:N           - for the first N ticks the scans go where the rivals
                         are, not after blips next to us: rival units seen
                         lately are tracked (a Tkach every 3 ticks, a Klinok
                         every 2), otherwise the ruins a rival can reach about
                         as soon as we can are checked, those our Tkachs head
                         to first; nothing to look at - the head's scan stays
                         (idea from playing in the lab, 06.10);
     gap:N, catch:x,   - numbers of the "built-in heads" from the manifest
     bopen:x, rfloor:x   (rules, A.1) in our own mirror: guardGap, catchFloor,
                         buildOpen, raidFloor. They don't change the laws of
                         the world, only the head.
   Mechanics - tactics.ts. */
export const FILL_CHARTERS = [...Object.keys(NAKAZ_SAMPLES), 'own'] as const;
/* the old name of our nakaz (until 05.10) */
const OWN_ALIAS = 'наш';

export interface Tactics {
  fill: { charter: string; after: number } | null;
  noPact: boolean;
  noFeed: number | null;
  k0: number | null;
  ram: number | null;
  hunt: number | null;
  cherta: boolean;
  stay: number | null;
  yardCap: boolean;
  noHook: boolean;
  cache: number | null;
  dawn: number | null;
  loot: number | null;
  duck: boolean;
  scout: number | null;
  surplus: { at: number; build: number } | null;
  /* SIM_CFG key -> value in the head's mirror */
  engine: Readonly<Record<string, number>>;
}

/* token -> SIM_CFG key and bounds; gap is an integer */
export const ENGINE_KNOBS: Readonly<Record<string, { key: string; min: number; max: number; int: boolean }>> = {
  gap: { key: 'guardGap', min: 1, max: 600, int: true },
  catch: { key: 'catchFloor', min: 0, max: 1, int: false },
  bopen: { key: 'buildOpen', min: 0, max: 5, int: false },
  rfloor: { key: 'raidFloor', min: 0, max: 2, int: false },
};

export const NO_TACTICS: Tactics = { fill: null, noPact: false, noFeed: null, k0: null, ram: null, hunt: null, cherta: false, stay: null, yardCap: false, noHook: false, cache: null, dawn: null, loot: null, duck: false, scout: null, surplus: null, engine: {} };

/* submission: the organizers don't set ZARIA_TACTICS, so the battle runs with
   this string. An empty variable (the stack often sets it so) - this string
   too; no tactics - none. nofeed:1200 - from the 01.10 search together with
   the полудень style (DEFAULT_PRESET); nohook only shortens the path after a
   find's hook; cherta and hunt:12 (ram v2 instead of ram:6) - see the index in
   tactics.ts: without cherta minus 55-90 minutes per pack on the foreign and
   mixed pools; hunt:12 vs hunt:6 - a plus on all three pools (+0.13…+0.39
   share, +51…+72 minutes) */
export const DEFAULT_TACTICS = 'fill:own:6,nofeed:1200,nohook,cherta,hunt:12';

/* tactics string; anything unknown - to the log and skip */
export function parseTactics(spec: string | readonly string[] | undefined, log: (line: string) => void = () => undefined): Tactics {
  const items = (typeof spec === 'string' ? spec.split(',') : (spec ?? [])).map((x) => x.trim()).filter(Boolean);
  const out: Tactics = { ...NO_TACTICS };
  /* tick or radius: an integer within bounds, otherwise - to the log */
  const int = (item: string, v: string | undefined, max: number): number | null => {
    const n = Number(v);
    if (v !== undefined && /^\d{1,4}$/.test(v) && n >= 1 && n <= max) return n;
    log('tactic "' + item + '": N - integer 1-' + max + ', skipping');
    return null;
  };
  for (const item of items) {
    const [name, rawCharter, after, ...rest] = item.split(':');
    const charter = name === 'fill' && rawCharter === OWN_ALIAS ? 'own' : rawCharter;
    if (rest.length) log('no tactic "' + item + '", skipping');
    else if (name === 'none' && charter === undefined) continue;
    else if (name === 'nopact' && charter === undefined) out.noPact = true;
    else if (name === 'nofeed' && after === undefined) out.noFeed = int(item, charter, 1200) ?? out.noFeed;
    else if (name === 'k0' && after === undefined) out.k0 = int(item, charter, 1200) ?? out.k0;
    else if (name === 'ram' && after === undefined) out.ram = int(item, charter, 12) ?? out.ram;
    else if (name === 'hunt' && after === undefined) out.hunt = int(item, charter, 24) ?? out.hunt;
    else if (name === 'stay' && after === undefined) out.stay = int(item, charter, 24) ?? out.stay;
    else if (name === 'cherta' && charter === undefined) out.cherta = true;
    else if (name === 'yardcap' && charter === undefined) out.yardCap = true;
    else if (name === 'nohook' && charter === undefined) out.noHook = true;
    else if (name === 'cache' && after === undefined) out.cache = int(item, charter, 12) ?? out.cache;
    else if (name === 'dawn' && after === undefined) out.dawn = int(item, charter, 120) ?? out.dawn;
    else if (name === 'loot' && after === undefined) out.loot = int(item, charter, 3) ?? out.loot;
    else if (name === 'duck' && charter === undefined) out.duck = true;
    else if (name === 'scout' && after === undefined) out.scout = int(item, charter, 1200) ?? out.scout;
    else if (name === 'surplus' && charter !== undefined && after !== undefined) {
      const at = Number(charter);
      const build = Number(after);
      const ok = /^\d{1,3}$/.test(charter) && at >= 0 && at <= 360 && /^\d+(\.\d+)?$/.test(after) && build <= 3;
      if (ok) out.surplus = { at, build };
      else log('tactic "' + item + '": E - integer 0-360, B - 0-3, skipping');
    }
    else if (name && Object.hasOwn(ENGINE_KNOBS, name) && after === undefined) {
      const k = ENGINE_KNOBS[name]!;
      const n = Number(charter);
      const ok = charter !== undefined && (k.int ? /^\d{1,4}$/ : /^\d+(\.\d+)?$/).test(charter) && n >= k.min && n <= k.max;
      if (ok) out.engine = { ...out.engine, [k.key]: n };
      else log('tactic "' + item + '": N - ' + (k.int ? 'integer ' : '') + k.min + '-' + k.max + ', skipping');
    }
    else if (name === 'fill' && charter && (FILL_CHARTERS as readonly string[]).includes(charter)) {
      const n = after === undefined ? 0 : Number(after);
      if (Number.isInteger(n) && n >= 0 && n <= 1200) out.fill = { charter, after: n };
      else log('tactic "' + item + '": N - integer 0-1200, skipping');
    } else log('no tactic "' + item + '", skipping');
  }
  return out;
}

/* the filler nakaz's text */
export function charterText(name: string): string {
  if (name === 'own' || name === OWN_ALIAS) return readFileSync(new URL('../nakaz.yaml', import.meta.url), 'utf8');
  const text = (NAKAZ_SAMPLES as Readonly<Record<string, string>>)[name];
  if (!text) throw new Error('no such charter: ' + name);
  return text;
}

/* the head the pulse wraps: an archetype mirror or a stand-in in tests */
export type Head = Pick<MirrorBot, 'init' | 'tick' | 'feedback' | 'mirror'>;

/* where a frame order comes from: pulse, head, filler nakaz or a tactic, and its position in its source */
export type Source = 'pulse' | 'head' | 'fill' | 'tactic';
interface Entry {
  order: Order;
  from: Source;
  at: number;
}

export interface StrategyOpts {
  tactics?: Tactics;
  /* the filler nakaz; without it fill does nothing */
  filler?: WireBot | null;
}

export class PulseStrategy implements Strategy {
  private readonly head: Head;
  private readonly log: (line: string) => void;
  private readonly tactics: Tactics;
  private readonly filler: WireBot | null;
  private slot: SlotName | null = null;
  private trace: BeliefTrace | null = null;
  private world: PulseWorld | null = null;
  /* ticks in a row without an accepted order */
  private quiet = 0;
  /* ticks in a row when the head was silent */
  private headIdle = 0;
  /* focus accepted by the gatekeeper; before the first watch - the hearth */
  private focus: Watch | null = null;
  /* this tick's frame orders in frame order: verdicts go back to their source by them */
  private sent: Entry[] = [];
  /* diagnostics for the lab (lab/): pulse and order sources of the last frame */
  lastPulse: Order | null = null;
  lastSources: Source[] = [];
  private headFaults = 0;
  /* tactics after the head with frame memory (tactics.ts); null - none */
  private after: AfterHead | null = null;
  /* the "nofeed has no effect" warning - once per match */
  private feedWarned = false;

  constructor(head: Head, log: (line: string) => void = () => undefined, opts: StrategyOpts = {}) {
    this.head = head;
    this.log = log;
    this.tactics = opts.tactics ?? NO_TACTICS;
    this.filler = this.tactics.fill ? (opts.filler ?? null) : null;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.head.init(manifest, slot);
    this.filler?.init(manifest, slot);
    this.slot = slot;
    this.trace = new BeliefTrace(slot);
    const m = decodeManifest(manifest);
    const hearth = m?.seats[m.perm.indexOf(slot)];
    this.world = m && hearth ? { cfg: m.cfg as unknown as ChannelCfg, storms: m.storms, hearth } : null;
    this.focus = hearth ? { kind: 'watch', q: hearth.q, r: hearth.r, keep: 0 } : null;
    this.quiet = 0;
    this.headIdle = 0;
    this.feedWarned = false;
    const t = this.tactics;
    const needAfter = t.ram !== null || t.hunt !== null || t.stay !== null || t.cherta || t.yardCap || t.noHook || t.cache !== null || t.dawn !== null || t.loot !== null || t.duck || t.scout !== null;
    this.after =
      needAfter && m && this.world
        ? new AfterHead(t, m, slot, this.world, (at, obs) => this.links(at, obs), (a, b, cls) => this.pathOk(a, b, cls), this.log)
        : null;
    hookHead(this.head.mirror(), slot, this.tactics, this.log);
  }

  tick(observe: Uint8Array): Uint8Array {
    let reply: Uint8Array | null = null;
    let headOrders: Order[] = [];
    /* the observe frame - before the head: tactics first see the world and
       correct the mirror (foreign finds, rejected sites) */
    const obs = (this.quiet >= PULSE_AFTER || this.after || this.tactics.noFeed !== null) && this.world ? decodeObserve(observe) : null;
    if (obs && this.after) {
      this.after.see(obs);
      this.after.syncMirror(this.head.mirror());
    }
    try {
      reply = this.head.tick(observe);
      const decoded = decodeOrders(reply);
      // a reply that does not decode is garbage for the node too: the pulse speaks instead
      if (decoded === null) reply = null;
      headOrders = decoded ?? [];
    } catch (e) {
      this.fail('tick', e);
    }
    // the filler follows every tick, so that it knows the world when its turn comes
    let fillOrders: Order[] = [];
    if (this.filler) {
      try {
        fillOrders = decodeOrders(this.filler.tick(observe)) ?? [];
      } catch (e) {
        this.fail('fill', e);
      }
    }

    let entries: Entry[] = headOrders
      .map((order, at): Entry => ({ order, from: 'head', at }))
      .filter((e) => !(this.tactics.noPact && e.order.kind === 'pact' && e.order.op !== 'break'));
    this.headIdle = headOrders.length === 0 ? this.headIdle + 1 : 0;
    const fill = this.tactics.fill;
    if (fill && entries.length === 0 && this.headIdle > fill.after) {
      entries = fillOrders.map((order, at): Entry => ({ order, from: 'fill', at }));
    }

    const quiet = this.quiet;
    this.quiet += 1;
    /* nofeed is on, but a Tkach is feeding anyway (the node's nakaz put it
       there or the mask failed) - once per match to the log: otherwise the loss is invisible */
    const nf = this.tactics.noFeed;
    if (obs && nf !== null && obs.t < nf && !this.feedWarned && obs.mine.units.some((u) => u.task?.feed)) {
      this.feedWarned = true;
      this.log('nofeed: a Tkach is feeding at tick ' + obs.t + ' - check the mask (new engine?)');
    }
    if (obs && this.after && this.slot && this.world) {
      entries = this.after.apply(obs, entries);
      if (this.tactics.ram !== null) {
        const ram = ramOrder(obs, entries.map((e) => e.order), this.slot, this.after.owners, this.tactics.ram, this.world, this.after.refused);
        if (ram) entries = [...entries, { order: ram, from: 'tactic', at: 0 }];
      }
      entries = this.after.vet(obs, entries, this.flareTokens());
    }
    const orders = entries.map((e) => e.order);
    const pulse = obs && quiet >= PULSE_AFTER && this.world ? pulseOrder(obs, orders, this.focus, this.world) : null;
    this.lastPulse = pulse;
    this.sent = pulse ? [{ order: pulse, from: 'pulse', at: 0 }, ...entries] : entries;
    /* the gatekeeper doesn't consider a frame above the cap (the tail is a
       "cap" rejection): the pulse goes first and stays */
    if (obs && this.world) this.sent = this.sent.slice(0, orderCap(this.world.cfg, obs.pulse.chanAt));
    this.lastSources = this.sent.map((e) => e.from);

    /* the head's frame goes byte for byte only if every order is the same head
       object at its own position: a tactic's in-place edit (a new object) is
       already a different frame */
    if (!pulse && reply && this.sent.length === headOrders.length && this.sent.every((e, i) => e.from === 'head' && e.order === headOrders[i])) return reply;
    return encodeOrders(this.sent.map((e) => e.order));
  }

  feedback(verdicts: Uint8Array): void {
    const list = decodeVerdicts(verdicts);
    if (list?.some(([, ok]) => ok)) this.quiet = 0;
    if (list) this.after?.verdicts(this.sent, list);
    const head: Verdict[] = [];
    const filler: Verdict[] = [];
    for (const [i, ok, code] of list ?? []) {
      const entry = this.sent[i];
      if (!entry) continue;
      if (ok && entry.order.kind === 'watch') this.focus = entry.order;
      if (entry.from === 'head') head.push([entry.at, ok, code]);
      else if (entry.from === 'fill') filler.push([entry.at, ok, code]);
    }
    try {
      // the head gets back only the verdicts on its own commands, at their own positions
      this.head.feedback(list ? encodeVerdicts(head) : verdicts);
    } catch (e) {
      this.fail('feedback', e);
    }
    if (this.filler && filler.length > 0) {
      try {
        this.filler.feedback?.(encodeVerdicts(filler));
      } catch (e) {
        this.fail('fill feedback', e);
      }
    }
  }

  /* mirror flare tokens: a scan with a token is free (rules 16.4) */
  private flareTokens(): number {
    const E = this.head.mirror() as { SIM?: { world?: { flare?: Record<string, number> } } } | null;
    return (this.slot && E?.SIM?.world?.flare?.[this.slot]) || 0;
  }

  /* can a unit of class cls reach the cell (mirror engine): the cell itself is
     passable (canPass - a mountain, water or the edge give a "ground" rejection
     on move) and there is a path (botPath doesn't check the end cell). No mirror - no */
  private pathOk(from: Hex, to: Hex, cls: string): boolean {
    const E = this.head.mirror() as {
      botPath?: (a: Hex, b: Hex, cap: number, u: unknown) => unknown[] | null;
      canPass?: (q: number, r: number) => boolean;
    } | null;
    if (!E || typeof E.botPath !== 'function' || typeof E.canPass !== 'function') return false;
    try {
      if (!E.canPass(to.q, to.r)) return false;
      return E.botPath({ q: from.q, r: from.r }, { q: to.q, r: to.r }, 400, { q: from.q, r: from.r, cls, p: this.slot }) !== null;
    } catch (e) {
      fault('mirror.pathOk', e);
      return false;
    }
  }

  /* will a thread from the cell reach our lit needle or the hearth: ask the
     mirror engine (mountains, hills - rules 7.2); a nakaz head - no (cautious) */
  private links(at: Hex, obs: Observe): boolean {
    const E = this.head.mirror() as { linkOk?: (aq: number, ar: number, bq: number, br: number) => boolean } | null;
    if (!E || typeof E.linkOk !== 'function' || !this.world) return false;
    const to = [this.world.hearth, ...obs.mine.needles.filter((n) => !n.dark)];
    return to.some((n) => E.linkOk!(at.q, at.r, n.q, n.r));
  }

  /* mirror belief: the world of the mirror head is what it believes in */
  belief(obs: Observe | null): BeliefFrame | null {
    const E = this.head.mirror();
    return this.trace && E ? this.trace.frame(E, obs) : null;
  }

  resetBelief(): void {
    if (this.slot) this.trace = new BeliefTrace(this.slot);
  }

  /* the head failed: the tick goes on without its orders; the log gets the
     first failure and every FAIL_LOG_EVERY-th, with a counter */
  private fail(where: string, e: unknown): void {
    this.headFaults += 1;
    if (this.headFaults % FAIL_LOG_EVERY !== 1) return;
    this.log('head failed (' + where + ', failure #' + this.headFaults + '): ' + errText(e) + '; the pulse keeps the slot');
  }
}

/* сплав - two heads in one seat (combo.ts): the economy of one, the Klinoks of
   another, under our pulse. The battle preset since 06.10: the best candidate
   of the 04-06.10 lab measurements on every pool, +0.32…+1.57 share per pack
   vs полудень with the battle tactics. The tactics (ZARIA_TACTICS) are not
   for it: they work inside and after the mirror head, and сплав has none */
export const COMBO_PRESET = 'сплав';
/* сплав plays without tactics: they were made for the mirror head */
export const COMBO_TACTICS = 'none';
/* the economy head of the battle сплав: its default plus the memory of deadly roads
   (combo/economy.ts, knob roads). Lab 15.10, fresh valleys, against сплав without it:
   ext +0.10 ± 0.05 and +0.07 ± 0.06 share per pack on 240 valleys each, strong
   +0.15 ± 0.05 and +0.11 ± 0.05, mixed +0.10 ± 0.04; foreign -0.03 ± 0.02 on 120.
   240 ticks of memory gave nothing, 800 the same as 480 */
export const COMBO_ECONOMY = 'roads=480';

/* "сплав" or a variant for the lab "сплав:<economy>:<blades>": the economy head's preset or
   knobs ("хижий", "alpha=0.6+risk=0.8"), the Klinok head's knobs ("guard=0+hunt=0");
   an empty part - the head's default (so "сплав::" is сплав without COMBO_ECONOMY);
   null - not сплав or a part that does not parse */
export function comboParts(preset: string): { economy: string; blades: string } | null {
  if (preset === COMBO_PRESET) return { economy: COMBO_ECONOMY, blades: '' };
  if (!preset.startsWith(COMBO_PRESET + ':')) return null;
  const [economy = '', blades = '', ...rest] = preset.slice(COMBO_PRESET.length + 1).split(':');
  const k = blades.replace(/\+/g, ';');
  if (rest.length || economyParams(economy) === null || !bladesKnobsOk(k)) return null;
  return { economy, blades: k };
}

/* the tactics a preset plays with when none are given */
export const defaultTacticsOf = (preset: string): string => (comboParts(preset) ? COMBO_TACTICS : DEFAULT_TACTICS);

/* names in the catalogue: by them the service knob for changing the preset
   decides whether such a preset exists */
export function presets(): string[] {
  return [COMBO_PRESET, ...Object.keys(STYLES)];
}

/* полудень - the winner of the 01.10 search (styles.ts), searched together
   with the tactics nofeed:1200 and ram:6. With them vs світанок with
   fill:own:6, which played in battle before: +1.55 ± 0.21 share per pack on
   60 fresh valleys vs the mixed pool (our bot, рівний, облягач, опортуніст,
   рейдер, a nakaz bot), better against each of them. The battle preset until
   06.10; the lab still measures mirror-head tactics on it */
export const HEAD_PRESET = 'полудень';

/* the battle preset: ZARIA_PRESET empty or unknown */
export const DEFAULT_PRESET = COMBO_PRESET;

/* Nakaz head: "nakaz:<SDK sample or own>" - instead of the mirror, a nakaz
   thinks inside the bot (like the filler, but all the time). The pulse and
   the tactics after the head work as always, so the slot stays with the bot: a
   bare nakaz in its place is silent in ticks without business, and the node
   gives the slot to the nakaz (rules 23.2) */
export const NAKAZ_HEADS = FILL_CHARTERS.map((name) => 'nakaz:' + name);
export function nakazHeadOf(preset: string): string | null {
  if (preset === 'nakaz:' + OWN_ALIAS) return 'own';
  return NAKAZ_HEADS.includes(preset) ? preset.slice('nakaz:'.length) : null;
}

/* preset - сплав, a catalogue style, a "base+knob=number" string or a nakaz head */
export function isPreset(preset: string): boolean {
  return comboParts(preset) !== null || parseStyle(preset) !== null || nakazHeadOf(preset) !== null;
}

/* an unknown name (typo, cmd code page) doesn't bring the bot down before the
   oath: the default style plays */
export function presetOrDefault(preset: string | undefined, log: (line: string) => void = () => undefined): string {
  if (!preset) return DEFAULT_PRESET;
  if (isPreset(preset)) return preset;
  log('no preset "' + preset + '", playing ' + DEFAULT_PRESET);
  return DEFAULT_PRESET;
}

/* a nakaz as the head: it has no mirror belief, the belief diary is empty */
function nakazHead(text: string): Head {
  const bot = createNakazSparring(text);
  return {
    init: (manifest, slot) => bot.init(manifest, slot),
    tick: (observe) => bot.tick(observe),
    feedback: (verdicts) => bot.feedback?.(verdicts),
    mirror: () => null,
  };
}

/* what plays a seat: the mirror head under the pulse with tactics, or сплав; both
   tell the lab the pulse and the order sources of the last frame */
export type BattleStrategy = PulseStrategy | ComboStrategy;

export function createStrategy(
  preset = process.env['ZARIA_PRESET'],
  log: (line: string) => void = () => undefined,
  given?: Tactics,
): BattleStrategy {
  const chosen = presetOrDefault(preset, log);
  const tactics = given ?? parseTactics(process.env['ZARIA_TACTICS'] || defaultTacticsOf(chosen), log);
  const combo = comboParts(chosen);
  if (combo) return new ComboStrategy(log, tactics, combo.economy, combo.blades);
  const nakaz = nakazHeadOf(chosen);
  const head: Head = nakaz ? nakazHead(charterText(nakaz)) : new MirrorBot(createEngine, { ...(parseStyle(chosen) ?? STYLES[HEAD_PRESET]!) });
  let filler: WireBot | null = null;
  if (tactics.fill) {
    try {
      filler = createNakazSparring(charterText(tactics.fill.charter));
    } catch (e) {
      log('filler nakaz "' + tactics.fill.charter + '" could not be read, playing without it: ' + errText(e));
    }
  }
  return new PulseStrategy(head, log, { tactics, filler });
}
