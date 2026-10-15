/* bot :: combo/economy
   The economy half of the сплав preset (combo.ts): of its orders the frame takes the
   Tkachs' and those without a unit. Brought from the lab's sparring bot lab/ext/a4,
   which was written from the part 2 documents; measured in the lab 04-06.10.

   "Зоря" head: its own planner over protocol frames, no mirror.

   Every tick the head rebuilds its picture of the valley (needle owners,
   pull of every actor on every cell, our thread, the comms zone) and gives
   each free unit the job with the best payoff per tick of its time:
     Tkach  - heat a ruin (free needle), build a covering or bridging needle,
              take a weak enemy needle, feed a needle at the end;
     Klinok - grab a cache, ram whoever heats or jams our network, jam an
              enemy needle (loot + cut thread) or a Keeper ring needle from
              outside the line, deny a rival's contract.
   Contracts (+30) get a dedicated planner that pins Tkachs; dawn gets a
   staging plan onto the ring. The channel is budgeted so working units keep
   their hands; a cheap accepted command every few ticks keeps the slot. */

import { fault } from '../faults.js';
import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import type { BeliefFrame, WireBot } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, stormAt } from '@zoria/protocol';
import type { ClsName, LotSpec, Manifest, MineUnit, Observe, Order, SlotName } from '@zoria/protocol';

export interface Strategy extends WireBot {
  /* belief diary frame for the tick; null - there is no frame */
  belief(obs: Observe | null): BeliefFrame | null;
  resetBelief(): void;
}

/* ---------- geometry ---------- */

const OFF = 20;
const W = 2 * OFF + 1;
const NC = W * W;
const MAXR = 8;
const INF = 1e9;
const SL: readonly SlotName[] = ['A', 'B', 'C'];
const TK: ClsName = 'ткач';
const KL: ClsName = 'клинок';
const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];

const kOf = (q: number, r: number): number => (q + OFF) * W + (r + OFF);
const qOf = (k: number): number => Math.floor(k / W) - OFF;
const rOf = (k: number): number => (k % W) - OFF;
const inBox = (q: number, r: number): boolean => q >= -OFF && q <= OFF && r >= -OFF && r <= OFF;

function hexDist(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
const kDist = (a: number, b: number): number => hexDist(qOf(a), rOf(a), qOf(b), rOf(b));
/* P.roads: a job within this many cells of a deadly cell counts as "at" it */
const ROAD_NEAR = 2;
/* P.roads: the share of a job's value left per deadly cell at it or on the way */
const ROAD_RISK = 0.35;
const share = (p: number, tot: number): number => (tot <= 1 ? p : p / tot);
const idCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Off {
  dq: number;
  dr: number;
  d: number;
}
const DISK: Off[] = [];
for (let dq = -MAXR; dq <= MAXR; dq++) {
  for (let dr = -MAXR; dr <= MAXR; dr++) {
    const d = hexDist(dq, dr, 0, 0);
    if (d <= MAXR) DISK.push({ dq, dr, d });
  }
}
DISK.sort((a, b) => a.d - b.d || a.dq - b.dq || a.dr - b.dr);
const DISK_N: number[] = [];
for (let R = 0; R <= MAXR; R++) {
  let n = 0;
  for (const o of DISK) if (o.d <= R) n++;
  DISK_N.push(n);
}
const diskN = (R: number): number => DISK_N[Math.max(0, Math.min(MAXR, Math.floor(R)))] ?? 1;

/* binary heap for Dijkstra */
class Heap {
  private ks = new Int32Array(8192);
  private ds = new Float64Array(8192);
  size = 0;
  topD = 0;

  clear(): void {
    this.size = 0;
  }

  push(k: number, d: number): void {
    if (this.size >= this.ks.length) {
      const nk = new Int32Array(this.ks.length * 2);
      nk.set(this.ks);
      this.ks = nk;
      const nd = new Float64Array(this.ds.length * 2);
      nd.set(this.ds);
      this.ds = nd;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pd = this.ds[p]!;
      if (pd <= d) break;
      this.ks[i] = this.ks[p]!;
      this.ds[i] = pd;
      i = p;
    }
    this.ks[i] = k;
    this.ds[i] = d;
  }

  pop(): number {
    const top = this.ks[0]!;
    this.topD = this.ds[0]!;
    const n = --this.size;
    if (n > 0) {
      const k = this.ks[n]!;
      const d = this.ds[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.ds[c + 1]! < this.ds[c]!) c++;
        if (this.ds[c]! >= d) break;
        this.ks[i] = this.ks[c]!;
        this.ds[i] = this.ds[c]!;
        i = c;
      }
      this.ks[i] = k;
      this.ds[i] = d;
    }
    return top;
  }
}

/* ---------- head state types ---------- */

interface Params {
  alpha: number; // weight of a rival's loss against our own gain
  jam: number; // multiplier of offensive jam value
  ram: boolean; // ram threats to the network
  bid: number; // multiplier of lot bids
  risk: number; // discount on heating others' needles
  /* memory of deadly roads, ticks, 0 - off: a job at a cell, or past a cell, where a
     Tkach of ours was rammed within this many ticks is worth ROAD_RISK as much per
     such death. The group journals of 13.10: one rival post rammed five of our
     Tkachs in a row on one road; the head forgets a rival after 40 ticks */
  roads: number;
}

const PRESETS: Record<string, Params> = {
  'рівний': { alpha: 0.5, jam: 1, ram: true, bid: 1, risk: 0.7, roads: 0 },
  'тихий': { alpha: 0.3, jam: 0.6, ram: true, bid: 0.8, risk: 0.5, roads: 0 },
  'хижий': { alpha: 0.8, jam: 1.4, ram: true, bid: 1.2, risk: 0.85, roads: 0 },
};

interface Ndl {
  k: number;
  start: boolean;
  label: string | null;
  ring: boolean;
  owner: string | null; // 'A' | 'B' | 'C' | 'K' | '?' | null
  dark: boolean;
  w: number; // own needles: weight from the frame
  fed: boolean;
  seen: number;
  since: number; // tick the current owner took it (estimate)
}

type JobKind = 'cap' | 'build' | 'feed' | 'stage' | 'retreat' | 'cache' | 'jam' | 'ram' | 'guard' | 'home' | 'duck';

interface Job {
  kind: JobKind;
  k: number; // destination cell
  n: number; // jam / stage: the needle cell
  tid: string; // ram target
  own: string | null; // owner of the target at assignment
  lit: boolean; // the result joins our thread
  t0: number;
  until: number;
  arrive: number;
  work: number;
  sent: number;
  tries: number;
  phase: number;
  pin: number; // 0 normal, 1 dawn/guard, 2 contract, 3 defense
}

interface UInfo {
  u: MineUnit;
  id: string;
  k: number;
  tk: boolean;
  busy: boolean;
  acting: boolean;
  canCmd: boolean;
  jamming: boolean;
}

interface Cand {
  k: number;
  kind: 'cap' | 'build' | 'feed';
  work: number;
  g: number; // minutes per tick once done
  bonus: number; // one-off minutes
  lit: boolean;
  own: string | null;
}

interface Meta {
  unit: string;
  kind: string;
  job: Job | null;
  lot: number;
  cls: string;
}

interface FoeMem {
  id: string;
  p: string;
  cls: string;
  k: number;
  t: number;
  still: number;
}

interface CTask {
  k: number;
  kind: 'cap' | 'build';
  work: number;
}

interface Slot4 {
  ui: UInfo;
  D: Float64Array;
  free: number;
  pos: number;
  list: number[];
  cur: number;
  off: boolean;
}

/* pass, build, step, value, reach, block - Appendix A.2, used only when the manifest lacks a passport */
const DEF_TERRAIN: readonly (readonly number[])[] = [
  [1, 1, 1, 2, 0, 0],
  [1, 1, 1, 3, 0, 0],
  [1, 1, 1, 2, 0, 0],
  [1, 1, 1, 1, 0, 0],
  [1, 1, 2, 1, 0, 0],
  [1, 1, 2, 1, 1, 0],
  [0, 0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0, 1],
];

const hasTask = (u: MineUnit): boolean => {
  const t = u.task;
  return !!t && (t.path > 0 || !!t.site || !!t.feed || !!t.jam || !!t.ram || !!t.goal);
};

const actorIdx = (o: string | null): number => (o === 'A' ? 0 : o === 'B' ? 1 : o === 'C' ? 2 : o === 'K' ? 3 : 4);

/* ---------- the head ---------- */

class ZoriaHead implements Strategy {
  private readonly P: Params;
  private man: Manifest | null = null;
  private oracle: RulesOracle | null = null;
  private ready = false;
  private slot: SlotName = 'A';
  private me = 0;

  /* world numbers (manifest cfg) */
  private linkRange = 5;
  private heatNeedle = 8;
  private heatEnemy = 24;
  private heatDark = 16;
  private capGrace = 60;
  private costT = 90;
  private costK = 50;
  private costN = 60;
  private buildTicks = 8;
  private stepT = 2;
  private stepK = 1;
  private stepRise = 1;
  private wT = 2;
  private wK = 1;
  private squad = 8;
  private autonomy = 40;
  private chanOrder = 32;
  private chanTick = 32;
  private scanCost = 256;
  private scanRad = 3;
  private jamStart = 64;
  private jamKeep = 8;
  private rate = 0.0005;
  private regen = 1;
  private eCap = 360;
  private holdTicks = 12;
  private stormMul = 2;
  private ringPull = 1.25;
  private dawnRing = 2;
  private feedRing = 1;
  private visExact = 2;
  private visT = 3;
  private visK = 1;
  private T_END = 1200;
  private dawnAt = 1000;
  private cherta = 6;
  private rings: number[] = [1, 1, 2 / 3, 1 / 3];

  /* static valley */
  private readonly valid = new Uint8Array(NC);
  private cells: number[] = [];
  private readonly lvl = new Int16Array(NC);
  private readonly val = new Float64Array(NC);
  private readonly pass = new Uint8Array(NC);
  private readonly bld = new Uint8Array(NC);
  private readonly mul = new Float64Array(NC);
  private readonly hill = new Uint8Array(NC);
  private readonly mount = new Uint8Array(NC);
  private readonly dead = new Uint8Array(NC);
  private readonly cit = new Int16Array(NC);
  private readonly nb = new Int32Array(NC * 6).fill(-1);
  private seatK: number[] = [];
  private hearth = -1;
  private lots: LotSpec[] = [];
  private cacheCells: number[] = [];
  private readonly heap = new Heap();

  /* memory */
  private t = 0;
  private obs: Observe | null = null;
  private energy = 0;
  private readonly nd = new Map<number, Ndl>();
  private readonly jobs = new Map<string, Job>();
  private readonly claim = new Map<number, string>();
  private readonly lastCmd = new Map<string, { key: string; t: number }>();
  private readonly cool = new Map<number, number>();
  private readonly foeMem = new Map<string, FoeMem>();
  private foeNow: FoeMem[] = [];
  private readonly seenAt = new Int32Array(NC).fill(-1000);
  private readonly linkCache = new Map<number, boolean>();
  private readonly hearthOf = new Map<string, number>();
  private readonly findTaken = new Set<number>();
  private readonly jamSet = new Set<number>();
  private readonly lootDead = new Map<number, number>();
  private readonly down = new Map<number, number>();
  private downT = -100;
  private jamSince = -1;
  private lootT = 0;
  private lastStolen = 0;
  private dawned = false;
  private seatDone = false;
  private cacheRush = false;
  private pend: { cls: ClsName; t: number }[] = [];
  private yardT = -10;
  private threatT = -1000;
  private hunted = -1000; // last tick a rival rammed or stalked our units
  /* where our Tkachs were rammed and when (P.roads) */
  private readonly deaths: { k: number; t: number }[] = [];
  private wantKlinok = false;
  private lastOk = 0;
  private fails = 0;
  private bidFail = new Set<number>();
  private bidOk = new Set<number>();

  /* contract */
  private cDoneFrom = -1;
  private cLastFrom = -1;
  private cTo = 0;
  private cDeny = -1;
  private cGuard: number[] = [];

  /* per-tick derived */
  private readonly pull: Float64Array[] = [
    new Float64Array(NC),
    new Float64Array(NC),
    new Float64Array(NC),
    new Float64Array(NC),
    new Float64Array(NC),
  ];
  private readonly tot = new Float64Array(NC);
  private readonly plan = new Float64Array(NC);
  private readonly linkNow = new Uint8Array(NC);
  private readonly linkP = new Uint8Array(NC);
  private readonly zoneD = new Int16Array(NC);
  private linkSig = '';
  private links: number[] = [];
  private litN = 0;
  private units: UInfo[] = [];
  private readonly dcache = new Map<string, Float64Array>();
  private cands: Cand[] | null = null;
  private readonly taken = new Set<number>();
  private ruinsFar: number[] = [];
  private outerRing: number[] = [];
  private haltQ: UInfo[] = [];

  /* channel budget of the tick */
  private chan = 0;
  private chanAt = 0;
  private spent = 0;
  private acting = 0;
  private extra = 0;
  private cap = 4;

  /* frame out */
  private orders: Order[] = [];
  private meta: Meta[] = [];

  /* belief diary */
  private bN = 0;
  private readonly bOwn = new Map<number, string | null>();
  private readonly bDark = new Map<number, boolean>();

  constructor(p: Params) {
    this.P = p;
  }

  /* ================= wire ================= */

  init(manifestBytes: Uint8Array, slot: SlotName): void {
    this.slot = slot;
    this.me = Math.max(0, SL.indexOf(slot));
    this.ready = false;
    try {
      const m = decodeManifest(manifestBytes);
      if (m) {
        this.man = m;
        this.setup(m);
        this.ready = true;
      }
    } catch (e) {
      fault('economy.init', e);
      this.ready = false;
    }
    try {
      this.oracle = new RulesOracle(createEngine, manifestBytes);
    } catch (e) {
      fault('economy.init', e);
      this.oracle = null;
    }
  }

  tick(observeBytes: Uint8Array): Uint8Array {
    let out: Order[] = [];
    try {
      const obs = decodeObserve(observeBytes);
      if (obs && this.ready) {
        out = this.think(obs);
        this.fails = 0;
      } else {
        this.orders = [];
        this.meta = [];
      }
    } catch (e) {
      fault('economy.tick', e);
      this.fails++;
      /* a frame that keeps failing hands the slot to the nakaz instead of holding it idle */
      out = this.fails <= 3 ? this.rescue() : [];
      if (!out.length) this.meta = [];
    }
    try {
      return encodeOrders(out);
    } catch (e) {
      fault('economy.tick', e);
      this.meta = [];
      return encodeOrders([]);
    }
  }

  feedback(verdictBytes: Uint8Array): void {
    try {
      const vs = decodeVerdicts(verdictBytes);
      if (!vs) return;
      for (const v of vs) {
        const i = v[0];
        const ok = v[1];
        const code = v[2];
        const m = this.meta[i];
        if (!m) continue;
        if (ok) {
          this.lastOk = this.t;
          if (m.kind === 'bid') this.bidOk.add(m.lot);
          continue;
        }
        if (m.kind === 'yard') {
          for (let x = this.pend.length - 1; x >= 0; x--) {
            if (this.pend[x]!.cls === m.cls) {
              this.pend.splice(x, 1);
              break;
            }
          }
          continue;
        }
        if (m.kind === 'bid') {
          this.bidFail.add(m.lot);
          continue;
        }
        const j = m.job;
        if (!j) continue;
        if (code === 2 || code === 4 || code === 6) {
          j.sent = -1; /* cap, mid-step, channel: retry later */
        } else if (code === 3) {
          if (this.jobs.get(m.unit) === j) this.jobs.delete(m.unit);
        } else {
          const tgt = j.kind === 'jam' || j.kind === 'stage' ? j.n : j.k;
          this.cool.set(tgt, this.t + (code === 11 ? 400 : 80));
          if (this.jobs.get(m.unit) === j) this.jobs.delete(m.unit);
        }
      }
    } catch (e) {
      fault('economy.feedback', e);
      /* verdicts are advisory */
    }
  }

  /* the next diary frame is a full one: the previous line was not written (wire.ts) */
  resetBelief(): void {
    this.bN = 0;
  }

  belief(obs: Observe | null): BeliefFrame | null {
    try {
      if (!obs) return null;
      const p = obs.pulse;
      const f: BeliefFrame = {
        t: obs.t,
        pulse: { energy: p.energy, chan: p.chan, ear: p.ear, minutes: p.minutes, needles: p.needles },
      };
      const full = this.bN % 50 === 0;
      this.bN++;
      if (full) f.full = true;
      const own: Record<string, string | null> = {};
      const dark: Record<string, boolean> = {};
      let no = 0;
      let nd = 0;
      for (const n of this.nd.values()) {
        const key = qOf(n.k) + ',' + rOf(n.k);
        if (full || this.bOwn.get(n.k) !== n.owner) {
          own[key] = n.owner;
          this.bOwn.set(n.k, n.owner);
          no++;
        }
        if (full || this.bDark.get(n.k) !== n.dark) {
          dark[key] = n.dark;
          this.bDark.set(n.k, n.dark);
          nd++;
        }
      }
      if (no) f.own = own;
      if (nd) f.dark = dark;
      f.foe = obs.foe.map((x): [string, string, number, number] => [x.id, x.p, x.q, x.r]);
      f.noisy = obs.noisy.length;
      f.units = obs.mine.units.map((u): [string, number, number, number] => [u.id, u.q, u.r, u.task ? u.task.path : 0]);
      f.pact = null;
      f.cries = obs.pub.cries.map((c): [string, number] => [c[0], c[1]]);
      return f;
    } catch (e) {
      fault('economy.belief', e);
      return null;
    }
  }

  /* ================= setup ================= */

  private setup(m: Manifest): void {
    const cfg: Record<string, number> = m.cfg ?? {};
    const num = (key: string, def: number): number => {
      const v = cfg[key];
      return typeof v === 'number' && Number.isFinite(v) ? v : def;
    };
    this.linkRange = num('linkRange', 5);
    this.heatNeedle = num('heatNeedle', 8);
    this.heatEnemy = num('heatEnemy', 24);
    this.heatDark = num('heatDark', 16);
    this.capGrace = num('capGrace', 60);
    this.costT = num('costTkach', 90);
    this.costK = num('costKlinok', 50);
    this.costN = num('costNeedle', 60);
    this.buildTicks = num('buildTicks', 8);
    this.stepT = Math.max(0.5, num('stepTkach', 2));
    this.stepK = Math.max(0.5, num('stepKlinok', 1));
    this.stepRise = num('stepRise', 1);
    this.wT = num('weightTkach', 2);
    this.wK = num('weightKlinok', 1);
    this.squad = num('squadWeight', 8);
    this.autonomy = num('autonomy', 40);
    this.chanOrder = Math.max(1, num('chanOrder', 32));
    this.chanTick = num('chanTick', 32);
    this.scanCost = num('scanCost', 256);
    this.scanRad = Math.max(0, Math.min(3, Math.floor(num('scanRad', 3))));
    this.jamStart = num('jamStart', 64);
    this.jamKeep = num('jamKeep', 8);
    this.rate = num('minuteRate', 0.0005);
    this.regen = num('energyRegen', 1);
    this.eCap = num('energyCap', 360);
    this.holdTicks = num('orderHoldTicks', 12);
    this.stormMul = num('stormCost', 2);
    this.ringPull = num('ringPull', 1.25);
    this.dawnRing = num('dawnRing', 2);
    this.feedRing = Math.max(0, Math.min(3, Math.floor(num('feedRing', 1))));
    this.visExact = num('visExact', 2);
    this.visT = num('visTkach', 3);
    this.visK = num('visKlinok', 1);
    this.T_END = typeof m.ticks === 'number' && m.ticks > 0 ? m.ticks : 1200;
    this.dawnAt = m.dawn && Number.isFinite(m.dawn.at) ? m.dawn.at : this.T_END - num('dawnTicks', 200);
    if (m.dawn && Number.isFinite(m.dawn.ring) && m.dawn.ring > 0) this.dawnRing = m.dawn.ring;
    this.cherta = Number.isFinite(m.cherta) ? m.cherta : 6;
    if (Array.isArray(m.rings) && m.rings.length >= 2 && m.rings.length <= 5 && m.rings.every((x) => Number.isFinite(x))) {
      this.rings = m.rings.slice();
    }

    /* cells */
    const R = Math.min(OFF - 1, Math.max(5, (m.terrain && m.terrain.radius ? m.terrain.radius : 20) - 1));
    for (let q = -R; q <= R; q++) {
      for (let r = -R; r <= R; r++) {
        if (hexDist(q, r, 0, 0) <= R) {
          const k = kOf(q, r);
          this.valid[k] = 1;
          this.cells.push(k);
        }
      }
    }
    for (const k of this.cells) {
      const q = qOf(k);
      const r = rOf(k);
      for (let i = 0; i < 6; i++) {
        const nq = q + DQ[i]!;
        const nr = r + DR[i]!;
        if (!inBox(nq, nr)) continue;
        const c = kOf(nq, nr);
        if (this.valid[c]) this.nb[k * 6 + i] = c;
      }
    }

    /* terrain passports */
    const types = m.terrain && Array.isArray(m.terrain.types) ? m.terrain.types : [];
    const nTypes = Math.max(8, types.length);
    const tPass: boolean[] = [];
    const tBuild: boolean[] = [];
    const tCost: number[] = [];
    const tVal: number[] = [];
    const tReach: boolean[] = [];
    const tBlock: boolean[] = [];
    let valsOk = types.length >= 8;
    for (let i = 0; i < types.length; i++) {
      const v = types[i]!.min;
      if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10)) valsOk = false;
    }
    for (let i = 0; i < nTypes; i++) {
      const d = DEF_TERRAIN[i] ?? DEF_TERRAIN[0]!;
      const ty = types[i];
      tPass.push(ty ? !!ty.pass : d[0] === 1);
      tBuild.push(ty ? !!ty.build : d[1] === 1);
      tCost.push(ty && typeof ty.cost === 'number' && ty.cost > 0 ? ty.cost : d[2]!);
      tVal.push(valsOk && ty ? ty.min : d[3]!);
      tReach.push(ty ? !!ty.reach : d[4] === 1);
      tBlock.push(ty ? !!ty.block : d[5] === 1);
    }
    const terr = new Int8Array(NC);
    const tc = m.terrain && Array.isArray(m.terrain.cells) ? m.terrain.cells : [];
    let a = 0;
    let b = 0;
    for (const c of tc) {
      if (Number.isInteger(c[2]) && c[2] >= 0 && c[2] < nTypes) a++;
      if (Number.isInteger(c[0]) && c[0] >= 0 && c[0] < nTypes) b++;
    }
    const qrt = a >= b;
    for (const c of tc) {
      const q = qrt ? c[0] : c[1];
      const r = qrt ? c[1] : c[2];
      const ty = qrt ? c[2] : c[0];
      if (!inBox(q, r) || ty < 0 || ty >= nTypes) continue;
      const k = kOf(q, r);
      if (this.valid[k]) terr[k] = ty;
    }
    for (const k of this.cells) {
      const ty = terr[k]!;
      this.pass[k] = tPass[ty] ? 1 : 0;
      this.bld[k] = tBuild[ty] && tPass[ty] ? 1 : 0;
      this.mul[k] = tCost[ty] ?? 1;
      this.val[k] = tVal[ty] ?? 0;
      this.hill[k] = tReach[ty] ? 1 : 0;
      this.mount[k] = tBlock[ty] ? 1 : 0;
    }

    /* levels in (r, q) order */
    const ord = this.cells.slice().sort((x, y) => rOf(x) - rOf(y) || qOf(x) - qOf(y));
    if (Array.isArray(m.levels) && m.levels.length === ord.length) {
      for (let i = 0; i < ord.length; i++) this.lvl[ord[i]!] = (m.levels[i] ?? 0) | 0;
    }

    const cq = m.citadel ? m.citadel.q : 0;
    const cr = m.citadel ? m.citadel.r : 0;
    for (const k of this.cells) this.cit[k] = hexDist(qOf(k), rOf(k), cq, cr);
    this.seatK = (m.seats ?? []).map((h) => kOf(h.q, h.r));
    this.lots = Array.isArray(m.lots) ? m.lots : [];

    for (const f of m.finds ?? []) {
      if (!inBox(f.q, f.r)) continue;
      const k = kOf(f.q, f.r);
      if (!this.valid[k]) continue;
      if (f.kind === 'dead') this.dead[k] = 1;
      if (f.kind === 'cache') this.cacheCells.push(k);
    }

    for (const s of m.needles ?? []) {
      if (!inBox(s.q, s.r)) continue;
      const k = kOf(s.q, s.r);
      if (!this.valid[k]) continue;
      const ring = !!s.ring || !!s.spoke;
      this.nd.set(k, {
        k,
        start: !!s.start,
        label: s.start ?? null,
        ring,
        owner: ring ? 'K' : s.start ? '?' : null,
        dark: false,
        w: 0,
        fed: false,
        seen: 0,
        since: -1000,
      });
    }
  }

  /* ================= static helpers ================= */

  private linkOk(a: number, b: number): boolean {
    if (a === b) return true;
    const d = kDist(a, b);
    const range = this.linkRange + (this.hill[a] || this.hill[b] ? 1 : 0);
    if (d > range) return false;
    const key = a < b ? a * NC + b : b * NC + a;
    const c = this.linkCache.get(key);
    if (c !== undefined) return c;
    let ok: boolean;
    if (this.oracle) {
      try {
        ok = this.oracle.linkOk({ q: qOf(a), r: rOf(a) }, { q: qOf(b), r: rOf(b) });
      } catch (e) {
        fault('economy.linkOk', e);
        ok = this.lineClear(a, b);
      }
    } else {
      ok = this.lineClear(a, b);
    }
    this.linkCache.set(key, ok);
    return ok;
  }

  private lineClear(a: number, b: number): boolean {
    const aq = qOf(a);
    const ar = rOf(a);
    const bq = qOf(b);
    const br = rOf(b);
    const n = hexDist(aq, ar, bq, br);
    for (let i = 1; i < n; i++) {
      const s = i / n;
      const fq = aq + (bq - aq) * s + 1e-6;
      const fr = ar + (br - ar) * s + 1e-6;
      const fs = -fq - fr;
      let q = Math.round(fq);
      let r = Math.round(fr);
      const rs = Math.round(fs);
      const dq = Math.abs(q - fq);
      const dr = Math.abs(r - fr);
      const ds = Math.abs(rs - fs);
      if (dq > dr && dq > ds) q = -r - rs;
      else if (dr > ds) r = -q - rs;
      if (inBox(q, r) && this.mount[kOf(q, r)]) return false;
    }
    return true;
  }

  private storm(k: number): boolean {
    if (k < 0) return false;
    const q = qOf(k);
    const r = rOf(k);
    if (this.oracle) {
      try {
        return this.oracle.storm({ q, r }, this.t);
      } catch (e) {
        fault('economy.storm', e);
        /* fall through to the spot model */
      }
    }
    const m = this.man;
    if (!m || !m.storms || !m.storms.length) return false;
    try {
      return stormAt(m.storms, q, r, this.t);
    } catch (e) {
      fault('economy.storm', e);
      return false;
    }
  }

  private dijkstra(src: number, step: number): Float64Array {
    const D = new Float64Array(NC).fill(INF);
    if (src < 0 || !this.valid[src]) return D;
    const h = this.heap;
    h.clear();
    D[src] = 0;
    h.push(src, 0);
    while (h.size > 0) {
      const k = h.pop();
      const d = h.topD;
      if (d > D[k]!) continue;
      const base = k * 6;
      const lk = this.lvl[k]!;
      for (let i = 0; i < 6; i++) {
        const c = this.nb[base + i]!;
        if (c < 0 || !this.pass[c]) continue;
        const climb = this.lvl[c]! - lk;
        if (climb >= 2) continue;
        const nd = d + step * this.mul[c]! + (climb > 0 ? climb * this.stepRise : 0);
        if (nd < D[c]!) {
          D[c] = nd;
          h.push(c, nd);
        }
      }
    }
    return D;
  }

  private dfield(ui: UInfo): Float64Array {
    let D = this.dcache.get(ui.id);
    if (!D) {
      D = this.dijkstra(ui.k, ui.tk ? this.stepT : this.stepK);
      this.dcache.set(ui.id, D);
    }
    return D;
  }

  private nearestSeat(k: number): number {
    let best = -1;
    let bd = INF;
    for (const s of this.seatK) {
      const d = kDist(s, k);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private nearSeat(k: number): boolean {
    for (const s of this.seatK) if (kDist(s, k) <= 2) return true;
    return false;
  }

  private ringM(): number {
    return this.dawned ? this.dawnRing : this.ringPull;
  }

  private regenRate(): number {
    return 0.25 * this.regen * Math.min(8, this.litN);
  }

  private isCool(k: number): boolean {
    const u = this.cool.get(k);
    return u !== undefined && u > this.t;
  }

  /* minutes worth of one energy */
  private ew(): number {
    if (this.energy >= this.eCap - 30) return 0.004;
    return this.t < 300 ? 0.06 : this.t < 700 ? 0.035 : 0.015;
  }

  private alpha(o: string | null): number {
    if (o === null || o === 'K' || o === this.slot) return 0;
    const i = SL.indexOf(o as SlotName);
    const sc = this.obs ? this.obs.pub.score : null;
    if (!sc || i < 0) return this.P.alpha;
    let other = -1;
    for (let x = 0; x < 3; x++) if (x !== i && x !== this.me) other = x;
    const theirs = sc[i] ?? 0;
    const third = other >= 0 ? (sc[other] ?? 0) : 0;
    return this.P.alpha * (theirs >= third ? 1.2 : 0.8);
  }

  /* chance a ruin we have not seen lately is still free */
  private pUnowned(n: Ndl): number {
    const age = this.t - n.seen;
    if (age <= 5) return 1;
    const dUs = kDist(n.k, this.hearth);
    let dEn = INF;
    for (const s of this.seatK) if (s !== this.hearth) dEn = Math.min(dEn, kDist(n.k, s));
    const hz = dEn < dUs - 1 ? 1 / 130 : dEn <= dUs + 2 ? 1 / 260 : 1 / 650;
    return Math.exp(-age * hz);
  }

  private siteOk(s: number): boolean {
    if (!this.valid[s] || !this.bld[s] || this.dead[s]) return false;
    if (this.nd.has(s) || this.nearSeat(s) || this.isCool(s)) return false;
    if (!this.dawned && this.cit[s]! <= this.cherta) return false;
    return true;
  }

  /* ================= pull ================= */

  private addPull(arr: Float64Array, k: number, mult: number, fed: boolean): void {
    const q0 = qOf(k);
    const r0 = rOf(k);
    const nr = this.rings.length;
    const R = fed ? nr - 1 + this.feedRing : nr - 1;
    const n = diskN(R);
    for (let i = 0; i < n; i++) {
      const o = DISK[i]!;
      const q = q0 + o.dq;
      const r = r0 + o.dr;
      if (!inBox(q, r)) continue;
      const c = kOf(q, r);
      if (!this.valid[c]) continue;
      const ri = fed ? Math.max(0, o.d - this.feedRing) : o.d;
      if (ri >= nr) continue;
      arr[c] = arr[c]! + this.rings[ri]! * mult;
    }
  }

  private needleMult(n: Ndl): number {
    if (n.owner === null) return 0;
    if (n.owner === this.slot) return n.w * (n.ring ? this.ringM() : 1);
    if (n.owner === 'K') return this.dawned || n.dark ? 0 : this.ringPull;
    return n.dark ? 0 : n.ring ? this.ringM() : 1;
  }

  private computePull(): void {
    for (const a of this.pull) a.fill(0);
    for (const n of this.nd.values()) {
      if (n.owner === null) continue;
      let who = actorIdx(n.owner);
      let mult: number;
      let fed = false;
      if (n.owner === this.slot) {
        mult = n.w * (n.ring ? this.ringM() : 1);
        fed = n.fed;
      } else if (this.jamSet.has(n.k)) {
        /* our live jam: the needle's coverage pulls for us */
        if ((this.lootDead.get(n.k) ?? -1) > this.t) continue;
        if (n.owner === 'K' && this.dawned) continue;
        who = this.me;
        mult = n.ring ? this.ringM() : 1;
      } else {
        mult = this.needleMult(n);
      }
      if (mult <= 0) continue;
      this.addPull(this.pull[who]!, n.k, mult, fed);
    }
    const tot = this.tot;
    tot.fill(0);
    for (const a of this.pull) for (const c of this.cells) tot[c] = tot[c]! + a[c]!;
  }

  /* minutes per tick we gain by one more needle of ours at k */
  private gainAdd(k: number, mult: number, noKeeper = false): number {
    const ours = this.pull[this.me]!;
    const pk = this.pull[3]!;
    const q0 = qOf(k);
    const r0 = rOf(k);
    const n = diskN(this.rings.length - 1);
    let g = 0;
    for (let i = 0; i < n; i++) {
      const o = DISK[i]!;
      const q = q0 + o.dq;
      const r = r0 + o.dr;
      if (!inBox(q, r)) continue;
      const c = kOf(q, r);
      if (!this.valid[c]) continue;
      const v = this.val[c]!;
      if (v <= 0) continue;
      const w = this.rings[o.d]! * mult;
      const p = ours[c]! + this.plan[c]!;
      const T = this.tot[c]! + this.plan[c]! - (noKeeper ? pk[c]! : 0);
      g += v * (share(p + w, T + w) - share(p, T));
    }
    return g * this.rate;
  }

  /* needle n changes hands to us (capture) or its coverage pulls for us (jam loot) */
  private gainTransfer(n: Ndl, multUs: number): { us: number; them: number } {
    const X = actorIdx(n.owner);
    const px = this.pull[X]!;
    const ours = this.pull[this.me]!;
    const multX = this.needleMult(n);
    const q0 = qOf(n.k);
    const r0 = rOf(n.k);
    const cnt = diskN(this.rings.length - 1);
    let us = 0;
    let them = 0;
    for (let i = 0; i < cnt; i++) {
      const o = DISK[i]!;
      const q = q0 + o.dq;
      const r = r0 + o.dr;
      if (!inBox(q, r)) continue;
      const c = kOf(q, r);
      if (!this.valid[c]) continue;
      const v = this.val[c]!;
      if (v <= 0) continue;
      const wx = this.rings[o.d]! * multX;
      const wu = this.rings[o.d]! * multUs;
      const p = ours[c]! + this.plan[c]!;
      const T = this.tot[c]! + this.plan[c]!;
      const x = px[c]!;
      const p2 = p + wu;
      const x2 = Math.max(0, x - wx);
      const T2 = Math.max(0, T - wx + wu);
      us += v * (share(p2, T2) - share(p, T));
      them += v * (share(x, T) - share(x2, T2));
    }
    return { us: us * this.rate, them: X === 3 ? 0 : them * this.rate };
  }

  /* extra minutes per tick while a Tkach feeds our needle n */
  private gainFeed(n: Ndl): number {
    const ours = this.pull[this.me]!;
    const m = n.w * (n.ring ? this.ringM() : 1);
    const nr = this.rings.length;
    const R = nr - 1 + this.feedRing;
    const cnt = diskN(R);
    const q0 = qOf(n.k);
    const r0 = rOf(n.k);
    let g = 0;
    for (let i = 0; i < cnt; i++) {
      const o = DISK[i]!;
      const q = q0 + o.dq;
      const r = r0 + o.dr;
      if (!inBox(q, r)) continue;
      const c = kOf(q, r);
      if (!this.valid[c]) continue;
      const v = this.val[c]!;
      if (v <= 0) continue;
      const wOld = o.d < nr ? this.rings[o.d]! * m : 0;
      const ri = Math.max(0, o.d - this.feedRing);
      const wNew = ri < nr ? this.rings[ri]! * m : 0;
      const p = ours[c]! + this.plan[c]!;
      const T = this.tot[c]! + this.plan[c]!;
      g += v * (share(p - wOld + wNew, T - wOld + wNew) - share(p, T));
    }
    return g * this.rate;
  }

  /* ================= the tick ================= */

  private think(obs: Observe): Order[] {
    this.t = obs.t;
    this.obs = obs;
    this.energy = obs.pulse.energy;
    this.orders = [];
    this.meta = [];
    this.taken.clear();
    this.dcache.clear();
    this.cands = null;
    this.haltQ = [];
    this.wantKlinok = false;

    this.ingest(obs);
    if (this.hearth < 0) return [];
    this.network();
    this.computePull();
    this.computeZone();
    this.readUnits(obs);
    this.budgetInit(obs);
    this.reconcile();
    this.planPull();
    if (this.t - this.downT >= 10) {
      this.computeDownstream();
      this.downT = this.t;
    }
    this.ruinLists();
    this.contractPlan(obs);
    this.defend();
    this.dawnPlan();
    this.leashGuard();
    this.assignKlinoks();
    this.assignTkachs();
    const early = this.units.length + this.pend.length < 2;
    if (early) this.doYard(obs);
    this.drive();
    if (!early) this.doYard(obs);
    this.doBids(obs);
    this.doScan(obs);
    this.keepAlive();
    return this.orders;
  }

  /* minimal frame after an internal error: keep the slot with one cheap command */
  private rescue(): Order[] {
    this.orders = [];
    this.meta = [];
    try {
      const obs = this.obs;
      if (!obs) return [];
      for (const u of obs.mine.units) {
        if (!hasTask(u) && !(u.task && u.task.path > 0 && u.wait > 0)) {
          this.orders.push({ kind: 'halt', unit: u.id });
          this.meta.push({ unit: u.id, kind: 'halt', job: null, lot: -1, cls: '' });
          return this.orders;
        }
      }
      if (this.hearth >= 0 && obs.pulse.chan >= this.chanOrder * 2) {
        this.orders.push({ kind: 'watch', q: qOf(this.hearth), r: rOf(this.hearth), keep: 0 });
        this.meta.push({ unit: '', kind: 'watch', job: null, lot: -1, cls: '' });
      }
    } catch (e) {
      fault('economy.rescue', e);
      this.orders = [];
      this.meta = [];
    }
    return this.orders;
  }

  /* ---------- memory ---------- */

  private ingest(obs: Observe): void {
    const t = this.t;
    const mine = new Set<number>();
    for (const mn of obs.mine.needles) {
      if (!inBox(mn.q, mn.r)) continue;
      const k = kOf(mn.q, mn.r);
      if (!this.valid[k]) continue;
      mine.add(k);
      let n = this.nd.get(k);
      if (!n) {
        n = { k, start: false, label: null, ring: false, owner: null, dark: false, w: 0, fed: false, seen: t, since: t };
        this.nd.set(k, n);
      }
      if (n.owner !== this.slot) {
        n.owner = this.slot;
        n.since = t;
      }
      n.dark = mn.dark;
      n.w = mn.dark ? 0 : mn.weight;
      n.fed = mn.fed;
      n.seen = t;
    }
    if (!this.seatDone && mine.size > 0) this.detectSeat(mine);

    for (const n of this.nd.values()) {
      if (n.owner === this.slot && !mine.has(n.k)) {
        n.owner = '?';
        n.since = t;
        n.w = 0;
        n.fed = false;
      }
    }
    for (const l of obs.mine.losts) {
      if (!inBox(l.q, l.r)) continue;
      const n = this.nd.get(kOf(l.q, l.r));
      if (!n || mine.has(n.k)) continue;
      n.owner = l.owner ?? null;
      n.dark = l.dark;
      n.since = l.t;
      n.seen = t;
    }
    for (const e of obs.own) {
      if (!inBox(e.q, e.r)) continue;
      const k = kOf(e.q, e.r);
      if (!this.valid[k] || mine.has(k)) continue;
      let n = this.nd.get(k);
      if (!n) {
        n = { k, start: false, label: null, ring: false, owner: null, dark: false, w: 0, fed: false, seen: t, since: t - 20 };
        this.nd.set(k, n);
      }
      const o = e.owner ?? null;
      if (o !== n.owner) {
        n.since = t - n.seen <= 3 ? t : Math.max(n.seen, t - 30);
        n.owner = o;
        if (n.start && o && o !== 'K') this.hearthOf.set(o, this.nearestSeat(n.k));
      }
      n.dark = e.dark;
      n.seen = t;
    }

    this.jamSet.clear();
    for (const j of obs.mine.jams) {
      if (j.until >= t && inBox(j.q, j.r)) this.jamSet.add(kOf(j.q, j.r));
    }
    const stolen = obs.mine.ledger ? obs.mine.ledger.stolen : 0;
    if (this.jamSet.size === 0) {
      this.jamSince = -1;
    } else {
      if (this.jamSince < 0) this.jamSince = t;
      if (stolen > this.lastStolen + 1e-9) this.lootT = t;
      else if (t - this.jamSince > 14 && t - this.lootT > 14) {
        for (const k of this.jamSet) this.lootDead.set(k, t + 150);
      }
    }
    this.lastStolen = stolen;

    for (const ev of obs.events) {
      switch (ev.type) {
        case 'cap': {
          if (!inBox(ev.q, ev.r)) break;
          const n = this.nd.get(kOf(ev.q, ev.r));
          if (n && ev.p !== this.slot && !mine.has(n.k)) {
            n.owner = ev.p;
            n.since = t - 1;
            n.dark = false;
            n.seen = t;
          }
          break;
        }
        case 'lot': {
          const L = this.lots[ev.lot];
          if (L && ev.p) {
            for (const h of L.cells) {
              if (!inBox(h.q, h.r)) continue;
              const n = this.nd.get(kOf(h.q, h.r));
              if (n && n.owner === null) {
                n.owner = ev.p;
                n.since = -1000;
                n.seen = t;
              }
            }
          }
          break;
        }
        case 'find':
          if (inBox(ev.q, ev.r)) this.findTaken.add(kOf(ev.q, ev.r));
          break;
        case 'build':
          if (ev.p === this.slot) {
            const i = this.pend.findIndex((x) => x.cls === ev.cls);
            if (i >= 0) this.pend.splice(i, 1);
          }
          break;
        case 'orderDone':
          this.cDoneFrom = obs.pub.order ? obs.pub.order.from : this.cLastFrom;
          break;
        case 'dawn':
          this.dawned = true;
          break;
        case 'jam':
          if (ev.own === this.slot) this.threatT = t;
          break;
        case 'ram':
          if (ev.tgt === this.slot && ev.p !== 'K') this.hunted = t;
          break;
        case 'lost':
          if (ev.p === this.slot && ev.why === 'таран') {
            this.hunted = t;
            if (this.P.roads > 0 && ev.cls === TK && inBox(ev.q, ev.r)) this.deaths.push({ k: kOf(ev.q, ev.r), t });
          }
          break;
        default:
          break;
      }
    }
    if (obs.pub.dawn || t >= this.dawnAt) this.dawned = true;
    this.pend = this.pend.filter((x) => t - x.t <= 12);

    this.foeNow = [];
    for (const f of obs.foe) {
      if (f.p === this.slot || !inBox(f.q, f.r)) continue;
      const k = kOf(f.q, f.r);
      const prev = this.foeMem.get(f.id);
      const still = prev && prev.k === k && prev.t >= t - 2 ? prev.still + 1 : 0;
      const fm: FoeMem = { id: f.id, p: f.p, cls: f.cls, k, t, still };
      this.foeMem.set(f.id, fm);
      this.foeNow.push(fm);
    }
    for (const [id, fm] of this.foeMem) if (t - fm.t > 40) this.foeMem.delete(id);

    /* what our eyes covered this tick (staleness for scans) */
    const mark = (k: number, R: number): void => {
      const q0 = qOf(k);
      const r0 = rOf(k);
      const n = diskN(R);
      for (let i = 0; i < n; i++) {
        const o = DISK[i]!;
        const q = q0 + o.dq;
        const r = r0 + o.dr;
        if (inBox(q, r)) this.seenAt[kOf(q, r)] = t;
      }
    };
    if (this.hearth >= 0) mark(this.hearth, this.visExact);
    for (const k of mine) mark(k, this.visExact);
    for (const u of obs.mine.units) if (inBox(u.q, u.r)) mark(kOf(u.q, u.r), u.cls === TK ? this.visT : this.visK);
  }

  private detectSeat(mine: Set<number>): void {
    const m = this.man;
    if (!m) return;
    let label: string | null = null;
    let hk = -1;
    for (const k of mine) {
      const n = this.nd.get(k);
      if (n && n.start) {
        label = n.label;
        hk = this.nearestSeat(k);
        break;
      }
    }
    if (hk < 0) {
      const pi = m.perm ? m.perm.indexOf(this.slot) : -1;
      hk = this.seatK[pi >= 0 ? pi : this.me] ?? this.seatK[0] ?? kOf(0, 0);
    }
    this.hearth = hk;
    /* starting-needle labels -> owners of the other two seats */
    const lab = new Map<string, string>();
    if (label !== null) {
      if (label === this.slot) {
        for (const s of SL) lab.set(s, s);
      } else if (m.perm && m.perm.length === 3) {
        const si = SL.indexOf(label as SlotName);
        if (si >= 0 && m.perm[si] === this.slot) {
          for (let i = 0; i < 3; i++) lab.set(SL[i]!, m.perm[i]!);
        } else if (m.perm[this.me] === label) {
          for (let i = 0; i < 3; i++) lab.set(m.perm[i]!, SL[i]!);
        }
      }
    }
    for (const n of this.nd.values()) {
      if (!n.start || n.owner === this.slot) continue;
      const o = n.label !== null ? lab.get(n.label) : undefined;
      n.owner = o && o !== this.slot ? o : '?';
      if (o && o !== this.slot) this.hearthOf.set(o, this.nearestSeat(n.k));
    }
    this.seatDone = true;
    this.decideCacheRush();
  }

  private decideCacheRush(): void {
    if (!this.cacheCells.length || this.hearth < 0) return;
    const D = this.dijkstra(this.hearth, this.stepK);
    for (const ck of this.cacheCells) {
      const d = D[ck]!;
      if (d > 26) continue;
      let rival = INF;
      for (const s of this.seatK) if (s !== this.hearth) rival = Math.min(rival, kDist(s, ck));
      if (d <= rival + 3) this.cacheRush = true;
    }
  }

  /* ---------- network, zone, units ---------- */

  private network(): void {
    const links: number[] = [this.hearth];
    let lit = 0;
    for (const n of this.nd.values()) {
      if (n.owner !== this.slot) continue;
      if (!n.dark && n.w > 0) lit++;
      if (!n.dark && n.w >= 0.999) links.push(n.k);
    }
    this.litN = lit;
    links.sort((a, b) => a - b);
    const sig = links.join(',');
    if (sig !== this.linkSig) {
      this.linkSig = sig;
      this.links = links;
      this.fillLinkable(links, this.linkNow, true);
    }
  }

  private fillLinkable(src: number[], out: Uint8Array, clear: boolean): void {
    if (clear) out.fill(0);
    const n = diskN(this.linkRange + 1);
    for (const l of src) {
      const q0 = qOf(l);
      const r0 = rOf(l);
      for (let i = 0; i < n; i++) {
        const o = DISK[i]!;
        const q = q0 + o.dq;
        const r = r0 + o.dr;
        if (!inBox(q, r)) continue;
        const c = kOf(q, r);
        if (!this.valid[c] || out[c]) continue;
        if (this.linkOk(l, c)) out[c] = 1;
      }
    }
  }

  private computeZone(): void {
    const zd = this.zoneD;
    zd.fill(32000);
    const ours = this.pull[this.me]!;
    const qu: number[] = [];
    for (const c of this.cells) {
      if (ours[c]! > 0 || kDist(c, this.hearth) <= this.linkRange) {
        zd[c] = 0;
        qu.push(c);
      }
    }
    for (let h = 0; h < qu.length; h++) {
      const c = qu[h]!;
      const d = zd[c]! + 1;
      for (let i = 0; i < 6; i++) {
        const x = this.nb[c * 6 + i]!;
        if (x >= 0 && zd[x]! > d) {
          zd[x] = d;
          qu.push(x);
        }
      }
    }
  }

  private readUnits(obs: Observe): void {
    this.units = [];
    for (const u of obs.mine.units) {
      if (!inBox(u.q, u.r)) continue;
      const k = kOf(u.q, u.r);
      const tk = u.cls === TK;
      const busy = hasTask(u);
      const n = this.nd.get(k);
      const onHeat = tk && !!n && n.owner !== this.slot && !n.start;
      const canCmd = !(u.task !== null && u.task.path > 0 && u.wait > 0);
      const jamming = !!u.task && !!u.task.jam;
      this.units.push({ u, id: u.id, k, tk, busy, acting: busy || onHeat, canCmd, jamming });
    }
    this.units.sort((a, b) => idCmp(a.id, b.id));
  }

  private budgetInit(obs: Observe): void {
    this.chan = obs.pulse.chan;
    this.chanAt = obs.pulse.chanAt;
    this.spent = 0;
    this.acting = 0;
    this.extra = 0;
    for (const ui of this.units) {
      if (ui.acting) this.acting++;
      if (ui.jamming) this.extra += this.jamKeep;
    }
    this.cap = Math.floor(this.chanAt / this.chanOrder) + 4;
  }

  private chanSlack(): number {
    return this.chan - this.spent - this.chanTick * this.acting - this.extra;
  }

  /* ---------- jobs bookkeeping ---------- */

  private mk(kind: JobKind, k: number, o: Partial<Job> = {}): Job {
    return {
      kind,
      k,
      n: -1,
      tid: '',
      own: null,
      lit: false,
      t0: this.t,
      until: this.t + 120,
      arrive: -1,
      work: 0,
      sent: -1,
      tries: 0,
      phase: 0,
      pin: 0,
      ...o,
    };
  }

  private setJob(id: string, j: Job): void {
    const old = this.jobs.get(id);
    if (old) {
      if (this.claim.get(old.k) === id) this.claim.delete(old.k);
      if (old.n >= 0 && this.claim.get(old.n) === id) this.claim.delete(old.n);
    }
    this.jobs.set(id, j);
    this.claim.set(j.k, id);
    if (j.n >= 0) this.claim.set(j.n, id);
    this.taken.add(j.k);
    if (j.n >= 0) this.taken.add(j.n);
  }

  private claimedByOther(k: number, id: string): boolean {
    const c = this.claim.get(k);
    return c !== undefined && c !== id;
  }

  private reconcile(): void {
    const alive = new Set(this.units.map((x) => x.id));
    for (const id of [...this.jobs.keys()]) if (!alive.has(id)) this.jobs.delete(id);
    for (const ui of this.units) {
      const j = this.jobs.get(ui.id);
      if (!j) continue;
      const v = this.check(ui, j);
      if (v === 'keep') continue;
      this.jobs.delete(ui.id);
      if (v === 'fail') this.cool.set(j.kind === 'jam' || j.kind === 'stage' ? j.n : j.k, this.t + 80);
      if (ui.busy && (j.kind === 'jam' || j.kind === 'ram' || j.kind === 'guard' || v === 'fail')) this.haltQ.push(ui);
    }
  }

  private check(ui: UInfo, j: Job): 'keep' | 'done' | 'fail' {
    const t = this.t;
    if (t > j.until) return 'fail';
    const at = ui.k === j.k;
    if (at && j.arrive < 0) j.arrive = t;
    const stale = j.sent >= 0 && t - j.sent >= 2 && !ui.busy && !at;
    const resend = (): 'keep' | 'fail' => {
      j.sent = -1;
      j.tries++;
      return j.tries > 2 ? 'fail' : 'keep';
    };
    switch (j.kind) {
      case 'cap': {
        const n = this.nd.get(j.k);
        if (!n || n.start) return 'fail';
        if (n.owner === this.slot) return 'done';
        if (!this.dawned && this.cit[j.k]! <= this.cherta) return 'fail';
        if (at) return t - j.arrive > j.work + 12 ? 'fail' : 'keep';
        if (n.owner !== j.own && j.pin < 2) return 'done';
        if (stale) return resend();
        return 'keep';
      }
      case 'build': {
        const n = this.nd.get(j.k);
        if (n) return n.owner === this.slot ? 'done' : 'fail';
        if (at) {
          if (!ui.busy && j.sent >= 0 && t - j.sent >= 2) return 'fail';
          return t - j.arrive > this.buildTicks + 30 ? 'fail' : 'keep';
        }
        if (stale) return resend();
        return 'keep';
      }
      case 'feed': {
        const n = this.nd.get(j.k);
        if (!n || n.owner !== this.slot || n.dark) return 'done';
        const feeding = !!ui.u.task && !!ui.u.task.feed;
        if (at && !feeding && j.sent >= 0 && t - j.sent >= 2) return 'fail';
        if (stale) return resend();
        return 'keep';
      }
      case 'duck':
        if (t >= j.until - 1) return 'done';
        if (stale) return resend();
        return 'keep';
      case 'stage':
      case 'retreat':
      case 'cache':
      case 'guard':
      case 'home': {
        if (j.kind === 'retreat' && this.zoneD[ui.k] === 0) return 'done';
        if (j.kind === 'cache' && this.findTaken.has(j.k)) return 'done';
        if (at && j.kind !== 'stage') return 'done';
        if (stale) return resend();
        return 'keep';
      }
      case 'jam': {
        const n = this.nd.get(j.n);
        if (!n || !this.jamOk(n)) return 'done';
        if ((this.lootDead.get(j.n) ?? -1) > t && j.pin < 2) return 'done';
        if (this.zoneD[ui.k]! > 0 && ui.u.away >= this.autonomy - 2) return 'fail';
        if (j.phase === 0) {
          if (at) {
            j.phase = 1;
            j.sent = -1;
            return 'keep';
          }
          if (stale) return resend();
          return 'keep';
        }
        if (!at && !ui.jamming) {
          j.phase = 0;
          j.sent = -1;
          return 'keep';
        }
        if (j.sent >= 0 && t - j.sent >= 2 && !ui.jamming) return resend();
        return 'keep';
      }
      case 'ram': {
        if (!ui.busy && j.sent >= 0 && t - j.sent >= 1) return 'done';
        if (t - j.t0 > 30) return 'done';
        return 'keep';
      }
      default:
        return 'keep';
    }
  }

  /* planned needles: their pull and the thread they will extend */
  private planPull(): void {
    this.plan.fill(0);
    this.linkP.set(this.linkNow);
    this.claim.clear();
    const planned: number[] = [];
    for (const [id, j] of this.jobs) {
      this.claim.set(j.k, id);
      if (j.n >= 0) this.claim.set(j.n, id);
      if ((j.kind === 'cap' || j.kind === 'build') && this.linkNow[j.k]) {
        planned.push(j.k);
        const n = this.nd.get(j.k);
        this.addPull(this.plan, j.k, n && n.ring ? this.ringM() : 1, false);
      }
    }
    if (planned.length) this.fillLinkable(planned, this.linkP, false);
  }

  private ruinLists(): void {
    this.ruinsFar = [];
    this.outerRing = [];
    for (const n of this.nd.values()) {
      if (n.owner === null && !n.ring && !this.linkP[n.k] && this.pUnowned(n) >= 0.3) this.ruinsFar.push(n.k);
      if (n.ring && this.cit[n.k]! >= this.cherta) this.outerRing.push(n.k);
    }
  }

  /* enemy networks: how many known needles hang on each needle */
  private computeDownstream(): void {
    this.down.clear();
    for (const X of SL) {
      if (X === this.slot) continue;
      const hk = this.hearthOf.get(X);
      if (hk === undefined || hk < 0) continue;
      const nodes: number[] = [hk];
      for (const n of this.nd.values()) {
        if (n.owner === X && !n.dark && this.t - n.seen < 300) nodes.push(n.k);
      }
      const m = nodes.length;
      if (m < 3 || m > 60) continue;
      const adj: number[][] = [];
      for (let i = 0; i < m; i++) adj.push([]);
      for (let i = 0; i < m; i++) {
        for (let j = i + 1; j < m; j++) {
          if (this.linkOk(nodes[i]!, nodes[j]!)) {
            adj[i]!.push(j);
            adj[j]!.push(i);
          }
        }
      }
      const reach = (skip: number): number => {
        const seen = new Uint8Array(m);
        seen[0] = 1;
        const st = [0];
        let c = 1;
        while (st.length) {
          const x = st.pop()!;
          for (const y of adj[x]!) {
            if (y === skip || seen[y]) continue;
            seen[y] = 1;
            c++;
            st.push(y);
          }
        }
        return c;
      };
      const base = reach(-1);
      for (let i = 1; i < m; i++) {
        const n = this.nd.get(nodes[i]!);
        if (!n || n.start) continue;
        const cut = base - reach(i) - 1;
        if (cut > 0) this.down.set(nodes[i]!, cut);
      }
    }
  }

  /* ---------- contract "Hold the Line" ---------- */

  private unpin(level: number): void {
    for (const j of this.jobs.values()) if (j.pin === level && (j.kind === 'cap' || j.kind === 'build')) j.pin = 0;
  }

  private contractPlan(obs: Observe): void {
    this.cDeny = -1;
    this.cGuard = [];
    const ob = obs.pub.order;
    if (ob) this.cLastFrom = ob.from;
    if (!ob || this.t > ob.to || ob.from === this.cDoneFrom) {
      this.unpin(2);
      return;
    }
    this.cTo = ob.to;
    const cells: number[] = [];
    for (const h of ob.cells) {
      if (!inBox(h.q, h.r)) continue;
      const k = kOf(h.q, h.r);
      if (this.valid[k]) cells.push(k);
    }
    if (cells.length !== 3) return;
    const left = ob.to - this.t;
    const own = cells.map((k) => {
      const n = this.nd.get(k);
      return n ? n.owner : null;
    });
    const isLit = cells.map((k) => {
      const n = this.nd.get(k);
      return !!n && n.owner === this.slot && !n.dark && n.w >= 0.999;
    });
    const mineN = own.filter((o) => o === this.slot).length;
    if (mineN >= 2) this.cGuard = cells.filter((_, i) => own[i] === this.slot);
    if (isLit[0] && isLit[1] && isLit[2]) {
      this.unpin(2);
      return;
    }
    const tks = this.units.filter((x) => x.tk);
    if (!tks.length) {
      this.contractDeny(cells, own, left);
      return;
    }

    const inNet = cells.map((k, i) => !!isLit[i] || this.linkNow[k] === 1);
    const close = (): void => {
      let ch = true;
      while (ch) {
        ch = false;
        for (let i = 0; i < 3; i++) {
          if (inNet[i]) continue;
          for (let j = 0; j < 3; j++) {
            if (inNet[j] && this.linkOk(cells[j]!, cells[i]!)) {
              inNet[i] = true;
              ch = true;
              break;
            }
          }
        }
      }
    };
    close();

    const tasks: CTask[] = [];
    let extra = 0;
    for (let i = 0; i < 3; i++) {
      const k = cells[i]!;
      const n = this.nd.get(k);
      if (!n || n.start) {
        this.contractDeny(cells, own, left);
        return;
      }
      if (n.owner === this.slot) {
        if (!isLit[i] && inNet[i]) extra = Math.max(extra, 16);
        continue;
      }
      let work: number;
      if (n.owner === null) work = this.heatNeedle;
      else if (n.owner === 'K') work = this.dawned ? this.heatNeedle : this.heatEnemy;
      else work = (n.dark ? this.heatDark : this.heatEnemy) + Math.max(0, n.since + this.capGrace - this.t);
      tasks.push({ k, kind: 'cap', work });
    }
    for (let i = 0; i < 3; i++) {
      if (inNet[i]) continue;
      const net = cells.filter((_, j) => inNet[j]);
      const s = this.bridgeSite(cells[i]!, net, tks);
      if (s < 0) {
        this.contractDeny(cells, own, left);
        return;
      }
      tasks.push({ k: s, kind: 'build', work: this.buildTicks });
      inNet[i] = true;
      close();
    }

    /* greedy assignment, current contract jobs kept */
    const slots: Slot4[] = tks.map((ui) => {
      const j = this.jobs.get(ui.id);
      return {
        ui,
        D: this.dfield(ui),
        free: ui.canCmd ? 0 : Math.max(1, ui.u.wait),
        pos: -1,
        list: [],
        cur: j && j.pin >= 2 && (j.kind === 'cap' || j.kind === 'build') ? j.k : -1,
        off: !!j && (j.kind === 'retreat' || (j.pin >= 2 && j.kind !== 'cap' && j.kind !== 'build')),
      };
    });
    const done = new Set<number>();
    for (const sl of slots) {
      if (sl.cur < 0) continue;
      const ti = tasks.findIndex((x, i) => x.k === sl.cur && !done.has(i));
      if (ti < 0) continue;
      done.add(ti);
      const task = tasks[ti]!;
      const tr = sl.D[task.k]!;
      sl.free += (tr >= INF ? 0 : tr) + task.work;
      sl.pos = task.k;
      sl.list.push(ti);
    }
    /* a task deep outside our comms zone would freeze the Tkach on the leash */
    for (const task of tasks) {
      const outT = this.zoneD[task.k]! * this.stepT * 1.5 + task.work;
      if (outT > this.autonomy - 6) {
        this.contractDeny(cells, own, left);
        return;
      }
    }
    const order = tasks.map((_, i) => i).sort((a, b) => tasks[b]!.work - tasks[a]!.work || a - b);
    for (const ti of order) {
      if (done.has(ti)) continue;
      const task = tasks[ti]!;
      let bs: Slot4 | null = null;
      let bf = INF;
      for (const sl of slots) {
        if (sl.off) continue;
        const travel = sl.pos < 0 ? sl.D[task.k]! : kDist(sl.pos, task.k) * this.stepT * 1.4;
        if (travel >= INF) continue;
        const f = sl.free + travel + task.work;
        if (f < bf) {
          bf = f;
          bs = sl;
        }
      }
      if (!bs) {
        this.contractDeny(cells, own, left);
        return;
      }
      done.add(ti);
      bs.free = bf;
      bs.pos = task.k;
      bs.list.push(ti);
    }
    let finish = 0;
    for (const sl of slots) finish = Math.max(finish, sl.free);
    finish += extra;
    const bridges = tasks.filter((x) => x.kind === 'build').length;
    const eOk = this.energy + this.regenRate() * finish >= bridges * this.costN;
    if (!eOk || finish + this.holdTicks + 2 > left) {
      this.contractDeny(cells, own, left);
      return;
    }

    /* commit: each Tkach takes its first task */
    for (const sl of slots) {
      const ti = sl.list[0];
      if (ti === undefined) continue;
      const task = tasks[ti]!;
      const j = this.jobs.get(sl.ui.id);
      if (j && j.k === task.k && j.kind === task.kind) {
        j.pin = Math.max(j.pin, 2);
        j.until = Math.max(j.until, this.t + left + 5);
        continue;
      }
      if (j && j.pin >= 3) continue;
      const n = this.nd.get(task.k);
      this.setJob(
        sl.ui.id,
        this.mk(task.kind, task.k, {
          work: task.work,
          pin: 2,
          until: this.t + left + 5,
          own: n ? n.owner : null,
          lit: true,
        }),
      );
    }
  }

  private bridgeSite(x: number, net: number[], tks: UInfo[]): number {
    let best = -1;
    let bs = INF;
    const q0 = qOf(x);
    const r0 = rOf(x);
    const n = diskN(this.linkRange + 1);
    for (let i = 1; i < n; i++) {
      const o = DISK[i]!;
      const q = q0 + o.dq;
      const r = r0 + o.dr;
      if (!inBox(q, r)) continue;
      const s = kOf(q, r);
      if (!this.siteOk(s) || !this.linkOk(s, x)) continue;
      if (!(this.linkNow[s] === 1 || net.some((c) => this.linkOk(c, s)))) continue;
      let d = INF;
      for (const ui of tks) d = Math.min(d, this.dfield(ui)[s]!);
      if (d < bs) {
        bs = d;
        best = s;
      }
    }
    return best;
  }

  /* we cannot finish the contract: make sure no rival does either */
  private contractDeny(cells: number[], own: (string | null)[], left: number): void {
    const cnt = new Map<string, number>();
    for (const o of own) if (o && o !== this.slot && o !== 'K') cnt.set(o, (cnt.get(o) ?? 0) + 1);
    let top: string | null = null;
    let tc = 0;
    for (const [o, c] of cnt) {
      if (c > tc || (c === tc && top !== null && o < top)) {
        tc = c;
        top = o;
      }
    }
    const free = cells.filter((_, i) => own[i] === null);
    if (free.length) {
      const enemySide = free.some((k) => {
        const s = this.nearestSeat(k);
        return s !== this.hearth;
      });
      let already = false;
      for (const j of this.jobs.values()) if (j.kind === 'cap' && free.includes(j.k)) already = true;
      if (!already && (tc >= 1 || enemySide)) {
        let bu: UInfo | null = null;
        let bk = -1;
        let bd = INF;
        for (const ui of this.units) {
          if (!ui.tk || !ui.canCmd) continue;
          const j = this.jobs.get(ui.id);
          if (j && (j.pin >= 2 || (j.kind === 'cap' && j.arrive >= 0))) continue;
          const D = this.dfield(ui);
          for (const k of free) {
            const d = D[k]!;
            if (d >= INF || d > 45 || d + this.heatNeedle > left - 1) continue;
            const outT = this.zoneD[k]! * this.stepT * 1.5 * 2 + this.heatNeedle;
            if (outT > this.autonomy - 6) continue;
            if (d < bd) {
              bd = d;
              bu = ui;
              bk = k;
            }
          }
        }
        if (bu && bk >= 0) {
          this.setJob(bu.id, this.mk('cap', bk, { work: this.heatNeedle, pin: 2, until: this.t + left, own: null, lit: this.linkP[bk] === 1 }));
        }
      }
    }
    if (top && tc >= 2) {
      let best = -1;
      let bz = INF;
      for (let i = 0; i < cells.length; i++) {
        if (own[i] !== top) continue;
        const k = cells[i]!;
        const z = this.zoneD[k]!;
        if (z < bz) {
          bz = z;
          best = k;
        }
      }
      this.cDeny = best;
    }
  }

  /* ---------- defense: rams ---------- */

  private defend(): void {
    if (!this.P.ram) return;
    const threats: { f: FoeMem; sev: number }[] = [];
    const working = this.units.filter((x) => x.tk && x.acting);
    for (const f of this.foeNow) {
      /* a ram needs the target in our own exact sight, not in last tick's scan */
      if (f.p === 'K' || this.seenAt[f.k] !== this.t) continue;
      let sev = 0;
      const n = this.nd.get(f.k);
      const zd = this.zoneD[f.k]!;
      if (f.cls === TK) {
        if (n && n.owner === this.slot && !n.start) sev = 3;
        else if (n && n.owner !== f.p && !n.start && zd <= 3) sev = 2;
        else if (f.still >= 2 && zd <= 2) sev = 1.6;
        else if (zd === 0 && this.units.filter((x) => !x.tk).length >= 2) sev = 1;
      } else {
        let nearDark = false;
        let nearOwn = false;
        for (let i = 0; i < 6; i++) {
          const c = this.nb[f.k * 6 + i]!;
          const m = c >= 0 ? this.nd.get(c) : undefined;
          if (m && m.owner === this.slot && !m.start) {
            nearOwn = true;
            if (m.dark) nearDark = true;
          }
        }
        if (n && n.owner === this.slot && !n.start) {
          nearOwn = true;
          if (n.dark) nearDark = true;
        }
        const nearWork = working.some((w) => kDist(w.k, f.k) <= 3);
        const nearTk = this.units.some((w) => w.tk && kDist(w.k, f.k) <= 3);
        const nearC = this.cGuard.some((c) => kDist(c, f.k) <= 2);
        if (nearWork || nearTk) this.hunted = this.t;
        if (nearDark) sev = 2.5;
        else if (nearWork || nearC) sev = 2.3;
        else if (nearTk) sev = 2;
        else if (nearOwn && zd === 0) sev = 1.2;
      }
      if (sev > 0) threats.push({ f, sev });
    }
    if (!threats.length) return;
    this.threatT = this.t;
    threats.sort((a, b) => b.sev - a.sev || idCmp(a.f.id, b.f.id));
    for (const th of threats) {
      let chased = false;
      for (const j of this.jobs.values()) if (j.kind === 'ram' && j.tid === th.f.id) chased = true;
      if (chased) continue;
      let best: UInfo | null = null;
      let bd = INF;
      const maxD = th.sev >= 3 ? 18 : th.sev >= 2 ? 12 : 7;
      for (const ui of this.units) {
        if (ui.tk || !ui.canCmd) continue;
        const j = this.jobs.get(ui.id);
        if (j && (j.kind === 'ram' || j.pin >= 3)) continue;
        if (j && j.pin >= 2 && th.sev < 2.5) continue;
        if (j && j.kind === 'jam' && j.phase === 1 && th.sev < 2) continue;
        const d = kDist(ui.k, th.f.k);
        if (d > maxD) continue;
        /* an escort does not leave its Tkach for a far target */
        if (j && j.kind === 'guard' && j.tid !== '' && d > 5) continue;
        if (d < bd) {
          bd = d;
          best = ui;
        }
      }
      if (best) {
        this.setJob(best.id, this.mk('ram', th.f.k, { tid: th.f.id, pin: 3, until: this.t + 25 }));
      } else if (th.sev >= 2.3) {
        this.wantKlinok = true;
      }
    }
    this.duck(threats);
  }

  /* a heating Tkach that a rival Klinok reaches first steps off the needle:
     a ram on an idle Tkach is not clean and costs the rammer its own hull */
  private duck(threats: { f: FoeMem; sev: number }[]): void {
    for (const th of threats) {
      if (th.f.cls !== KL) continue;
      let guard = INF;
      for (const [id, j] of this.jobs) {
        if (j.kind !== 'ram' || j.tid !== th.f.id) continue;
        const g = this.units.find((x) => x.id === id);
        if (g) guard = kDist(g.k, th.f.k);
      }
      for (const ui of this.units) {
        if (!ui.tk || !ui.canCmd || !ui.acting) continue;
        const d = kDist(ui.k, th.f.k);
        if (d > 2 || guard < d) continue;
        const j = this.jobs.get(ui.id);
        if (j && (j.kind === 'duck' || j.kind === 'retreat')) continue;
        const n = this.nd.get(ui.k);
        const heating = !!n && n.owner !== this.slot && !n.start;
        const building = !!ui.u.task && !!ui.u.task.site;
        if (!heating && !building) continue;
        if (j && j.kind === 'cap' && j.arrive >= 0 && this.t - j.arrive >= j.work - 1) continue;
        let bc = -1;
        let bs = -INF;
        for (let i = 0; i < 6; i++) {
          const c = this.nb[ui.k * 6 + i]!;
          if (c < 0 || !this.pass[c] || this.nd.has(c)) continue;
          if (this.lvl[c]! - this.lvl[ui.k]! >= 2) continue;
          let occ = false;
          for (const x of this.units) if (x.k === c) occ = true;
          for (const f of this.foeNow) if (f.k === c) occ = true;
          if (occ) continue;
          const s = kDist(c, th.f.k) * 2 - kDist(c, this.hearth) * 0.1;
          if (s > bs) {
            bs = s;
            bc = c;
          }
        }
        if (bc < 0) continue;
        this.setJob(ui.id, this.mk('duck', bc, { pin: 3, until: this.t + 6 }));
      }
    }
  }

  /* ---------- dawn: stage next to ring needles, step on at dawn ---------- */

  private dawnPlan(): void {
    const t = this.t;
    const da = this.dawnAt;
    if (t >= da && t <= da + 3) {
      for (const ui of this.units) {
        const j = this.jobs.get(ui.id);
        if (!j || j.kind !== 'stage') continue;
        const n = this.nd.get(j.n);
        if (n && n.owner !== this.slot && !n.start) {
          const work = n.owner === 'K' || n.owner === null ? this.heatNeedle : n.dark ? this.heatDark : this.heatEnemy;
          this.setJob(ui.id, this.mk('cap', j.n, { work, pin: 1, until: t + 45, own: n.owner, lit: this.linkP[j.n] === 1 }));
        } else {
          this.jobs.delete(ui.id);
        }
      }
      return;
    }
    if (t < da - 32 || t >= da) return;
    const targets: Ndl[] = [];
    for (const n of this.nd.values()) {
      if (n.ring && n.owner !== this.slot && this.linkP[n.k] === 1 && !this.claim.has(n.k)) targets.push(n);
    }
    if (!targets.length) return;
    for (const ui of this.units) {
      if (!ui.tk || !ui.canCmd) continue;
      const j = this.jobs.get(ui.id);
      if (j && (j.pin >= 1 || j.arrive >= 0 || j.kind === 'retreat')) continue;
      if (this.zoneD[ui.k]! > 0 && ui.u.away > this.autonomy / 2) continue;
      const D = this.dfield(ui);
      let bn: Ndl | null = null;
      let bp = -1;
      let bu = 0;
      for (const n of targets) {
        if (this.claim.has(n.k)) continue;
        const p = this.stagePos(n, D);
        if (p < 0) continue;
        const d = D[p]!;
        if (t + d > da + 4) continue;
        const u = this.gainAdd(n.k, this.dawnRing, true) / (10 + d);
        if (u > bu) {
          bu = u;
          bn = n;
          bp = p;
        }
      }
      if (bn && bp >= 0) this.setJob(ui.id, this.mk('stage', bp, { n: bn.k, pin: 1, until: da + 6 }));
    }
  }

  private stagePos(n: Ndl, D: Float64Array): number {
    let best = -1;
    let bd = INF;
    for (let i = 0; i < 6; i++) {
      const c = this.nb[n.k * 6 + i]!;
      if (c < 0 || !this.pass[c] || this.nd.has(c) || this.claim.has(c)) continue;
      const d = D[c]!;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return bd < INF ? best : -1;
  }

  /* ---------- leash: a Tkach never freezes outside the zone ---------- */

  private leashGuard(): void {
    for (const ui of this.units) {
      if (!ui.tk || !ui.canCmd || this.zoneD[ui.k] === 0) continue;
      if (ui.u.away < this.autonomy - 12) continue;
      const j = this.jobs.get(ui.id);
      if (j && j.kind === 'retreat') continue;
      if (j && j.kind === 'cap' && j.lit && j.arrive >= 0 && this.t - j.arrive >= j.work - 5) continue;
      if (j && j.kind === 'build' && j.arrive >= 0 && this.t - j.arrive >= this.buildTicks - 3) continue;
      const D = this.dfield(ui);
      let bk = -1;
      let bd = INF;
      for (const l of this.links) {
        const d = D[l]! + (l === this.hearth ? 3 : 0);
        if (d < bd) {
          bd = d;
          bk = l;
        }
      }
      if (bk >= 0) this.setJob(ui.id, this.mk('retreat', bk, { pin: 2, until: this.t + Math.min(60, bd + 20) }));
    }
  }

  /* ---------- Klinoks ---------- */

  private jamOk(n: Ndl): boolean {
    if (n.owner === null || n.owner === this.slot || n.start) return false;
    if (n.owner === 'K') return !this.dawned && n.ring;
    return true;
  }

  private jamPos(n: Ndl, D: Float64Array, id: string): number {
    let best = -1;
    let bd = INF;
    for (let i = 0; i < 6; i++) {
      const c = this.nb[n.k * 6 + i]!;
      if (c < 0 || !this.pass[c]) continue;
      if (n.owner === 'K' && this.cit[c]! <= this.cherta) continue;
      if (this.claimedByOther(c, id) || this.taken.has(c)) continue;
      const d = D[c]! + (this.zoneD[c]! > 0 ? 3 : 0);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return bd < INF ? best : -1;
  }

  private jamValue(n: Ndl): number {
    const tr = this.gainTransfer(n, n.ring ? this.ringM() : 1);
    const a = this.alpha(n.owner);
    return tr.us + a * (tr.them + (this.down.get(n.k) ?? 0) * 0.012);
  }

  private assignKlinoks(): void {
    for (const ui of this.units) {
      if (ui.tk || !ui.canCmd || this.jobs.has(ui.id)) continue;
      const nj = this.bestKlinok(ui);
      if (nj) this.setJob(ui.id, nj);
    }
  }

  private bestKlinok(ui: UInfo): Job | null {
    const D = this.dfield(ui);
    const t = this.t;
    let best: Job | null = null;
    let bu = 0;

    /* caches: early energy is worth a lot */
    if (t < 500) {
      for (const ck of this.cacheCells) {
        if (this.findTaken.has(ck) || this.claimedByOther(ck, ui.id) || this.taken.has(ck)) continue;
        const d = D[ck]!;
        if (d >= 45) continue;
        let rival = INF;
        for (const s of this.seatK) if (s !== this.hearth) rival = Math.min(rival, kDist(s, ck));
        if (t + d > rival + 30) continue;
        const v = Math.min(150, Math.max(0, this.eCap - this.energy)) * this.ew();
        const u = v / (d + 5);
        if (u > bu) {
          bu = u;
          best = this.mk('cache', ck, { until: t + d + 15 });
        }
      }
    }

    /* contract denial */
    if (this.cDeny >= 0) {
      const n = this.nd.get(this.cDeny);
      if (n && this.jamOk(n) && !this.claimedByOther(n.k, ui.id) && !this.taken.has(n.k)) {
        const p = this.jamPos(n, D, ui.id);
        if (p >= 0) {
          const u = 12 / (D[p]! + 15);
          if (u > bu) {
            bu = u;
            best = this.mk('jam', p, { n: n.k, pin: 2, until: this.cTo + 2 });
          }
        }
      }
    }

    /* escort: while rivals hunt our Tkachs, stand next to the most exposed one */
    if (t - this.hunted < 250) {
      for (const x of this.units) {
        if (!x.tk) continue;
        const xj = this.jobs.get(x.id);
        const spot = xj && (xj.kind === 'cap' || xj.kind === 'build' || xj.kind === 'feed') ? xj.k : x.k;
        let escorted = false;
        for (const [id, j] of this.jobs) {
          if (id !== ui.id && j.kind === 'guard' && j.tid === x.id) escorted = true;
        }
        if (escorted) continue;
        let bc = -1;
        let bd = INF;
        for (let i = 0; i < 6; i++) {
          const c = this.nb[spot * 6 + i]!;
          if (c < 0 || !this.pass[c] || this.nd.has(c) || this.claimedByOther(c, ui.id) || this.taken.has(c)) continue;
          const d = D[c]!;
          if (d < bd) {
            bd = d;
            bc = c;
          }
        }
        if (bc < 0 || bd > 40) continue;
        const exposure = 1 + Math.min(10, kDist(spot, this.hearth)) / 5;
        const u = (0.25 * exposure) / (1 + bd / 10);
        if (u > bu) {
          bu = u;
          best = this.mk('guard', bc, { tid: x.id, pin: 1, until: t + bd + 12 });
        }
      }
    }

    /* guard our contract needles */
    for (const ck of this.cGuard) {
      if (this.claimedByOther(ck, ui.id) || this.taken.has(ck)) continue;
      let guarded = false;
      for (const x of this.units) if (!x.tk && x.id !== ui.id && kDist(x.k, ck) <= 1) guarded = true;
      if (guarded) break;
      const d = D[ck]!;
      if (d >= 40) continue;
      const u = 0.06 / (1 + d / 20);
      if (u > bu) {
        bu = u;
        best = this.mk('guard', ck, { pin: 1, until: t + d + 30 });
      }
      break;
    }

    /* jams: loot plus the rival's loss */
    const chanOk = this.chanAt - this.chanTick * this.units.length - this.jamKeep >= this.chanOrder;
    if (this.P.jam > 0 && chanOk) {
      for (const n of this.nd.values()) {
        if (!this.jamOk(n) || this.isCool(n.k) || this.claimedByOther(n.k, ui.id) || this.taken.has(n.k)) continue;
        if (n.dark && !this.jamSet.has(n.k)) continue;
        if (n.owner !== 'K' && t - n.seen > 250) continue;
        if ((this.lootDead.get(n.k) ?? -1) > t) continue;
        const p = this.jamPos(n, D, ui.id);
        if (p < 0) continue;
        const d = D[p]!;
        if (d > 50) continue;
        const v = this.jamValue(n) * this.P.jam - 0.002;
        if (v <= 0) continue;
        const u = (v * 60) / (60 + d);
        if (u > bu) {
          bu = u;
          best = this.mk('jam', p, { n: n.k, until: t + d + 400 });
        }
      }
    }

    /* nothing to do: wait inside the zone */
    if (!best && this.zoneD[ui.k]! > 0) {
      let bk = -1;
      let bd = INF;
      for (const l of this.links) {
        if (l === this.hearth) continue;
        const d = D[l]!;
        if (d < bd) {
          bd = d;
          bk = l;
        }
      }
      if (bk >= 0) best = this.mk('home', bk, { until: t + bd + 20 });
    }
    return best;
  }

  /* ---------- Tkachs ---------- */

  private buildReserve(except: string): number {
    let n = 0;
    for (const [id, j] of this.jobs) if (id !== except && j.kind === 'build') n++;
    return n * this.costN;
  }

  /* the first three Tkachs come before any needle we pay for */
  private tkachReserve(): number {
    if (this.t > this.T_END - 200) return 0;
    let nT = 0;
    for (const ui of this.units) if (ui.tk) nT++;
    for (const p of this.pend) if (p.cls === TK) nT++;
    return nT < 3 ? this.costT : 0;
  }

  private tkCands(): Cand[] {
    if (this.cands) return this.cands;
    const out: Cand[] = [];
    const t = this.t;
    const pre = !this.dawned;
    const rem = Math.max(1, this.T_END - t);
    const ebLit = this.litN < 8 ? 0.25 * this.regen * this.ew() * Math.min(rem, 700) : 0;

    for (const n of this.nd.values()) {
      if (n.owner === this.slot || n.start || this.isCool(n.k)) continue;
      if (pre && this.cit[n.k]! <= this.cherta) continue;
      const lit = this.linkP[n.k] === 1;
      const rm = n.ring ? this.ringM() : 1;
      if (n.owner === null) {
        const pu = this.pUnowned(n);
        if (pu < 0.2) continue;
        const g = this.gainAdd(n.k, rm);
        out.push({ k: n.k, kind: 'cap', work: this.heatNeedle, g: (lit ? g : 0.2 * g) * pu, bonus: lit ? ebLit * pu : 0, lit, own: null });
      } else if (n.owner === 'K') {
        if (pre || !lit) continue;
        out.push({ k: n.k, kind: 'cap', work: n.dark ? this.heatNeedle : this.heatEnemy, g: this.gainAdd(n.k, rm, true), bonus: 0, lit, own: 'K' });
      } else {
        const grace = n.since + this.capGrace - t;
        if (grace > 30 || t - n.seen > 300) continue;
        const tr = this.gainTransfer(n, rm);
        const a = this.alpha(n.owner);
        const g = ((lit ? tr.us : 0) + a * (tr.them + (this.down.get(n.k) ?? 0) * 0.012)) * this.P.risk;
        if (g <= 0) continue;
        out.push({
          k: n.k,
          kind: 'cap',
          work: (n.dark ? this.heatDark : this.heatEnemy) + Math.max(0, grace),
          g,
          bonus: 0,
          lit,
          own: n.owner,
        });
      }
    }

    const sites: Cand[] = [];
    const dawnBridge = pre && t >= this.dawnAt - 260 && t < this.dawnAt - 15;
    for (const c of this.cells) {
      if (!this.linkP[c] || !this.siteOk(c)) continue;
      const g = this.gainAdd(c, 1);
      let bonus = ebLit - this.costN * this.ew();
      let bb = 0;
      for (const r of this.ruinsFar) {
        if (kDist(c, r) > this.linkRange + 1 || !this.linkOk(c, r)) continue;
        bb += 0.35 * this.gainAdd(r, 1) * rem;
      }
      bonus += Math.min(bb, 12);
      if (dawnBridge) {
        let db = 0;
        for (const rk of this.outerRing) {
          if (this.linkP[rk] || kDist(c, rk) > this.linkRange + 1 || !this.linkOk(c, rk)) continue;
          db += 0.5 * this.gainAdd(rk, this.dawnRing, true) * Math.max(0, this.T_END - this.dawnAt);
        }
        bonus += Math.min(db, 10);
      }
      sites.push({ k: c, kind: 'build', work: this.buildTicks, g, bonus, lit: true, own: null });
    }
    sites.sort((a, b) => b.g * rem + b.bonus - (a.g * rem + a.bonus) || a.k - b.k);
    for (let i = 0; i < sites.length && i < 40; i++) out.push(sites[i]!);

    for (const n of this.nd.values()) {
      if (n.owner !== this.slot || n.dark || n.w < 0.999 || n.fed) continue;
      const g = this.gainFeed(n);
      if (g > 0.0015) out.push({ k: n.k, kind: 'feed', work: 0, g, bonus: 0, lit: true, own: this.slot });
    }
    this.cands = out;
    return out;
  }

  private assignTkachs(): void {
    for (const ui of this.units) {
      if (!ui.tk || !ui.canCmd) continue;
      const j = this.jobs.get(ui.id);
      if (j && !(j.kind === 'feed' && j.pin === 0 && this.t - j.t0 >= 40)) continue;
      const nj = this.bestTkach(ui);
      if (!nj) {
        if (j) j.t0 = this.t;
        continue;
      }
      if (j && j.kind === nj.kind && j.k === nj.k) {
        j.t0 = this.t;
        continue;
      }
      this.setJob(ui.id, nj);
      if ((nj.kind === 'cap' || nj.kind === 'build') && nj.lit) {
        const n = this.nd.get(nj.k);
        this.addPull(this.plan, nj.k, n && n.ring ? this.ringM() : 1, false);
      }
    }
  }

  private bestTkach(ui: UInfo): Job | null {
    const cands = this.tkCands();
    const D = this.dfield(ui);
    const t = this.t;
    const E = this.energy - this.buildReserve(ui.id) - this.tkachReserve();
    const rr = this.regenRate();
    const awayNow = this.zoneD[ui.k]! > 0 ? ui.u.away : 0;
    const deadly = this.deadlyRoads(ui.k);
    let best: Cand | null = null;
    let bu = 0.00002;
    let bt = 0;
    for (const c of cands) {
      if (this.claimedByOther(c.k, ui.id) || this.taken.has(c.k)) continue;
      if (c.kind === 'build') {
        let crowd = false;
        for (const [id, j] of this.jobs) if (id !== ui.id && j.kind === 'build' && kDist(j.k, c.k) <= 2) crowd = true;
        if (crowd) continue;
      }
      const tt = c.k === ui.k ? 0 : D[c.k]!;
      if (tt >= INF) continue;
      let U: number;
      let time: number;
      if (c.kind === 'feed') {
        if (this.chanSlack() < this.chanTick) continue;
        time = tt;
        U = (c.g * 60) / (60 + tt);
      } else {
        let wait = 0;
        if (c.kind === 'build' && E < this.costN) {
          if (rr <= 0) continue;
          wait = Math.max(0, (this.costN - E) / rr - tt);
          if (wait > 25) continue;
        }
        time = tt + c.work + wait;
        const zd = this.zoneD[c.k]!;
        if (zd > 0) {
          const outT = zd * this.stepT * 1.5 * (c.lit ? 1 : 2) + c.work + wait;
          if (outT + awayNow > this.autonomy - 6) continue;
        }
        const remA = Math.max(0, this.T_END - (t + time));
        const V = c.g * remA + c.bonus * (remA / Math.max(1, this.T_END - t));
        U = V / (time + 6);
      }
      if (deadly.length) U *= this.roadRisk(ui.k, c.k, deadly);
      if (U > bu) {
        bu = U;
        best = c;
        bt = time;
      }
    }
    if (!best) return null;
    if (best.kind === 'feed') {
      const j = this.mk('feed', best.k, { until: t + 100000, lit: true });
      if (ui.k === best.k && ui.u.task && ui.u.task.feed) j.sent = t;
      return j;
    }
    return this.mk(best.kind, best.k, {
      work: best.work,
      own: best.own,
      lit: best.lit,
      until: t + Math.ceil(bt) + 45,
    });
  }

  /* the cells where our Tkachs were rammed lately, except next to the Tkach itself:
     it is there already, and every job would be "past" them */
  private deadlyRoads(from: number): number[] {
    if (this.P.roads <= 0) return [];
    while (this.deaths.length && this.t - this.deaths[0]!.t > this.P.roads) this.deaths.shift();
    return this.deaths.filter((d) => kDist(from, d.k) >= 2).map((d) => d.k);
  }

  /* the share of a job's value left after the deadly cells at it or on the way to it:
     the server walks the unit by a shortest path, so a cell is on the way when the
     detour through it is at most one step */
  private roadRisk(from: number, to: number, deadly: readonly number[]): number {
    const direct = kDist(from, to);
    let f = 1;
    for (const d of deadly) if (kDist(to, d) <= ROAD_NEAR || kDist(from, d) + kDist(d, to) <= direct + 1) f *= ROAD_RISK;
    return f;
  }

  /* ---------- commands ---------- */

  private emit(o: Order, cost: number, add: number, extra: number, unit: string, job: Job | null, pin: number, lot = -1): boolean {
    if (this.orders.length >= this.cap) return false;
    const free = o.kind === 'jam' || o.kind === 'halt' || o.kind === 'scan';
    const remain = this.chan - this.spent;
    if (o.kind === 'jam' || o.kind === 'halt') {
      if (remain < this.chanOrder) return false;
    } else if (!free && remain < cost) {
      return false;
    }
    if (o.kind !== 'scan' && o.kind !== 'halt') {
      const need = this.spent + cost + this.chanTick * Math.max(0, this.acting + add) + this.extra + extra;
      const slack = pin >= 3 ? 96 : pin >= 2 ? 64 : pin >= 1 ? 32 : 0;
      if (need > this.chan + slack) return false;
    }
    this.orders.push(o);
    this.meta.push({ unit, kind: o.kind, job, lot, cls: o.kind === 'yard' ? o.cls : '' });
    this.spent += cost;
    this.acting = Math.max(0, this.acting + add);
    this.extra = Math.max(0, this.extra + extra);
    return true;
  }

  private jobOrder(ui: UInfo, j: Job): Order | null {
    const id = ui.id;
    const q = qOf(j.k);
    const r = rOf(j.k);
    const task = ui.u.task;
    switch (j.kind) {
      case 'build':
        if (task && task.site && task.site.q === q && task.site.r === r) return null;
        return { kind: 'needle', unit: id, q, r };
      case 'feed':
        if (task && task.feed && task.feed.q === q && task.feed.r === r) return null;
        return { kind: 'feed', unit: id, q, r };
      case 'ram':
        return { kind: 'ram', unit: id, target: j.tid };
      case 'jam':
        if (j.phase === 1) {
          const nq = qOf(j.n);
          const nr = rOf(j.n);
          if (task && task.jam && task.jam.q === nq && task.jam.r === nr) return null;
          return { kind: 'jam', unit: id, target: { q: nq, r: nr }, hold: true };
        }
        break;
      default:
        break;
    }
    if (ui.k === j.k) return ui.busy && (j.kind === 'cap' || j.kind === 'stage') ? { kind: 'halt', unit: id } : null;
    return { kind: 'move', unit: id, q, r, goal: null, home: !ui.tk && this.zoneD[j.k] === 0 };
  }

  private cmdKey(o: Order): string {
    switch (o.kind) {
      case 'move':
      case 'needle':
      case 'feed':
        return o.kind + ':' + o.q + ',' + o.r;
      case 'jam':
        return 'jam:' + (o.target ? o.target.q + ',' + o.target.r : '-') + (o.hold ? 'h' : '');
      case 'ram':
        return 'ram:' + o.target;
      default:
        return o.kind;
    }
  }

  private drive(): void {
    for (const ui of this.haltQ) {
      if (!ui.busy || !ui.canCmd) continue;
      if (this.emit({ kind: 'halt', unit: ui.id }, 0, ui.acting ? -1 : 0, ui.jamming ? -this.jamKeep : 0, ui.id, null, 3)) {
        ui.busy = false;
        ui.acting = false;
      }
    }
    const list = this.units.filter((x) => this.jobs.has(x.id));
    list.sort((a, b) => (this.jobs.get(b.id)?.pin ?? 0) - (this.jobs.get(a.id)?.pin ?? 0) || idCmp(a.id, b.id));
    for (const ui of list) {
      const j = this.jobs.get(ui.id);
      if (!j || j.sent >= 0) continue;
      if (j.kind === 'jam' && j.phase === 0 && ui.k === j.k) j.phase = 1;
      const o = this.jobOrder(ui, j);
      if (!o) {
        j.sent = this.t;
        continue;
      }
      const free = o.kind === 'jam' || o.kind === 'halt';
      if (!ui.canCmd && o.kind !== 'jam') continue;
      const key = this.cmdKey(o);
      const last = this.lastCmd.get(ui.id);
      if (last && last.key === key && this.t - last.t < 4 && ui.busy) {
        j.sent = last.t;
        continue;
      }
      const cost = free ? 0 : this.chanOrder * (this.storm(ui.k) ? this.stormMul : 1);
      const add = o.kind === 'halt' ? (ui.acting ? -1 : 0) : ui.acting ? 0 : 1;
      const extra = o.kind === 'jam' ? this.jamStart : 0;
      if (this.emit(o, cost, add, extra, ui.id, j, j.pin)) {
        j.sent = this.t;
        this.lastCmd.set(ui.id, { key, t: this.t });
        if (o.kind === 'halt') {
          ui.acting = false;
          ui.busy = false;
        } else {
          ui.acting = true;
          ui.busy = true;
        }
      }
    }
  }

  /* ---------- yard ---------- */

  private bidReserve(): number {
    for (const L of this.lots) {
      if (this.t >= L.at - 4 && this.t < L.at) {
        for (const h of L.cells) {
          if (!inBox(h.q, h.r)) continue;
          const k = kOf(h.q, h.r);
          const n = this.nd.get(k);
          if ((!n || n.owner === null) && this.linkP[k]) return 130;
        }
      }
    }
    return 0;
  }

  private doYard(obs: Observe): void {
    if (this.yardT === this.t || this.hearth < 0) return;
    const E = obs.pulse.energy;
    let nT = 0;
    let nK = 0;
    for (const ui of this.units) {
      if (ui.tk) nT++;
      else nK++;
    }
    for (const p of this.pend) {
      if (p.cls === TK) nT++;
      else nK++;
    }
    const room = this.squad - (nT * this.wT + nK * this.wK);
    if (room < this.wK) return;
    const unitsN = this.units.length + this.pend.length;
    const chanRoom = this.chanAt - this.chanTick * (unitsN + 1);
    const res = this.bidReserve();
    const t = this.t;
    let wantK = t < 150 ? (this.cacheRush ? 1 : 0) : t < 320 ? 1 : 2;
    if (t - this.threatT < 100) wantK = Math.max(wantK, 1);
    const late = t > this.T_END - 110;
    const hunted = t - this.hunted < 250;
    if (hunted) wantK = Math.max(wantK, nT >= 2 ? 2 : 1);
    let cls: ClsName | null = null;
    if (this.wantKlinok && nK === 0 && E >= this.costK + (nT >= 2 || hunted ? 0 : this.costT)) cls = KL;
    else if (hunted && nT >= 1 && nK < wantK && room >= this.wK && E >= this.costK && t < this.T_END - 60) cls = KL;
    else if (t <= 3 && this.cacheRush && nK === 0 && E >= this.costK) cls = KL;
    else if (!late && nT < 3 && room >= this.wT && E - res >= this.costT && chanRoom >= -8) cls = TK;
    else if (t < this.T_END - 60 && nK < wantK && room >= this.wK && E - res - this.buildReserve('') - (nT < 3 && !late ? this.costT : 0) >= this.costK && chanRoom >= 8) cls = KL;
    if (!cls) return;
    const cost = this.chanOrder * (this.storm(this.hearth) ? this.stormMul : 1);
    const pin = nT === 0 || this.wantKlinok ? 3 : 1;
    if (this.emit({ kind: 'yard', cls }, cost, 0, 0, '', null, pin)) {
      this.pend.push({ cls, t });
      this.yardT = t;
      this.energy -= cls === TK ? this.costT : this.costK;
    }
  }

  /* ---------- lots ---------- */

  private doBids(obs: Observe): void {
    const t = this.t;
    for (let i = 0; i < this.lots.length; i++) {
      const L = this.lots[i]!;
      if (t !== L.at - 2 && t !== L.at - 1) continue;
      if (t === L.at - 1 && this.bidOk.has(i) && !this.bidFail.has(i)) continue;
      let linkN = 0;
      let other = 0;
      let gsum = 0;
      for (const h of L.cells) {
        if (!inBox(h.q, h.r)) continue;
        const k = kOf(h.q, h.r);
        const n = this.nd.get(k);
        if (n && n.owner !== null) continue;
        if (this.linkP[k]) {
          linkN++;
          gsum += this.gainAdd(k, 1);
        } else {
          other++;
        }
      }
      if (linkN === 0) continue;
      let builders = 0;
      for (const ui of this.units) if (ui.tk && ui.u.task && ui.u.task.site) builders++;
      const avail = this.energy - builders * this.costN - 3;
      let want = linkN * 105 + other * 15 + gsum * 2500;
      if (obs.pulse.energy >= this.eCap - 60) want = Math.max(want, avail);
      want *= this.P.bid;
      const amount = Math.floor(Math.min(want, avail)) - this.me;
      if (amount < 61) continue;
      const cost = this.chanOrder * (this.storm(this.hearth) ? this.stormMul : 1);
      this.bidFail.delete(i);
      this.emit({ kind: 'bid', lot: i, amount }, cost, 0, 0, '', null, 2, i);
    }
  }

  /* ---------- scan: refresh what matters most ---------- */

  private doScan(obs: Observe): void {
    const ear = obs.pulse.ear;
    if (ear < this.scanCost || this.orders.length >= this.cap) return;
    const t = this.t;
    let best = -1;
    let bs = 0;
    const consider = (k: number, imp: number): void => {
      if (k < 0 || !this.valid[k]) return;
      const st = t - this.seenAt[k]!;
      if (st < 8) return;
      const s = imp * Math.min(st, 150);
      if (s > bs) {
        bs = s;
        best = k;
      }
    };
    const ob = obs.pub.order;
    if (ob && t <= ob.to) for (const h of ob.cells) if (inBox(h.q, h.r)) consider(kOf(h.q, h.r), 6);
    for (const L of this.lots) {
      if (t >= L.at - 8 && t < L.at) for (const h of L.cells) if (inBox(h.q, h.r)) consider(kOf(h.q, h.r), 4);
    }
    const nearDawn = t >= this.dawnAt - 40 && t <= this.dawnAt + 60;
    for (const n of this.nd.values()) {
      if (n.owner === this.slot) continue;
      if (n.ring) {
        if (nearDawn) consider(n.k, 3);
        continue;
      }
      if (n.owner !== null && n.owner !== 'K' && !n.start && this.zoneD[n.k]! <= 4) consider(n.k, 2);
      else if (n.owner === null && this.zoneD[n.k]! <= 6) consider(n.k, 1.2);
    }
    for (const h of obs.noisy) {
      if (!inBox(h.q, h.r)) continue;
      const k = kOf(h.q, h.r);
      if (this.valid[k] && this.zoneD[k] === 0) consider(k, 1.5);
    }
    if (best < 0) return;
    const cost = this.scanCost * (this.storm(best) ? this.stormMul : 1);
    if (ear < cost) return;
    if (this.emit({ kind: 'scan', q: qOf(best), r: rOf(best), rad: this.scanRad }, 0, 0, 0, '', null, 0)) {
      const q0 = qOf(best);
      const r0 = rOf(best);
      const n = diskN(this.scanRad);
      for (let i = 0; i < n; i++) {
        const o = DISK[i]!;
        const q = q0 + o.dq;
        const r = r0 + o.dr;
        if (inBox(q, r)) this.seenAt[kOf(q, r)] = t;
      }
    }
  }

  /* ---------- the slot stays ours: one cheap accepted command every few ticks ---------- */

  private keepAlive(): void {
    if (this.t - this.lastOk < 4) return;
    for (const o of this.orders) if (o.kind === 'halt' || o.kind === 'scan') return;
    for (const ui of this.units) {
      if (ui.busy || ui.acting || !ui.canCmd || this.jobs.has(ui.id)) continue;
      if (this.emit({ kind: 'halt', unit: ui.id }, 0, 0, 0, ui.id, null, 3)) return;
    }
    /* a jam intent of null on a Klinok that jams nothing: free, and accepted even mid-step */
    for (const ui of this.units) {
      if (ui.tk || ui.jamming) continue;
      const j = this.jobs.get(ui.id);
      if (j && (j.kind === 'ram' || j.kind === 'jam')) continue;
      if (this.emit({ kind: 'jam', unit: ui.id, target: null, hold: false }, 0, 0, 0, ui.id, null, 3)) return;
    }
    const cost = this.chanOrder * (this.storm(this.hearth) ? this.stormMul : 1);
    this.emit({ kind: 'watch', q: qOf(this.hearth), r: rOf(this.hearth), keep: 0 }, cost, 0, 0, '', null, 3);
  }
}

/* names of this head's presets: the preset-change service handle checks them */
export function presets(): string[] {
  return Object.keys(PRESETS);
}

/* a preset name or knobs on top of рівний: "alpha=0.6+risk=0.8" (also with ";") */
export function economyParams(preset?: string): Params | null {
  if (preset === undefined || preset === '') return PRESETS['рівний']!;
  const named = PRESETS[preset];
  if (named) return named;
  const p: Params = { ...PRESETS['рівний']! };
  for (const part of preset.split(/[+;]/)) {
    const [k, v] = part.split('=');
    const n = Number(v);
    if (v === undefined || !/^\d+(\.\d+)?$/.test(v)) return null;
    if (k === 'alpha' && n <= 2) p.alpha = n;
    else if (k === 'jam' && n <= 3) p.jam = n;
    else if (k === 'bid' && n <= 3) p.bid = n;
    else if (k === 'risk' && n <= 1) p.risk = n;
    else if (k === 'ram' && (n === 0 || n === 1)) p.ram = n === 1;
    else if (k === 'roads' && Number.isInteger(n) && n <= 1200) p.roads = n;
    else return null;
  }
  return p;
}

export function createStrategy(preset?: string): Strategy {
  return new ZoriaHead(economyParams(preset) ?? PRESETS['рівний']!);
}
