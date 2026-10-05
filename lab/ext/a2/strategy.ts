/* bot :: strategy
   Head "Зоря": an economy-first network builder with an active guard.

   Score is minutes of connection, so the head grows a lit, linked, low-overlap
   network as fast as it can and keeps it lit:
   - Tkachs take linkable ruins (free, 8 ticks), then build needles with spare
     energy on the best coverage sites; contract cells, bridges to cut-off or
     unreachable needles and lot cells get a bonus; feeding fills idle time;
     before dawn they stage next to linkable ring needles and take them (x2).
   - Klinoks fetch caches, ram enemy Tkachs heating our needles (a clean ram),
     ram jammers; the raid preset also jams the enemy needle that cuts most.
   - Every command and every hand is budgeted against the channel; the slot is
     always held by a free command. Everything is deterministic. */

import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import type { BeliefFrame, WireBot } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, stormAt } from '@zoria/protocol';
import type { ClsName, FoeEntry, Hex, Manifest, MineUnit, Observe, Order, SlotName, StormSpec } from '@zoria/protocol';

export interface Strategy extends WireBot {
  /* belief diary frame for the tick; null - there is no frame */
  belief(obs: Observe | null): BeliefFrame | null;
}

/* ------------------------------------------------------------------ presets */

interface Params {
  tkach: number; /* Tkachs to keep */
  klinok: number; /* Klinoks at most */
  raid: boolean; /* idle Klinoks jam for loot and cuts */
  heatEnemy: boolean; /* Tkachs may heat enemy needles */
  jammers: number; /* raiders at once */
}

const PRESETS: Record<string, Params> = {
  zoria: { tkach: 3, klinok: 2, raid: false, heatEnemy: false, jammers: 0 },
  raid: { tkach: 3, klinok: 2, raid: true, heatEnemy: true, jammers: 1 },
  eco: { tkach: 4, klinok: 0, raid: false, heatEnemy: true, jammers: 0 },
};
const DEFAULT_PRESET = 'zoria';

/* ------------------------------------------------------------- world numbers */

interface Cfg {
  linkRange: number;
  costTkach: number;
  costKlinok: number;
  costNeedle: number;
  stepTkach: number;
  stepKlinok: number;
  stepRise: number;
  weightTkach: number;
  weightKlinok: number;
  squadWeight: number;
  buildTicks: number;
  autonomy: number;
  heatNeedle: number;
  heatEnemy: number;
  heatDark: number;
  capGrace: number;
  chanOrder: number;
  chanTick: number;
  scanCost: number;
  scanRad: number;
  stormCost: number;
  energyCap: number;
  ringPull: number;
  dawnRing: number;
  minuteRate: number;
  feedRing: number;
  orderBonus: number;
  orderHoldTicks: number;
  energyRegen: number;
  jamStart: number;
  jamKeep: number;
}

const CFG_DEFAULT: Cfg = {
  linkRange: 5,
  costTkach: 90,
  costKlinok: 50,
  costNeedle: 60,
  stepTkach: 2,
  stepKlinok: 1,
  stepRise: 1,
  weightTkach: 2,
  weightKlinok: 1,
  squadWeight: 8,
  buildTicks: 8,
  autonomy: 40,
  heatNeedle: 8,
  heatEnemy: 24,
  heatDark: 16,
  capGrace: 60,
  chanOrder: 32,
  chanTick: 32,
  scanCost: 256,
  scanRad: 3,
  stormCost: 2,
  energyCap: 360,
  ringPull: 1.25,
  dawnRing: 2,
  minuteRate: 0.0005,
  feedRing: 1,
  orderBonus: 30,
  orderHoldTicks: 12,
  energyRegen: 1,
  jamStart: 64,
  jamKeep: 8,
};

function readCfg(raw: Record<string, number> | undefined): Cfg {
  const c: Cfg = { ...CFG_DEFAULT };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(c) as (keyof Cfg)[]) {
      const v = raw[k];
      if (typeof v === 'number' && Number.isFinite(v)) c[k] = v;
    }
  }
  return c;
}

/* ------------------------------------------------------------------ geometry */

const TK: ClsName = 'ткач';
const KL: ClsName = 'клинок';
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

interface Off {
  dq: number;
  dr: number;
  d: number;
}
const OFFS: Off[] = [];
for (let dq = -6; dq <= 6; dq++) {
  for (let dr = -6; dr <= 6; dr++) {
    const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    if (d <= 6) OFFS.push({ dq, dr, d });
  }
}
OFFS.sort((a, b) => a.d - b.d || a.dq - b.dq || a.dr - b.dr);
/* OFF_N[k] = number of offsets at distance <= k */
const OFF_N: number[] = [];
for (let k = 0; k <= 6; k++) OFF_N.push(OFFS.filter((o) => o.d <= k).length);

function offCount(k: number): number {
  return OFF_N[Math.max(0, Math.min(6, k))] ?? 1;
}

function hexRound(fq: number, fr: number): [number, number] {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

/* the income share of pull m on a cell where the others pull o (8.3) */
function share(m: number, o: number): number {
  if (m <= 0) return 0;
  const s = m + o;
  return s <= 1 ? m : m / s;
}

/* terrain defaults by dictionary index: pass, build, step, value, reach, block */
const TERRAIN_DEFAULT: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [1, 1, 1, 2, 0, 0],
  [1, 1, 1, 3, 0, 0],
  [1, 1, 1, 2, 0, 0],
  [1, 1, 1, 1, 0, 0],
  [1, 1, 2, 1, 0, 0],
  [1, 1, 2, 1, 1, 0],
  [0, 0, 1, 0, 0, 0],
  [0, 0, 1, 0, 0, 1],
];

class Geo {
  readonly R: number;
  readonly W: number;
  readonly N: number;
  readonly valid: Uint8Array;
  readonly qq: Int16Array;
  readonly rr: Int16Array;
  readonly cells: number[] = [];
  readonly nb: Int32Array;
  readonly val: Float64Array;
  readonly pass: Uint8Array;
  readonly bld: Uint8Array;
  readonly mul: Float64Array;
  readonly reach: Uint8Array;
  readonly block: Uint8Array;
  readonly lvl: Int16Array;
  readonly dead: Uint8Array;

  constructor(R: number) {
    this.R = R;
    this.W = 2 * R + 1;
    this.N = this.W * this.W;
    const N = this.N;
    this.valid = new Uint8Array(N);
    this.qq = new Int16Array(N);
    this.rr = new Int16Array(N);
    this.nb = new Int32Array(N * 6).fill(-1);
    this.val = new Float64Array(N);
    this.pass = new Uint8Array(N);
    this.bld = new Uint8Array(N);
    this.mul = new Float64Array(N).fill(1);
    this.reach = new Uint8Array(N);
    this.block = new Uint8Array(N);
    this.lvl = new Int16Array(N);
    this.dead = new Uint8Array(N);
    for (let q = -R; q <= R; q++) {
      for (let r = -R; r <= R; r++) {
        if (Math.abs(q + r) > R) continue;
        const i = (q + R) * this.W + (r + R);
        this.valid[i] = 1;
        this.qq[i] = q;
        this.rr[i] = r;
        this.cells.push(i);
      }
    }
    for (const i of this.cells) {
      const q = this.qq[i]!;
      const r = this.rr[i]!;
      for (let k = 0; k < 6; k++) {
        const d = DIRS[k]!;
        this.nb[i * 6 + k] = this.idx(q + d[0], r + d[1]);
      }
    }
  }

  idx(q: number, r: number): number {
    const R = this.R;
    if (!Number.isInteger(q) || !Number.isInteger(r)) return -1;
    if (q < -R || q > R || r < -R || r > R || Math.abs(q + r) > R) return -1;
    return (q + R) * this.W + (r + R);
  }

  dist(a: number, b: number): number {
    const dq = this.qq[a]! - this.qq[b]!;
    const dr = this.rr[a]! - this.rr[b]!;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  hex(c: number): Hex {
    return { q: this.qq[c]!, r: this.rr[c]! };
  }
}

function buildGeo(m: Manifest): Geo {
  const rad = m.terrain && typeof m.terrain.radius === 'number' ? m.terrain.radius : 20;
  const g = new Geo(Math.max(2, Math.min(40, Math.round(rad) - 1)));
  const types = m.terrain && Array.isArray(m.terrain.types) ? m.terrain.types : [];
  const nT = Math.max(types.length, TERRAIN_DEFAULT.length);
  const tPass: number[] = [];
  const tBld: number[] = [];
  const tMul: number[] = [];
  const tVal: number[] = [];
  const tReach: number[] = [];
  const tBlock: number[] = [];
  for (let i = 0; i < nT; i++) {
    const d = TERRAIN_DEFAULT[i] ?? [1, 1, 1, 1, 0, 0];
    const t = types[i];
    tPass.push(t && typeof t.pass === 'boolean' ? (t.pass ? 1 : 0) : d[0]);
    tBld.push(t && typeof t.build === 'boolean' ? (t.build ? 1 : 0) : d[1]);
    tMul.push(t && typeof t.cost === 'number' && t.cost > 0 ? t.cost : d[2]);
    tVal.push(t && typeof t.min === 'number' && t.min >= 0 ? t.min : d[3]);
    tReach.push(t && typeof t.reach === 'boolean' ? (t.reach ? 1 : 0) : d[4]);
    tBlock.push(t && typeof t.block === 'boolean' ? (t.block ? 1 : 0) : d[5]);
  }
  const terr = new Uint8Array(g.N);
  const list = m.terrain && Array.isArray(m.terrain.cells) ? m.terrain.cells : [];
  /* the tuple order: [q, r, type] expected; checked against [type, q, r] */
  let okA = 0;
  let okB = 0;
  for (const e of list) {
    if (!Array.isArray(e) || e.length < 3) continue;
    if (g.idx(e[0], e[1]) >= 0 && e[2] >= 0 && e[2] < nT) okA++;
    if (g.idx(e[1], e[2]) >= 0 && e[0] >= 0 && e[0] < nT) okB++;
  }
  const qrt = okA >= okB;
  for (const e of list) {
    if (!Array.isArray(e) || e.length < 3) continue;
    const q = qrt ? e[0] : e[1];
    const r = qrt ? e[1] : e[2];
    const t = qrt ? e[2] : e[0];
    const c = g.idx(q, r);
    if (c >= 0 && t >= 0 && t < nT) terr[c] = t;
  }
  for (const c of g.cells) {
    const t = terr[c]!;
    g.pass[c] = tPass[t] ?? 1;
    g.bld[c] = tBld[t] ?? 1;
    g.mul[c] = tMul[t] ?? 1;
    g.val[c] = tVal[t] ?? 1;
    g.reach[c] = tReach[t] ?? 0;
    g.block[c] = tBlock[t] ?? 0;
  }
  const lv = Array.isArray(m.levels) ? m.levels : [];
  if (lv.length === g.cells.length) {
    let i = 0;
    for (let r = -g.R; r <= g.R; r++) {
      for (let q = -g.R; q <= g.R; q++) {
        const c = g.idx(q, r);
        if (c < 0) continue;
        const v = lv[i++];
        g.lvl[c] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      }
    }
  }
  for (const f of Array.isArray(m.finds) ? m.finds : []) {
    if (f && f.kind === 'dead') {
      const c = g.idx(f.q, f.r);
      if (c >= 0) g.dead[c] = 1;
    }
  }
  return g;
}

class Heap {
  private k: Float64Array;
  private v: Int32Array;
  n = 0;

  constructor(cap: number) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
  }

  push(key: number, val: number): void {
    if (this.n >= this.k.length) {
      const k2 = new Float64Array(this.k.length * 2);
      k2.set(this.k);
      const v2 = new Int32Array(this.v.length * 2);
      v2.set(this.v);
      this.k = k2;
      this.v = v2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = this.k[p]!;
      if (pk <= key) break;
      this.k[i] = pk;
      this.v[i] = this.v[p]!;
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }

  topKey(): number {
    return this.k[0]!;
  }

  pop(): number {
    const top = this.v[0]!;
    const n = --this.n;
    if (n > 0) {
      const key = this.k[n]!;
      const val = this.v[n]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.k[c + 1]! < this.k[c]!) c++;
        if (this.k[c]! >= key) break;
        this.k[i] = this.k[c]!;
        this.v[i] = this.v[c]!;
        i = c;
      }
      this.k[i] = key;
      this.v[i] = val;
    }
    return top;
  }
}

/* -------------------------------------------------------------------- memory */

interface NInfo {
  c: number;
  ring: boolean;
  start: boolean;
  owner: string | null; /* slot, 'K', 'E' (some enemy), '?' (lost to unknown), null (ruin) */
  dark: boolean;
  seen: number;
  grace: number; /* tick before which the needle cannot be heated */
}

interface FindInfo {
  kind: string;
  c: number;
  taken: boolean;
}

type AKind = 'heat' | 'build' | 'feed' | 'goto' | 'hold' | 'ram' | 'jam';

interface Assign {
  kind: AKind;
  cell: number; /* destination cell */
  ref: number; /* stage / hold: ring needle; jam: target needle */
  tgt: string; /* ram target */
  sub: string; /* heat: ruin | foe; goto: park | stage | fetch | home | clear */
  since: number;
  issued: number;
  tries: number;
  until: number;
  prio: number;
  seen: number;
  linked: boolean;
  score: number;
}

interface UMem {
  id: string;
  cls: ClsName;
  a: Assign | null;
  lastC: number;
  still: number;
  arrivedAt: number;
}

interface FoeTrack {
  c: number;
  still: number;
  seen: number;
}

interface Meta {
  unit: string;
  cell: number;
}

interface Threat {
  f: FoeEntry;
  c: number;
  s: number;
}

const NOMETA: Meta = { unit: '', cell: -1 };

/* the tick's channel: commands are paid first, hands of acting units after them */
class Budget {
  chan: number;
  hands: number;
  readonly cap: number;
  readonly order: number;
  readonly tick: number;
  readonly orders: Order[] = [];
  readonly meta: Meta[] = [];

  constructor(chan: number, hands: number, cap: number, order: number, tick: number) {
    this.chan = chan;
    this.hands = hands;
    this.cap = cap;
    this.order = order;
    this.tick = tick;
  }

  /* cost 0 - a free command (jam, halt): accepted with one order's worth left */
  can(cost: number, dh: number, force: boolean): boolean {
    if (this.orders.length >= this.cap) return false;
    if (cost <= 0) return this.chan >= this.order;
    if (cost > this.chan) return false;
    if (force) return true;
    return this.chan - cost >= (this.hands + dh) * this.tick;
  }

  push(o: Order, cost: number, dh: number, m: Meta): void {
    this.orders.push(o);
    this.meta.push(m);
    this.chan -= Math.max(0, cost);
    this.hands = Math.max(0, this.hands + dh);
  }

  room(): boolean {
    return this.orders.length < this.cap;
  }

  spare(): number {
    return this.chan - this.hands * this.tick;
  }
}

function canCmd(u: MineUnit): boolean {
  return !(u.task && u.task.path > 0 && u.wait > 0);
}

/* ----------------------------------------------------------------------- head */

class ZoriaBot implements Strategy {
  private readonly P: Params;
  private C: Cfg = { ...CFG_DEFAULT };
  private slot: SlotName = 'A';
  private g: Geo | null = null;
  private oracle: RulesOracle | null = null;
  private linkC: Int8Array = new Int8Array(0);
  private baseW: number[] = [1, 1, 2 / 3, 1 / 3];
  private fedW: number[] = [1, 1, 1, 2 / 3, 1 / 3];
  private needles = new Map<number, NInfo>();
  private seats: number[] = [];
  private hearth = -1;
  private hearthOk = false;
  private man0: Hex | null = null;
  private foeHearths: number[] = [];
  private citadel = -1;
  private cherta = 6;
  private finds: FindInfo[] = [];
  private lots: { at: number; cells: number[] }[] = [];
  private storms: StormSpec[] = [];
  private dawnAt = 1000;
  private tEnd = 1200;

  private umem = new Map<string, UMem>();
  private pending: { cls: ClsName; at: number }[] = [];
  private known = new Set<string>();
  private foeTrack = new Map<string, FoeTrack>();
  private banned = new Map<number, number>();
  private dcache = new Map<number, Float64Array>();
  private heap = new Heap(8192);
  private stamp: Int32Array = new Int32Array(0);
  private stampN = 0;
  private lastScan = new Map<number, number>();
  private bidCache = new Map<number, { t: number; v: number }>();
  private ramBan = new Map<string, number>();
  private jamPressureAt = -1000;

  private t = 0;
  private obs: Observe | null = null;
  private lastOrders: Order[] = [];
  private lastMeta: Meta[] = [];
  private lastAccepted = 0;
  private gotFeedback = false;
  private lastSent = 0;
  private yardAskT = -100;
  private threatAt = -1000;
  private flares = 0;
  private openCache = -1;
  private openingChecked = false;

  /* derived per tick */
  private units: MineUnit[] = [];
  private ownAll: number[] = [];
  private ownLit: number[] = [];
  private anchors: number[] = [];
  private claims = new Set<number>();
  private occOwn = new Map<number, string>();
  private occFoe = new Map<number, string>();
  private foeById = new Map<string, FoeEntry>();
  private pMine: Float64Array = new Float64Array(0);
  private pPlan: Float64Array = new Float64Array(0);
  private pOth: Float64Array = new Float64Array(0);
  private postDawn = false;
  private mercy = false;
  private partner: SlotName | null = null;
  private leader: string | null = null;
  private energy = 0;
  private income = 0;
  private litCount = 0;
  private contract: { cells: number[]; to: number; per: number; feasible: boolean } | null = null;
  private bridgeY: { c: number; w: number }[] = [];
  private myJams = new Map<number, number>();
  private threats: Threat[] = [];
  private reservedBuild = 0;
  private nT = 0;
  private nK = 0;
  private weight = 0;
  private lastLoss = 0;
  private canBuildBefore = false;
  private buildTrigger = false;

  /* belief diary */
  private bOwn = new Map<string, string | null>();
  private bDark = new Map<string, boolean>();
  private bCount = 0;

  constructor(p: Params) {
    this.P = p;
  }

  /* ================================================================ wire */

  init(manifestBytes: Uint8Array, slot: SlotName): void {
    this.slot = slot;
    try {
      const m = decodeManifest(manifestBytes);
      if (m) this.setup(m, manifestBytes);
    } catch {
      this.g = null;
    }
  }

  tick(observeBytes: Uint8Array): Uint8Array {
    let orders: Order[] = [];
    try {
      const o = decodeObserve(observeBytes);
      orders = o ? this.think(o) : this.fallback();
    } catch {
      try {
        orders = this.fallback();
      } catch {
        orders = [];
        this.lastMeta = [];
      }
    }
    try {
      const bytes = encodeOrders(orders);
      this.lastOrders = orders;
      if (orders.length) this.lastSent = this.t;
      return bytes;
    } catch {
      try {
        const fb = this.fallback();
        const bytes = encodeOrders(fb);
        this.lastOrders = fb;
        if (fb.length) this.lastSent = this.t;
        return bytes;
      } catch {
        this.lastOrders = [];
        this.lastMeta = [];
        try {
          return encodeOrders([]);
        } catch {
          return new Uint8Array([0x80]);
        }
      }
    }
  }

  feedback(verdictBytes: Uint8Array): void {
    try {
      const vs = decodeVerdicts(verdictBytes);
      if (!vs) return;
      this.gotFeedback = true;
      for (const v of vs) {
        const i = v[0];
        const ok = v[1];
        const code = v[2];
        const o = this.lastOrders[i];
        if (!o) continue;
        if (ok) {
          this.lastAccepted = this.t;
          if (o.kind === 'yard') this.pending.push({ cls: o.cls, at: this.t });
          continue;
        }
        const m = this.lastMeta[i];
        if (!m || !m.unit) continue;
        const um = this.umem.get(m.unit);
        if (!um) continue;
        if (code === 3) {
          this.umem.delete(m.unit);
          continue;
        }
        const a = um.a;
        if (!a || a.cell !== m.cell) continue;
        if (code === 4 || code === 6 || code === 2) {
          a.issued = -100;
        } else if (code === 11 || code === 12 || code === 13 || code === 21 || code === 18) {
          this.ban(m.cell, this.t + 200);
          if (a.ref >= 0) this.ban(a.ref, this.t + 100);
          um.a = null;
        } else if (code === 16 || code === 17) {
          um.a = null;
        } else {
          a.issued = -100;
        }
      }
    } catch {
      /* verdicts are advisory */
    }
  }

  belief(obs: Observe | null): BeliefFrame | null {
    try {
      const o = obs ?? this.obs;
      if (!o || !this.g) return null;
      const g = this.g;
      const p = o.pulse;
      const f: BeliefFrame = {
        t: o.t,
        pulse: { energy: p.energy, chan: p.chan, ear: p.ear, minutes: p.minutes, needles: p.needles },
      };
      const full = this.bCount % 200 === 0;
      this.bCount++;
      const own: Record<string, string | null> = {};
      const dark: Record<string, boolean> = {};
      let nOwn = 0;
      let nDark = 0;
      for (const n of this.needles.values()) {
        const key = g.qq[n.c]! + ',' + g.rr[n.c]!;
        const ow = n.owner === '?' || n.owner === 'E' ? null : n.owner;
        if (full || this.bOwn.get(key) !== ow) {
          own[key] = ow;
          this.bOwn.set(key, ow);
          nOwn++;
        }
        if (full || this.bDark.get(key) !== n.dark) {
          dark[key] = n.dark;
          this.bDark.set(key, n.dark);
          nDark++;
        }
      }
      if (full) f.full = true;
      if (full || nOwn > 0) f.own = own;
      if (full || nDark > 0) f.dark = dark;
      f.foe = o.foe.map((e): [string, string, number, number] => [e.id, e.p, e.q, e.r]);
      f.noisy = o.noisy.length;
      f.units = o.mine.units.map((u): [string, number, number, number] => [u.id, u.q, u.r, u.task ? u.task.path : 0]);
      let pact: string | null = null;
      for (const l of o.pub.pact.active) {
        if (l.a === this.slot) pact = l.b;
        else if (l.b === this.slot) pact = l.a;
      }
      f.pact = pact;
      f.cries = o.pub.cries.map((c): [string, number] => [c[0], c[1]]);
      return f;
    } catch {
      return null;
    }
  }

  private fallback(): Order[] {
    this.lastMeta = [];
    const o = this.obs;
    if (o) {
      for (const u of o.mine.units) {
        if (!u.task) {
          this.lastMeta = [NOMETA];
          return [{ kind: 'halt', unit: u.id }];
        }
      }
    }
    const h = this.man0;
    if (h) {
      this.lastMeta = [NOMETA];
      return [{ kind: 'watch', q: h.q, r: h.r, keep: 0 }];
    }
    return [];
  }

  /* ================================================================ setup */

  private setup(m: Manifest, bytes: Uint8Array): void {
    this.C = readCfg(m.cfg);
    if (Array.isArray(m.rings) && m.rings.length >= 2 && m.rings.length <= 5 && m.rings.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0)) {
      this.baseW = m.rings.slice();
    }
    const fr = Math.max(0, Math.min(1, Math.round(this.C.feedRing)));
    this.fedW = [];
    for (let k = 0; k < this.baseW.length + fr; k++) this.fedW.push(this.baseW[Math.max(0, k - fr)] ?? 0);
    const g = buildGeo(m);
    this.g = g;
    this.pMine = new Float64Array(g.N);
    this.pPlan = new Float64Array(g.N);
    this.pOth = new Float64Array(g.N);
    this.stamp = new Int32Array(g.N);
    this.linkC = new Int8Array(g.N * g.N);
    this.citadel = m.citadel ? g.idx(m.citadel.q, m.citadel.r) : -1;
    if (this.citadel < 0) this.citadel = g.idx(0, 0);
    this.cherta = typeof m.cherta === 'number' && m.cherta > 0 ? m.cherta : 6;
    this.seats = [];
    for (const s of Array.isArray(m.seats) ? m.seats : []) {
      const c = g.idx(s.q, s.r);
      if (c >= 0) this.seats.push(c);
    }
    for (const n of Array.isArray(m.needles) ? m.needles : []) {
      const c = g.idx(n.q, n.r);
      if (c < 0) continue;
      this.needles.set(c, {
        c,
        ring: !!n.ring,
        start: !!n.start,
        owner: n.ring ? 'K' : n.start ? 'E' : null,
        dark: false,
        seen: -1,
        grace: 0,
      });
    }
    for (const f of Array.isArray(m.finds) ? m.finds : []) {
      const c = g.idx(f.q, f.r);
      if (c >= 0) this.finds.push({ kind: f.kind, c, taken: false });
    }
    for (const l of Array.isArray(m.lots) ? m.lots : []) {
      const cells: number[] = [];
      for (const h of Array.isArray(l.cells) ? l.cells : []) {
        const c = g.idx(h.q, h.r);
        if (c >= 0) cells.push(c);
      }
      this.lots.push({ at: typeof l.at === 'number' ? l.at : -1, cells });
    }
    this.storms = Array.isArray(m.storms) ? m.storms : [];
    this.tEnd = typeof m.ticks === 'number' && m.ticks > 0 ? m.ticks : 1200;
    this.dawnAt = m.dawn && typeof m.dawn.at === 'number' ? m.dawn.at : this.tEnd - 200;
    /* hearth guess: the seat next to the starting needles named after our slot;
       confirmed by our own needles in the first frame */
    for (const n of Array.isArray(m.needles) ? m.needles : []) {
      if (n.start !== this.slot) continue;
      const c = g.idx(n.q, n.r);
      for (const s of this.seats) if (c >= 0 && g.dist(s, c) === 1) this.hearth = s;
    }
    if (this.hearth < 0) this.hearth = this.seats[['A', 'B', 'C'].indexOf(this.slot)] ?? -1;
    if (this.hearth >= 0) this.man0 = g.hex(this.hearth);
    this.foeHearths = this.seats.filter((s) => s !== this.hearth);
    /* the rules oracle answers link questions exactly; it is kept only if it is sane */
    try {
      const o = new RulesOracle(createEngine, bytes);
      let sane = true;
      const s0 = this.seats[0];
      if (s0 !== undefined) {
        let near = -1;
        for (const n of this.needles.values()) if (n.start && g.dist(n.c, s0) === 1) near = n.c;
        if (near >= 0 && !o.linkOk(g.hex(s0), g.hex(near))) sane = false;
        let far = -1;
        for (const c of g.cells) {
          if (g.dist(c, s0) === 9) {
            far = c;
            break;
          }
        }
        if (far >= 0 && o.linkOk(g.hex(s0), g.hex(far))) sane = false;
      }
      this.oracle = sane ? o : null;
    } catch {
      this.oracle = null;
    }
  }

  /* ================================================================ think */

  private think(o: Observe): Order[] {
    this.t = o.t;
    this.obs = o;
    this.dcache.clear();
    if (!this.g) return this.bare(o);
    this.absorb(o);
    this.derive(o);
    const B = new Budget(
      o.pulse.chan,
      this.countActing(),
      Math.floor(o.pulse.chanAt / Math.max(1, this.C.chanOrder)) + 4,
      this.C.chanOrder,
      this.C.chanTick,
    );
    this.validate();
    this.refreshPlan();
    this.evalContract(o);
    this.buildBridge();
    this.openingCheck();
    this.defend(B);
    this.reissue(B, true);
    this.yard(B);
    this.planTkachs(B);
    this.planKlinoks(B);
    this.clearHearth(B);
    this.reissue(B, false);
    this.bid(B);
    this.scan(B);
    this.halts(B);
    this.keepalive(B);
    this.lastMeta = B.meta;
    return B.orders;
  }

  /* no geometry: only hold the slot */
  private bare(o: Observe): Order[] {
    this.lastMeta = [];
    const quiet = this.t - (this.gotFeedback ? this.lastAccepted : this.lastSent);
    if (quiet < 3) return [];
    for (const u of o.mine.units) {
      if (!u.task) {
        this.lastMeta = [NOMETA];
        return [{ kind: 'halt', unit: u.id }];
      }
    }
    const h = this.man0 ?? { q: 0, r: 0 };
    this.lastMeta = [NOMETA];
    return [{ kind: 'watch', q: h.q, r: h.r, keep: 0 }];
  }

  /* ---------------------------------------------------------- memory */

  private absorb(o: Observe): void {
    const g = this.g!;
    const t = this.t;
    const me = this.slot;
    const C = this.C;
    const mineSet = new Set<number>();
    for (const n of o.mine.needles) {
      const c = g.idx(n.q, n.r);
      if (c < 0) continue;
      mineSet.add(c);
      let info = this.needles.get(c);
      if (!info) {
        info = { c, ring: false, start: false, owner: null, dark: false, seen: -1, grace: 0 };
        this.needles.set(c, info);
      }
      if (info.owner !== me) info.grace = t + C.capGrace;
      info.owner = me;
      info.dark = n.dark;
      info.seen = t;
    }
    /* the hearth is the seat next to our starting needles */
    if (!this.hearthOk) {
      for (const s of this.seats) {
        let k = 0;
        for (const c of mineSet) {
          const n = this.needles.get(c);
          if (n && n.start && g.dist(s, c) === 1) k++;
        }
        if (k > 0) {
          this.hearth = s;
          this.hearthOk = true;
          this.man0 = g.hex(s);
          this.foeHearths = this.seats.filter((x) => x !== s);
          for (const n of this.needles.values()) if (n.start && !mineSet.has(n.c)) n.owner = 'E';
          break;
        }
      }
    }
    for (const l of o.mine.losts) {
      const c = g.idx(l.q, l.r);
      const info = c >= 0 ? this.needles.get(c) : undefined;
      if (!info || mineSet.has(c)) continue;
      info.owner = l.owner;
      info.dark = l.dark;
      info.grace = Math.max(info.grace, l.t + C.capGrace);
      info.seen = Math.max(info.seen, l.t);
      this.threatAt = Math.max(this.threatAt, l.t);
    }
    for (const info of this.needles.values()) {
      if (info.owner === me && !mineSet.has(info.c)) {
        info.owner = '?';
        info.grace = t + C.capGrace;
      }
    }
    for (const e of o.own) {
      const c = g.idx(e.q, e.r);
      if (c < 0 || mineSet.has(c)) continue;
      let info = this.needles.get(c);
      if (!info) {
        info = { c, ring: false, start: false, owner: e.owner, dark: e.dark, seen: t, grace: t + C.capGrace / 2 };
        this.needles.set(c, info);
        continue;
      }
      if (info.owner !== e.owner && e.owner !== null) {
        const prev = info.seen >= 0 ? info.seen : t;
        info.grace = Math.max(info.grace, Math.max(t, Math.min(t + C.capGrace, prev + C.capGrace)));
      }
      info.owner = e.owner;
      info.dark = e.dark;
      info.seen = t;
    }
    for (const ev of o.events) {
      switch (ev.type) {
        case 'find': {
          const c = g.idx(ev.q, ev.r);
          for (const f of this.finds) if (f.c === c) f.taken = true;
          if (ev.p === me && ev.find === 'flare') this.flares++;
          break;
        }
        case 'cap':
          if (ev.from === me && ev.p !== me) this.threatAt = t;
          break;
        case 'jam':
          if (ev.own === me && ev.p !== me) this.threatAt = t;
          break;
        case 'ram':
          if (ev.p !== me) this.threatAt = t;
          break;
        default:
          break;
      }
    }
    /* foes in exact sight */
    this.foeById.clear();
    this.occFoe.clear();
    for (const f of o.foe) {
      const c = g.idx(f.q, f.r);
      if (c < 0 || f.p === me) continue;
      this.foeById.set(f.id, f);
      this.occFoe.set(c, f.id);
      const tr = this.foeTrack.get(f.id);
      if (tr && tr.c === c && tr.seen >= t - 1) {
        tr.still++;
        tr.seen = t;
      } else {
        this.foeTrack.set(f.id, { c, still: 0, seen: t });
      }
    }
    if (t % 25 === 0) {
      for (const [id, tr] of this.foeTrack) if (tr.seen < t - 40) this.foeTrack.delete(id);
      for (const [c, until] of this.banned) if (until <= t) this.banned.delete(c);
      for (const [id, until] of this.ramBan) if (until <= t) this.ramBan.delete(id);
    }
    /* own units */
    const units = o.mine.units.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.units = units;
    this.occOwn.clear();
    const alive = new Set<string>();
    for (const u of units) {
      const c = g.idx(u.q, u.r);
      alive.add(u.id);
      if (c >= 0) this.occOwn.set(c, u.id);
      let m = this.umem.get(u.id);
      if (!m) {
        m = { id: u.id, cls: u.cls, a: null, lastC: c, still: 0, arrivedAt: -1 };
        this.umem.set(u.id, m);
      } else if (m.lastC === c) {
        m.still++;
      } else {
        m.still = 0;
        m.lastC = c;
      }
      if (!this.known.has(u.id)) {
        this.known.add(u.id);
        const i = this.pending.findIndex((p) => p.cls === u.cls);
        if (i >= 0) this.pending.splice(i, 1);
      }
    }
    for (const id of [...this.umem.keys()]) if (!alive.has(id)) this.umem.delete(id);
    /* a find our unit stands on, or passes next to while walking, is taken (16.8):
       finds are not in frames, so this is the only news when someone else took it */
    for (const f of this.finds) {
      if (f.taken) continue;
      for (const u of units) {
        const c = g.idx(u.q, u.r);
        if (c < 0) continue;
        const d = g.dist(c, f.c);
        if (d === 0 || (d <= 1 && u.task && u.task.path > 0 && !u.task.ram)) {
          f.taken = true;
          break;
        }
      }
    }
    this.pending = this.pending.filter((p) => p.at >= t - 12);
  }

  private derive(o: Observe): void {
    const g = this.g!;
    const me = this.slot;
    const t = this.t;
    const C = this.C;
    this.energy = o.pulse.energy;
    this.mercy = !!o.pulse.mercy;
    this.postDawn = o.pub.dawn || t >= this.dawnAt;
    this.partner = null;
    for (const l of o.pub.pact.active) {
      if (l.a === me) this.partner = l.b;
      else if (l.b === me) this.partner = l.a;
    }
    const slots: SlotName[] = ['A', 'B', 'C'];
    let best = -Infinity;
    this.leader = null;
    for (let i = 0; i < 3; i++) {
      const s = slots[i]!;
      if (s === me) continue;
      const v = o.pub.score[i] ?? 0;
      if (v > best) {
        best = v;
        this.leader = s;
      }
    }
    this.ownAll = [];
    this.ownLit = [];
    let lit = 0;
    let wsum = 0;
    const ws: number[] = [];
    for (const n of o.mine.needles) {
      const c = g.idx(n.q, n.r);
      if (c < 0) continue;
      this.ownAll.push(c);
      if (!n.dark && n.weight > 0) {
        lit++;
        ws.push(Math.min(1, n.weight));
        if (n.weight >= 0.999) this.ownLit.push(c);
      }
    }
    ws.sort((a, b) => b - a);
    for (let i = 0; i < Math.min(8, ws.length); i++) wsum += ws[i]!;
    this.litCount = lit;
    this.income = (C.energyRegen / 4) * wsum;
    this.myJams.clear();
    for (const j of o.mine.jams) {
      const c = g.idx(j.q, j.r);
      if (c >= 0 && j.until >= t) this.myJams.set(c, j.until);
    }
    let nT = 0;
    let nK = 0;
    for (const u of this.units) {
      if (u.cls === TK) nT++;
      else nK++;
    }
    for (const p of this.pending) {
      if (p.cls === TK) nT++;
      else nK++;
    }
    this.nT = nT;
    this.nK = nK;
    this.weight = nT * C.weightTkach + nK * C.weightKlinok;
    this.computePulls(o);
    this.findThreats(o);
  }

  /* a pact partner's needle or unit; with no pact nobody is a partner */
  private isPartner(owner: string | null): boolean {
    return this.partner !== null && owner === this.partner;
  }

  private ringMult(): number {
    return this.postDawn ? this.C.dawnRing : this.C.ringPull;
  }

  private computePulls(o: Observe): void {
    const g = this.g!;
    const me = this.slot;
    this.pMine.fill(0);
    this.pOth.fill(0);
    for (const n of o.mine.needles) {
      if (n.dark || n.weight <= 0) continue;
      const c = g.idx(n.q, n.r);
      if (c < 0) continue;
      const info = this.needles.get(c);
      const mult = (info && info.ring ? this.ringMult() : 1) * n.weight;
      this.addPull(this.pMine, c, n.fed ? this.fedW : this.baseW, mult);
    }
    /* our live jams pull for us (loot) instead of their owner */
    for (const c of this.myJams.keys()) {
      const info = this.needles.get(c);
      if (!info || info.owner === me || info.owner === null || info.owner === '?') continue;
      if (info.owner === 'K' && this.postDawn) continue;
      this.addPull(this.pMine, c, this.baseW, info.ring ? this.ringMult() : 1);
    }
    for (const info of this.needles.values()) {
      const ow = info.owner;
      if (ow === null || ow === me || ow === '?' || this.myJams.has(info.c)) continue;
      if (ow === 'K') {
        if (this.postDawn || info.dark) continue;
        this.addPull(this.pOth, info.c, this.baseW, this.C.ringPull);
        continue;
      }
      if (info.dark) continue;
      this.addPull(this.pOth, info.c, this.baseW, info.ring ? this.ringMult() : 1);
    }
    this.pPlan.set(this.pMine);
  }

  private addPull(arr: Float64Array, c: number, w: number[], mult: number): void {
    const g = this.g!;
    const q0 = g.qq[c]!;
    const r0 = g.rr[c]!;
    const n = offCount(w.length - 1);
    for (let i = 0; i < n; i++) {
      const of = OFFS[i]!;
      const x = g.idx(q0 + of.dq, r0 + of.dr);
      if (x < 0) continue;
      arr[x] = arr[x]! + (w[of.d] ?? 0) * mult;
    }
  }

  /* value-weighted income gain of a needle at c (pull * cell value per tick);
     removeMult - pull of the current foreign owner that goes away, their loss -> lastLoss */
  private gain(c: number, w: number[], mult: number, removeMult: number): number {
    const g = this.g!;
    const q0 = g.qq[c]!;
    const r0 = g.rr[c]!;
    const n = offCount(w.length - 1);
    const bw = this.baseW;
    let s = 0;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const of = OFFS[i]!;
      const x = g.idx(q0 + of.dq, r0 + of.dr);
      if (x < 0) continue;
      const v = g.val[x]!;
      if (v <= 0) continue;
      const m = this.pPlan[x]!;
      const o0 = this.pOth[x]!;
      let o1 = o0;
      if (removeMult > 0) {
        const theirs = (bw[of.d] ?? 0) * removeMult;
        o1 = Math.max(0, o0 - theirs);
        loss += v * Math.min(1, theirs) * (o0 > 0 ? Math.min(1, theirs / o0) : 1);
      }
      s += v * (share(m + (w[of.d] ?? 0) * mult, o1) - share(m, o0));
    }
    this.lastLoss = loss;
    return s;
  }

  private feedGain(c: number, mult: number, fedNow: boolean): number {
    const g = this.g!;
    const q0 = g.qq[c]!;
    const r0 = g.rr[c]!;
    const n = offCount(this.fedW.length - 1);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const of = OFFS[i]!;
      const delta = ((this.fedW[of.d] ?? 0) - (this.baseW[of.d] ?? 0)) * mult;
      if (delta <= 0) continue;
      const x = g.idx(q0 + of.dq, r0 + of.dr);
      if (x < 0) continue;
      const v = g.val[x]!;
      if (v <= 0) continue;
      const m = this.pPlan[x]!;
      const o = this.pOth[x]!;
      if (fedNow) s += v * (share(m, o) - share(Math.max(0, m - delta), o));
      else s += v * (share(m + delta, o) - share(m, o));
    }
    return s;
  }

  /* ---------------------------------------------------------- helpers */

  private cellOf(u: { q: number; r: number }): number {
    return this.g!.idx(u.q, u.r);
  }

  private hexIs(h: Hex | null | undefined, c: number): boolean {
    return !!h && this.g!.idx(h.q, h.r) === c;
  }

  private isInside(c: number): boolean {
    return this.citadel >= 0 && this.g!.dist(c, this.citadel) <= this.cherta;
  }

  private stormMult(c: number): number {
    if (c < 0 || !this.storms.length) return 1;
    try {
      return stormAt(this.storms, this.g!.qq[c]!, this.g!.rr[c]!, this.t) ? Math.max(1, this.C.stormCost) : 1;
    } catch {
      return 1;
    }
  }

  private ban(c: number, until: number): void {
    if (c < 0) return;
    this.banned.set(c, Math.max(this.banned.get(c) ?? 0, until));
  }

  private isBanned(c: number): boolean {
    return (this.banned.get(c) ?? -1) > this.t;
  }

  /* travel time in ticks from src to every cell (10.5) */
  private dijk(src: number, step: number, maxT: number): Float64Array {
    const key = src * 8 + step;
    const hit = this.dcache.get(key);
    if (hit) return hit;
    const g = this.g!;
    const D = new Float64Array(g.N).fill(Infinity);
    this.dcache.set(key, D);
    if (src < 0 || !g.valid[src]) return D;
    const h = this.heap;
    h.n = 0;
    D[src] = 0;
    h.push(0, src);
    const rise = this.C.stepRise;
    while (h.n > 0) {
      const d = h.topKey();
      const a = h.pop();
      if (d > D[a]!) continue;
      if (d > maxT) break;
      const la = g.lvl[a]!;
      for (let k = 0; k < 6; k++) {
        const b = g.nb[a * 6 + k]!;
        if (b < 0 || !g.pass[b]) continue;
        const up = g.lvl[b]! - la;
        if (up >= 2) continue;
        const nd = d + step * g.mul[b]! + (up > 0 ? up * rise : 0);
        if (nd < D[b]!) {
          D[b] = nd;
          h.push(nd, b);
        }
      }
    }
    return D;
  }

  /* whether the thread reaches between two cells (7.2) */
  private linkOk(a: number, b: number): boolean {
    if (a === b) return true;
    const g = this.g!;
    const d = g.dist(a, b);
    const rng = this.C.linkRange + (g.reach[a] || g.reach[b] ? 1 : 0);
    if (d > rng) return false;
    const k = a * g.N + b;
    const cv = this.linkC[k];
    if (cv === 1) return true;
    if (cv === 2) return false;
    let ok: boolean;
    if (this.oracle) {
      try {
        ok = this.oracle.linkOk(g.hex(a), g.hex(b));
      } catch {
        ok = this.segOk(a, b);
      }
    } else {
      ok = this.segOk(a, b);
    }
    this.linkC[k] = ok ? 1 : 2;
    this.linkC[b * g.N + a] = ok ? 1 : 2;
    return ok;
  }

  private segOk(a: number, b: number): boolean {
    const g = this.g!;
    const aq = g.qq[a]!;
    const ar = g.rr[a]!;
    const bq = g.qq[b]!;
    const br = g.rr[b]!;
    const n = Math.max(1, g.dist(a, b)) * 4;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const [q, r] = hexRound(aq + (bq - aq) * f + 1e-6, ar + (br - ar) * f + 2e-6);
      const c = g.idx(q, r);
      if (c < 0 || c === a || c === b) continue;
      if (g.block[c]) return false;
    }
    return true;
  }

  private linkable(c: number): boolean {
    const g = this.g!;
    const lim = this.C.linkRange + 1;
    for (const a of this.anchors) {
      if (g.dist(a, c) <= lim && this.linkOk(a, c)) return true;
    }
    return false;
  }

  private nearAnchors(c: number, d: number): boolean {
    const g = this.g!;
    for (const a of this.anchors) if (g.dist(a, c) <= d) return true;
    return false;
  }

  private minDistOwn(c: number): number {
    const g = this.g!;
    let best = 99;
    for (const x of this.ownAll) {
      const d = g.dist(x, c);
      if (d < best) best = d;
    }
    if (this.hearth >= 0) best = Math.min(best, g.dist(this.hearth, c));
    return best;
  }

  /* a unit that pays hands this tick (13.6) */
  private isActing(u: MineUnit): boolean {
    const tk = u.task;
    if (tk) {
      if (tk.path > 0) return true;
      if (tk.goal || tk.site || tk.feed || tk.jam || tk.ram) return true;
    }
    if (u.cls === TK) {
      const c = this.cellOf(u);
      const n = c >= 0 ? this.needles.get(c) : undefined;
      if (n && n.owner !== this.slot && !n.start && n.grace <= this.t && !this.isPartner(n.owner)) return true;
    }
    return false;
  }

  private countActing(): number {
    let k = 0;
    for (const u of this.units) if (this.isActing(u)) k++;
    return k;
  }

  /* ---------------------------------------------------------- plan pull, claims */

  private refreshPlan(): void {
    this.claims.clear();
    this.reservedBuild = 0;
    this.pPlan.set(this.pMine);
    this.anchors = [];
    if (this.hearth >= 0) this.anchors.push(this.hearth);
    for (const c of this.ownLit) this.anchors.push(c);
    for (const m of this.umem.values()) {
      const a = m.a;
      if (a) this.addClaim(a);
    }
  }

  private addClaim(a: Assign): void {
    let c = -1;
    if (a.kind === 'heat' || a.kind === 'build') c = a.cell;
    else if ((a.kind === 'goto' && a.sub === 'stage') || (a.kind === 'hold' && a.ref >= 0)) c = a.ref;
    if (c < 0 || this.claims.has(c)) return;
    this.claims.add(c);
    if (a.kind === 'build') this.reservedBuild += this.C.costNeedle;
    const n = this.needles.get(c);
    const ring = !!(n && n.ring);
    const mult = ring ? (this.postDawn || a.kind !== 'heat' ? this.C.dawnRing : this.C.ringPull) : 1;
    this.addPull(this.pPlan, c, this.baseW, a.linked ? mult : mult * 0.3);
    if (a.linked) this.anchors.push(c);
  }

  /* ---------------------------------------------------------- threats */

  private findThreats(o: Observe): void {
    const g = this.g!;
    const me = this.slot;
    this.threats = [];
    const darkOwn: number[] = [];
    for (const n of o.mine.needles) {
      if (!n.dark) continue;
      const x = g.idx(n.q, n.r);
      const info = x >= 0 ? this.needles.get(x) : undefined;
      if (info && !info.start) darkOwn.push(x);
    }
    const workers: number[] = [];
    for (const u of this.units) {
      if (u.cls !== TK) continue;
      const a = this.umem.get(u.id)?.a;
      const uc = this.cellOf(u);
      if (a && (a.kind === 'heat' || a.kind === 'build') && uc === a.cell) workers.push(uc);
    }
    const contractCells = o.pub.order ? o.pub.order.cells.map((h) => g.idx(h.q, h.r)) : [];
    for (const f of o.foe) {
      if (f.p === me || f.p === 'K' || this.isPartner(f.p)) continue;
      const c = g.idx(f.q, f.r);
      if (c < 0) continue;
      const tr = this.foeTrack.get(f.id);
      const still = tr ? tr.still : 0;
      const n = this.needles.get(c);
      const near = this.minDistOwn(c);
      let s = 0;
      if (f.cls === TK) {
        if (n && n.owner === me && !n.start) s = 100;
        else if (n && !n.start && n.owner !== f.p && n.owner !== 'K') s = near <= 6 ? 70 : 44;
        else if (still >= 2 && near <= 4) s = 48;
        else if (near <= 2) s = 24;
      } else {
        if (darkOwn.some((x) => g.dist(x, c) <= 1)) {
          s = 82;
          this.jamPressureAt = this.t;
        } else if (workers.some((x) => g.dist(x, c) <= 2)) s = 36;
        else if (this.ownAll.some((x) => g.dist(x, c) <= 1 && !this.needles.get(x)?.start)) s = 40;
        else if (near <= 1 && this.t - this.threatAt < 40) s = 28;
      }
      if (s > 0 && contractCells.includes(c)) s += 10;
      if (s > 0) this.threats.push({ f, c, s });
      if (s >= 44 && near <= 6) this.threatAt = this.t;
    }
    this.threats.sort((a, b) => b.s - a.s || (a.f.id < b.f.id ? -1 : a.f.id > b.f.id ? 1 : 0));
  }

  private threatRecent(span: number): boolean {
    return this.t - this.threatAt <= span;
  }

  /* ---------------------------------------------------------- assignments */

  private mk(kind: AKind, cell: number, prio: number): Assign {
    return {
      kind,
      cell,
      ref: -1,
      tgt: '',
      sub: '',
      since: this.t,
      issued: -100,
      tries: 0,
      until: 0,
      prio,
      seen: this.t,
      linked: false,
      score: 0,
    };
  }

  private heatPrice(n: NInfo): number {
    if (n.owner === null) return this.C.heatNeedle;
    if (n.owner === 'K') return this.postDawn ? this.C.heatNeedle : n.dark ? this.C.heatDark : this.C.heatEnemy;
    return n.dark ? this.C.heatDark : this.C.heatEnemy;
  }

  private validate(): void {
    const g = this.g!;
    const t = this.t;
    const me = this.slot;
    for (const u of this.units) {
      const m = this.umem.get(u.id);
      if (!m || !m.a) continue;
      const a = m.a;
      const c = this.cellOf(u);
      let drop = false;
      switch (a.kind) {
        case 'heat': {
          const n = this.needles.get(a.cell);
          if (!n || n.owner === me || n.start || this.isPartner(n.owner)) {
            drop = true;
            break;
          }
          if (!this.postDawn && !this.mercy && this.isInside(a.cell)) {
            drop = true;
            break;
          }
          if (a.sub === 'ruin' && n.owner !== null) {
            drop = true;
            break;
          }
          const occ = this.occFoe.get(a.cell);
          const own = this.occOwn.get(a.cell);
          if (c !== a.cell && (occ !== undefined || (own !== undefined && own !== u.id))) {
            this.ban(a.cell, t + 15);
            drop = true;
            break;
          }
          if (c === a.cell) {
            if (m.arrivedAt < 0) m.arrivedAt = t;
            if (n.grace > t + 2) {
              this.ban(a.cell, n.grace);
              drop = true;
              break;
            }
            if (t - m.arrivedAt > this.heatPrice(n) + 14) {
              this.ban(a.cell, t + 90);
              drop = true;
            }
          } else {
            m.arrivedAt = -1;
          }
          break;
        }
        case 'build': {
          const n = this.needles.get(a.cell);
          if (n) {
            if (n.owner !== me) this.ban(a.cell, t + 100000);
            drop = true;
            break;
          }
          if (c !== a.cell && (this.occFoe.has(a.cell) || (this.occOwn.has(a.cell) && this.occOwn.get(a.cell) !== u.id))) {
            this.ban(a.cell, t + 20);
            drop = true;
            break;
          }
          if (c === a.cell) {
            if (m.arrivedAt < 0) m.arrivedAt = t;
            if (t - m.arrivedAt > this.C.buildTicks * 4 + 6) {
              this.ban(a.cell, t + 150);
              drop = true;
            }
          } else {
            m.arrivedAt = -1;
          }
          break;
        }
        case 'feed': {
          const n = this.needles.get(a.cell);
          if (!n || n.owner !== me || n.dark) drop = true;
          else if (c !== a.cell && (this.occFoe.has(a.cell) || (this.occOwn.has(a.cell) && this.occOwn.get(a.cell) !== u.id))) drop = true;
          break;
        }
        case 'goto': {
          if (c === a.cell) {
            if (a.sub === 'stage' && !this.postDawn) {
              const h = this.mk('hold', a.cell, a.prio);
              h.ref = a.ref;
              h.until = this.dawnAt;
              h.linked = a.linked;
              m.a = h;
            } else {
              drop = true;
            }
          } else if (this.occFoe.has(a.cell)) {
            drop = true;
          } else if (a.sub === 'fetch') {
            const f = this.finds.find((x) => x.c === a.cell);
            if (!f || f.taken) drop = true;
          } else if (a.sub === 'stage' && this.postDawn) {
            drop = true;
          }
          break;
        }
        case 'hold':
          if (t >= a.until || this.postDawn) drop = true;
          break;
        case 'ram': {
          const f = this.foeById.get(a.tgt);
          if (f) {
            a.seen = t;
            const fc = this.cellOf(f);
            if (fc >= 0) a.cell = fc;
          } else if (t - a.seen > 4) {
            drop = true;
          }
          /* a chase that does not end is a target we cannot reach */
          if (t - a.since > 45) {
            this.ramBan.set(a.tgt, t + 60);
            drop = true;
          }
          break;
        }
        case 'jam': {
          const n = this.needles.get(a.ref);
          if (!n || n.owner === me || n.owner === null || n.owner === '?' || this.isPartner(n.owner) || n.start) drop = true;
          else if (n.owner === 'K' && (this.postDawn || t >= this.dawnAt - 5)) drop = true;
          else if (n.dark && !this.myJams.has(a.ref)) drop = t - a.since > 30;
          else if (c !== a.cell && g.dist(c, a.ref) > 1 && this.occFoe.has(a.cell)) drop = true;
          break;
        }
      }
      if (!drop && m.a === a && m.still >= 16 && this.needsMove(u, a)) {
        this.ban(a.kind === 'jam' ? a.ref : a.cell, t + 60);
        m.still = 0;
        drop = true;
      }
      if (drop && m.a === a) m.a = null;
    }
  }

  private needsMove(u: MineUnit, a: Assign): boolean {
    const c = this.cellOf(u);
    switch (a.kind) {
      case 'heat':
      case 'build':
      case 'feed':
      case 'goto':
        return c !== a.cell;
      case 'jam':
        return this.g!.dist(c, a.ref) > 1;
      default:
        return false;
    }
  }

  private needsCmd(u: MineUnit, a: Assign): boolean {
    const c = this.cellOf(u);
    const tk = u.task;
    switch (a.kind) {
      case 'heat':
        return c !== a.cell && !(tk && tk.path > 0);
      case 'build':
        return !(tk && this.hexIs(tk.site, a.cell));
      case 'feed':
        return !(tk && this.hexIs(tk.feed, a.cell));
      case 'goto':
        return c !== a.cell && !(tk && tk.path > 0);
      case 'hold':
        return false;
      case 'ram':
        return !(tk && tk.ram === a.tgt) && this.foeById.has(a.tgt);
      case 'jam':
        if (this.g!.dist(c, a.ref) <= 1) return !(tk && this.hexIs(tk.jam, a.ref));
        return !(tk && tk.path > 0);
    }
    return false;
  }

  private issue(u: MineUnit, a: Assign, B: Budget, force: boolean): boolean {
    const g = this.g!;
    const uc = this.cellOf(u);
    const cost = this.C.chanOrder * this.stormMult(uc);
    const dh = this.isActing(u) ? 0 : 1;
    const meta: Meta = { unit: u.id, cell: a.cell };
    const at = g.hex(a.cell);
    switch (a.kind) {
      case 'heat':
        if (uc === a.cell) break;
        if (!B.can(cost, dh, force)) return false;
        B.push({ kind: 'move', unit: u.id, q: at.q, r: at.r, goal: { q: at.q, r: at.r }, home: false }, cost, dh, meta);
        break;
      case 'build':
        if (!B.can(cost, dh, force)) return false;
        B.push({ kind: 'needle', unit: u.id, q: at.q, r: at.r }, cost, dh, meta);
        break;
      case 'feed':
        if (!B.can(cost, dh, force)) return false;
        B.push({ kind: 'feed', unit: u.id, q: at.q, r: at.r }, cost, dh, meta);
        break;
      case 'goto': {
        if (uc === a.cell) break;
        if (!B.can(cost, dh, force)) return false;
        const home = u.cls === KL && (this.pMine[a.cell]! > 0 || (this.hearth >= 0 && g.dist(a.cell, this.hearth) <= this.C.linkRange));
        B.push({ kind: 'move', unit: u.id, q: at.q, r: at.r, goal: null, home }, cost, dh, meta);
        break;
      }
      case 'hold':
        break;
      case 'ram':
        if (!B.can(cost, dh, force)) return false;
        B.push({ kind: 'ram', unit: u.id, target: a.tgt }, cost, dh, meta);
        break;
      case 'jam': {
        const ref = g.hex(a.ref);
        if (g.dist(uc, a.ref) <= 1) {
          if (!B.can(0, dh, force)) return false;
          B.push({ kind: 'jam', unit: u.id, target: ref, hold: true }, 0, dh, meta);
        } else {
          if (!B.can(cost, dh, force)) return false;
          B.push({ kind: 'move', unit: u.id, q: at.q, r: at.r, goal: null, home: false }, cost, dh, meta);
          if (B.can(0, 0, true)) B.push({ kind: 'jam', unit: u.id, target: ref, hold: false }, 0, 0, meta);
        }
        break;
      }
    }
    a.issued = this.t;
    return true;
  }

  private reissue(B: Budget, important: boolean): void {
    for (const u of this.units) {
      const m = this.umem.get(u.id);
      if (!m || !m.a) continue;
      const a = m.a;
      const imp = a.kind === 'heat' || a.kind === 'build' || a.kind === 'ram';
      if (imp !== important) continue;
      if (a.issued === this.t || this.t - a.issued < 2) continue;
      if (!canCmd(u)) continue;
      if (!this.needsCmd(u, a)) continue;
      if (a.tries >= 5) {
        this.ban(a.kind === 'jam' ? a.ref : a.cell, this.t + 60);
        m.a = null;
        continue;
      }
      if (this.issue(u, a, B, a.kind === 'ram')) a.tries++;
    }
  }

  /* ---------------------------------------------------------- contract & bridges */

  private evalContract(o: Observe): void {
    this.contract = null;
    const b = o.pub.order;
    if (!b || this.t > b.to) return;
    const g = this.g!;
    const cells: number[] = [];
    for (const h of b.cells) {
      const c = g.idx(h.q, h.r);
      if (c >= 0) cells.push(c);
    }
    if (!cells.length) return;
    let need = 0;
    let worst = 0;
    for (const c of cells) {
      const n = this.needles.get(c);
      if (!n) {
        worst = 9999;
        continue;
      }
      if (n.owner === this.slot && !n.dark) continue;
      need++;
      let work: number;
      if (n.owner === this.slot) work = 20;
      else if (n.start || this.isPartner(n.owner)) work = 9999;
      else if (n.owner === null) work = this.C.heatNeedle;
      else if (n.owner === 'K' && !this.postDawn) work = 9999;
      else work = this.heatPrice(n) + Math.max(0, n.grace - this.t) + 6;
      let eta = 80;
      for (const u of this.units) {
        if (u.cls !== TK) continue;
        eta = Math.min(eta, g.dist(this.cellOf(u), c) * this.C.stepTkach * 1.35 + 2);
      }
      if (!this.linkable(c)) {
        let ok = false;
        for (const x of cells) if (x !== c && this.linkable(x) && this.linkOk(x, c)) ok = true;
        if (!ok) work += this.nearAnchors(c, this.C.linkRange * 2) ? 25 : 9999;
      }
      worst = Math.max(worst, eta + work);
    }
    const bonus = typeof b.bonus === 'number' && b.bonus > 0 ? b.bonus : this.C.orderBonus;
    const hold = typeof b.holdTicks === 'number' && b.holdTicks > 0 ? b.holdTicks : this.C.orderHoldTicks;
    const feasible = need > 0 && this.t + worst + hold + 4 <= b.to;
    this.contract = { cells, to: b.to, per: need > 0 ? (bonus * 0.9) / need : 0, feasible };
  }

  /* things worth reaching that the network does not reach yet */
  private buildBridge(): void {
    const Y: { c: number; w: number }[] = [];
    const mr = this.C.minuteRate;
    const Rm = Math.max(0, this.tEnd - this.t - 30);
    for (const n of this.needles.values()) {
      if (n.start) continue;
      if (n.owner === null) {
        if (this.isBanned(n.c) || this.claims.has(n.c)) continue;
        if (!this.postDawn && this.isInside(n.c)) continue;
        if (!this.nearAnchors(n.c, 12) || this.linkable(n.c)) continue;
        Y.push({ c: n.c, w: this.gain(n.c, this.baseW, 1, 0) * mr * Rm * 0.35 });
      } else if (n.owner === this.slot && n.dark) {
        if (!this.nearAnchors(n.c, 12) || this.linkable(n.c)) continue;
        Y.push({ c: n.c, w: this.gain(n.c, this.baseW, 1, 0) * mr * Rm * 0.45 });
      } else if (n.ring && n.owner === 'K' && this.t >= this.dawnAt - 300 && this.t < this.tEnd - 60) {
        if (!this.nearAnchors(n.c, 12) || this.linkable(n.c)) continue;
        Y.push({ c: n.c, w: 0.028 * Math.max(0, this.tEnd - Math.max(this.t, this.dawnAt) - 15) * 0.3 });
      }
    }
    const k = this.contract;
    if (k && k.feasible) {
      for (const c of k.cells) {
        const n = this.needles.get(c);
        if (n && n.owner === this.slot && !n.dark) continue;
        if (this.linkable(c)) continue;
        Y.push({ c, w: k.per * 0.6 });
      }
    }
    this.bridgeY = Y;
  }

  private bridgeU(x: number): number {
    const g = this.g!;
    const lim = this.C.linkRange + 1;
    let u = 0;
    for (const y of this.bridgeY) {
      if (y.c === x || g.dist(x, y.c) > lim) continue;
      if (this.linkOk(x, y.c)) u += y.w;
    }
    return Math.min(u, 30);
  }

  private siteOk(x: number, uid: string): boolean {
    const g = this.g!;
    if (!g.valid[x] || !g.pass[x] || !g.bld[x] || g.dead[x]) return false;
    if (this.needles.has(x) || this.claims.has(x) || this.isBanned(x)) return false;
    for (const s of this.seats) if (g.dist(s, x) <= 2) return false;
    if (!this.postDawn && !this.mercy && this.isInside(x)) return false;
    if (this.occFoe.has(x)) return false;
    const own = this.occOwn.get(x);
    if (own !== undefined && own !== uid) return false;
    return true;
  }

  /* ---------------------------------------------------------- opening */

  /* a cache a Klinok reaches first is worth more than an early Tkach */
  private openingCheck(): void {
    if (this.openingChecked || this.hearth < 0) return;
    this.openingChecked = true;
    if (this.P.klinok <= 0 || this.t > 3) return;
    const g = this.g!;
    const D = this.dijk(this.hearth, this.C.stepKlinok, 60);
    let best = -1;
    let bestEta = Infinity;
    for (const f of this.finds) {
      if (f.kind !== 'cache' || f.taken) continue;
      const eta = D[f.c]!;
      if (!(eta <= 28)) continue;
      let foeD = 99;
      for (const h of this.foeHearths) foeD = Math.min(foeD, g.dist(h, f.c));
      if (eta > foeD * 1.15) continue;
      if (eta < bestEta) {
        bestEta = eta;
        best = f.c;
      }
    }
    this.openCache = best;
  }

  /* ---------------------------------------------------------- defence */

  private defend(B: Budget): void {
    if (!this.threats.length) return;
    const g = this.g!;
    const kls = this.units.filter((u) => u.cls === KL);
    if (!kls.length) return;
    const taken = new Set<string>();
    const busy = new Set<string>();
    for (const u of kls) {
      const a = this.umem.get(u.id)?.a;
      if (a && a.kind === 'ram') taken.add(a.tgt);
    }
    for (const th of this.threats) {
      if (taken.has(th.f.id) || (this.ramBan.get(th.f.id) ?? -1) > this.t) continue;
      const maxEta = th.s >= 95 ? 40 : th.s >= 75 ? 34 : th.s >= 65 ? 26 : th.s >= 44 ? 18 : th.s >= 30 ? 10 : 7;
      let best: MineUnit | null = null;
      let bestEta = Infinity;
      for (const u of kls) {
        if (busy.has(u.id) || !canCmd(u)) continue;
        const cur = this.umem.get(u.id)?.a ?? null;
        if (cur && cur.prio >= th.s) continue;
        const uc = this.cellOf(u);
        let eta = Infinity;
        if (g.dist(uc, th.c) <= 1) {
          eta = 0;
        } else {
          const D = this.dijk(uc, this.C.stepKlinok, 60);
          for (let k = 0; k < 6; k++) {
            const x = g.nb[th.c * 6 + k]!;
            if (x >= 0) eta = Math.min(eta, D[x]!);
          }
        }
        if (eta <= maxEta && eta < bestEta) {
          bestEta = eta;
          best = u;
        }
      }
      if (!best) continue;
      const m = this.umem.get(best.id);
      if (!m) continue;
      const a = this.mk('ram', th.c, th.s);
      a.tgt = th.f.id;
      m.a = a;
      busy.add(best.id);
      taken.add(th.f.id);
      this.issue(best, a, B, true);
    }
  }

  /* ---------------------------------------------------------- yard */

  private desiredK(): number {
    if (this.P.klinok <= 0) return 0;
    const t = this.t;
    let k = 0;
    if ((this.nT >= this.P.tkach || t >= 220) && (t >= 110 || this.threatRecent(150))) k = 1;
    if (this.nT >= this.P.tkach && (this.threatRecent(220) || t >= 380)) k = 2;
    if (this.openCache >= 0) k = Math.max(k, 1);
    if ((this.postDawn && !this.threatRecent(60)) || t > this.tEnd - 150) k = Math.min(k, this.nK);
    return Math.min(k, this.P.klinok);
  }

  private unitReserve(): number {
    const C = this.C;
    if (this.t > this.tEnd - 100) return 0;
    if (this.nT < this.P.tkach && this.weight + C.weightTkach <= C.squadWeight) return C.costTkach;
    if (this.nK < this.desiredK() && this.weight + C.weightKlinok <= C.squadWeight) return C.costKlinok;
    return 0;
  }

  private yard(B: Budget): void {
    if (this.hearth < 0) return;
    const t = this.t;
    const C = this.C;
    if (t > this.tEnd - 90) return;
    if (t - this.yardAskT < (this.gotFeedback ? 1 : 6)) return;
    const e = this.energy - this.bidReserve();
    const room = C.squadWeight - this.weight;
    let cls: ClsName | null = null;
    const jammed = t - this.jamPressureAt <= 30 && this.nK === 0 && this.P.klinok > 0;
    if (jammed) {
      /* a jammer cuts the whole network behind it: a Klinok first */
      if (e >= C.costKlinok && room >= C.weightKlinok) cls = KL;
      else return;
    } else if (this.openCache >= 0 && this.nK === 0 && t < 30) {
      if (e >= C.costKlinok && room >= C.weightKlinok) cls = KL;
      else return;
    } else if (this.nT < this.P.tkach && room >= C.weightTkach && t < this.tEnd - 100) {
      if (e >= C.costTkach) cls = TK;
      else if (this.threatRecent(30) && this.nK === 0 && this.nT >= 2 && e >= C.costKlinok && room >= C.weightKlinok && this.P.klinok > 0) cls = KL;
    } else if (this.nK < this.desiredK() && room >= C.weightKlinok && e >= C.costKlinok) {
      cls = KL;
    }
    if (!cls) return;
    const cost = C.chanOrder * this.stormMult(this.hearth);
    if (!B.can(cost, 0, this.threatRecent(20))) return;
    B.push({ kind: 'yard', cls }, cost, 0, NOMETA);
    this.yardAskT = t;
  }

  /* ---------------------------------------------------------- Tkachs */

  private planTkachs(B: Budget): void {
    const canBuild = this.energy + this.income * 20 - this.reservedBuild - this.unitReserve() >= this.C.costNeedle;
    this.buildTrigger = canBuild && !this.canBuildBefore;
    this.canBuildBefore = canBuild;
    let plans = 0;
    for (const u of this.units) {
      if (u.cls !== TK || plans >= 3) continue;
      if (!canCmd(u)) continue;
      const m = this.umem.get(u.id);
      if (!m) continue;
      const a = m.a;
      const c = this.cellOf(u);
      /* leash: come back into the comms zone before freezing */
      if (u.away >= this.C.autonomy - 10 && !(a && (a.kind === 'heat' || a.kind === 'build') && c === a.cell) && !(a && a.sub === 'home')) {
        const home = this.nearestHome(u);
        if (home >= 0) {
          const h = this.mk('goto', home, 50);
          h.sub = 'home';
          m.a = h;
          this.issue(u, h, B, true);
          continue;
        }
      }
      let replan = !a;
      if (a && a.kind === 'feed' && (this.t - a.since >= 15 || this.buildTrigger)) replan = true;
      if (!replan) continue;
      plans++;
      const best = this.bestTkach(u, a, B);
      if (!best) {
        if (a && a.kind !== 'feed') m.a = null;
        continue;
      }
      if (a && a.kind === 'feed' && best.kind === 'feed' && (best.cell === a.cell || best.score < a.score * 1.3)) {
        a.since = this.t;
        continue;
      }
      m.a = best;
      this.addClaim(best);
      this.issue(u, best, B, false);
    }
  }

  private nearestHome(u: MineUnit): number {
    const g = this.g!;
    const c = this.cellOf(u);
    let best = -1;
    let bd = Infinity;
    for (const x of this.ownLit) {
      const occ = this.occOwn.get(x);
      if (occ !== undefined && occ !== u.id) continue;
      const d = g.dist(c, x);
      if (d < bd) {
        bd = d;
        best = x;
      }
    }
    return best;
  }

  /* the best job for a Tkach, by minutes gained per tick of its time */
  private bestTkach(u: MineUnit, cur: Assign | null, B: Budget): Assign | null {
    const g = this.g!;
    const C = this.C;
    const t = this.t;
    const me = this.slot;
    const mr = C.minuteRate;
    const c0 = this.cellOf(u);
    if (c0 < 0) return null;
    const D = this.dijk(c0, C.stepTkach, 160);
    const lit8 = this.litCount + this.claims.size < 8;
    const eb = lit8 ? 0.005 : 0.0012;
    const k = this.contract;
    const pick = { a: null as Assign | null, s: 0 };
    const offer = (a: Assign, s: number): void => {
      if (s > pick.s) {
        pick.s = s;
        a.score = s;
        pick.a = a;
      }
    };

    /* 1. heating: ruins, enemy needles, the ring after dawn */
    for (const n of this.needles.values()) {
      const c = n.c;
      if (n.start || n.owner === me || this.isPartner(n.owner)) continue;
      if (this.isBanned(c) || this.claims.has(c) || this.occFoe.has(c)) continue;
      const oc = this.occOwn.get(c);
      if (oc !== undefined && oc !== u.id) continue;
      if (this.isInside(c) && !this.postDawn && !this.mercy) continue;
      const isContract = !!(k && k.feasible && k.cells.includes(c));
      let remove = 0;
      let enemy = false;
      if (n.owner === 'K') {
        if (!this.postDawn) continue;
      } else if (n.owner !== null) {
        if (!this.P.heatEnemy && !isContract) continue;
        enemy = true;
        remove = n.dark ? 0 : n.ring ? this.ringMult() : 1;
      }
      const work = this.heatPrice(n);
      const eta = D[c]!;
      if (!(eta < 90)) continue;
      if (n.grace > t + eta + 2) continue;
      const Rm = this.tEnd - (t + eta + work);
      if (Rm <= 0) continue;
      const linked = this.linkable(c);
      if (!linked && !this.nearAnchors(c, C.linkRange * 2)) continue;
      const mult = n.ring ? this.ringMult() : 1;
      const gv = this.gain(c, this.baseW, mult, remove);
      const loss = this.lastLoss;
      let V = gv * mr * Rm + eb * Rm;
      if (!linked) V *= 0.3;
      V += this.bridgeU(c);
      if (isContract && linked && k) V += k.per;
      if (enemy) V = V * 0.6 + loss * mr * Rm * 0.35;
      const a = this.mk('heat', c, 10);
      a.linked = linked;
      a.sub = n.owner === null ? 'ruin' : 'foe';
      offer(a, V / (eta + work + 4));
    }

    /* 2. building with spare energy */
    const avail0 = this.energy - this.reservedBuild - this.unitReserve() - this.bidReserve();
    if (avail0 + this.income * 20 >= C.costNeedle && t < this.tEnd - C.buildTicks - 2) {
      const st = ++this.stampN;
      const n6 = offCount(C.linkRange + 1);
      const pen = this.energy >= C.energyCap * 0.8 ? 0 : 2.5;
      /* energy that would only pile up is worth spending on thin sites too */
      const minGain = this.energy >= C.energyCap * 0.55 || t > this.tEnd - 120 ? 1.5 : 6;
      for (const an of this.anchors) {
        const q0 = g.qq[an]!;
        const r0 = g.rr[an]!;
        for (let i = 1; i < n6; i++) {
          const of = OFFS[i]!;
          const x = g.idx(q0 + of.dq, r0 + of.dr);
          if (x < 0 || this.stamp[x] === st) continue;
          this.stamp[x] = st;
          if (!this.siteOk(x, u.id)) continue;
          const eta = D[x]!;
          if (!(eta < 70)) continue;
          if (avail0 + this.income * Math.min(eta, 20) < C.costNeedle) continue;
          const Rm = this.tEnd - (t + eta + C.buildTicks);
          if (Rm <= 0) continue;
          if (!this.linkable(x)) continue;
          const gv = this.gain(x, this.baseW, 1, 0);
          if (gv <= minGain) continue;
          const V = gv * mr * Rm + eb * Rm + this.bridgeU(x) - pen;
          if (V <= 0) continue;
          const a = this.mk('build', x, 10);
          a.linked = true;
          offer(a, V / (eta + C.buildTicks + 4));
        }
      }
    }

    /* 3. before dawn: stand next to a linkable ring needle */
    if (!this.postDawn && t >= this.dawnAt - 30) {
      for (const n of this.needles.values()) {
        if (!n.ring || n.owner === me || this.claims.has(n.c) || this.isBanned(n.c)) continue;
        if (n.owner !== 'K' && n.owner !== null) continue;
        if (!this.linkable(n.c)) continue;
        let sc = -1;
        let se = Infinity;
        for (let i = 0; i < 6; i++) {
          const x = g.nb[n.c * 6 + i]!;
          if (x < 0 || !g.pass[x] || this.needles.has(x) || this.occFoe.has(x)) continue;
          const oc = this.occOwn.get(x);
          if (oc !== undefined && oc !== u.id) continue;
          const e = D[x]! + (this.isInside(x) ? 1 : 0);
          if (e < se) {
            se = e;
            sc = x;
          }
        }
        if (sc < 0 || !(se < 60)) continue;
        const Rm = this.tEnd - Math.max(this.dawnAt, t + se) - C.heatNeedle;
        if (Rm <= 0) continue;
        const gv = this.gain(n.c, this.baseW, C.dawnRing, 0) * 1.25;
        const V = gv * mr * Rm * 0.85;
        const work = Math.max(0, this.dawnAt - t - se) + C.heatNeedle;
        const a = this.mk('goto', sc, 10);
        a.sub = 'stage';
        a.ref = n.c;
        a.linked = true;
        offer(a, V / (se + work + 4));
      }
    }

    /* 4. a cache within a short walk */
    if (this.energy < C.energyCap - 60) {
      for (const f of this.finds) {
        if (f.taken || f.kind !== 'cache' || this.isBanned(f.c) || this.fetchTaken(f.c, u.id)) continue;
        const eta = D[f.c]!;
        if (!(eta <= 16)) continue;
        const a = this.mk('goto', f.c, 10);
        a.sub = 'fetch';
        offer(a, this.cacheValue(eta) / (eta + 4));
      }
    }

    /* 5. feeding, while the channel has room for the hands */
    const room = B.spare() >= C.chanTick + C.chanOrder || (cur !== null && cur.kind === 'feed');
    if (room) {
      const o = this.obs!;
      for (const n of o.mine.needles) {
        if (n.dark || n.weight <= 0) continue;
        const c = g.idx(n.q, n.r);
        if (c < 0) continue;
        const occ = this.occOwn.get(c);
        if ((occ !== undefined && occ !== u.id) || this.occFoe.has(c)) continue;
        if (this.feedTaken(c, u.id)) continue;
        const fedNow = !!(cur && cur.kind === 'feed' && cur.cell === c && n.fed);
        if (n.fed && !fedNow) continue;
        const eta = D[c]!;
        if (!(eta < 60) || this.tEnd - t < eta + 4) continue;
        const info = this.needles.get(c);
        const mult = (info && info.ring ? this.ringMult() : 1) * n.weight;
        const gv = this.feedGain(c, mult, fedNow);
        if (gv <= 0.5) continue;
        const a = this.mk('feed', c, 5);
        offer(a, (gv * mr * 60) / (eta + 60));
      }
    }
    return pick.a;
  }

  private cacheValue(eta: number): number {
    const C = this.C;
    const room = Math.max(0, Math.min(1, (C.energyCap - this.energy) / 150));
    return (150 / C.costNeedle) * 0.018 * Math.max(0, this.tEnd - this.t - eta - 80) * 0.7 * room;
  }

  private fetchTaken(c: number, uid: string): boolean {
    for (const m of this.umem.values()) if (m.id !== uid && m.a && m.a.kind === 'goto' && m.a.sub === 'fetch' && m.a.cell === c) return true;
    return false;
  }

  private feedTaken(c: number, uid: string): boolean {
    for (const m of this.umem.values()) if (m.id !== uid && m.a && m.a.kind === 'feed' && m.a.cell === c) return true;
    return false;
  }

  /* ---------------------------------------------------------- Klinoks */

  private planKlinoks(B: Budget): void {
    const g = this.g!;
    const C = this.C;
    const kls = this.units.filter((u) => u.cls === KL);
    if (!kls.length) return;
    let jammers = 0;
    for (const u of kls) {
      const a = this.umem.get(u.id)?.a;
      if (a && a.kind === 'jam') jammers++;
    }
    const guards = this.guardCells();
    let gi = 0;
    for (const u of kls) {
      const m = this.umem.get(u.id);
      if (!m) continue;
      const myGuard = guards.length ? guards[gi % guards.length]! : -1;
      gi++;
      if (!canCmd(u)) continue;
      const a = m.a;
      if (a && !(a.kind === 'goto' && a.sub === 'park')) continue;
      const c0 = this.cellOf(u);
      const D = this.dijk(c0, C.stepKlinok, 90);
      let choice: Assign | null = null;
      let cs = 0;
      /* finds */
      for (const f of this.finds) {
        if (f.taken || (f.kind !== 'cache' && f.kind !== 'flare') || this.isBanned(f.c) || this.fetchTaken(f.c, u.id)) continue;
        const cache = f.kind === 'cache';
        if (cache && this.energy >= C.energyCap - 40) continue;
        const eta = D[f.c]!;
        if (!(eta <= (cache ? 36 : 12))) continue;
        const s = (cache ? 150 : 15) / (eta + 6);
        if (s > cs) {
          cs = s;
          choice = this.mk('goto', f.c, 30);
          choice.sub = 'fetch';
        }
      }
      /* raid: jam for loot and cuts */
      if (!choice && this.P.raid && jammers < this.P.jammers && this.t >= 90 && this.t < this.tEnd - 15 && B.spare() >= C.chanTick + C.jamKeep + C.jamStart) {
        const j = this.pickJam(u, D);
        if (j) {
          choice = j;
          jammers++;
        }
      }
      /* guard post */
      if (!choice && myGuard >= 0 && g.dist(c0, myGuard) > 2 && !(a && g.dist(a.cell, myGuard) <= 2)) {
        choice = this.mk('goto', myGuard, 1);
        choice.sub = 'park';
      }
      if (!choice) continue;
      m.a = choice;
      this.issue(u, choice, B, false);
    }
  }

  private pickJam(u: MineUnit, D: Float64Array): Assign | null {
    const g = this.g!;
    const me = this.slot;
    let best: Assign | null = null;
    let bs = 0;
    for (const n of this.needles.values()) {
      if (n.start || n.owner === null || n.owner === me || n.owner === '?' || this.isPartner(n.owner)) continue;
      const keeper = n.owner === 'K';
      if (keeper && (this.postDawn || this.t > this.dawnAt - 25)) continue;
      if (n.dark && !this.myJams.has(n.c)) continue;
      if (!keeper && this.t - n.seen > 150) continue;
      if (this.isBanned(n.c) || this.jamTaken(n.c, u.id)) continue;
      let cell = -1;
      let eta = Infinity;
      for (let i = 0; i < 6; i++) {
        const x = g.nb[n.c * 6 + i]!;
        if (x < 0 || !g.pass[x] || this.needles.has(x) || this.occFoe.has(x)) continue;
        const oc = this.occOwn.get(x);
        if (oc !== undefined && oc !== u.id) continue;
        if (this.isInside(x) && !this.postDawn) continue;
        const e = D[x]!;
        if (e < eta) {
          eta = e;
          cell = x;
        }
      }
      if (cell < 0 || !(eta <= 45)) continue;
      const mult = n.ring ? this.ringMult() : 1;
      const gv = this.gain(n.c, this.baseW, mult, mult);
      const loss = this.lastLoss;
      const cut = keeper ? 0 : this.cutValue(n);
      const val = (gv + loss * 0.6 + cut * 0.5) * (n.owner === this.leader ? 1.3 : 1) * (keeper ? 0.6 : 1);
      const s = val / (eta + 20);
      if (s > bs) {
        bs = s;
        best = this.mk('jam', cell, 20);
        best.ref = n.c;
      }
    }
    return bs >= 0.25 ? best : null;
  }

  /* what an enemy loses behind a needle: the coverage of its known needles that
     no longer reach its hearth or starting needles when this one is jammed */
  private cutValue(x: NInfo): number {
    const g = this.g!;
    const ow = x.owner;
    if (ow === null || ow === 'K' || ow === 'E' || ow === '?') return 0;
    const nodes: number[] = [];
    const roots: number[] = [];
    for (const n of this.needles.values()) {
      if (n.owner !== ow) continue;
      if (n.start) {
        roots.push(n.c);
        for (const s of this.seats) if (g.dist(s, n.c) === 1 && !roots.includes(s)) roots.push(s);
      } else if (!n.dark && n.c !== x.c) {
        nodes.push(n.c);
      }
    }
    if (!roots.length || !nodes.length) return 0;
    const reach = (skip: number): Set<number> => {
      const seen = new Set<number>();
      const queue = roots.slice();
      while (queue.length) {
        const a = queue.pop()!;
        for (const b of nodes) {
          if (b === skip || seen.has(b)) continue;
          if (g.dist(a, b) <= this.C.linkRange + 1 && this.linkOk(a, b)) {
            seen.add(b);
            queue.push(b);
          }
        }
      }
      return seen;
    };
    nodes.push(x.c);
    const all = reach(-1);
    if (!all.has(x.c)) return 0;
    const without = reach(x.c);
    let v = 0;
    for (const c of all) {
      if (c === x.c || without.has(c)) continue;
      for (let i = 0; i < offCount(this.baseW.length - 1); i++) {
        const of = OFFS[i]!;
        const y = g.idx(g.qq[c]! + of.dq, g.rr[c]! + of.dr);
        if (y >= 0) v += g.val[y]! * (this.baseW[of.d] ?? 0);
      }
    }
    return v;
  }

  private jamTaken(c: number, uid: string): boolean {
    for (const m of this.umem.values()) if (m.id !== uid && m.a && m.a.kind === 'jam' && m.a.ref === c) return true;
    return false;
  }

  /* two posts: the centre of the network and its edge nearest an enemy hearth */
  private guardCells(): number[] {
    const g = this.g!;
    if (this.hearth < 0) return [];
    const src = this.ownLit.length ? this.ownLit : [this.hearth];
    let sq = 0;
    let sr = 0;
    for (const c of src) {
      sq += g.qq[c]!;
      sr += g.rr[c]!;
    }
    const ci = g.idx(Math.round(sq / src.length), Math.round(sr / src.length));
    const centre = ci >= 0 ? ci : this.hearth;
    const hearth = this.hearth;
    const free = (x: number): boolean => {
      if (x < 0 || !g.pass[x] || this.needles.has(x) || this.occFoe.has(x)) return false;
      return g.dist(x, hearth) >= 2;
    };
    const nearestFree = (c: number, avoid: number): number => {
      let best = -1;
      let bd = Infinity;
      const q0 = g.qq[c]!;
      const r0 = g.rr[c]!;
      for (let i = 0; i < offCount(4); i++) {
        const of = OFFS[i]!;
        const x = g.idx(q0 + of.dq, r0 + of.dr);
        if (!free(x) || x === avoid) continue;
        const d = of.d * 10 + g.dist(x, hearth);
        if (d < bd) {
          bd = d;
          best = x;
        }
      }
      return best;
    };
    const out: number[] = [];
    const a = nearestFree(centre, -1);
    if (a >= 0) out.push(a);
    let front = -1;
    let fd = Infinity;
    for (const c of this.ownLit) {
      for (const h of this.foeHearths) {
        const d = g.dist(c, h);
        if (d < fd) {
          fd = d;
          front = c;
        }
      }
    }
    if (front >= 0) {
      const b = nearestFree(front, a);
      if (b >= 0 && b !== a) out.push(b);
    }
    return out;
  }

  /* an idle unit on the hearth blocks the yard exit and the traffic around it */
  private clearHearth(B: Budget): void {
    const g = this.g!;
    const h = this.hearth;
    if (h < 0) return;
    for (const u of this.units) {
      const m = this.umem.get(u.id);
      if (!m || m.a || !canCmd(u) || this.cellOf(u) !== h) continue;
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < offCount(3); i++) {
        const of = OFFS[i]!;
        if (of.d !== 2 && of.d !== 3) continue;
        const x = g.idx(g.qq[h]! + of.dq, g.rr[h]! + of.dr);
        if (x < 0 || !g.pass[x] || this.needles.has(x) || this.occOwn.has(x) || this.occFoe.has(x)) continue;
        const d = of.d * 100 + (this.citadel >= 0 ? g.dist(x, this.citadel) : 0);
        if (d < bd) {
          bd = d;
          best = x;
        }
      }
      if (best < 0) continue;
      const a = this.mk('goto', best, 0);
      a.sub = 'clear';
      m.a = a;
      this.issue(u, a, B, false);
    }
  }

  /* ---------------------------------------------------------- bidding (second price) */

  private lotBid(i: number): number {
    const L = this.lots[i];
    if (!L || L.at <= this.t || this.postDawn || L.at >= this.dawnAt) return 0;
    const mr = this.C.minuteRate;
    const free = L.cells.filter((c) => {
      const n = this.needles.get(c);
      return !!n && n.owner === null && !this.claims.has(c);
    });
    if (!free.length) return 0;
    let V = 0;
    let k = 0;
    for (const c of free) {
      let linked = this.linkable(c);
      if (!linked) for (const x of free) if (x !== c && this.linkable(x) && this.linkOk(x, c)) linked = true;
      if (!linked) continue;
      V += this.gain(c, this.baseW, 1, 0) * mr * Math.max(0, this.tEnd - L.at);
      k++;
    }
    if (!k) return 0;
    const needleV = 0.02 * Math.max(1, this.tEnd - L.at);
    let amt = Math.floor(((this.C.costNeedle * V) / needleV) * 1.1);
    amt = Math.min(amt, this.C.costNeedle * k + 50);
    amt = Math.min(amt, Math.floor(this.energy) - this.reservedBuild - 4);
    if (amt % 2 === 0) amt -= 1;
    return amt > this.C.costNeedle ? amt : 0;
  }

  private lotBidCached(i: number): number {
    const h = this.bidCache.get(i);
    if (h && h.t === this.t) return h.v;
    const v = this.lotBid(i);
    this.bidCache.set(i, { t: this.t, v });
    return v;
  }

  private bidReserve(): number {
    let r = 0;
    for (let i = 0; i < this.lots.length; i++) {
      const L = this.lots[i]!;
      const dt = L.at - this.t;
      if (dt > 0 && dt <= 6) r = Math.max(r, this.lotBidCached(i));
    }
    return r;
  }

  private bid(B: Budget): void {
    if (this.postDawn || this.hearth < 0) return;
    for (let i = 0; i < this.lots.length; i++) {
      const L = this.lots[i]!;
      const dt = L.at - this.t;
      if (dt !== 1 && dt !== 2) continue;
      const amt = this.lotBidCached(i);
      if (amt <= this.C.costNeedle) continue;
      const cost = this.C.chanOrder * this.stormMult(this.hearth);
      if (!B.can(cost, 0, false)) continue;
      B.push({ kind: 'bid', lot: i, amount: amt }, cost, 0, NOMETA);
    }
  }

  /* ---------------------------------------------------------- scan (ears only) */

  private scan(B: Budget): void {
    const o = this.obs!;
    if (!B.room()) return;
    const g = this.g!;
    const t = this.t;
    const pick = { c: -1, w: 0 };
    const consider = (c: number, w: number): void => {
      if (c < 0) return;
      if (t - (this.lastScan.get(c) ?? -100) < 15) return;
      if (w > pick.w) {
        pick.w = w;
        pick.c = c;
      }
    };
    for (const u of this.units) {
      const a = this.umem.get(u.id)?.a;
      if (!a) continue;
      let c = -1;
      if (a.kind === 'heat' || a.kind === 'build') c = a.cell;
      else if (a.kind === 'goto' && a.sub === 'stage') c = a.ref;
      else if (a.kind === 'jam') c = a.ref;
      if (c < 0) continue;
      const n = this.needles.get(c);
      const age = n ? t - n.seen : 60;
      if (g.dist(this.cellOf(u), c) > 3 && age > 20) consider(c, 10 + Math.min(10, age / 10));
    }
    const k = this.contract;
    if (k) {
      for (const c of k.cells) {
        const n = this.needles.get(c);
        if (n && t - n.seen > 25) consider(c, 8);
      }
    }
    for (const n of this.needles.values()) {
      if (n.start) continue;
      const age = t - n.seen;
      if (n.owner === null && age > 60 && this.nearAnchors(n.c, 9)) consider(n.c, 3 + Math.min(5, age / 60));
      else if (n.ring && t >= this.dawnAt - 40 && t <= this.dawnAt + 40 && age > 15 && this.nearAnchors(n.c, 9)) consider(n.c, 6);
      else if (n.owner !== null && n.owner !== this.slot && n.owner !== 'K' && age > 80 && this.nearAnchors(n.c, 12)) consider(n.c, 2);
    }
    const best = pick.c;
    if (best < 0) return;
    const cost = this.flares > 0 ? 0 : this.C.scanCost * this.stormMult(best);
    if (o.pulse.ear < Math.max(32, cost + 8)) return;
    const h = g.hex(best);
    B.push({ kind: 'scan', q: h.q, r: h.r, rad: Math.max(0, Math.min(3, Math.round(this.C.scanRad))) }, 0, 0, NOMETA);
    this.lastScan.set(best, t);
    if (this.flares > 0) this.flares--;
  }

  /* ---------------------------------------------------------- idle hands, the slot */

  private halts(B: Budget): void {
    for (const u of this.units) {
      const m = this.umem.get(u.id);
      if (!m || m.a) continue;
      if (!canCmd(u) || !u.task || u.task.home) continue;
      if (!this.isActing(u)) continue;
      if (!B.can(0, 0, true)) return;
      B.push({ kind: 'halt', unit: u.id }, 0, -1, NOMETA);
    }
  }

  /* the nakaz takes the slot after 6 silent ticks: hold it with a free command */
  private keepalive(B: Budget): void {
    const quiet = this.t - (this.gotFeedback ? this.lastAccepted : this.lastSent);
    if (quiet < 3) return;
    if (B.orders.some((o) => o.kind === 'halt')) return;
    for (const u of this.units) {
      if (u.task || !canCmd(u)) continue;
      if (B.can(0, 0, true)) {
        B.push({ kind: 'halt', unit: u.id }, 0, 0, NOMETA);
        return;
      }
    }
    for (const u of this.units) {
      if (u.cls !== KL) continue;
      const a = this.umem.get(u.id)?.a;
      if ((a && a.kind === 'jam') || (u.task && u.task.jam)) continue;
      if (B.can(0, 0, true)) {
        B.push({ kind: 'jam', unit: u.id, target: null, hold: false }, 0, 0, NOMETA);
        return;
      }
    }
    if (this.hearth >= 0 && B.room()) {
      const cost = this.C.chanOrder * this.stormMult(this.hearth);
      if (B.chan >= cost) {
        const h = this.g!.hex(this.hearth);
        B.push({ kind: 'watch', q: h.q, r: h.r, keep: 0 }, cost, 0, NOMETA);
      }
    }
  }
}

/* names of this head's presets: the preset-change service handle uses them */
export function presets(): string[] {
  return Object.keys(PRESETS);
}

export function createStrategy(preset?: string): Strategy {
  const named = preset !== undefined && Object.prototype.hasOwnProperty.call(PRESETS, preset) ? PRESETS[preset] : undefined;
  return new ZoriaBot(named ?? PRESETS[DEFAULT_PRESET] ?? { tkach: 3, klinok: 2, raid: false, heatEnemy: false, jammers: 0 });
}
