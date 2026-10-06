/* bot :: tactics
   Tactics that act not next to the head but inside it or after it.

   The head is the engine's botOrders on the mirror world (MirrorBot.decide
   calls E.botOrders through a property of the engine object). So a tactic can:
     - swap a style knob on the live E.BOT_STYLE[slot] - the head reads it
       every tick (k0: no Klinoks from the yard before tick T);
     - wrap E.botOrders and, for the time of the decision, change what the head
       sees (nofeed: all our lit needles are "already being fed", and
       botTryFeed finds no one to feed);
     - append an order after the head (ram: clean ram).
   The mirror engine is a fresh one in every match (MirrorBot.init), so nothing
   leaks between matches.

   ===== tactics index: what, why, how, whether in battle =====
   The token is set by ZARIA_TACTICS (parsed by parseTactics in strategy.ts),
   battle without the variable - DEFAULT_TACTICS. Numbers - the lab's --eval,
   60 fresh valleys, mixed pool, paired share difference per pack vs the
   battle bot of that time.

   Inside the head (hookHead):
     nofeed:T  BATTLE (1200). The head puts a Tkach on feeding before the
               target and keeps it there for good - minus a growth Tkach. The
               w.fed mask for the time of the decision: botTryFeed finds no one
               to feed. +1.05 ± 0.19.
     k0:T      off. No Klinoks from the yard before T: knob klinok = 0. +0.28 ± 0.17.
     cherta    BATTLE. Before dawn needles beyond the cherta vanish from the
               belief for the time of the decision: the Keeper rams the Tkachs
               that heat them, and there are almost no captures there.
               Re-measure 2×2 after the 02.10 fixes (bot 49fb1a5): without
               cherta the battle bot loses 13-35 minutes per pack on the strong
               pool, 77-90 on the foreign one (no copy of ours at the table),
               55-60 on the mixed one.
     gap, catch, bopen, rfloor  off, not measured. Numbers of the built-in
               heads (guardGap, catchFloor, buildOpen, raidFloor) in our mirror.

   After the head (ramOrder, AfterHead):
     ram:R     off since 02.10 (replaced by hunt). A Klinok rams an enemy Tkach
               on a needle that is not his (heating - the ram is clean, rules
               11.7). +0.17 ± 0.09.
     hunt:R    BATTLE (12). Ram v2: a wider circle of hunters, no trades
               (capture pause, transit, won't make it). R - hunter-prey
               distance; "makes it" cuts it by itself: unowned needle ≤ 3, dark
               ≤ 11, lit enemy ≤ 19, so hunt:20 is unbounded. With cherta,
               hunt:6 and ram:6 are equal (−0.02 ± 0.03 share, +1 ± 5 minutes,
               5 sets). hunt:12 vs hunt:6, fresh valleys and a recheck on a
               second set: foreign pool +0.13 ± 0.04 / +0.13 ± 0.04 (+57 / +51
               minutes), strong +0.23 ± 0.08 / +0.39 ± 0.09 (+72 / +62), mixed
               +0.16 ± 0.06 (+52); a plus against every opponent. hunt:9 - in
               between.
     stay:K    off. Don't recall a Tkach K ticks before a capture. ≈ 0.
     nohook    BATTLE. A find's hook (rules 16.8) leads a Tkach to a cache and
               back to the point where it turned, even when it already stands
               on its target needle. When the find gives nothing any more
               (taken, or it would burn under the cap), a move to the same cell
               cuts the way back: the Tkach stays to heat. A cache that still
               pays is delivered by the hook. ±0.03 - a penny without risk:
               fewer extra steps, no charge lost.
     cache:N   off. A cache gives the full 150 - the nearest free unit within N
               cells goes for it (an idle Klinok or a Tkach without a task).
               +0.02 ± 0.04, but ~0.1 rejections per pack - not in battle yet.
     yardcap   off. Don't order a unit above the swarm weight (for a nakaz
               head). −0.02 ± 0.02.
     scout:N   off, being measured (06.10). In the first ticks no needle's
               picture is 40 ticks old yet, so the head scans only after
               movement blips (×10) - and blips exist only 3-5 cells from our
               own eyes, many of them the world's ghosts or the Keeper's units.
               scout:N spends the same free ears on the rivals: tracks the
               units seen lately, otherwise checks the contested ruins.

   Always, when there is at least one tactic after the head (AfterHead):
     syncMirror  before the head's decision writes into the mirror the finds
               taken by others (an SDK bug: otherwise a phantom flare token and
               an "ears" rejection) and rejected sites (the botSites cache
               forgets them after 20 ticks).
     vet       frame filter: the empty pair jam(null) + halt to a guard Klinok
               (~420 per match, it bloated the frame - "cap"), a scan without
               ears and without a token, a needle onto rejected "ground". The
               gatekeeper doesn't consider the tail above the frame cap - the
               frame is trimmed (strategy.ts).
     self-check  the world numbers the tactics read (CFG_KEYS), and ramClean -
               otherwise a line to the log: on 05.10 nothing must break silently. */

import { orderCap, orderCost } from '@zoria/protocol';
import type { ActorName, ClsName, Hex, Manifest, NeedleSpec, Observe, Order, SlotName, Verdict } from '@zoria/protocol';
import { channelLeft } from './strategy.js';
import type { PulseWorld, Source, Tactics } from './strategy.js';

/* what the tactics need from the mirror engine */
interface HeadEngine {
  botOrders: (p: string, w: unknown) => void;
  BOT_STYLE: Record<string, Record<string, unknown>>;
  SIM: { t: number };
  NEEDLES?: readonly { key: string; q: number; r: number }[];
  CHERTA_R?: number;
  SIM_CFG?: Record<string, unknown>;
}
interface HeadWorld {
  lit: Record<string, Record<string, unknown> | undefined>;
  fed: Record<string, string>;
  own: Record<string, string | undefined>;
  dawn?: number | boolean;
  keep?: { mercy?: Record<string, unknown> };
  bel?: Record<string, { at: Record<string, unknown> } | undefined>;
  energy?: Record<string, number>;
}

/* head tactics: k0, nofeed, cherta and the numbers of the built-in heads. No
   engine (a stand-in in tests without a mirror) or the wrong one - to the log and without them */
export function hookHead(engine: unknown, slot: SlotName, tactics: Tactics, log: (line: string) => void): void {
  const { k0, cherta, surplus } = tactics;
  let noFeed = tactics.noFeed;
  const knobs = Object.entries(tactics.engine);
  if (noFeed === null && k0 === null && !cherta && !surplus && !knobs.length) return;
  const E = engine as HeadEngine | null;
  if (!E || typeof E.botOrders !== 'function' || !E.BOT_STYLE?.[slot] || !E.SIM) {
    log('head tactics (nofeed, k0, cherta, head numbers) have no effect without the mirror engine');
    return;
  }
  /* numbers of the built-in heads - only in our own mirror: MirrorBot.init has
     already rewritten SIM_CFG from the manifest and doesn't touch it again */
  if (knobs.length && E.SIM_CFG) for (const [key, value] of knobs) E.SIM_CFG[key] = value;
  /* nofeed relies on engine internals (w.fed, w.lit): the new world of 05.10
     may rename them - then the mask would silently stop working. No fields -
     to the log, and the head plays as is */
  const w0 = (E.SIM as { world?: Partial<HeadWorld> }).world;
  if (noFeed !== null && (!w0 || typeof w0.fed !== 'object' || w0.fed === null || typeof w0.lit !== 'object' || w0.lit === null)) {
    log('nofeed: the mirror engine has no w.fed / w.lit - mask disabled, the head feeds as is');
    noFeed = null;
  }
  if (noFeed === null && k0 === null && !cherta && !surplus) return;
  const style = E.BOT_STYLE[slot];
  const klinok = typeof style['klinok'] === 'number' ? style['klinok'] : 0;
  const build = typeof style['build'] === 'number' ? style['build'] : 0;
  /* needles inside the cherta (the center is the citadel at 0,0): only these does cherta hide */
  const inside = cherta ? (E.NEEDLES ?? []).filter((n) => hexDist(n, { q: 0, r: 0 }) <= (E.CHERTA_R ?? 6)).map((n) => n.key) : [];
  const decide = E.botOrders;
  E.botOrders = (p, w) => {
    const t = E.SIM.t;
    if (k0 !== null) style['klinok'] = t < k0 ? 0 : klinok;
    const world = w as HeadWorld;
    /* surplus: charge near the cap burns - the build knob grows, the head puts
       up masts (botWantsMast) and bids on lots itself (lot price - 60 · build · …) */
    if (surplus) style['build'] = (world.energy?.[p] ?? 0) >= surplus.at ? surplus.build : build;
    /* botTryFeed skips a needle in w.fed; the mask is only for the time of the
       decision, the world's bookkeeping is already done in the mirror sync */
    const fed: string[] = [];
    if (noFeed !== null && t < noFeed) {
      const lit = world.lit?.[p] ?? {};
      for (const k of Object.keys(lit)) {
        if (lit[k] && !world.fed[k]) {
          world.fed[k] = p;
          fed.push(k);
        }
      }
    }
    /* before dawn and without mercy needles inside the cherta vanish from the
       belief: botPick skips an unknown needle, and the head sends there neither a Tkach nor a Klinok */
    const hidden: [string, unknown][] = [];
    const at = world.bel?.[p]?.at;
    if (at && inside.length && !world.dawn && !world.keep?.mercy?.[p]) {
      for (const k of inside) {
        if (at[k] !== undefined && world.own?.[k] !== p) {
          hidden.push([k, at[k]]);
          delete at[k];
        }
      }
    }
    try {
      return decide.call(E, p, w);
    } finally {
      for (const k of fed) delete world.fed[k];
      for (const [k, v] of hidden) at![k] = v;
    }
  };
}

const cell = (h: Hex): string => h.q + ',' + h.r;
export const hexDist = (a: Hex, b: Hex): number => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
/* all of a unit's orders in the frame are "empty": jam without a target and
   without hold, and halt. That's how the head holds a guard Klinok every tick;
   it can be given a job, these orders lose nothing */
export function idleOnly(entries: readonly Tagged[], idx: readonly number[]): boolean {
  return idx.every((i) => {
    const o = entries[i]!.order;
    return o.kind === 'halt' || (o.kind === 'jam' && o.target === null && !o.hold);
  });
}

/* the ring of cells at distance r from the center */
export function hexRing(c: Hex, r: number): Hex[] {
  const dirs: Hex[] = [{ q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }];
  const out: Hex[] = [];
  let h: Hex = { q: c.q + dirs[4]!.q * r, r: c.r + dirs[4]!.r * r };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < r; step++) {
      out.push(h);
      h = { q: h.q + dirs[side]!.q, r: h.r + dirs[side]!.r };
    }
  }
  return out;
}

/* who owns each needle, as far as we know: from the manifest (ruins, ring,
   starts) and from frames - ours fully, foreign ones - when they are visible */
export class NeedleOwners {
  private readonly owner = new Map<string, ActorName | null>();
  private readonly ring = new Set<string>();

  /* perm - which slot sits in which seat: n.start in the manifest is the SEAT
     letter (rules 5.4), not the slot; in matches 2 and 3 of a pack they differ */
  constructor(needles: readonly NeedleSpec[], perm?: readonly SlotName[]) {
    const seatSlot = (seat: SlotName): SlotName => perm?.[['A', 'B', 'C'].indexOf(seat)] ?? seat;
    for (const n of needles) {
      this.owner.set(cell(n), n.start ? seatSlot(n.start) : n.ring ? 'K' : null);
      if (n.ring) this.ring.add(cell(n));
    }
  }

  ringAt(h: Hex): boolean {
    return this.ring.has(cell(h));
  }

  see(obs: Observe, slot: SlotName): void {
    for (const e of obs.own) this.owner.set(cell(e), e.owner);
    for (const n of obs.mine.needles) this.owner.set(cell(n), slot);
  }

  /* undefined - no needle on the cell */
  at(h: Hex): ActorName | null | undefined {
    return this.owner.get(cell(h));
  }
}

/* Clean ram: an enemy Tkach stands on a needle that is not his - he heats or
   builds it, and a ram on him is clean (rules 11.7). The head doesn't catch
   these: its defence is built for a 1:1 trade (one recharge per swarm, a
   guest price threshold, only lit needles). Prey - only seen exactly in this
   tick (11.6), not the Keeper and not a pact partner; first Tkachs on our
   needles, then on ruins and the ring, then on the third player's needles.
   Hunter - a Klinok without a ram job or a way home, not a siege holder, that
   the head gave nothing in the frame, within R steps. At most one new ram per
   tick; channel and frame cap are checked as for the pulse. */
export function ramOrder(
  obs: Observe,
  orders: readonly Order[],
  slot: SlotName,
  owners: NeedleOwners,
  R: number,
  world: PulseWorld,
  refused: (unit: string, target: string) => boolean = () => false,
): Order | null {
  const link = obs.pub.pact.active.find((l) => l.a === slot || l.b === slot);
  const friend = link ? (link.a === slot ? link.b : link.a) : null;
  const commanded = new Set(orders.flatMap((o) => ('unit' in o ? [o.unit] : [])));
  const chased = new Set(obs.mine.units.flatMap((u) => (u.task?.ram ? [u.task.ram] : [])));
  const rank = (owner: ActorName | null): number => (owner === slot ? 0 : owner === null || owner === 'K' ? 1 : 2);
  const prey = obs.foe.flatMap((f) => {
    if (f.cls !== 'ткач' || f.p === 'K' || f.p === friend || chased.has(f.id)) return [];
    const owner = owners.at(f);
    return owner === undefined || owner === f.p ? [] : [{ f, rank: rank(owner) }];
  });
  if (!prey.length) return null;
  let best: { unit: string; at: Hex; target: string; rank: number; d: number } | null = null;
  for (const u of obs.mine.units) {
    if (u.cls !== 'клинок' || u.stuck || u.wait > 0 || commanded.has(u.id)) continue;
    if (u.task && (u.task.ram || u.task.home || (u.task.jam && u.task.path === 0))) continue;
    for (const { f, rank } of prey) {
      const d = hexDist(u, f);
      if (d > R || refused(u.id, f.id)) continue;
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { unit: u.id, at: u, target: f.id, rank, d };
    }
  }
  if (!best) return null;
  const ram: Order = { kind: 'ram', unit: best.unit, target: best.target };
  if (orders.length + 1 > orderCap(world.cfg, obs.pulse.chanAt)) return null;
  const cost = orderCost(world.cfg, 'ram', best.at, obs.t, world.storms);
  return channelLeft(obs, orders, world) >= cost ? ram : null;
}

/* scout: a rival unit not seen for this many ticks is lost; a ruin is looked at again no sooner
   than this; only ruins we would reach within the horizon; a race closer than the margin is contested */
const SCOUT_LOST = 12;
const SCOUT_RECHECK = 6;
const SCOUT_HORIZON = 40;
const SCOUT_MARGIN = 10;

/* world numbers the tactics read (AfterHead.num): self-check at start */
export const CFG_KEYS = [
  'heatNeedle', 'heatDark', 'heatEnemy', 'autonomy', 'stepTkach', 'stepKlinok', 'capGrace',
  'weightTkach', 'weightKlinok', 'squadWeight', 'droneBuild', 'findHook', 'energyCap', 'scanCost', 'chanOrder',
] as const;

/* a frame entry: an order, its source and its position in it (strategy.ts, Entry) */
export interface Tagged {
  order: Order;
  from: Source;
  at: number;
}


/* Tactics after the head that remember frames: stay, cherta (stop those
   already heading beyond the line), hunt (ram v2), yardcap and the memory of
   ram rejections. Own state - for one match: PulseStrategy builds a new one in every init. */
export class AfterHead {
  readonly owners: NeedleOwners;
  private readonly cfg: Record<string, number>;
  private readonly citadel: Hex;
  private readonly cherta: number;
  private readonly start = new Set<string>();
  /* our Tkach: how many ticks it has stood with hands on one cell */
  private readonly dwell = new Map<string, { cell: string; ticks: number }>();
  /* a foreign unit: since which tick it stands on the cell */
  private readonly foeAt = new Map<string, { cell: string; since: number }>();
  /* our needle: the tick it became ours (capGrace pause after a capture) */
  private readonly ours = new Map<string, number>();
  private known = false;
  /* yard orders accepted by the gatekeeper: hulls in the queue (droneBuild ticks) */
  private readonly yards: { t: number; cls: ClsName }[] = [];
  /* rejected rams "hunter>target" - until tick */
  private readonly refusedUntil = new Map<string, number>();
  /* hunt chases: hunter -> target */
  private readonly hunts = new Map<string, string>();
  /* the valley's caches and flares (manifest) and the ones already taken (the find event is visible to all) */
  private readonly finds: { q: number; r: number; kind: string }[];
  private readonly taken = new Map<string, ActorName>();
  /* sites where the gatekeeper rejected a needle with code 11 "ground": there
     is already a foreign needle there, the head didn't see it and without
     memory would build there again (the botSites cache forgets rejections every 20 ticks) */
  private readonly refusedSites = new Set<string>();
  /* cache -> the unit the cache tactic sent for it */
  private readonly seekers = new Map<string, string>();
  /* the dawn tick (manifest) and the ring needles right on the cherta: next to
     them there are cells beyond the line (cherta + 1) to both wait for dawn and jam without provoking */
  private readonly dawnAt: number | null;
  private readonly ringEdge: Hex[];
  private readonly needleCells = new Set<string>();
  /* dawn: Tkach -> ring needle and waiting cell; loot: Klinok -> needle and cell */
  private readonly staged = new Map<string, { ring: Hex; stand: Hex }>();
  private readonly looters = new Map<string, { ring: Hex; stand: Hex }>();
  /* duck: a Tkach that stepped off a needle because of an enemy Klinok -> until which tick it stays aside */
  private readonly ducking = new Map<string, number>();
  /* scout: the rivals' hearths, the valley's ruins, rival units seen lately and when we last looked */
  private readonly rivalHearths: Hex[] = [];
  private readonly ruins: Hex[];
  private readonly seenFoe = new Map<string, { q: number; r: number; t: number; cls: ClsName }>();
  private readonly lookedAt = new Map<string, number>();
  private t = 0;

  constructor(
    private readonly tactics: Tactics,
    man: Manifest,
    private readonly slot: SlotName,
    private readonly world: PulseWorld,
    /* will a thread from the cell reach our lit needle or the hearth (mirror engine) */
    private readonly links: (at: Hex, obs: Observe) => boolean,
    /* is there a path for a unit of class cls from cell to cell (mirror engine); no mirror - no */
    private readonly pathOk: (from: Hex, to: Hex, cls: ClsName) => boolean = () => false,
    log: (line: string) => void = () => undefined,
  ) {
    this.owners = new NeedleOwners(man.needles, man.perm);
    this.cfg = man.cfg;
    this.citadel = man.citadel;
    this.cherta = man.cherta;
    for (const n of man.needles) if (n.start) this.start.add(cell(n));
    for (const n of man.needles) this.needleCells.add(cell(n));
    this.dawnAt = typeof man.dawn?.at === 'number' ? man.dawn.at : null;
    this.ringEdge = man.needles.filter((n) => n.ring && hexDist(n, man.citadel) === man.cherta).map((n) => ({ q: n.q, r: n.r }));
    this.finds = man.finds.filter((f) => f.kind === 'cache' || f.kind === 'flare');
    /* seat i belongs to slot perm[i]: the rivals' hearths are the seats of the other two slots */
    (man.seats ?? []).forEach((h, i) => {
      const owner = man.perm?.[i];
      if (owner && owner !== slot) this.rivalHearths.push({ q: h.q, r: h.r });
    });
    this.ruins = man.needles.filter((n) => !n.start && !n.ring).map((n) => ({ q: n.q, r: n.r }));
    /* the new world of 05.10 may rename a number - then the tactic would
       quietly count with the fallback value. No key - once to the log */
    const missing = CFG_KEYS.filter((k) => typeof this.cfg[k] !== 'number');
    if (missing.length) log('tactics: the manifest cfg has no ' + missing.join(', ') + ' - using fallback numbers');
    if ((tactics.hunt !== null || tactics.ram !== null) && this.cfg['ramClean'] !== 1) {
      log('ram: ramClean = ' + String(this.cfg['ramClean']) + ' - a ram on a working Tkach may be a trade');
    }
  }

  /* the SDK mirror doesn't parse foreign find events (an SDK bug): a find taken
     by an opponent still "lies" in the mirror, our unit walks over its cell and
     the mirror credits itself a phantom flare token - the head thinks a scan
     under a storm is free, and the gatekeeper rejects "ears". Before the head's
     decision write the taken finds into the mirror's w.find, and rejected sites into the botSites cache */
  syncMirror(engine: unknown): void {
    const E = engine as {
      SIM?: { world?: { find?: Record<string, unknown> } };
      BOT_SITES?: Record<string, { refused?: Record<string, unknown> } | null>;
    } | null;
    const w = E?.SIM?.world;
    if (w && this.taken.size) {
      const found = w.find ?? (w.find = {});
      for (const [k, p] of this.taken) if (!found[k]) found[k] = { p, t: this.t };
    }
    const sites = E?.BOT_SITES?.[this.slot];
    if (sites && this.refusedSites.size) {
      const refused = sites.refused ?? (sites.refused = {});
      for (const k of this.refusedSites) refused[k] = 1;
    }
  }

  private num(key: string, fallback: number): number {
    const v = this.cfg[key];
    return typeof v === 'number' ? v : fallback;
  }

  refused = (unit: string, target: string): boolean => (this.refusedUntil.get(unit + '>' + target) ?? -1) >= this.t;

  /* observe frame: owners, how long ours and foreign units stand, our new needles */
  see(obs: Observe): void {
    this.t = obs.t;
    this.owners.see(obs, this.slot);
    for (const e of obs.events) if (e.type === 'find') this.taken.set(cell(e), e.p);
    for (const n of obs.mine.needles) {
      const k = cell(n);
      if (!this.ours.has(k)) this.ours.set(k, this.known ? obs.t : -1e9);
    }
    const mineNow = new Set(obs.mine.needles.map(cell));
    for (const k of [...this.ours.keys()]) if (!mineNow.has(k)) this.ours.delete(k);
    this.known = true;
    const alive = new Set<string>();
    for (const u of obs.mine.units) {
      alive.add(u.id);
      if (u.cls !== 'ткач') continue;
      const k = cell(u);
      const d = this.dwell.get(u.id);
      const hands = u.mute ? 0 : 1;
      this.dwell.set(u.id, d && d.cell === k ? { cell: k, ticks: d.ticks + hands } : { cell: k, ticks: hands });
    }
    for (const id of [...this.dwell.keys()]) if (!alive.has(id)) this.dwell.delete(id);
    const seen = new Set<string>();
    for (const f of obs.foe) {
      seen.add(f.id);
      const k = cell(f);
      const was = this.foeAt.get(f.id);
      if (!was || was.cell !== k) this.foeAt.set(f.id, { cell: k, since: obs.t });
    }
    for (const id of [...this.foeAt.keys()]) if (!seen.has(id)) this.foeAt.delete(id);
    for (const [id] of this.hunts) if (!alive.has(id)) this.hunts.delete(id);
    for (const f of obs.foe) if (f.p !== 'K') this.seenFoe.set(f.id, { q: f.q, r: f.r, t: obs.t, cls: f.cls });
    for (const [id, s] of [...this.seenFoe]) if (obs.t - s.t > SCOUT_LOST) this.seenFoe.delete(id);
  }

  private underLine(h: Hex, obs: Observe): boolean {
    return !obs.pub.dawn && !obs.pulse.mercy && hexDist(h, this.citadel) <= this.cherta;
  }

  /* how many ticks to heat the needle under a unit: ruin 8, dark foreign 16,
     lit 24; the Keeper's ring before dawn - like a foreign one, after - like a ruin */
  private heatPrice(at: Hex, owner: ActorName | null, obs: Observe): number {
    if (owner === null || (owner === 'K' && obs.pub.dawn)) return this.num('heatNeedle', 8);
    const dark = obs.own.find((e) => e.q === at.q && e.r === at.r)?.dark ?? false;
    return dark ? this.num('heatDark', 16) : this.num('heatEnemy', 24);
  }

  /* stay: a Tkach heats a foreign or unowned needle, ≤ K ticks to go, and the leash holds */
  staysToFinish(u: Observe['mine']['units'][number], obs: Observe, K: number): boolean {
    if (u.cls !== 'ткач') return false;
    const owner = this.owners.at(u);
    if (owner === undefined || owner === this.slot || this.start.has(cell(u))) return false;
    if (this.underLine(u, obs)) return false;
    const stood = this.dwell.get(u.id);
    if (!stood || stood.cell !== cell(u)) return false;
    const left = this.heatPrice(u, owner, obs) - stood.ticks;
    /* far from the end, or the "progress" isn't growing (a foreign capture pause) */
    if (left > K || left < -2) return false;
    const back = this.links(u, obs) ? 0 : 3 * this.num('stepTkach', 2);
    return u.away + Math.max(0, left) + back + 4 <= this.num('autonomy', 40);
  }

  /* everything after the head: input - the head's (or filler's) entries, output - the frame without the pulse */
  apply(obs: Observe, entries: readonly Tagged[]): Tagged[] {
    let out = [...entries];
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    const commanded = (id: string) => out.some((e) => 'unit' in e.order && e.order.unit === id);

    if (this.tactics.stay !== null) {
      const K = this.tactics.stay;
      out = out.filter((e) => {
        if (e.from !== 'head' || e.order.kind !== 'move' || !e.order.home) return true;
        const u = units.get(e.order.unit);
        return !(u && this.staysToFinish(u, obs, K));
      });
    }

    if (this.tactics.noHook) {
      /* The Tkach stands on its target cell, but the path isn't empty yet - this
         is just the trail of a find's hook (rules 16.8): the hook leads the unit
         to the find, returns it to where it turned, and only then finishes the
         old path to the target. A move to the same cell gives an empty path and
         the same target: the unit stands and heats (simHeat looks at the cell,
         not the task), and the hook doesn't catch on an empty path. Cut only the
         trail where the find gives nothing any more (hookWorth): then the Tkach
         loses neither ticks nor charge. Price - an ordinary order (32 bytes) */
      for (const u of obs.mine.units) {
        const task = u.task;
        const goal = task?.goal;
        if (u.cls !== 'ткач' || !task || !goal || goal.q !== u.q || goal.r !== u.r || task.path <= 0) continue;
        if (task.home || task.ram || u.wait > 0 || u.stuck || commanded(u.id) || this.owners.at(u) === undefined) continue;
        if (this.hookWorth(u, obs)) continue;
        const orders = out.map((e) => e.order);
        if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) break;
        if (channelLeft(obs, orders, this.world) < orderCost(this.world.cfg, 'move', u, obs.t, this.world.storms)) break;
        out.push({ order: { kind: 'move', unit: u.id, q: u.q, r: u.r, goal: { q: u.q, r: u.r }, home: false }, from: 'tactic', at: 0 });
      }
    }

    if (this.tactics.cache !== null) out = this.seekCache(obs, out, this.tactics.cache);

    /* dawn - before cherta: a Tkach stepping onto the ring one tick before dawn
       already has an order, and cherta doesn't stop it (halt only for those the frame gave nothing) */
    if (this.tactics.dawn !== null) out = this.stageDawn(obs, out, this.tactics.dawn);

    const extra: Order[] = [];
    if (this.tactics.cherta && !obs.pub.dawn && !obs.pulse.mercy) {
      /* An aggressor for the Keeper (rules 21.6, keeperJams) - a Klinok inside
         the line within 1 of a ring needle that holds our live jam (it lives up
         to 20 ticks after the last jamming), and a Tkach standing on a needle it
         can heat (it heats even without a task, 13.6). Dropping the target or a
         halt is not enough: both - move beyond the line (≥ cherta + 1 from the
         citadel). A Klinok mid-step - jam without a target: accepted mid-step
         too (10.6) and doesn't extend the jam */
      const liveRingJams = obs.mine.jams.filter((j) => j.until > obs.t && this.owners.at(j) === 'K');
      for (const u of obs.mine.units) {
        if (u.stuck || !this.underLine(u, obs)) continue;
        const owner = this.owners.at(u);
        const jamming = u.cls === 'клинок' && liveRingJams.some((j) => hexDist(u, j) <= 1);
        const heating = u.cls === 'ткач' && owner !== undefined && owner !== this.slot;
        if (!jamming && !heating) continue;
        if (u.wait === 0) {
          const to = this.exitLine(u);
          if (to) out = this.replaceUnit(obs, out, u.id, { kind: 'move', unit: u.id, q: to.q, r: to.r, goal: null, home: false });
        } else if (jamming) {
          out = this.replaceUnit(obs, out, u.id, { kind: 'jam', unit: u.id, target: null, hold: false });
        }
      }
      /* whoever is already heading beyond the line by an old plan - stop */
      for (const u of obs.mine.units) {
        const goal = u.task?.goal;
        /* halt mid-step is a "turn" rejection (code 4): only to a unit between steps */
        if (u.cls === 'ткач' && goal && this.underLine(goal, obs) && u.wait === 0 && !commanded(u.id)) extra.push({ kind: 'halt', unit: u.id });
      }
      out = out.map((e) => {
        const o = e.order;
        if (o.kind !== 'jam' || !o.target || this.owners.at(o.target) !== 'K') return e;
        const u = units.get(o.unit);
        return u && this.underLine(u, obs) ? { ...e, order: { ...o, target: null } } : e;
      });
    }

    if (this.tactics.loot !== null) out = this.lootRing(obs, out, this.tactics.loot);

    if (this.tactics.duck) out = this.duckTkachs(obs, out);

    if (this.tactics.scout !== null) out = this.scout(obs, out, this.tactics.scout);

    if (this.tactics.hunt !== null) {
      for (const [hunter, target] of [...this.hunts]) {
        const u = units.get(hunter);
        if (!u || u.task?.ram !== target) {
          this.hunts.delete(hunter);
          continue;
        }
        const f = obs.foe.find((x) => x.id === target);
        if (f && !this.worthy(f, obs) && u.wait === 0 && !commanded(hunter)) {
          extra.push({ kind: 'halt', unit: hunter });
          this.hunts.delete(hunter);
        }
      }
    }

    /* stops are free, but the gatekeeper accepts them only with 32 channel bytes (13.4) */
    for (const o of extra) {
      const orders = out.map((e) => e.order);
      if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) break;
      if (channelLeft(obs, orders, this.world) < this.world.cfg.chanOrder) break;
      out.push({ order: o, from: 'tactic', at: 0 });
    }

    if (this.tactics.hunt !== null) {
      const hit = this.hunt(obs, out, this.tactics.hunt);
      if (hit) {
        out = out.filter((_, i) => !hit.replaces.includes(i));
        out.push({ order: hit.order, from: 'tactic', at: 0 });
        if (hit.order.kind === 'ram') this.hunts.set(hit.order.unit, hit.order.target);
      }
    }

    if (this.tactics.yardCap) out = this.capYard(obs, out);
    return out;
  }

  /* the nearest cell beyond the line (cherta + 1 from the citadel) with a path to it */
  private exitLine(u: Observe['mine']['units'][number]): Hex | null {
    const ring = hexRing(this.citadel, this.cherta + 1).sort((a, b) => hexDist(u, a) - hexDist(u, b));
    for (const c of ring.slice(0, 8)) if (this.pathOk(u, c, u.cls)) return c;
    return null;
  }

  /* all of a unit's orders in the frame - out, one tactic order instead; if
     the channel or the frame cap won't fit it - the frame as it was */
  private replaceUnit(obs: Observe, entries: Tagged[], unit: string, order: Order): Tagged[] {
    const rest = entries.filter((e) => !('unit' in e.order && e.order.unit === unit));
    const orders = rest.map((e) => e.order);
    if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) return entries;
    const at = obs.mine.units.find((u) => u.id === unit) ?? this.world.hearth;
    const cost = order.kind === 'jam' || order.kind === 'halt' ? this.world.cfg.chanOrder : orderCost(this.world.cfg, order.kind, at, obs.t, this.world.storms);
    if (channelLeft(obs, orders, this.world) < cost) return entries;
    return [...rest, { order, from: 'tactic', at: 0 }];
  }

  /* all of a unit's orders in the frame - out (the unit keeps its task) */
  private dropUnit(entries: Tagged[], unit: string): Tagged[] {
    return entries.filter((e) => !('unit' in e.order && e.order.unit === unit));
  }

  /* cells beyond the line next to a ring needle: not a needle, no units, not taken by another plan */
  private standsBy(ring: Hex, obs: Observe, taken: ReadonlySet<string>): Hex[] {
    const busy = new Set([...obs.mine.units.map(cell), ...obs.foe.map(cell)]);
    return hexRing(ring, 1).filter((c) => hexDist(c, this.citadel) === this.cherta + 1 && !this.needleCells.has(cell(c)) && !busy.has(cell(c)) && !taken.has(cell(c)));
  }

  /* dawn:N - after dawn the ring pulls twice as much, and whoever is closer
     takes it. The head remembers the ring only on the dawn tick (the engine's
     ring siege) and leads Tkachs across half the valley. Here a free Tkach (not
     heating a foreign needle, not building, not feeding) N ticks before dawn
     stands beyond the line next to a ring needle our thread reaches, and waits;
     one tick before dawn it steps onto it - heating already after dawn (8
     ticks). The head is ignored for it until the needle is ours */
  private stageDawn(obs: Observe, entries: Tagged[], N: number): Tagged[] {
    const at = this.dawnAt;
    let out = entries;
    if (at === null) return out;
    const t = obs.t;
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    for (const [id, s] of [...this.staged]) {
      if (!units.has(id) || this.owners.at(s.ring) === this.slot || t > at + 16) this.staged.delete(id);
    }
    if (t >= at - 1) {
      for (const [id, s] of this.staged) {
        const u = units.get(id)!;
        const goal = u.task?.goal;
        const onRing = u.q === s.ring.q && u.r === s.ring.r;
        const heading = !!goal && goal.q === s.ring.q && goal.r === s.ring.r;
        if (onRing || heading || u.wait > 0 || u.stuck) {
          out = this.dropUnit(out, id);
          continue;
        }
        out = this.replaceUnit(obs, out, id, { kind: 'move', unit: id, q: s.ring.q, r: s.ring.r, goal: { q: s.ring.q, r: s.ring.r }, home: false });
      }
      return out;
    }
    if (t < at - N) return out;
    /* already assigned: standing - ignore the head; knocked off - back */
    for (const [id, s] of this.staged) {
      const u = units.get(id)!;
      const there = u.q === s.stand.q && u.r === s.stand.r;
      if (there || u.wait > 0 || u.stuck) {
        out = this.dropUnit(out, id);
        continue;
      }
      out = this.replaceUnit(obs, out, id, { kind: 'move', unit: id, q: s.stand.q, r: s.stand.r, goal: null, home: false });
    }
    /* new ones: the nearest pair "Tkach - cell next to a ring needle" it can make in time */
    const rings = new Set([...this.staged.values()].map((s) => cell(s.ring)));
    const stands = new Set([...this.staged.values()].map((s) => cell(s.stand)));
    const step = this.num('stepTkach', 2);
    for (;;) {
      let best: { u: Observe['mine']['units'][number]; ring: Hex; stand: Hex; d: number } | null = null;
      for (const ring of this.ringEdge) {
        if (rings.has(cell(ring)) || this.owners.at(ring) !== 'K' || !this.links(ring, obs)) continue;
        for (const stand of this.standsBy(ring, obs, stands)) {
          for (const u of obs.mine.units) {
            if (u.cls !== 'ткач' || u.wait > 0 || u.stuck || u.mute || this.staged.has(u.id)) continue;
            /* in the frame site = goal on the way too: busy is only one already at the goal (heating or building) */
            const goal = u.task?.goal;
            if (u.task?.feed || u.task?.home || (goal && goal.q === u.q && goal.r === u.r)) continue;
            const owner = this.owners.at(u);
            if (owner !== undefined && owner !== this.slot) continue; /* heating a foreign needle */
            const d = hexDist(u, stand);
            if (d * step * 1.5 > at - t + 4 || (best && d >= best.d)) continue;
            if (!this.pathOk(u, stand, 'ткач')) continue;
            best = { u, ring, stand, d };
          }
        }
      }
      if (!best) break;
      const next = this.replaceUnit(obs, out, best.u.id, { kind: 'move', unit: best.u.id, q: best.stand.q, r: best.stand.r, goal: null, home: false });
      if (next === out) break;
      out = next;
      this.staged.set(best.u.id, { ring: best.ring, stand: best.stand });
      rings.add(cell(best.ring));
      stands.add(cell(best.stand));
    }
    return out;
  }

  /* loot:K - a jam on a foreign lit needle pulls its coverage to us (rules
     8.7), and the engine's head doesn't count loot at all (03-sdk 6) and even
     removes the Keeper's penalty from a ring needle, though jamming from a cell
     farther than 6 from the center is not a provocation (21.7). Before dawn K
     Klinoks the head gave nothing stand beyond the line next to a lit ring
     needle and hold the jam (hold). The head's empty pair jam(null) + halt is
     not passed for them - it would lift the jam. One tick before dawn - release:
     a dark ring gives no loot (22.5) */
  private lootRing(obs: Observe, entries: Tagged[], K: number): Tagged[] {
    const at = this.dawnAt;
    let out = entries;
    if (at === null) return out;
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    const autonomy = this.num('autonomy', 40);
    const idx = (id: string) => out.flatMap((e, i) => ('unit' in e.order && e.order.unit === id ? [i] : []));
    const lit = (h: Hex) => this.owners.at(h) === 'K' && !(obs.own.find((e) => e.q === h.q && e.r === h.r)?.dark ?? false);
    for (const [id, s] of [...this.looters]) {
      const u = units.get(id);
      /* the head rams (a threat), the leash, the ring went dark or is no longer the Keeper's - release;
         its other orders (post, raid) are outweighed by the jam */
      const rams = out.some((e) => e.order.kind === 'ram' && e.order.unit === id);
      if (!u || obs.pub.dawn || obs.t >= at - 1 || !lit(s.ring) || u.away > autonomy - 8 || rams) this.looters.delete(id);
    }
    if (obs.pub.dawn || obs.t >= at - 1) return out;
    for (const [id, s] of this.looters) {
      const u = units.get(id)!;
      const there = u.q === s.stand.q && u.r === s.stand.r;
      const jam = u.task?.jam;
      if (there && jam && jam.q === s.ring.q && jam.r === s.ring.r && u.task?.path === 0) {
        out = this.dropUnit(out, id);
        continue;
      }
      if (u.wait > 0 || u.stuck) {
        out = this.dropUnit(out, id);
        continue;
      }
      out = there
        ? this.replaceUnit(obs, out, id, { kind: 'jam', unit: id, target: { q: s.ring.q, r: s.ring.r }, hold: true })
        : this.replaceUnit(obs, out, id, { kind: 'move', unit: id, q: s.stand.q, r: s.stand.r, goal: null, home: false });
    }
    const rings = new Set([...this.looters.values()].map((s) => cell(s.ring)));
    const stands = new Set([...this.looters.values()].map((s) => cell(s.stand)));
    while (this.looters.size < K) {
      let best: { u: Observe['mine']['units'][number]; ring: Hex; stand: Hex; d: number } | null = null;
      for (const ring of this.ringEdge) {
        if (rings.has(cell(ring)) || !lit(ring)) continue;
        for (const stand of this.standsBy(ring, obs, stands)) {
          for (const u of obs.mine.units) {
            if (u.cls !== 'клинок' || u.wait > 0 || u.stuck || u.mute || this.looters.has(u.id) || this.hunts.has(u.id)) continue;
            if (u.task && (u.task.ram || u.task.home || u.task.jam)) continue;
            if (!idleOnly(out, idx(u.id))) continue;
            const d = hexDist(u, stand);
            if (d > 24 || (best && d >= best.d)) continue;
            if (!this.pathOk(u, stand, 'клинок')) continue;
            best = { u, ring, stand, d };
          }
        }
      }
      if (!best) break;
      const there = best.d === 0;
      const order: Order = there
        ? { kind: 'jam', unit: best.u.id, target: { q: best.ring.q, r: best.ring.r }, hold: true }
        : { kind: 'move', unit: best.u.id, q: best.stand.q, r: best.stand.r, goal: null, home: false };
      const next = this.replaceUnit(obs, out, best.u.id, order);
      if (next === out) break;
      out = next;
      this.looters.set(best.u.id, { ring: best.ring, stand: best.stand });
      rings.add(cell(best.ring));
      stands.add(cell(best.stand));
    }
    return out;
  }

  /* duck - a ram on a Tkach that heats or builds is clean (11.7): the
     opponent's Klinok kills it and lives. A ram on a Tkach without work is a
     trade, the rammer dies too. An enemy Klinok within 2 cells of our working
     Tkach, and no Klinok of ours closer to it - the Tkach steps off the needle
     to a free adjacent cell away from the Klinok and stands while the threat is
     near (up to 6 ticks). Heating restarts, but the Tkach is alive, and a ram
     on it costs the opponent a Klinok */
  private duckTkachs(obs: Observe, entries: Tagged[]): Tagged[] {
    let out = entries;
    const t = obs.t;
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    for (const [id, until] of [...this.ducking]) if (!units.has(id) || t > until) this.ducking.delete(id);
    const blades = obs.foe.filter((f) => f.cls === 'клинок' && f.p !== 'K');
    const ours = obs.mine.units.filter((u) => u.cls === 'клинок');
    const threat = (u: Hex) => blades.find((f) => hexDist(f, u) <= 2 && !ours.some((k) => hexDist(k, f) < hexDist(u, f)));
    /* already stepped away: they stand while the Klinok is near, the head is ignored */
    for (const id of this.ducking.keys()) {
      const u = units.get(id)!;
      if (!threat(u)) {
        this.ducking.delete(id);
        continue;
      }
      out = this.dropUnit(out, id);
    }
    const busy = new Set([...obs.mine.units.map(cell), ...obs.foe.map(cell)]);
    for (const u of obs.mine.units) {
      if (u.cls !== 'ткач' || u.wait > 0 || u.stuck || u.mute || this.ducking.has(u.id)) continue;
      const owner = this.owners.at(u);
      const heating = owner !== undefined && owner !== this.slot && !this.start.has(cell(u));
      const site = u.task?.site;
      const building = !!site && site.q === u.q && site.r === u.r && owner === undefined;
      if (!heating && !building) continue;
      /* heating is almost done - finish it */
      const stood = this.dwell.get(u.id);
      if (heating && stood && stood.cell === cell(u) && this.heatPrice(u, owner ?? null, obs) - stood.ticks <= 1) continue;
      const f = threat(u);
      if (!f) continue;
      const step = hexRing(u, 1)
        .filter((c) => !busy.has(cell(c)) && !this.needleCells.has(cell(c)) && this.pathOk(u, c, 'ткач'))
        .sort((a, b) => hexDist(b, f) - hexDist(a, f))[0];
      if (!step) continue;
      const next = this.replaceUnit(obs, out, u.id, { kind: 'move', unit: u.id, q: step.q, r: step.r, goal: null, home: false });
      if (next === out) continue;
      out = next;
      busy.add(cell(step));
      this.ducking.set(u.id, t + 6);
    }
    return out;
  }

  /* scout:N - the head's scans in the first ticks follow blips, and blips appear only next
     to our own eyes (3-5 cells, many of them ghosts). Here the free ears look at the rivals:
       1. tracking: a rival unit seen lately and not visible now is looked at again where it
          was last seen - a Tkach every 3 ticks (one cell per 2 ticks keeps it inside a
          radius-3 snapshot), a Klinok every 2; the ones close to our Tkachs' goals first;
       2. forecast: a ruin we would reach no later than about when a rival could (its first
          Tkach leaves the yard on tick 1 + droneBuild and walks a cell per stepTkach ticks),
          once a rival could already be near it; our Tkachs' goals first, then the closest race.
     The scan replaces the head's scan of this tick; with nothing to look at the head's stays.
     The snapshot arrives on the next tick (the world's subScan), so one scan per tick is enough */
  private scout(obs: Observe, entries: Tagged[], N: number): Tagged[] {
    if (obs.t > N) return entries;
    const target = this.scoutTarget(obs);
    if (!target) return entries;
    const order: Order = { kind: 'scan', q: target.at.q, r: target.at.r, rad: this.num('scanRad', 3) };
    if (orderCost(this.world.cfg, 'scan', target.at, obs.t, this.world.storms) > obs.pulse.ear) return entries;
    const rest = entries.filter((e) => e.order.kind !== 'scan');
    if (rest.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) return entries;
    this.lookedAt.set(target.key, obs.t);
    return [...rest, { order, from: 'tactic', at: 0 }];
  }

  private scoutTarget(obs: Observe): { at: Hex; key: string } | null {
    const t = obs.t;
    const step = this.num('stepTkach', 2);
    const tkachs = obs.mine.units.filter((u) => u.cls === 'ткач');
    const goals = tkachs.flatMap((u) => {
      const g = u.task?.site ?? u.task?.goal;
      return g ? [g] : [];
    });
    const nearGoal = (h: Hex, d: number) => goals.some((g) => hexDist(g, h) <= d);
    const visible = new Set(obs.foe.map((f) => f.id));
    let best: { at: Hex; key: string; score: number } | null = null;
    const offer = (at: Hex, key: string, score: number) => {
      if (!best || score > best.score) best = { at, key, score };
    };

    /* 1. tracking */
    for (const [id, s] of this.seenFoe) {
      if (visible.has(id)) continue;
      const every = s.cls === 'ткач' ? 3 : 2;
      const key = 'unit:' + id;
      if (t - s.t < every || t - (this.lookedAt.get(key) ?? -1e9) < every) continue;
      offer({ q: s.q, r: s.r }, key, 10 + (s.cls === 'ткач' ? 2 : 1) + (nearGoal(s, 6) ? 4 : 0) - (t - s.t) / SCOUT_LOST);
    }
    if (best) return best;

    /* 2. forecast */
    if (!this.rivalHearths.length) return null;
    const born = 1 + this.num('droneBuild', 4);
    for (const r of this.ruins) {
      const owner = this.owners.at(r);
      if (owner !== null) continue; /* ours, a rival's or the Keeper's already - nothing to race for */
      const key = cell(r);
      if (t - (this.lookedAt.get(key) ?? -1e9) < SCOUT_RECHECK) continue;
      const ours = tkachs.length ? t + step * Math.min(...tkachs.map((u) => hexDist(u, r))) : t + born + step * hexDist(this.world.hearth, r);
      const rival = Math.min(...this.rivalHearths.map((h) => born + step * hexDist(h, r)));
      if (ours - t > SCOUT_HORIZON) continue; /* not in our plans soon */
      if (rival > ours + SCOUT_MARGIN) continue; /* we are there well before anyone */
      if (t < rival - 2 * step) continue; /* no rival can be within two cells of it yet */
      offer(r, key, (nearGoal(r, 0) ? 3 : 1) + 1 / (1 + Math.abs(ours - rival)));
    }
    return best;
  }

  /* how much charge a cache gives now: above the cap burns (rules 16.3) */
  private cacheGain(obs: Observe): number {
    return Math.max(0, Math.min(this.num('cacheEnergy', 150), this.num('energyCap', 360) - obs.pulse.energy));
  }

  /* is there an untaken find near the unit (within the hook, findHook) worth
     letting the hook reach: a flare - always (a free scan, the hook - a few
     ticks), a cache - when ≥ 50 charge would be left of it. Nothing like that -
     the hook's trail is empty: the find is either taken or would burn under the cap */
  private hookWorth(u: Hex, obs: Observe): boolean {
    const reach = this.num('findHook', 2);
    return this.finds.some(
      (f) => !this.taken.has(cell(f)) && hexDist(u, f) <= reach && (f.kind === 'flare' || this.cacheGain(obs) >= 50),
    );
  }

  /* cache:N - a cache gives the full 150, so it's worth a trip: the nearest in
     time free unit within N cells (a Klinok steps twice as fast as a Tkach).
     Free - in the zone (away 0), no ram, no way home or siege; the head gave
     the Klinok nothing or only an "empty" jam (its place is taken by the
     move), a Tkach without a task and without a head order. A Tkach that heats
     or walks to its target is never taken off. One unit per cache; the hook and
     the road itself pick it up on a step (16.2), after which the head gives the unit a new job */
  private seekCache(obs: Observe, entries: readonly Tagged[], N: number): Tagged[] {
    if (this.cacheGain(obs) < this.num('cacheEnergy', 150)) return [...entries];
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    let out = [...entries];
    for (const f of this.finds) {
      const key = cell(f);
      if (f.kind !== 'cache' || this.taken.has(key)) continue;
      const sent = this.seekers.get(key);
      const seeker = sent ? units.get(sent) : undefined;
      if (seeker && seeker.task && seeker.task.path > 0 && !seeker.task.goal) continue;
      this.seekers.delete(key);
      let best: { unit: string; at: Hex; time: number; replaces: number[] } | null = null;
      for (const u of obs.mine.units) {
        if (u.stuck || u.wait > 0 || u.away > 0) continue;
        if (u.task && (u.task.ram || u.task.home)) continue;
        const mine = out.flatMap((e, i) => ('unit' in e.order && e.order.unit === u.id ? [i] : []));
        let replaces: number[] = [];
        if (u.cls === 'клинок') {
          if (u.task && u.task.jam && u.task.path === 0) continue;
          if (!idleOnly(out, mine)) continue;
          replaces = mine;
        } else if (u.task !== null || mine.length) continue;
        const d = hexDist(u, f);
        if (d > N) continue;
        const time = d * (u.cls === 'клинок' ? this.num('stepKlinok', 1) : this.num('stepTkach', 2));
        if (!best || time < best.time) best = { unit: u.id, at: u, time, replaces };
      }
      if (!best) continue;
      const rest = out.filter((_, i) => !best!.replaces.includes(i));
      const orders = rest.map((e) => e.order);
      if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) continue;
      if (channelLeft(obs, orders, this.world) < orderCost(this.world.cfg, 'move', best.at, obs.t, this.world.storms)) continue;
      out = [...rest, { order: { kind: 'move', unit: best.unit, q: f.q, r: f.r, goal: null, home: false }, from: 'tactic', at: 0 }];
      this.seekers.set(key, best.unit);
    }
    return out;
  }

  /* the prey is worth a ram after all: stands on a needle that isn't its own,
     not in our pause, not on a start needle and not on its pact partner's needle */
  private worthy(f: Observe['foe'][number], obs: Observe): boolean {
    const owner = this.owners.at(f);
    if (owner === undefined || owner === f.p || this.start.has(cell(f))) return false;
    if (owner === 'K' && !obs.pub.dawn) return false;
    if (owner === this.slot && this.t - (this.ours.get(cell(f)) ?? -1e9) < this.num('capGrace', 60)) return false;
    if (owner !== null && obs.pub.pact.active.some((l) => (l.a === f.p && l.b === owner) || (l.b === f.p && l.a === owner))) return false;
    return true;
  }

  /* Ram v2. Hunter - a Klinok in the zone (away 0), without a ram or a way
     home, that the head gave nothing or only an "empty" jam (without a target
     and hold: it changes nothing, and the ram takes its place). A siege holder
     - only for prey on our needle within 3 steps. The prey has stood on the
     cell ≥ 3 ticks and is worth a ram (worthy), the Klinok makes it before the
     heating ends. Ranks: our needle (the ring after dawn - higher), a ruin or
     the ring, the third player's needle. */
  private hunt(obs: Observe, entries: readonly Tagged[], R: number): { order: Order; replaces: number[] } | null {
    const link = obs.pub.pact.active.find((l) => l.a === this.slot || l.b === this.slot);
    const friend = link ? (link.a === this.slot ? link.b : link.a) : null;
    const chased = new Set(obs.mine.units.flatMap((u) => (u.task?.ram ? [u.task.ram] : [])));
    const stepK = this.num('stepKlinok', 1);
    const prey: { f: Observe['foe'][number]; rank: number; left: number; ours: boolean }[] = [];
    for (const f of obs.foe) {
      if (f.cls !== 'ткач' || f.p === 'K' || f.p === friend || chased.has(f.id) || !this.worthy(f, obs)) continue;
      const stood = this.foeAt.get(f.id);
      const owner = this.owners.at(f) ?? null;
      /* on our needle in a capture pause heating isn't possible: heating started no earlier than its end */
      const graceEnd = owner === this.slot ? (this.ours.get(cell(f)) ?? -1e9) + this.num('capGrace', 60) : -1e9;
      const since = stood && stood.cell === cell(f) ? obs.t - Math.max(stood.since, graceEnd) : 0;
      if (since < 3) continue;
      const ring = owner === this.slot && this.owners.ringAt(f);
      const rank = owner === this.slot ? (ring ? -1 : 0) : owner === null || owner === 'K' ? 1 : 2;
      prey.push({ f, rank, left: this.heatPrice(f, owner, obs) - since, ours: owner === this.slot });
    }
    if (!prey.length) return null;
    const byUnit = new Map<string, number[]>();
    entries.forEach((e, i) => {
      if ('unit' in e.order) byUnit.set(e.order.unit, [...(byUnit.get(e.order.unit) ?? []), i]);
    });
    let best: { unit: string; at: Hex; target: string; rank: number; d: number; replaces: number[] } | null = null;
    for (const u of obs.mine.units) {
      if (u.cls !== 'клинок' || u.stuck || u.wait > 0 || u.away > 0) continue;
      if (u.task && (u.task.ram || u.task.home)) continue;
      const mine = byUnit.get(u.id) ?? [];
      /* the head gives a guard Klinok the pair jam(null) + halt every tick: that's not a job */
      if (!idleOnly(entries, mine)) continue;
      const replaces = mine;
      const holder = !!(u.task && u.task.jam && u.task.path === 0);
      for (const p of prey) {
        const d = hexDist(u, p.f);
        if (d > R || (holder && (!p.ours || d > 3)) || this.refused(u.id, p.f.id)) continue;
        if ((d - 1) * stepK + 2 >= p.left) continue;
        if (!best || p.rank < best.rank || (p.rank === best.rank && d < best.d)) best = { unit: u.id, at: u, target: p.f.id, rank: p.rank, d, replaces };
      }
    }
    if (!best) return null;
    const orders = entries.filter((_, i) => !best!.replaces.includes(i)).map((e) => e.order);
    if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) return null;
    const cost = orderCost(this.world.cfg, 'ram', best.at, obs.t, this.world.storms);
    if (channelLeft(obs, orders, this.world) < cost) return null;
    return { order: { kind: 'ram', unit: best.unit, target: best.target }, replaces: best.replaces };
  }

  /* yardcap: units in the field and hulls in the yard queue (accepted within
     droneBuild ticks) plus the new one - not heavier than squadWeight; otherwise a "swarm weight" rejection */
  private capYard(obs: Observe, entries: readonly Tagged[]): Tagged[] {
    const weight = (cls: ClsName) => (cls === 'ткач' ? this.num('weightTkach', 2) : this.num('weightKlinok', 1));
    const build = this.num('droneBuild', 4);
    while (this.yards.length && this.yards[0]!.t < obs.t - build) this.yards.shift();
    let load = obs.mine.units.reduce((s, u) => s + weight(u.cls), 0) + this.yards.reduce((s, y) => s + weight(y.cls), 0);
    const cap = this.num('squadWeight', 8);
    return entries.filter((e) => {
      if (e.order.kind !== 'yard') return true;
      const w = weight(e.order.cls);
      if (load + w > cap) return false;
      load += w;
      return true;
    });
  }

  /* Frame filter before sending (criterion K3: 2 points only for 0 rejections):
     - "empty" orders: halt to a unit without a task, jam without a target and
       hold to a Klinok with no intent to jam - if the unit is given nothing
       else in the frame. The head gives such a pair to every guard Klinok every
       tick (~420 pairs per match) and bloats the frame above the cap - a "cap"
       rejection (code 2);
     - a scan there won't be enough ears for (with a storm) when there is no
       flare token - an "ears" rejection (code 7);
     - a needle onto a site where the gatekeeper already rejected "ground" (code 11).
     Verdicts stay in their positions (the entries' at doesn't change) */
  vet(obs: Observe, entries: readonly Tagged[], flareTokens: number): Tagged[] {
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    const noop = (o: Order): boolean => {
      if (!('unit' in o)) return false;
      const u = units.get(o.unit);
      if (!u) return false;
      if (o.kind === 'halt') return u.task === null;
      if (o.kind === 'jam') return o.target === null && !o.hold && u.cls === 'клинок' && (u.task === null || u.task.jam === null);
      return false;
    };
    const byUnit = new Map<string, number[]>();
    entries.forEach((e, i) => {
      if ('unit' in e.order) byUnit.set(e.order.unit, [...(byUnit.get(e.order.unit) ?? []), i]);
    });
    const drop = new Set<number>();
    for (const idx of byUnit.values()) if (idx.every((i) => noop(entries[i]!.order))) for (const i of idx) drop.add(i);
    entries.forEach((e, i) => {
      const o = e.order;
      if (o.kind === 'scan' && flareTokens <= 0 && orderCost(this.world.cfg, 'scan', o, obs.t, this.world.storms) > obs.pulse.ear) drop.add(i);
      if (o.kind === 'needle' && this.refusedSites.has(cell(o))) drop.add(i);
    });
    return drop.size ? entries.filter((_, i) => !drop.has(i)) : [...entries];
  }

  /* frame verdicts: accepted yard orders - into the queue, ram rejections -
     into memory for 15 ticks, "ground" on a needle - the site into memory until the end of the match */
  verdicts(sent: readonly Tagged[], list: readonly Verdict[]): void {
    for (const [i, ok, code] of list) {
      const e = sent[i];
      if (!e) continue;
      if (!ok && code === 11 && e.order.kind === 'needle') this.refusedSites.add(cell(e.order));
      if (ok && e.order.kind === 'yard') this.yards.push({ t: this.t, cls: e.order.cls });
      if (!ok && e.from === 'tactic' && e.order.kind === 'ram') {
        this.refusedUntil.set(e.order.unit + '>' + e.order.target, this.t + 15);
        this.hunts.delete(e.order.unit);
      }
    }
  }
}
