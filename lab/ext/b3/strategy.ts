/* zoria :: strategy "Zoria-Tkach"
   Plan (rules 01-rules.md):
   - the score is minutes of covered cells; income per cell is capped at pull 1,
     so the goal is to light many distinct valuable cells as early as possible;
   - opening: one Tkach at tick 1, then Tkachs up to three; free ruins within thread
     reach are taken by rate (marginal income + energy cap of 8 needles + contract
     + race against the opponents); caches (+150 energy) when the race is won;
   - after the ruins: needles are built on the best marginal-gain cells within thread
     reach (lattice -> cycles -> crown); idle Tkachs feed needles;
   - lots are bought with second-price bids valued from the marginal gain; the
     energy is held back shortly before each reveal;
   - a guard Klinok rams enemy Tkachs on our needles (clean ram) and enemy jammers;
     a second Klinok jams lit enemy needles that overlap our zone (jam = loot);
   - enemy needles are heated when the swing is worth the ticks;
   - dawn: Tkachs are staged just outside the line, then the ring is taken (8 ticks
     each, pull x2); chains of needles toward the centre are valued for that.
   No randomness, no clocks; every module is guarded: tick() always returns a frame. */

import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import type { BeliefFrame } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, orderCap, orderCost, orderScale } from '@zoria/protocol';
import type { ChannelCfg, ClsName, Manifest, MineUnit, Observe, Order, SlotName, WireBot } from '@zoria/protocol';

export interface Strategy extends WireBot {
  /* belief diary frame for the tick; null - there is no frame */
  belief(obs: Observe | null): BeliefFrame | null;
}

const TK: ClsName = 'ткач';
const KL: ClsName = 'клинок';
const INF = 1e9;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const TERRAIN_VALUE = [2, 3, 2, 1, 1, 1, 0, 0];

interface Params {
  wantT: number;
  wantKLate: number;
  raid: boolean;
  attack: boolean;
  bidScale: number;
}

const PRESETS: Record<string, Params> = {
  zoria: { wantT: 3, wantKLate: 2, raid: true, attack: true, bidScale: 1 },
  'zoria-mirnyi': { wantT: 3, wantKLate: 1, raid: false, attack: true, bidScale: 1 },
  'zoria-torgi': { wantT: 3, wantKLate: 2, raid: true, attack: true, bidScale: 1.25 },
};

export function presets(): string[] {
  return Object.keys(PRESETS);
}

/* ------------------------------------------------------------------ grid */

function hexDist(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

class Grid {
  readonly R: number;
  readonly W: number;
  readonly N: number;
  readonly cq: Int16Array;
  readonly cr: Int16Array;
  readonly look: Int32Array;
  readonly ter: Uint8Array;
  readonly lvl: Int8Array;
  readonly val: Float64Array;
  readonly pass: Uint8Array;
  readonly build: Uint8Array;
  readonly hill: Uint8Array;
  readonly mount: Uint8Array;
  readonly nb: Int32Array;
  readonly cov: Int32Array[];
  readonly covD: Uint8Array[];
  readonly stepMult: number[];

  constructor(m: Manifest) {
    const n = m.levels.length;
    let R = 19;
    for (let k = 1; k < 40; k++) {
      if (3 * k * (k + 1) + 1 === n) {
        R = k;
        break;
      }
    }
    this.R = R;
    const W = 2 * R + 1;
    this.W = W;
    this.look = new Int32Array(W * W).fill(-1);
    const qs: number[] = [];
    const rs: number[] = [];
    for (let r = -R; r <= R; r++) {
      for (let q = Math.max(-R, -R - r); q <= Math.min(R, R - r); q++) {
        this.look[(r + R) * W + (q + R)] = qs.length;
        qs.push(q);
        rs.push(r);
      }
    }
    const N = qs.length;
    this.N = N;
    this.cq = Int16Array.from(qs);
    this.cr = Int16Array.from(rs);
    this.ter = new Uint8Array(N);
    this.lvl = new Int8Array(N);
    this.val = new Float64Array(N);
    this.pass = new Uint8Array(N);
    this.build = new Uint8Array(N);
    this.hill = new Uint8Array(N);
    this.mount = new Uint8Array(N);
    this.nb = new Int32Array(N * 6).fill(-1);
    for (const c of m.terrain.cells) {
      const i = this.idx(c[0], c[1]);
      if (i >= 0) this.ter[i] = c[2];
    }
    const types = m.terrain.types;
    const useMin = types.some((x) => x.min > 0);
    this.stepMult = types.map((x) => (x.cost > 0 ? x.cost : 1));
    for (let i = 0; i < N; i++) {
      this.lvl[i] = m.levels[i] ?? 0;
      const tt = this.ter[i]!;
      const ty = types[tt];
      this.val[i] = useMin ? (ty ? ty.min : 0) : (TERRAIN_VALUE[tt] ?? 0);
      this.pass[i] = ty && ty.pass ? 1 : 0;
      this.build[i] = ty && ty.build ? 1 : 0;
      this.hill[i] = ty && ty.reach ? 1 : 0;
      this.mount[i] = ty && ty.block ? 1 : 0;
    }
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 6; d++) {
        const dir = DIRS[d]!;
        this.nb[i * 6 + d] = this.idx(this.cq[i]! + dir[0], this.cr[i]! + dir[1]);
      }
    }
    this.cov = [];
    this.covD = [];
    for (let i = 0; i < N; i++) {
      const li: number[] = [];
      const ld: number[] = [];
      const q0 = this.cq[i]!;
      const r0 = this.cr[i]!;
      for (let dq = -4; dq <= 4; dq++) {
        for (let dr = Math.max(-4, -4 - dq); dr <= Math.min(4, 4 - dq); dr++) {
          const j = this.idx(q0 + dq, r0 + dr);
          if (j >= 0) {
            li.push(j);
            ld.push((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2);
          }
        }
      }
      this.cov.push(Int32Array.from(li));
      this.covD.push(Uint8Array.from(ld));
    }
  }

  idx(q: number, r: number): number {
    const a = q + this.R;
    const b = r + this.R;
    if (a < 0 || b < 0 || a >= this.W || b >= this.W) return -1;
    return this.look[b * this.W + a]!;
  }

  hd(i: number, j: number): number {
    return hexDist(this.cq[i]!, this.cr[i]!, this.cq[j]!, this.cr[j]!);
  }
}

function dijkstra(g: Grid, src: number, step: Uint8Array, prev?: Int32Array): Int32Array {
  const dist = new Int32Array(g.N).fill(INF);
  if (prev) prev.fill(-1);
  const heap: number[] = [];
  const push = (x: number): void => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]! <= heap[i]!) break;
      const tmp = heap[p]!;
      heap[p] = heap[i]!;
      heap[i] = tmp;
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      const n = heap.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && heap[l]! < heap[m]!) m = l;
        if (r < n && heap[r]! < heap[m]!) m = r;
        if (m === i) break;
        const tmp = heap[m]!;
        heap[m] = heap[i]!;
        heap[i] = tmp;
        i = m;
      }
    }
    return top;
  };
  dist[src] = 0;
  push(src);
  while (heap.length > 0) {
    const top = pop();
    const d = Math.floor(top / 2048);
    const u = top - d * 2048;
    if (d > dist[u]!) continue;
    for (let k = 0; k < 6; k++) {
      const j = g.nb[u * 6 + k]!;
      if (j < 0) continue;
      const s = step[u * 6 + k]!;
      if (s === 0) continue;
      const nd = d + s;
      if (nd < dist[j]!) {
        dist[j] = nd;
        if (prev) prev[j] = u;
        push(nd * 2048 + j);
      }
    }
  }
  return dist;
}

/* my share of a cell's income: pull p against the others' pull o */
function share(p: number, o: number): number {
  if (p <= 0) return 0;
  const s = p + o;
  return s <= 1 ? p : p / s;
}

/* ------------------------------------------------------------------ bot */

interface Cmd {
  o: Order;
  pr: number;
  cost: number;
  unit: string | null;
  seq: number;
}

interface Ctx {
  t: number;
  obs: Observe;
  chan: number;
  cap: number;
  cmdCost: number;
  nCmd: number;
  acting: Set<string>;
  energy: number;
  reserve: number;
  committed: number;
  litCount: number;
  nodes: number[];
  assigned: Set<number>;
  ramBusy: Set<string>;
  threat: number;
  lotV: Map<number, number>;
  want: Array<{ c: number; v: number }>;
  abort: Set<string>;
}

interface UnitMem {
  kind: 'cap' | 'build' | 'cache' | 'feed' | 'stage' | 'post' | 'jam' | 'ram' | 'none';
  c: number;
  t0: number;
  hs: number;
  sv?: number;
}

interface Meta {
  kind: Order['kind'];
  unit: string | null;
  c: number;
  cls: ClsName | null;
}

interface FoeSeen {
  id: string;
  p: string;
  cls: ClsName;
  c: number;
  t: number;
}

interface CapTarget {
  c: number;
  mine: number;
  sub: number;
  h: number;
  grace: number;
  bonus: number;
  surv: number;
  p: (tc: number) => number;
}

interface Site {
  c: number;
  enable: number;
  red: number;
  surv: number;
}

class ZoriaBot implements Strategy {
  private params: Params;
  private slot: SlotName = 'A';
  private ready = false;
  private g!: Grid;
  private m!: Manifest;
  private oracle: RulesOracle | null = null;
  private oracleOk = true;
  private cfg: Record<string, number> = {};
  private ringW: number[] = [1, 1, 2 / 3, 1 / 3];
  private stepTk!: Uint8Array;
  private stepKl!: Uint8Array;
  private hearth = -1;
  private hearthOf: Record<string, number> = {};
  private enemies: string[] = [];
  private enemyDist: Record<string, Int32Array> = {};
  private citadel = -1;
  private cherta = 6;
  private dawnAt = 1000;
  private dawnMult = 2;
  private ticks = 1200;
  private minuteRate = 0.0005;
  private linkCache = new Map<number, boolean>();
  private dead = new Set<number>();
  private finds: Array<{ c: number; taken: boolean; kind: string }> = [];

  /* needle memory */
  private nHas!: Uint8Array;
  private nOwner: Array<string | null> = [];
  private nDark!: Uint8Array;
  private nSeen!: Int32Array;
  private nSince!: Int32Array;
  private nStart!: Uint8Array;
  private nRing!: Uint8Array;
  private needleList: number[] = [];
  private mineW!: Float64Array;
  private mineFed!: Uint8Array;
  private mineSet = new Set<number>();
  private P!: Float64Array;
  private O!: Float64Array;
  private Pv!: Float64Array;
  private Ov!: Float64Array;

  /* run state */
  private t = 0;
  private obs: Observe | null = null;
  private mem = new Map<string, UnitMem>();
  private queue: Array<{ cls: ClsName; at: number }> = [];
  private lastMeta: Meta[] = [];
  private lastAcc = 0;
  private black = new Map<string, number>();
  private distCache = new Map<string, Int32Array>();
  private foeSeen = new Map<string, FoeSeen>();
  private jamAlert = new Map<number, number>();
  private threatTick = -1000;
  private lostTick = -1000;
  private lotsDone = new Set<number>();
  private bidLast = new Map<number, number>();
  private scanLog: Array<{ c: number; t: number }> = [];
  private seq = 0;
  private lastBeliefOwn = new Map<string, string | null>();
  private lastBeliefDark = new Map<string, boolean>();
  private beliefN = 0;
  private lastFull = -1000;
  private posts: number[] = [];
  private postsAt = -1000;
  private lastPos = new Map<string, { c: number; cls: ClsName }>();
  private deaths: Array<{ c: number; t: number; cls: ClsName }> = [];
  private klSeen = -1000;
  private klLost = -1000;
  private danger!: Uint8Array;
  private stepSafe!: Uint8Array;
  private dangerAt = -1;
  private workSeen = 1;
  private workTick = -1000;
  private seenAt!: Int32Array;
  private pendScan: Array<{ c: number; t: number }> = [];

  constructor(preset?: string) {
    this.params = (preset ? PRESETS[preset] : undefined) ?? PRESETS['zoria']!;
  }

  /* ------------------------------------------------------------ init */

  init(manifestBytes: Uint8Array, slot: SlotName): void {
    this.slot = slot;
    this.ready = false;
    try {
      const m = decodeManifest(manifestBytes);
      if (!m) return;
      this.m = m;
      this.cfg = m.cfg;
      this.g = new Grid(m);
      const g = this.g;
      const N = g.N;
      this.ticks = m.ticks > 0 ? m.ticks : 1200;
      this.minuteRate = this.C('minuteRate', 0.0005);
      this.cherta = m.cherta > 0 ? m.cherta : 6;
      this.dawnAt = m.dawn ? m.dawn.at : this.ticks - 200;
      this.dawnMult = m.dawn && m.dawn.ring > 0 ? m.dawn.ring : this.C('dawnRing', 2);
      if (Array.isArray(m.rings) && m.rings.length >= 4) this.ringW = m.rings.slice(0, 4);
      this.citadel = g.idx(m.citadel.q, m.citadel.r);
      try {
        this.oracle = new RulesOracle(createEngine, manifestBytes);
      } catch {
        this.oracle = null;
      }
      this.buildSteps();
      this.nHas = new Uint8Array(N);
      this.nOwner = new Array<string | null>(N).fill(null);
      this.nDark = new Uint8Array(N);
      this.nSeen = new Int32Array(N);
      this.nSince = new Int32Array(N).fill(-1000);
      this.nStart = new Uint8Array(N);
      this.nRing = new Uint8Array(N);
      this.mineW = new Float64Array(N);
      this.mineFed = new Uint8Array(N);
      this.danger = new Uint8Array(N);
      this.seenAt = new Int32Array(N).fill(-1000);
      this.stepSafe = new Uint8Array(N * 6);
      this.P = new Float64Array(N);
      this.O = new Float64Array(N);
      this.Pv = new Float64Array(N);
      this.Ov = new Float64Array(N);
      for (const nd of m.needles) {
        const i = g.idx(nd.q, nd.r);
        if (i < 0) continue;
        this.nHas[i] = 1;
        this.needleList.push(i);
        if (nd.start) {
          this.nOwner[i] = nd.start;
          this.nStart[i] = 1;
        } else if (nd.ring || nd.spoke) {
          this.nOwner[i] = 'K';
          this.nRing[i] = 1;
        } else {
          this.nOwner[i] = null;
        }
      }
      /* hearths: the seat nearest to the starting needles of a slot */
      const slots: SlotName[] = ['A', 'B', 'C'];
      for (const s of slots) {
        const starts = m.needles.filter((x) => x.start === s);
        let best = -1;
        let bd = INF;
        for (const seat of m.seats) {
          let d = 0;
          for (const st of starts) d += hexDist(seat.q, seat.r, st.q, st.r);
          if (starts.length === 0) d = INF - 1;
          if (d < bd) {
            bd = d;
            best = g.idx(seat.q, seat.r);
          }
        }
        this.hearthOf[s] = best;
      }
      this.hearth = this.hearthOf[slot] ?? -1;
      this.enemies = slots.filter((s) => s !== slot);
      for (const e of this.enemies) {
        const h = this.hearthOf[e];
        if (h !== undefined && h >= 0) this.enemyDist[e] = dijkstra(g, h, this.stepTk);
      }
      for (const f of m.finds) {
        const c = g.idx(f.q, f.r);
        if (c < 0) continue;
        if (f.kind === 'dead') this.dead.add(c);
        else if (f.kind === 'cache' || f.kind === 'flare') this.finds.push({ c, taken: false, kind: f.kind });
      }
      this.ready = this.hearth >= 0;
    } catch {
      this.ready = false;
    }
  }

  private C(k: string, d: number): number {
    const v = this.cfg[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
  }

  private buildSteps(): void {
    const g = this.g;
    const N = g.N;
    this.stepTk = new Uint8Array(N * 6);
    this.stepKl = new Uint8Array(N * 6);
    const sT = this.C('stepTkach', 2);
    const sK = this.C('stepKlinok', 1);
    const rise = this.C('stepRise', 1);
    const own = (i: number, j: number): boolean => g.pass[i] === 1 && g.pass[j] === 1 && g.lvl[j]! - g.lvl[i]! <= 1 && j !== this.citadel;
    let useOracle = this.oracle !== null;
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 6; d++) {
        const j = g.nb[i * 6 + d]!;
        if (j < 0) continue;
        let ok = own(i, j);
        if (useOracle && this.oracle) {
          try {
            ok = this.oracle.canStep({ q: g.cq[i]!, r: g.cr[i]! }, { q: g.cq[j]!, r: g.cr[j]! });
          } catch {
            useOracle = false;
            ok = own(i, j);
          }
        }
        if (!ok) continue;
        const climb = Math.max(0, g.lvl[j]! - g.lvl[i]!);
        const mult = g.stepMult[g.ter[j]!] ?? 1;
        this.stepTk[i * 6 + d] = Math.max(1, Math.min(250, Math.round(sT * mult) + rise * climb));
        this.stepKl[i * 6 + d] = Math.max(1, Math.min(250, Math.round(sK * mult) + rise * climb));
      }
    }
    if (!useOracle) this.oracleOk = false;
  }

  /* thread reach with cache; the oracle knows mountains and hills */
  private linked(a: number, b: number): boolean {
    if (a === b) return false;
    const g = this.g;
    const key = a < b ? a * g.N + b : b * g.N + a;
    const hit = this.linkCache.get(key);
    if (hit !== undefined) return hit;
    const range = this.C('linkRange', 5) + (g.hill[a] === 1 || g.hill[b] === 1 ? 1 : 0);
    const d = g.hd(a, b);
    let ok = d <= range;
    if (ok) {
      let done = false;
      if (this.oracle && this.oracleOk) {
        try {
          ok = this.oracle.linkOk({ q: g.cq[a]!, r: g.cr[a]! }, { q: g.cq[b]!, r: g.cr[b]! });
          done = true;
        } catch {
          this.oracleOk = false;
        }
      }
      if (!done) ok = !this.crossesMountain(a, b);
    }
    this.linkCache.set(key, ok);
    return ok;
  }

  private crossesMountain(a: number, b: number): boolean {
    const g = this.g;
    const d = g.hd(a, b);
    if (d <= 1) return false;
    const aq = g.cq[a]!;
    const ar = g.cr[a]!;
    const bq = g.cq[b]!;
    const br = g.cr[b]!;
    for (let k = 1; k < d; k++) {
      const f = k / d;
      const x = aq + (bq - aq) * f;
      const z = ar + (br - ar) * f;
      const y = -x - z;
      let rx = Math.round(x);
      let ry = Math.round(y);
      let rz = Math.round(z);
      const dx = Math.abs(rx - x);
      const dy = Math.abs(ry - y);
      const dz = Math.abs(rz - z);
      if (dx > dy && dx > dz) rx = -ry - rz;
      else if (dy > dz) ry = -rx - rz;
      else rz = -rx - ry;
      const c = g.idx(rx, rz);
      if (c >= 0 && g.mount[c] === 1) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ wire */

  tick(observe: Uint8Array): Uint8Array {
    let orders: Order[] = [];
    try {
      const obs = decodeObserve(observe);
      if (obs && this.ready) {
        this.obs = obs;
        orders = this.plan(obs);
      } else {
        orders = this.fallback();
      }
    } catch {
      orders = this.fallback();
    }
    try {
      return encodeOrders(orders);
    } catch {
      try {
        return encodeOrders(this.fallback());
      } catch {
        return encodeOrders([]);
      }
    }
  }

  feedback(verdictBytes: Uint8Array): void {
    try {
      const vs = decodeVerdicts(verdictBytes);
      if (!vs) return;
      let any = false;
      for (const v of vs) {
        const i = v[0];
        const ok = v[1];
        const code = v[2];
        if (ok) {
          any = true;
          continue;
        }
        const meta = this.lastMeta[i];
        if (!meta) continue;
        if (meta.kind === 'yard') {
          for (let k = this.queue.length - 1; k >= 0; k--) {
            const qh = this.queue[k]!;
            if (qh.cls === meta.cls && qh.at === this.t) {
              this.queue.splice(k, 1);
              break;
            }
          }
        } else if (meta.kind === 'needle') {
          if (code === 11 || code === 21 || code === 12) this.black.set('s' + meta.c, this.t + (code === 21 ? 2000 : 120));
        } else if (meta.kind === 'move') {
          if (code === 11 || code === 12) this.black.set('u' + meta.unit + ':' + meta.c, this.t + 80);
        } else if (meta.kind === 'feed') {
          if (code === 13 || code === 11 || code === 12) this.black.set('f' + meta.c, this.t + 60);
        } else if (meta.kind === 'jam') {
          if (code === 18) this.black.set('j' + meta.c, this.t + 100);
        }
      }
      if (any) this.lastAcc = this.t;
    } catch {
      /* ignore */
    }
  }

  private fallback(): Order[] {
    try {
      if (this.ready && this.hearth >= 0) {
        const g = this.g;
        return [{ kind: 'watch', q: g.cq[this.hearth]!, r: g.cr[this.hearth]!, keep: 0 }];
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  /* ------------------------------------------------------------ plan */

  private plan(obs: Observe): Order[] {
    const t = obs.t;
    this.t = t;
    this.distCache.clear();
    try {
      this.update(obs);
    } catch {
      /* keep going with what we have */
    }
    const ctx = this.makeCtx(obs);
    const out: Cmd[] = [];
    const guard = (f: () => void): void => {
      try {
        f();
      } catch {
        /* a failing module must not break the frame */
      }
    };
    guard(() => this.doDefense(ctx, out));
    guard(() => this.doBids(ctx, out));
    guard(() => this.doYard(ctx, out));
    guard(() => this.doTkachs(ctx, out));
    guard(() => this.doKlinoks(ctx, out));
    guard(() => this.doScan(ctx, out));
    if (t - this.lastAcc >= 3) {
      const g = this.g;
      this.add(ctx, out, { kind: 'watch', q: g.cq[this.hearth]!, r: g.cr[this.hearth]!, keep: 0 }, 5, null, this.hearth, null);
    }
    return this.finalize(ctx, out);
  }

  private finalize(ctx: Ctx, cmds: Cmd[]): Order[] {
    cmds.sort((a, b) => b.pr - a.pr || a.seq - b.seq);
    const hands = 32 * ctx.acting.size;
    let used = 0;
    const out: Order[] = [];
    const meta: Meta[] = [];
    const seenUnit = new Set<string>();
    for (const c of cmds) {
      if (c.unit !== null && seenUnit.has(c.unit)) continue;
      if (out.length >= ctx.cap) break;
      /* commands are paid first, hands after them: only the commands decide acceptance;
         the hands reserve only trims optional work, never the keep-alive */
      const reserve = c.pr >= 20 ? hands : 0;
      if (used + c.cost + reserve > ctx.chan) continue;
      if (c.cost === 0 && used + 32 > ctx.chan) continue;
      used += c.cost;
      out.push(c.o);
      meta.push(this.metaOf(c));
      if (c.unit !== null) seenUnit.add(c.unit);
    }
    this.lastMeta = meta;
    /* yard entries that did not make it into the frame must not stay queued */
    const sentYard = out.filter((o) => o.kind === 'yard').length;
    let queuedNow = this.queue.filter((q) => q.at === this.t).length;
    for (let i = this.queue.length - 1; i >= 0 && queuedNow > sentYard; i--) {
      if (this.queue[i]!.at === this.t) {
        this.queue.splice(i, 1);
        queuedNow--;
      }
    }
    return out;
  }

  private metaOf(c: Cmd): Meta {
    const o = c.o;
    let cell = -1;
    const g = this.g;
    if (o.kind === 'move' || o.kind === 'needle' || o.kind === 'feed') cell = g.idx(o.q, o.r);
    else if (o.kind === 'jam' && o.target) cell = g.idx(o.target.q, o.target.r);
    return { kind: o.kind, unit: c.unit, c: cell, cls: o.kind === 'yard' ? o.cls : null };
  }

  private add(ctx: Ctx, out: Cmd[], o: Order, pr: number, unit: string | null, cellIdx: number, actingId: string | null): boolean {
    const cost = this.cmdPrice(o.kind, cellIdx, ctx.t);
    const free = cost === 0;
    if (!free && pr >= 20) {
      const need = ctx.cmdCost + cost + 32 * (ctx.acting.size + (actingId !== null && !ctx.acting.has(actingId) ? 1 : 0));
      if (need > ctx.chan) return false;
    } else if (!free && ctx.cmdCost + cost > ctx.chan) {
      return false;
    }
    if (ctx.nCmd + 1 > ctx.cap) return false;
    ctx.cmdCost += cost;
    ctx.nCmd++;
    if (actingId !== null) ctx.acting.add(actingId);
    out.push({ o, pr, cost, unit, seq: this.seq++ });
    return true;
  }

  /* channel price of a command: scans are paid from the ears, jam and halt are free */
  private cmdPrice(kind: Order['kind'], cell: number, t: number): number {
    const base = this.C('chanOrder', 32);
    if (kind === 'jam' || kind === 'halt' || kind === 'scan') return 0;
    try {
      if (orderScale(kind) !== 'chan') return 0;
      const g = this.g;
      const at = cell >= 0 ? { q: g.cq[cell]!, r: g.cr[cell]! } : undefined;
      return orderCost(this.m.cfg as unknown as ChannelCfg, kind, at, t, this.m.storms);
    } catch {
      return base;
    }
  }

  private makeCtx(obs: Observe): Ctx {
    const t = obs.t;
    const chanAt = obs.pulse.chanAt;
    let cap = Math.floor(chanAt / this.C('chanOrder', 32)) + 4;
    try {
      cap = orderCap(this.m.cfg as unknown as ChannelCfg, chanAt);
    } catch {
      /* keep the formula from the rules */
    }
    const acting = new Set<string>();
    for (const u of obs.mine.units) if (this.isActing(u)) acting.add(u.id);
    /* nodes of the thread: hearth + fully lit needles */
    const nodes: number[] = [this.hearth];
    let lit = 0;
    for (const i of this.mineSet) {
      if (this.mineW[i]! >= 0.999) {
        nodes.push(i);
        lit++;
      }
    }
    let committed = 0;
    for (const u of obs.mine.units) {
      const m = this.mem.get(u.id);
      if (m && m.kind === 'build' && u.task && u.task.site) committed += this.C('costNeedle', 60);
    }
    const ctx: Ctx = {
      t,
      obs,
      chan: obs.pulse.chan,
      cap,
      cmdCost: 0,
      nCmd: 0,
      acting,
      energy: obs.pulse.energy,
      reserve: 0,
      committed,
      litCount: lit,
      nodes,
      assigned: new Set<number>(),
      ramBusy: new Set<string>(),
      threat: 0,
      lotV: new Map<number, number>(),
      want: [],
      abort: new Set<string>(),
    };
    try {
      ctx.reserve = this.lotReserve(ctx);
    } catch {
      ctx.reserve = 0;
    }
    return ctx;
  }

  private isActing(u: MineUnit): boolean {
    const tk = u.task;
    if (tk && (tk.path > 0 || tk.site || tk.feed || tk.jam || tk.ram || tk.goal)) return true;
    if (u.cls === TK) {
      const i = this.g.idx(u.q, u.r);
      if (i >= 0 && this.nHas[i] && this.nOwner[i] !== this.slot && !this.nStart[i]) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ memory */

  private setNeedle(i: number, owner: string | null, dark: boolean, t: number): void {
    if (!this.nHas[i]) {
      this.nHas[i] = 1;
      this.needleList.push(i);
      this.nOwner[i] = owner;
      this.nSince[i] = t;
    } else if (this.nOwner[i] !== owner) {
      this.nOwner[i] = owner;
      this.nSince[i] = t;
    }
    this.nDark[i] = dark ? 1 : 0;
    this.nSeen[i] = t;
  }

  private update(obs: Observe): void {
    const g = this.g;
    const t = obs.t;
    const prev = this.mineSet;
    const now = new Set<number>();
    this.mineW.fill(0);
    this.mineFed.fill(0);
    for (const n of obs.mine.needles) {
      const i = g.idx(n.q, n.r);
      if (i < 0) continue;
      now.add(i);
      this.setNeedle(i, this.slot, n.dark, t);
      this.mineW[i] = n.dark ? 0 : n.weight;
      this.mineFed[i] = n.fed ? 1 : 0;
    }
    /* starting needles are shielded: they are ours even if the frame omits them */
    for (const i of this.needleList) {
      if (this.nStart[i] && this.nOwner[i] === this.slot && !now.has(i)) {
        now.add(i);
        this.mineW[i] = 1;
        this.nSeen[i] = t;
      }
    }
    for (const l of obs.mine.losts) {
      const i = g.idx(l.q, l.r);
      if (i >= 0 && !now.has(i)) {
        this.setNeedle(i, l.owner === this.slot ? '?' : l.owner, l.dark, t);
        this.lostTick = t;
      }
    }
    for (const i of prev) {
      if (!now.has(i) && this.nOwner[i] === this.slot) {
        this.setNeedle(i, '?', false, t);
        this.lostTick = t;
      }
    }
    this.mineSet = now;
    for (const e of obs.own) {
      const i = g.idx(e.q, e.r);
      if (i < 0 || now.has(i)) continue;
      this.setNeedle(i, e.owner, e.dark, t);
    }
    /* foes */
    for (const f of obs.foe) {
      const c = g.idx(f.q, f.r);
      if (c < 0) continue;
      this.foeSeen.set(f.id, { id: f.id, p: f.p, cls: f.cls, c, t });
      if (f.cls === KL && f.p !== this.slot && f.p !== 'K') this.klSeen = t;
    }
    for (const [k, v] of this.foeSeen) if (t - v.t > 30) this.foeSeen.delete(k);
    /* events */
    for (const ev of obs.events) {
      if (ev.type === 'find') {
        const c = g.idx(ev.q, ev.r);
        for (const f of this.finds) if (f.c === c) f.taken = true;
      } else if (ev.type === 'jam') {
        if (ev.own === this.slot) {
          const c = g.idx(ev.q, ev.r);
          if (c >= 0) this.jamAlert.set(c, t);
          this.threatTick = t;
        }
      } else if (ev.type === 'cap') {
        if (ev.from === this.slot) {
          this.lostTick = t;
          this.threatTick = t;
        }
      } else if (ev.type === 'build') {
        if (ev.p === this.slot) {
          for (let k = 0; k < this.queue.length; k++) {
            if (this.queue[k]!.cls === ev.cls) {
              this.queue.splice(k, 1);
              break;
            }
          }
        }
      } else if (ev.type === 'lot') {
        this.lotsDone.add(ev.lot);
      } else if (ev.type === 'ram') {
        if (ev.tgt === this.slot) this.threatTick = t;
      }
    }
    for (let k = this.queue.length - 1; k >= 0; k--) if (t - this.queue[k]!.at > 16) this.queue.splice(k, 1);
    /* units: memory cleanup */
    const alive = new Set<string>();
    for (const u of obs.mine.units) alive.add(u.id);
    for (const [id, lp] of Array.from(this.lastPos)) {
      if (alive.has(id)) continue;
      this.lastPos.delete(id);
      /* a unit that vanished is dead (or dissolved by the leash): remember where */
      this.deaths.push({ c: lp.c, t, cls: lp.cls });
      if (lp.cls === KL) this.klLost = t;
    }
    for (const u of obs.mine.units) {
      const c = g.idx(u.q, u.r);
      if (c >= 0) this.lastPos.set(u.id, { c, cls: u.cls });
    }
    while (this.deaths.length > 0 && t - this.deaths[0]!.t > 200) this.deaths.shift();
    for (const id of Array.from(this.mem.keys())) if (!alive.has(id)) this.mem.delete(id);
    for (const [k, v] of Array.from(this.black)) if (v < t) this.black.delete(k);
    for (const [c, tt] of Array.from(this.jamAlert)) if (t - tt > 40) this.jamAlert.delete(c);
    this.computeSight(obs);
    this.computePulls(obs);
    this.updateThreat(obs);
    this.computeDanger(obs);
  }

  /* which cells our own eyes or scans have looked at, and when */
  private computeSight(obs: Observe): void {
    const g = this.g;
    const t = obs.t;
    const mark = (c: number, rad: number): void => {
      if (c < 0) return;
      const cov = g.cov[c]!;
      const cd = g.covD[c]!;
      for (let k = 0; k < cov.length; k++) if (cd[k]! <= rad) this.seenAt[cov[k]!] = t;
    };
    const vE = this.C('visExact', 2);
    mark(this.hearth, vE);
    for (const i of this.mineSet) mark(i, vE);
    for (const u of obs.mine.units) mark(g.idx(u.q, u.r), u.cls === TK ? this.C('visTkach', 3) : this.C('visKlinok', 1));
    for (let k = this.pendScan.length - 1; k >= 0; k--) {
      const sc = this.pendScan[k]!;
      if (sc.t < t) {
        mark(sc.c, this.C('scanRad', 3));
        this.pendScan.splice(k, 1);
      }
    }
  }

  /* has everything within 2 of c been looked at lately (an enemy eye there would be known)? */
  private scouted(c: number, t: number): boolean {
    const g = this.g;
    if (t < 50) {
      let far = true;
      for (const e of this.enemies) {
        const h = this.hearthOf[e];
        if (h !== undefined && h >= 0 && g.hd(h, c) <= 9) far = false;
      }
      if (far) return true;
    }
    const cov = g.cov[c]!;
    const cd = g.covD[c]!;
    const maxAge = this.C('scanAge', 40) * 2;
    for (let k = 0; k < cov.length; k++) {
      if (cd[k]! <= 2 && t - this.seenAt[cov[k]!]! > maxAge) return false;
    }
    return true;
  }

  /* cells where an enemy eye can see our Tkach (exact sight: needles 2, Tkach 3, Klinok 1)
     or where our units died recently; routes avoid them when the detour is short */
  private computeDanger(obs: Observe): void {
    const g = this.g;
    const t = obs.t;
    const danger = this.danger;
    danger.fill(0);
    const mark = (c: number, rad: number): void => {
      const cov = g.cov[c]!;
      const cd = g.covD[c]!;
      for (let k = 0; k < cov.length; k++) if (cd[k]! <= rad) danger[cov[k]!] = 1;
    };
    for (const e of this.enemies) {
      const h = this.hearthOf[e];
      if (h !== undefined && h >= 0) mark(h, 2);
    }
    for (const i of this.needleList) {
      const o = this.nOwner[i] ?? null;
      if (o === null || o === this.slot || o === 'K') continue;
      mark(i, 2);
    }
    for (const f of this.foeSeen.values()) {
      if (f.p === this.slot || f.p === 'K' || t - f.t > 12) continue;
      mark(f.c, f.cls === TK ? 3 : 2);
    }
    for (const dz of this.deaths) if (dz.cls === TK) mark(dz.c, 2);
    const pen = this.C('detour', 5);
    const ss = this.stepSafe;
    for (let i = 0; i < g.N; i++) {
      for (let d = 0; d < 6; d++) {
        const base = this.stepTk[i * 6 + d]!;
        if (base === 0) {
          ss[i * 6 + d] = 0;
          continue;
        }
        const j = g.nb[i * 6 + d]!;
        ss[i * 6 + d] = Math.min(250, base + (danger[j] ? pen : 0));
      }
    }
    this.dangerAt = t;
  }

  private updateThreat(obs: Observe): void {
    const g = this.g;
    for (const f of obs.foe) {
      if (f.p === this.slot || f.p === 'K') continue;
      const c = g.idx(f.q, f.r);
      if (c < 0) continue;
      let near = g.hd(this.hearth, c);
      for (const i of this.mineSet) {
        const d = g.hd(i, c);
        if (d < near) near = d;
      }
      if (near <= 4) this.threatTick = obs.t;
    }
  }

  /* probability that a Tkach survives working on cell c (rams need exact sight: enemy needles
     and hearths see 2 cells, Tkachs 3, Klinoks 1); places where our units died recently count
     as guarded */
  private exposure(c: number, t: number): number {
    const g = this.g;
    const klRecent = t - this.klSeen < 120;
    let f = 1;
    let dmin = INF;
    for (const e of this.enemies) {
      const h = this.hearthOf[e];
      if (h !== undefined && h >= 0) dmin = Math.min(dmin, g.hd(h, c));
    }
    for (const i of this.needleList) {
      const o = this.nOwner[i] ?? null;
      if (o === null || o === this.slot || o === 'K') continue;
      const d = g.hd(i, c);
      if (d < dmin) dmin = d;
    }
    if (dmin <= 2) f = klRecent ? 0.25 : t > 70 ? 0.4 : 0.6;
    else if (dmin <= 3) f = klRecent ? 0.55 : 0.8;
    else if (dmin <= 4) f = klRecent ? 0.8 : 0.9;
    for (const fs of this.foeSeen.values()) {
      if (fs.p === this.slot || fs.p === 'K' || t - fs.t > 12) continue;
      const d = g.hd(fs.c, c);
      if (fs.cls === KL && d <= 6) f = Math.min(f, 0.45);
      else if (fs.cls === TK && d <= 3) f = Math.min(f, 0.8);
    }
    for (const dz of this.deaths) {
      if (g.hd(dz.c, c) <= 3) f = Math.min(f, dz.cls === TK ? 0.15 : 0.5);
    }
    return f;
  }

  /* minutes lost with a Tkach: its price at the rate energy converts into minutes */
  private tkachLoss(t: number): number {
    return this.C('costTkach', 90) * this.eps(t);
  }

  private dawnPassed(t: number): boolean {
    return t >= this.dawnAt;
  }

  private computePulls(obs: Observe): void {
    const g = this.g;
    const t = obs.t;
    this.P.fill(0);
    this.O.fill(0);
    const dawn = this.dawnPassed(t) || obs.pub.dawn;
    const ringPull = this.C('ringPull', 1.25);
    for (const i of this.needleList) {
      const owner = this.nOwner[i] ?? null;
      if (owner === null) continue;
      const cov = g.cov[i]!;
      const cd = g.covD[i]!;
      if (owner === this.slot) {
        const w0 = this.mineW[i]!;
        if (w0 <= 0) continue;
        const fed = this.mineFed[i] === 1;
        const mult = this.nRing[i] ? (dawn ? this.dawnMult : ringPull) : 1;
        for (let k = 0; k < cov.length; k++) {
          const d = cd[k]!;
          const w = fed ? this.ringW[Math.max(0, d - 1)] : d <= 3 ? this.ringW[d] : 0;
          if (!w) continue;
          const x = cov[k]!;
          this.P[x] = this.P[x]! + w0 * w * mult;
        }
      } else {
        if (this.nDark[i]) continue;
        let mult = 1;
        if (owner === 'K') {
          if (dawn) continue;
          mult = ringPull;
        } else if (this.nRing[i] && dawn) mult = this.dawnMult;
        for (let k = 0; k < cov.length; k++) {
          const d = cd[k]!;
          if (d > 3) continue;
          const x = cov[k]!;
          this.O[x] = this.O[x]! + this.ringW[d]! * mult;
        }
      }
    }
    this.Pv.set(this.P);
    this.Ov.set(this.O);
  }

  /* ------------------------------------------------------------ geometry helpers */

  private distFor(cell: number, cls: ClsName): Int32Array {
    const key = cell + (cls === TK ? ':t' : ':k');
    let d = this.distCache.get(key);
    if (!d) {
      d = dijkstra(this.g, cell, cls === TK ? this.stepTk : this.stepKl);
      this.distCache.set(key, d);
    }
    return d;
  }

  /* Tkach distances that include the detour penalty of enemy-sight cells */
  private distSafe(cell: number): Int32Array {
    const key = cell + ':s';
    let d = this.distCache.get(key);
    if (!d) {
      d = dijkstra(this.g, cell, this.stepSafe);
      this.distCache.set(key, d);
    }
    return d;
  }

  /* a move order for a Tkach that keeps out of enemy sight: waypoints along the penalised
     route, each of them reachable by a shortest path so the node's own path agrees */
  private tkachWaypoint(from: number, to: number): number {
    const g = this.g;
    if (from === to) return to;
    const prevP = new Int32Array(g.N);
    const dP = dijkstra(g, from, this.stepTk, prevP);
    if (dP[to]! >= INF) return to;
    let risky = false;
    for (let c = to; c !== from && c >= 0; c = prevP[c]!) {
      if (this.danger[c] && c !== to) {
        risky = true;
        break;
      }
    }
    if (!risky) return to;
    const prevS = new Int32Array(g.N);
    const dS = dijkstra(g, from, this.stepSafe, prevS);
    if (dS[to]! >= INF) return to;
    const path: number[] = [];
    for (let c = to; c !== from && c >= 0; c = prevS[c]!) path.push(c);
    path.reverse();
    let cum = 0;
    let cur = from;
    let best = -1;
    for (let k = 0; k < path.length; k++) {
      const nx = path[k]!;
      let step = 0;
      for (let d = 0; d < 6; d++) {
        if (g.nb[cur * 6 + d] === nx) {
          step = this.stepTk[cur * 6 + d]!;
          break;
        }
      }
      if (step === 0) break;
      cum += step;
      cur = nx;
      if (cum === dP[nx]!) best = nx;
      /* never end a leg inside a danger cell unless it is the target itself */
      if (this.danger[nx] && nx !== to && cum !== dP[nx]!) break;
    }
    if (best < 0) return to;
    return best;
  }

  /* minutes one unit of energy is worth at tick t */
  private eps(t: number): number {
    return 0.00025 * Math.max(0, this.ticks - t - 20);
  }

  /* minutes the extra energy of one more lit needle (0.25/tick) is worth over rem ticks */
  private eVal(rem: number): number {
    return 3.1e-5 * rem * rem;
  }

  private inLine(c: number): boolean {
    if (this.citadel < 0) return false;
    return this.g.hd(c, this.citadel) <= this.cherta;
  }

  private nearHearth(c: number): boolean {
    const g = this.g;
    for (const s of ['A', 'B', 'C']) {
      const h = this.hearthOf[s];
      if (h !== undefined && h >= 0 && g.hd(h, c) <= 2) return true;
    }
    return false;
  }

  /* minutes per tick when a needle of ours at c is lit.
     mine - our weight multiplier; sub - weight multiplier of the enemy pull that
     disappears when that needle is taken */
  private gain(c: number, mine: number, sub: number, P: Float64Array, O: Float64Array): { g: number; deny: number } {
    const g = this.g;
    const cov = g.cov[c]!;
    const cd = g.covD[c]!;
    let s = 0;
    let drop = 0;
    for (let k = 0; k < cov.length; k++) {
      const d = cd[k]!;
      if (d > 3) continue;
      const x = cov[k]!;
      const v = g.val[x]!;
      if (v === 0) continue;
      const w = this.ringW[d]! * mine;
      const p = P[x]!;
      const o = O[x]!;
      const so = sub > 0 ? Math.min(o, this.ringW[d]! * sub) : 0;
      s += v * (share(p + w, o - so) - share(p, o));
      if (so > 0) drop += v * (share(o, p) - share(o - so, p + w));
    }
    return { g: s * this.minuteRate, deny: drop * this.minuteRate };
  }

  /* gain of feeding the needle at i: coverage shifted one ring outward */
  private feedGain(i: number, P: Float64Array, O: Float64Array): number {
    const g = this.g;
    const cov = g.cov[i]!;
    const cd = g.covD[i]!;
    const w0 = Math.max(1, this.mineW[i]!);
    let s = 0;
    for (let k = 0; k < cov.length; k++) {
      const d = cd[k]!;
      const x = cov[k]!;
      const v = g.val[x]!;
      if (v === 0) continue;
      const wf = this.ringW[Math.max(0, d - 1)]!;
      const wn = d <= 3 ? this.ringW[d]! : 0;
      const delta = (wf - wn) * w0;
      if (delta <= 0) continue;
      s += v * (share(P[x]! + delta, O[x]!) - share(P[x]!, O[x]!));
    }
    return s * this.minuteRate;
  }

  private addVirtual(c: number, mine: number, sub: number): void {
    const g = this.g;
    const cov = g.cov[c]!;
    const cd = g.covD[c]!;
    for (let k = 0; k < cov.length; k++) {
      const d = cd[k]!;
      if (d > 3) continue;
      const x = cov[k]!;
      this.Pv[x] = this.Pv[x]! + this.ringW[d]! * mine;
      if (sub > 0) this.Ov[x] = Math.max(0, this.Ov[x]! - this.ringW[d]! * sub);
    }
  }

  private connectable(c: number, nodes: number[]): boolean {
    const g = this.g;
    for (const n of nodes) if (n !== c && g.hd(n, c) <= 6 && this.linked(n, c)) return true;
    return false;
  }

  private linkCount(c: number, nodes: number[]): number {
    const g = this.g;
    let k = 0;
    for (const n of nodes) if (n !== c && g.hd(n, c) <= 6 && this.linked(n, c)) k++;
    return k;
  }

  private heatTicks(c: number, dawn: boolean): number {
    const owner = this.nOwner[c] ?? null;
    if (owner === null) return this.C('heatNeedle', 8);
    if (owner === 'K' && dawn) return this.C('heatNeedle', 8);
    return this.nDark[c] ? this.C('heatDark', 16) : this.C('heatEnemy', 24);
  }

  /* earliest time an opponent could finish a ruin: used for races */
  private enemyEta(c: number, t: number): number {
    const g = this.g;
    let best = INF;
    for (const e of this.enemies) {
      const dm = this.enemyDist[e];
      if (dm && dm[c]! < best) best = dm[c]!;
    }
    for (const i of this.needleList) {
      const o = this.nOwner[i];
      if (o === null || o === undefined || o === this.slot || o === 'K' || this.nDark[i]) continue;
      const d = 2 * g.hd(i, c) + 2;
      if (d < best) best = d;
    }
    return Math.max(t, 5) + best + this.C('heatNeedle', 8);
  }

  private enemyCacheEta(c: number, t: number): number {
    let best = INF;
    for (const e of this.enemies) {
      const dm = this.enemyDist[e];
      if (dm && dm[c]! < best) best = dm[c]!;
    }
    return Math.max(t, 5) + best - 1;
  }

  /* ------------------------------------------------------------ defense */

  private doDefense(ctx: Ctx, out: Cmd[]): void {
    const obs = ctx.obs;
    const g = this.g;
    const t = ctx.t;
    const kls = obs.mine.units.filter((u) => u.cls === KL);
    const myTk = obs.mine.units.filter((u) => u.cls === TK);
    interface Th {
      f: (typeof obs.foe)[number];
      score: number;
    }
    const ths: Th[] = [];
    for (const f of obs.foe) {
      if (f.p === this.slot || f.p === 'K') continue;
      const c = g.idx(f.q, f.r);
      if (c < 0) continue;
      let near = g.hd(this.hearth, c);
      let onMine = false;
      for (const i of this.mineSet) {
        const d = g.hd(i, c);
        if (d < near) near = d;
        if (d === 0) onMine = true;
      }
      let score = 0;
      if (f.cls === TK) {
        if (onMine) score = 100;
        else if (near <= 2) score = 70;
        else if (near <= 5) score = 40;
      } else {
        let jamming = false;
        for (const [jc, jt] of this.jamAlert) if (t - jt <= 25 && g.hd(jc, c) <= 1) jamming = true;
        if (jamming) score = 85;
        for (const u of myTk) {
          if (hexDist(u.q, u.r, f.q, f.r) <= 3 && this.isActing(u)) score = Math.max(score, 80);
        }
        if (score === 0 && near <= 1 && t - this.klLost > 150 && kls.length >= 2) score = 45;
      }
      if (score > 0) ths.push({ f, score });
    }
    ths.sort((a, b) => b.score - a.score || (a.f.id < b.f.id ? -1 : 1));
    ctx.threat = ths.length > 0 ? ths[0]!.score : 0;
    if (kls.length === 0) return;
    const taken = new Set<string>();
    /* Klinoks already chasing a visible target keep going */
    for (const k of kls) {
      if (k.task && k.task.ram) {
        const rid = k.task.ram;
        const tg = obs.foe.find((f) => f.id === rid);
        if (tg) {
          ctx.ramBusy.add(k.id);
          taken.add(tg.id);
          ctx.acting.add(k.id);
        }
      }
    }
    for (const th of ths) {
      if (taken.has(th.f.id)) continue;
      const fc = g.idx(th.f.q, th.f.r);
      let bestK: MineUnit | null = null;
      let bestD = INF;
      for (const k of kls) {
        if (ctx.ramBusy.has(k.id)) continue;
        if (k.task && k.task.path > 0 && k.wait > 0) continue;
        const ki = g.idx(k.q, k.r);
        const d = this.distFor(ki, KL)[fc]!;
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      if (!bestK || bestD > 24) continue;
      /* a Klinok-for-Klinok trade only against a real threat */
      if (th.f.cls === KL && th.score < 60) continue;
      if (this.add(ctx, out, { kind: 'ram', unit: bestK.id, target: th.f.id }, 100, bestK.id, fc, bestK.id)) {
        ctx.ramBusy.add(bestK.id);
        taken.add(th.f.id);
        this.mem.set(bestK.id, { kind: 'ram', c: fc, t0: t, hs: 0 });
      }
    }
  }

  /* ------------------------------------------------------------ lots */

  /* what the lot is worth to us, in energy */
  private lotValue(j: number, ctx: Ctx): number {
    const cached = ctx.lotV.get(j);
    if (cached !== undefined) return cached;
    const v = this.lotValueRaw(j, ctx);
    ctx.lotV.set(j, v);
    return v;
  }

  private lotValueRaw(j: number, ctx: Ctx): number {
    const lot = this.m.lots[j];
    if (!lot) return 0;
    const g = this.g;
    const cells: number[] = [];
    for (const h of lot.cells) {
      const c = g.idx(h.q, h.r);
      if (c >= 0 && this.nHas[c] && (this.nOwner[c] ?? null) === null) cells.push(c);
    }
    if (cells.length === 0) return 0;
    const rem = this.ticks - lot.at;
    if (rem <= 10) return 0;
    const conn: number[] = [];
    const nodes = ctx.nodes.slice();
    for (let pass = 0; pass < 2; pass++) {
      for (const c of cells) {
        if (conn.includes(c)) continue;
        if (this.connectable(c, nodes)) {
          conn.push(c);
          nodes.push(c);
        }
      }
    }
    let v = 0;
    const P = this.P.slice();
    let lit = ctx.litCount;
    for (const c of conn) {
      const gn = this.gain(c, 1, 0, P, this.O);
      v += gn.g * rem + (lit < 8 ? this.eVal(rem) : 0);
      lit++;
      const cov = g.cov[c]!;
      const cd = g.covD[c]!;
      for (let k = 0; k < cov.length; k++) {
        const d = cd[k]!;
        if (d <= 3) P[cov[k]!] = P[cov[k]!]! + this.ringW[d]!;
      }
    }
    const e = this.eps(lot.at);
    if (e <= 0) return 0;
    return (v / e) * this.params.bidScale;
  }

  /* energy that must stay in the stock shortly before a reveal we want to bid on */
  private lotReserve(ctx: Ctx): number {
    const t = ctx.t;
    let r = 0;
    for (let j = 0; j < this.m.lots.length; j++) {
      const lot = this.m.lots[j]!;
      if (this.lotsDone.has(j)) continue;
      if (t >= lot.at - 18 && t < lot.at) {
        const v = this.lotValue(j, ctx);
        if (v >= 61) r = Math.max(r, t === lot.at - 1 ? Math.min(Math.floor(v), 300) : Math.min(Math.floor(v), 110));
      }
    }
    return r;
  }

  private doBids(ctx: Ctx, out: Cmd[]): void {
    const t = ctx.t;
    for (let j = 0; j < this.m.lots.length; j++) {
      const lot = this.m.lots[j]!;
      if (this.lotsDone.has(j)) continue;
      if (t >= lot.at) continue;
      if (t < lot.at - 3) continue;
      const v = this.lotValue(j, ctx);
      if (v < 61) continue;
      const stock = Math.floor(ctx.energy);
      let amount = Math.min(Math.floor(v), t === lot.at - 1 ? 300 : 110, stock - 1);
      if (amount < 60) continue;
      /* avoid round numbers: equal top bids give the lot to nobody */
      if (amount % 5 === 0) amount -= 1;
      if (amount < 60) continue;
      const last = this.bidLast.get(j);
      if (last === amount && t < lot.at - 1) continue;
      if (this.add(ctx, out, { kind: 'bid', lot: j, amount }, 90, null, this.hearth, null)) this.bidLast.set(j, amount);
    }
  }

  /* ------------------------------------------------------------ yard */

  private doYard(ctx: Ctx, out: Cmd[]): void {
    const obs = ctx.obs;
    const t = ctx.t;
    const wT = this.C('weightTkach', 2);
    const wK = this.C('weightKlinok', 1);
    const cap = this.C('squadWeight', 8);
    const cT = this.C('costTkach', 90);
    const cK = this.C('costKlinok', 50);
    let nT = obs.mine.units.filter((u) => u.cls === TK).length;
    let nK = obs.mine.units.filter((u) => u.cls === KL).length;
    for (const q of this.queue) {
      if (q.cls === TK) nT++;
      else nK++;
    }
    let weight = nT * wT + nK * wK;
    let energy = ctx.energy - ctx.reserve;
    const threatened = t - this.threatTick < 40 || t - this.lostTick < 80 || ctx.threat >= 70;
    let wantK = 0;
    if (t >= 140) wantK = 1;
    if (t >= 300) wantK = this.params.wantKLate;
    if (t - this.klLost < 120) wantK = Math.min(wantK, nK);
    if (threatened && t >= 50) wantK = Math.max(wantK, 1);
    if (t > this.dawnAt - 80) wantK = Math.min(wantK, nK);
    const tries: ClsName[] = [];
    if (threatened && nK === 0 && nT >= 1 && t >= 50) tries.push(KL);
    const workOk = t < 60 || t - this.workTick > 6 || this.workSeen > 0 || nT === 0;
    if (nT < this.params.wantT && workOk) tries.push(TK);
    if (nK < wantK) tries.push(KL);
    /* nothing to spend on: do not let the energy cap burn it */
    if (energy > 300 && tries.length === 0 && t < this.ticks - 150 && nK < 3) tries.push(KL);
    if (t >= this.ticks - 60) return;
    for (const cls of tries) {
      const cost = cls === TK ? cT : cK;
      const w = cls === TK ? wT : wK;
      if (weight + w > cap) continue;
      if (energy < cost) continue;
      if (this.add(ctx, out, { kind: 'yard', cls }, 80, null, this.hearth, null)) {
        this.queue.push({ cls, at: t });
        weight += w;
        energy -= cost;
        ctx.energy -= cost;
        if (cls === TK) nT++;
        else nK++;
      }
    }
  }

  /* ------------------------------------------------------------ Tkachs */

  private tkachState(u: MineUnit, ctx: Ctx): 'free' | 'busy' | 'mid' {
    const g = this.g;
    const t = ctx.t;
    const tk = u.task;
    if (tk && tk.path > 0 && u.wait > 0) return 'mid';
    const m = this.mem.get(u.id);
    const i = g.idx(u.q, u.r);
    if (tk && tk.site) {
      const s = g.idx(tk.site.q, tk.site.r);
      if (s >= 0 && !this.nHas[s]) return 'busy';
      return 'free';
    }
    if (tk && tk.feed) {
      const f = g.idx(tk.feed.q, tk.feed.r);
      if (f >= 0 && this.mineSet.has(f)) return 'busy';
      return 'free';
    }
    if (tk && tk.path > 0) {
      if (m && m.kind === 'cap') {
        const o = this.nOwner[m.c] ?? null;
        if (o === this.slot || (o !== null && this.nStart[m.c])) return 'free';
        if (this.black.has('t' + m.c)) return 'free';
      }
      if (m && m.kind === 'cache') {
        const cc = this.finds.find((x) => x.c === m.c);
        if (cc && cc.taken) return 'free';
      }
      return 'busy';
    }
    /* standing still on a needle we may heat: it is being heated */
    if (i >= 0 && this.nHas[i] && this.nOwner[i] !== this.slot && !this.nStart[i]) {
      const o = this.nOwner[i] ?? null;
      if (o === 'K' && !this.dawnPassed(t)) return 'free';
      if (this.black.has('t' + i)) return 'free';
      let mm = m;
      if (!mm || mm.kind !== 'cap' || mm.c !== i) {
        mm = { kind: 'cap', c: i, t0: t, hs: t };
        this.mem.set(u.id, mm);
      }
      if (mm.hs === 0) mm.hs = t;
      const h = this.heatTicks(i, this.dawnPassed(t));
      if (t - mm.hs > h + 10) {
        this.black.set('t' + i, t + 70);
        mm.hs = 0;
        return 'free';
      }
      return 'busy';
    }
    return 'free';
  }

  private doTkachs(ctx: Ctx, out: Cmd[]): void {
    const obs = ctx.obs;
    const g = this.g;
    const t = ctx.t;
    const tks = obs.mine.units.filter((u) => u.cls === TK).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (tks.length === 0) return;
    const dawn = this.dawnPassed(t);
    const costNeedle = this.C('costNeedle', 60);
    const free: MineUnit[] = [];
    for (const u of tks) {
      let st = this.tkachState(u, ctx);
      if (st === 'busy') {
        /* the ground became more dangerous than when the job was given: call the Tkach off */
        const am = this.mem.get(u.id);
        if (am && (am.kind === 'cap' || am.kind === 'build') && am.sv !== undefined && u.work === 0 && am.c >= 0) {
          const now = this.exposure(am.c, t);
          if (now < 0.5 && now < 0.6 * am.sv) {
            this.black.set((am.kind === 'build' ? 's' : 't') + am.c, t + 100);
            ctx.abort.add(u.id);
            st = 'free';
          }
        }
      }
      if (st === 'free') {
        free.push(u);
        continue;
      }
      /* busy / mid-step units keep their targets as virtual network */
      const m = this.mem.get(u.id);
      if (m && (m.kind === 'cap' || m.kind === 'build' || m.kind === 'cache') && m.c >= 0) {
        ctx.assigned.add(m.c);
        if (m.kind === 'cap' || m.kind === 'build') {
          const owner = this.nOwner[m.c] ?? null;
          const enemy = owner !== null && owner !== this.slot;
          this.addVirtual(m.c, this.nRing[m.c] && dawn ? this.dawnMult : 1, enemy ? (owner === 'K' ? (dawn ? 0 : 1.25) : 1) : 0);
          if (!ctx.nodes.includes(m.c)) ctx.nodes.push(m.c);
          if (ctx.litCount < 8) ctx.litCount++;
        }
      }
      if (m && m.kind === 'feed' && m.c >= 0) ctx.assigned.add(m.c + 100000);
    }
    /* feeding Tkachs may be pulled away by something clearly better */
    const pre: MineUnit[] = [];
    for (const u of tks) {
      const m = this.mem.get(u.id);
      if (m && m.kind === 'feed' && !(u.task && u.task.path > 0 && u.wait > 0) && !free.includes(u)) pre.push(u);
    }
    const workers = free.concat(pre);
    if (workers.length === 0) return;

    const targets = this.collectTargets(ctx, dawn);
    const cacheTg = this.collectCaches(ctx);
    const sites = this.collectSites(ctx, dawn);
    const regen = 0.25 * Math.min(8, Math.max(0, ctx.litCount));
    const wantTkach = tks.length + this.queue.filter((q) => q.cls === TK).length < this.params.wantT;
    const dists = new Map<string, Int32Array>();
    for (const u of workers) dists.set(u.id, this.distSafe(g.idx(u.q, u.r)));
    const left = workers.slice();
    const feedPre = new Set(pre.map((u) => u.id));
    interface Best {
      u: MineUnit;
      kind: 'cap' | 'build' | 'cache';
      c: number;
      rate: number;
      sv: number;
    }
    const loss = this.tkachLoss(t);
    let workN = 0;
    for (let iter = 0; iter < 6 && left.length > 0; iter++) {
      workN = 0;
      let best: Best | null = null;
      const gcache = new Map<number, { g: number; deny: number }>();
      const scache = new Map<number, number>();
      for (const u of left) {
        const dm = dists.get(u.id)!;
        const ui = g.idx(u.q, u.r);
        for (const x of targets) {
          if (ctx.assigned.has(x.c)) continue;
          if (this.black.has('u' + u.id + ':' + x.c) || this.black.has('t' + x.c)) continue;
          const e = x.c === ui ? 0 : dm[x.c]!;
          if (e >= INF) continue;
          let gn = gcache.get(x.c);
          if (!gn) {
            gn = this.gain(x.c, x.mine, x.sub, this.Pv, this.Ov);
            gcache.set(x.c, gn);
          }
          const gw = x.grace > 0 ? Math.max(0, x.grace - (t + e)) : 0;
          const tc = t + e + gw + x.h + 1;
          const rem = this.ticks - tc;
          if (rem <= 6) continue;
          /* autonomy: time spent outside the comms zone */
          const outside = this.Pv[x.c]! > 0 || g.hd(x.c, this.hearth) <= 5 ? 0 : e + gw + x.h;
          if (outside > this.C('autonomy', 40) - 4) continue;
          let V = (gn.g + 0.5 * gn.deny) * rem + (ctx.litCount < 8 ? this.eVal(rem) : 0) + x.bonus;
          if (V <= 0) continue;
          V = V * x.p(tc) * x.surv - (1 - x.surv) * loss;
          if (V <= 0.3) continue;
          workN++;
          const stick = this.mem.get(u.id);
          const rate = (V / (e + gw + x.h + 2)) * (stick && stick.kind === 'cap' && stick.c === x.c ? 1.2 : 1);
          if (!best || rate > best.rate) best = { u, kind: 'cap', c: x.c, rate, sv: x.surv };
        }
        for (const x of cacheTg) {
          if (ctx.assigned.has(x.c)) continue;
          if (this.black.has('u' + u.id + ':' + x.c)) continue;
          const e = x.c === ui ? 0 : dm[x.c]!;
          if (e >= INF) continue;
          const arrive = t + e;
          if (arrive >= this.enemyCacheEta(x.c, t)) continue;
          const sv = this.exposure(x.c, t);
          const val0 = x.kind === 'cache' ? 1.5 * this.eps(arrive) * Math.min(150, Math.max(0, 360 - ctx.energy)) : 0.4;
          const val = val0 * sv - (1 - sv) * loss;
          const rate = val / (e + 2);
          if (val > 0.3) {
            workN++;
            if (!best || rate > best.rate) best = { u, kind: 'cache', c: x.c, rate, sv };
          }
        }
        for (const x of sites) {
          if (ctx.assigned.has(x.c)) continue;
          if (this.black.has('s' + x.c) || this.black.has('u' + u.id + ':' + x.c)) continue;
          const e = x.c === ui ? 0 : dm[x.c]!;
          if (e >= INF) continue;
          const bt = this.C('buildTicks', 8);
          const tc = t + e + bt + 1;
          const rem = this.ticks - tc;
          if (rem <= 8) continue;
          const projE = ctx.energy + regen * (e + bt) - ctx.committed - ctx.reserve - (wantTkach ? this.C('costTkach', 90) : 0);
          if (projE < costNeedle) continue;
          let gv = scache.get(x.c);
          if (gv === undefined) {
            gv = this.gain(x.c, 1, 0, this.Pv, this.Ov).g;
            scache.set(x.c, gv);
          }
          const outside = this.Pv[x.c]! > 0 || g.hd(x.c, this.hearth) <= 5 ? 0 : e + bt;
          if (outside > this.C('autonomy', 40) - 4) continue;
          let V = gv * rem + (ctx.litCount < 8 ? this.eVal(rem) : 0) + x.enable - costNeedle * this.eps(tc);
          V = V * x.red * x.surv - (1 - x.surv) * loss;
          if (V <= 0.2) continue;
          workN++;
          const stick = this.mem.get(u.id);
          const rate = (V / (e + bt + 2)) * (stick && stick.kind === 'build' && stick.c === x.c ? 1.2 : 1);
          if (!best || rate > best.rate) best = { u, kind: 'build', c: x.c, rate, sv: x.surv };
        }
      }
      if (iter === 0) {
        this.workSeen = workN;
        this.workTick = t;
      }
      if (!best) break;
      /* feeding Tkachs only leave for something clearly better */
      if (feedPre.has(best.u.id) && best.rate < 0.08) {
        left.splice(left.indexOf(best.u), 1);
        continue;
      }
      const u = best.u;
      const ui = g.idx(u.q, u.r);
      const c = best.c;
      let ok = true;
      if (best.kind === 'build') {
        const wp = c === ui ? c : this.tkachWaypoint(ui, c);
        if (wp !== c) {
          ok = this.add(ctx, out, { kind: 'move', unit: u.id, q: g.cq[wp]!, r: g.cr[wp]!, goal: null, home: false }, 61, u.id, wp, u.id);
        } else {
          ok = this.add(ctx, out, { kind: 'needle', unit: u.id, q: g.cq[c]!, r: g.cr[c]! }, 62, u.id, c, u.id);
        }
        if (ok) {
          ctx.committed += costNeedle;
          this.mem.set(u.id, { kind: 'build', c, t0: t, hs: 0, sv: best.sv });
          this.addVirtual(c, 1, 0);
          ctx.nodes.push(c);
          if (ctx.litCount < 8) ctx.litCount++;
        }
      } else {
        if (c === ui) {
          this.mem.set(u.id, { kind: best.kind, c, t0: t, hs: t, sv: best.sv });
          ctx.acting.add(u.id);
        } else {
          const wp = best.kind === 'cache' ? c : this.tkachWaypoint(ui, c);
          ok = this.add(ctx, out, { kind: 'move', unit: u.id, q: g.cq[wp]!, r: g.cr[wp]!, goal: null, home: false }, 60, u.id, wp, u.id);
          if (ok) this.mem.set(u.id, { kind: best.kind, c, t0: t, hs: 0, sv: best.sv });
        }
        if (ok && best.kind === 'cap') {
          const owner = this.nOwner[c] ?? null;
          const enemy = owner !== null;
          this.addVirtual(c, this.nRing[c] && dawn ? this.dawnMult : 1, enemy ? (owner === 'K' ? (dawn ? 0 : 1.25) : 1) : 0);
          ctx.nodes.push(c);
          if (ctx.litCount < 8) ctx.litCount++;
        }
      }
      if (ok) {
        ctx.assigned.add(c);
        feedPre.delete(u.id);
      }
      /* with or without a channel for it, the unit is done for this tick */
      left.splice(left.indexOf(u), 1);
    }
    /* units without a job: stage for the dawn, feed, or stand */
    for (const u of left) {
      if (feedPre.has(u.id)) continue;
      if (this.tryStage(ctx, out, u, dawn)) continue;
      if (this.tryFeed(ctx, out, u)) continue;
      if (ctx.abort.has(u.id)) {
        this.add(ctx, out, { kind: 'halt', unit: u.id }, 63, u.id, -1, null);
        this.mem.set(u.id, { kind: 'none', c: -1, t0: t, hs: 0 });
      }
    }
  }

  private collectCaches(ctx: Ctx): Array<{ c: number; kind: string }> {
    const res: Array<{ c: number; kind: string }> = [];
    for (const f of this.finds) if (!f.taken && !ctx.assigned.has(f.c)) res.push({ c: f.c, kind: f.kind });
    return res;
  }

  private contractCells(ctx: Ctx): number[] {
    const board = ctx.obs.pub.order;
    if (!board) return [];
    if (ctx.t > board.to - 14) return [];
    const g = this.g;
    const res: number[] = [];
    for (const h of board.cells) {
      const c = g.idx(h.q, h.r);
      if (c >= 0) res.push(c);
    }
    return res;
  }

  private collectTargets(ctx: Ctx, dawn: boolean): CapTarget[] {
    const g = this.g;
    const t = ctx.t;
    const res: CapTarget[] = [];
    const cc = this.contractCells(ctx);
    let remaining = 0;
    let feasible = cc.length === 3;
    for (const c of cc) {
      const o = this.nOwner[c] ?? null;
      if (o !== this.slot) remaining++;
      if (o !== null && o !== this.slot && o === 'K') feasible = false;
    }
    const dangerKl: number[] = [];
    for (const f of this.foeSeen.values()) if (f.cls === KL && f.p !== this.slot && f.p !== 'K' && t - f.t <= 12) dangerKl.push(f.c);
    for (const c of this.needleList) {
      const owner = this.nOwner[c] ?? null;
      if (owner === this.slot) continue;
      if (this.nStart[c]) continue;
      if (this.black.has('t' + c)) continue;
      if (g.pass[c] !== 1) continue;
      if (owner === 'K' && !dawn) continue;
      if (this.inLine(c) && !dawn) continue;
      const enemy = owner !== null;
      if (enemy && !this.params.attack) continue;
      if (!this.connectable(c, ctx.nodes)) continue;
      if (!enemy && !this.scouted(c, t)) {
        ctx.want.push({ c, v: 40 });
        continue;
      }
      const isRing = this.nRing[c] === 1;
      const h = this.heatTicks(c, dawn);
      let grace = 0;
      if (enemy && owner !== 'K') grace = this.nSince[c]! + this.C('capGrace', 60);
      let bonus = 0;
      if (cc.includes(c) && feasible) {
        const mult = remaining > 0 ? 1 / remaining : 1;
        bonus = this.C('orderBonus', 30) * 0.8 * mult;
      }
      let surv = this.exposure(c, t);
      let risk = 1;
      if (enemy && owner !== 'K') {
        /* standing on an enemy needle for 16-24 ticks: its eye sees us the whole time */
        surv = Math.min(surv, t - this.klSeen < 60 ? 0.35 : 0.6);
        for (const kc of dangerKl) if (g.hd(kc, c) <= 6) surv = Math.min(surv, 0.25);
        risk = 0.85;
      }
      const mineMult = isRing && dawn ? this.dawnMult : 1;
      let sub = 0;
      if (enemy) {
        if (owner === 'K') sub = dawn ? 0 : 1.25;
        else sub = isRing && dawn ? this.dawnMult : 1;
      }
      const eta = this.enemyEta(c, t);
      const race = enemy
        ? (_tc: number): number => risk
        : (tc: number): number => Math.max(0.12, Math.min(1, 0.55 + (eta - tc) / 14));
      res.push({ c, mine: mineMult, sub, h, grace, bonus, surv, p: race });
    }
    return res;
  }

  private collectSites(ctx: Ctx, dawn: boolean): Site[] {
    const g = this.g;
    const t = ctx.t;
    const costNeedle = this.C('costNeedle', 60);
    const regen = 0.25 * Math.min(8, Math.max(0, ctx.litCount));
    if (ctx.energy + regen * 24 - ctx.committed - ctx.reserve < costNeedle) return [];
    if (this.ticks - t < 30) return [];
    /* ruins and ring needles not in reach yet make bridging sites valuable */
    const lonely: Array<{ c: number; v: number }> = [];
    const rem0 = this.ticks - t;
    for (const c of this.needleList) {
      const owner = this.nOwner[c] ?? null;
      const ring = this.nRing[c] === 1 && owner === 'K';
      if (!(owner === null || (ring && (dawn || t > this.dawnAt - 260)))) continue;
      if (this.nStart[c]) continue;
      if (this.connectable(c, ctx.nodes)) continue;
      const rem = ring ? Math.max(0, this.ticks - Math.max(t, this.dawnAt) - 20) : rem0 - 20;
      if (rem <= 0) continue;
      const gn = this.gain(c, ring ? this.dawnMult : 1, 0, this.P, this.O);
      const v = gn.g * rem + (ring ? 0 : this.eVal(rem0) * 0.5);
      if (v > 1) lonely.push({ c, v });
    }
    /* own needles that went dark (cut off by a jam or a lost hub): a new needle that links
       them to the lit network lights them again */
    const darkList: number[] = [];
    for (const i of this.mineSet) if (this.mineW[i]! < 0.999 && !this.nStart[i]) darkList.push(i);
    const jammedNow = (i: number): boolean => {
      const jt = this.jamAlert.get(i);
      return jt !== undefined && t - jt <= 22;
    };
    const dadj = new Map<number, number[]>();
    const dgain = new Map<number, number>();
    for (const a of darkList) {
      dgain.set(a, this.gain(a, 1, 0, this.Pv, this.Ov).g);
      const l: number[] = [];
      if (!jammedNow(a)) {
        for (const b of darkList) if (b !== a && !jammedNow(b) && g.hd(a, b) <= 6 && this.linked(a, b)) l.push(b);
      }
      dadj.set(a, l);
    }
    const relightOf = (c: number): number => {
      if (darkList.length === 0) return 0;
      const seen = new Set<number>();
      const stack: number[] = [];
      for (const d of darkList) {
        if (jammedNow(d)) continue;
        if (g.hd(c, d) <= 6 && this.linked(c, d)) {
          seen.add(d);
          stack.push(d);
        }
      }
      let sum = 0;
      while (stack.length > 0) {
        const u = stack.pop()!;
        sum += dgain.get(u) ?? 0;
        for (const v of dadj.get(u) ?? []) {
          if (!seen.has(v)) {
            seen.add(v);
            stack.push(v);
          }
        }
      }
      return sum;
    };
    const cands: Array<{ c: number; enable: number; red: number; surv: number; s: number }> = [];
    const unsc: Array<{ c: number; v: number }> = [];
    const nodes = ctx.nodes;
    for (let c = 0; c < g.N; c++) {
      if (g.build[c] !== 1 || g.pass[c] !== 1) continue;
      if (this.nHas[c]) continue;
      if (this.dead.has(c)) continue;
      if (this.black.has('s' + c)) continue;
      if (ctx.assigned.has(c)) continue;
      if (this.nearHearth(c)) continue;
      if (!dawn && this.inLine(c)) continue;
      let near = false;
      for (const n of nodes) {
        if (g.hd(n, c) <= 6) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      const lc = this.linkCount(c, nodes);
      if (lc === 0) continue;
      const gn = this.gain(c, 1, 0, this.Pv, this.Ov);
      let enable = 0;
      for (const l of lonely) if (g.hd(l.c, c) <= 6 && this.linked(c, l.c)) enable += 0.4 * l.v;
      enable += 0.8 * relightOf(c) * rem0;
      if (gn.g * rem0 + enable < 3) continue;
      if (!this.scouted(c, t)) {
        unsc.push({ c, v: gn.g * rem0 + enable });
        continue;
      }
      const surv = this.exposure(c, t);
      const red = lc >= 2 ? 1.08 : 1;
      cands.push({ c, enable, red, surv, s: (gn.g * rem0 + enable) * red * surv - (1 - surv) * this.tkachLoss(t) });
    }
    unsc.sort((a, b) => b.v - a.v || a.c - b.c);
    for (let k = 0; k < Math.min(4, unsc.length); k++) ctx.want.push(unsc[k]!);
    cands.sort((a, b) => b.s - a.s || a.c - b.c);
    return cands.slice(0, 40).map((x) => ({ c: x.c, enable: x.enable, red: x.red, surv: x.surv }));
  }

  private tryStage(ctx: Ctx, out: Cmd[], u: MineUnit, dawn: boolean): boolean {
    const t = ctx.t;
    const g = this.g;
    if (dawn || t < this.dawnAt - 45) return false;
    if (this.citadel < 0) return false;
    const ui = g.idx(u.q, u.r);
    const dm = this.distFor(ui, TK);
    const occupied = new Set<number>();
    for (const w of ctx.obs.mine.units) if (w.id !== u.id) occupied.add(g.idx(w.q, w.r));
    let best = -1;
    let bestD = INF;
    for (const c of this.needleList) {
      if (!this.nRing[c] || this.nOwner[c] !== 'K') continue;
      if (!this.connectable(c, ctx.nodes)) continue;
      const cov = g.cov[c]!;
      for (let k = 0; k < cov.length; k++) {
        const x = cov[k]!;
        if (g.pass[x] !== 1 || x === this.citadel) continue;
        if (g.hd(x, this.citadel) !== this.cherta + 1) continue;
        if (occupied.has(x) || ctx.assigned.has(x + 300000)) continue;
        const dd = x === ui ? 0 : dm[x]!;
        if (dd < bestD) {
          bestD = dd;
          best = x;
        }
      }
    }
    if (best < 0 || bestD >= INF) return false;
    ctx.assigned.add(best + 300000);
    if (best === ui) {
      this.mem.set(u.id, { kind: 'stage', c: best, t0: t, hs: 0 });
      return true;
    }
    if (this.add(ctx, out, { kind: 'move', unit: u.id, q: g.cq[best]!, r: g.cr[best]!, goal: null, home: false }, 50, u.id, best, u.id)) {
      this.mem.set(u.id, { kind: 'stage', c: best, t0: t, hs: 0 });
      return true;
    }
    return false;
  }

  private tryFeed(ctx: Ctx, out: Cmd[], u: MineUnit): boolean {
    const g = this.g;
    const t = ctx.t;
    if (this.ticks - t < 25) return false;
    const ui = g.idx(u.q, u.r);
    const dm = this.distSafe(ui);
    const loss = this.tkachLoss(t);
    let best = -1;
    let bestScore = 0.5;
    for (const i of this.mineSet) {
      if (this.mineW[i]! < 0.999) continue;
      if (this.mineFed[i]) continue;
      if (this.black.has('f' + i)) continue;
      if (ctx.assigned.has(i + 100000)) continue;
      if (this.inLine(i) && !this.dawnPassed(t)) continue;
      const e = i === ui ? 0 : dm[i]!;
      if (e >= INF || e > 60) continue;
      /* a feeding Tkach stands still for good: only where no enemy eye reaches */
      const sv = this.exposure(i, t);
      if (sv < 0.85) continue;
      const rem = this.ticks - t - e;
      if (rem <= 20) continue;
      const score = this.feedGain(i, this.Pv, this.Ov) * rem * sv - (1 - sv) * loss;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return false;
    const wp = best === ui ? best : this.tkachWaypoint(ui, best);
    if (wp !== best) {
      if (this.add(ctx, out, { kind: 'move', unit: u.id, q: g.cq[wp]!, r: g.cr[wp]!, goal: null, home: false }, 45, u.id, wp, u.id)) {
        this.mem.set(u.id, { kind: 'feed', c: best, t0: t, hs: 0 });
        ctx.assigned.add(best + 100000);
        return true;
      }
      return false;
    }
    if (this.add(ctx, out, { kind: 'feed', unit: u.id, q: g.cq[best]!, r: g.cr[best]! }, 45, u.id, best, u.id)) {
      this.mem.set(u.id, { kind: 'feed', c: best, t0: t, hs: 0 });
      ctx.assigned.add(best + 100000);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------ Klinoks */

  private computePosts(ctx: Ctx): void {
    const g = this.g;
    if (ctx.t - this.postsAt < 25 && this.posts.length > 0) return;
    this.postsAt = ctx.t;
    /* a safe central post: the lit needle with the smallest total distance to the others */
    let best = this.hearth;
    let bs = INF;
    const lit: number[] = [];
    for (const i of this.mineSet) if (this.mineW[i]! >= 0.999 && !this.inLine(i)) lit.push(i);
    lit.push(this.hearth);
    for (const a of lit) {
      let s = 0;
      for (const b of lit) s += g.hd(a, b);
      /* do not stand in front of an opponent's eyes */
      s += 6 * (this.exposure(a, ctx.t) < 0.9 ? 1 : 0) * lit.length;
      if (s < bs) {
        bs = s;
        best = a;
      }
    }
    this.posts = [best];
  }

  private doKlinoks(ctx: Ctx, out: Cmd[]): void {
    const obs = ctx.obs;
    const g = this.g;
    const t = ctx.t;
    const kls = obs.mine.units.filter((u) => u.cls === KL).sort((a, b) => (a.id < b.id ? -1 : 1));
    if (kls.length === 0) return;
    this.computePosts(ctx);
    let raiders = 0;
    for (let n = 0; n < kls.length; n++) {
      const k = kls[n]!;
      if (ctx.ramBusy.has(k.id)) continue;
      const midStep = !!(k.task && k.task.path > 0 && k.wait > 0);
      const ki = g.idx(k.q, k.r);
      const m = this.mem.get(k.id);
      const raiderRole = n >= 1 && this.params.raid && t >= 220 && t < this.dawnAt - 20 && t - this.klSeen > 100;
      if (raiderRole && raiders < 1) {
        const tgt = this.pickRaid(ctx, k);
        if (tgt >= 0) {
          raiders++;
          const keeping = !!(m && m.kind === 'jam' && m.c === tgt && k.task && k.task.jam);
          if (keeping) {
            ctx.acting.add(k.id);
            ctx.cmdCost += 8;
          } else if (!midStep) {
            if (this.add(ctx, out, { kind: 'jam', unit: k.id, target: { q: g.cq[tgt]!, r: g.cr[tgt]! }, hold: true }, 55, k.id, tgt, k.id)) {
              this.mem.set(k.id, { kind: 'jam', c: tgt, t0: t, hs: 0 });
              ctx.cmdCost += 72;
            }
          }
          continue;
        }
        if (m && m.kind === 'jam') {
          if (!midStep) {
            this.add(ctx, out, { kind: 'halt', unit: k.id }, 54, k.id, ki, null);
            this.mem.set(k.id, { kind: 'none', c: -1, t0: t, hs: 0 });
          }
          continue;
        }
      }
      if (midStep) continue;
      if (m && m.kind === 'jam') continue;
      if (k.task && k.task.path > 0) continue;
      const post = this.posts[n % this.posts.length] ?? this.hearth;
      if (ki !== post && g.hd(ki, post) > 1) {
        const home = this.Pv[post]! > 0 || g.hd(post, this.hearth) <= 5;
        if (this.add(ctx, out, { kind: 'move', unit: k.id, q: g.cq[post]!, r: g.cr[post]!, goal: null, home }, 40, k.id, post, k.id)) {
          this.mem.set(k.id, { kind: 'post', c: post, t0: t, hs: 0 });
        }
      }
    }
  }

  private pickRaid(ctx: Ctx, k: MineUnit): number {
    const g = this.g;
    const t = ctx.t;
    const m = this.mem.get(k.id);
    const rem = this.ticks - t;
    if (rem < 60) return -1;
    if (k.away > 30) return -1;
    const ki = g.idx(k.q, k.r);
    const dm = this.distFor(ki, KL);
    const dangerKl: number[] = [];
    for (const f of this.foeSeen.values()) if (f.cls === KL && f.p !== this.slot && f.p !== 'K' && t - f.t <= 10) dangerKl.push(f.c);
    let best = -1;
    let bestV = 3;
    for (const c of this.needleList) {
      const o = this.nOwner[c] ?? null;
      if (o === null || o === this.slot || o === 'K' || this.nStart[c] || this.nDark[c]) continue;
      if (t - this.nSeen[c]! > 25) continue;
      if (this.black.has('j' + c)) continue;
      /* only needles that touch our zone: the loot stays in the comms zone */
      let touch = false;
      const cov = g.cov[c]!;
      for (let q = 0; q < cov.length; q++) {
        if (this.P[cov[q]!]! > 0) {
          touch = true;
          break;
        }
      }
      if (!touch && g.hd(c, this.hearth) > 9) continue;
      let e = dm[c]!;
      for (let d = 0; d < 6; d++) {
        const j = g.nb[c * 6 + d]!;
        if (j >= 0 && dm[j]! < e) e = dm[j]!;
      }
      if (e > 30) continue;
      let risk = 1;
      for (const kc of dangerKl) if (g.hd(kc, c) <= 5) risk = 0.4;
      const gn = this.gain(c, 1, 1, this.P, this.O);
      const swing = gn.g + 0.6 * gn.deny;
      const v = swing * Math.min(100, rem - e) * risk + (m && m.kind === 'jam' && m.c === c ? 1.5 : 0);
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------ scans */

  private doScan(ctx: Ctx, out: Cmd[]): void {
    const obs = ctx.obs;
    const g = this.g;
    const t = ctx.t;
    if (t < 3) return;
    const scanCost = this.C('scanCost', 256);
    if (obs.pulse.ear < scanCost + 80) return;
    if (ctx.want.length > 0) {
      /* look where a Tkach would like to go but the ground is not scouted */
      let wb = -1;
      let wv = -1;
      for (const w of ctx.want) {
        if (this.scanLog.some((x) => t - x.t < 6 && g.hd(x.c, w.c) <= 2)) continue;
        const dn = g.hd(w.c, this.hearth);
        const v = w.v / (1 + 0.04 * dn);
        if (v > wv) {
          wv = v;
          wb = w.c;
        }
      }
      if (wb >= 0 && this.add(ctx, out, { kind: 'scan', q: g.cq[wb]!, r: g.cr[wb]!, rad: this.C('scanRad', 3) }, 21, null, wb, null)) {
        this.scanLog.push({ c: wb, t });
        this.pendScan.push({ c: wb, t });
        if (this.scanLog.length > 12) this.scanLog.shift();
        return;
      }
    }
    let bestC = -1;
    let bestS = 1.4;
    const blips = obs.noisy.map((h) => g.idx(h.q, h.r)).filter((c) => c >= 0);
    for (let c = 0; c < g.N; c++) {
      let blocked = false;
      for (const s of this.scanLog) {
        if (t - s.t < 10 && g.hd(s.c, c) <= 3) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      let s = 0;
      const cov = g.cov[c]!;
      const cd = g.covD[c]!;
      for (let k = 0; k < cov.length; k++) {
        if (cd[k]! > 3) continue;
        const x = cov[k]!;
        if (!this.nHas[x]) continue;
        const o = this.nOwner[x] ?? null;
        if (o === this.slot || this.nStart[x]) continue;
        const stale = Math.min(1, (t - this.nSeen[x]!) / 60);
        if (stale <= 0.1) continue;
        s += (o === null ? 0.5 : o === 'K' ? 0.1 : 1) * stale;
      }
      if (s > 0) {
        /* near our network the information is actionable */
        let dn = INF;
        for (const n of ctx.nodes) {
          const d = g.hd(n, c);
          if (d < dn) dn = d;
        }
        s *= dn <= 8 ? 1 : dn <= 12 ? 0.6 : 0.25;
      }
      for (const b of blips) {
        if (g.hd(b, c) <= 3) {
          let near = false;
          for (const n of ctx.nodes) if (g.hd(n, b) <= 4) near = true;
          if (near) s += 0.9;
        }
      }
      if (s > bestS) {
        bestS = s;
        bestC = c;
      }
    }
    if (bestC < 0) return;
    if (this.add(ctx, out, { kind: 'scan', q: g.cq[bestC]!, r: g.cr[bestC]!, rad: 3 }, 20, null, bestC, null)) {
      this.scanLog.push({ c: bestC, t });
      this.pendScan.push({ c: bestC, t });
      if (this.scanLog.length > 12) this.scanLog.shift();
    }
  }

  /* ------------------------------------------------------------ belief */

  belief(obs: Observe | null): BeliefFrame | null {
    try {
      if (!this.ready) return null;
      const o = obs ?? this.obs;
      if (!o) return null;
      const g = this.g;
      const t = o.t;
      const frame: BeliefFrame = {
        t,
        pulse: { energy: o.pulse.energy, chan: o.pulse.chan, ear: o.pulse.ear, minutes: o.pulse.minutes, needles: o.pulse.needles },
      };
      const full = this.beliefN === 0 || t - this.lastFull >= 200;
      const own: Record<string, string | null> = {};
      const dark: Record<string, boolean> = {};
      let changed = false;
      for (const i of this.needleList) {
        const key = g.cq[i]! + ',' + g.cr[i]!;
        const ow = this.nOwner[i] ?? null;
        const dk = this.nDark[i] === 1;
        if (full || !this.lastBeliefOwn.has(key) || this.lastBeliefOwn.get(key) !== ow) {
          own[key] = ow;
          changed = true;
        }
        if (full || this.lastBeliefDark.get(key) !== dk) {
          dark[key] = dk;
          changed = true;
        }
        this.lastBeliefOwn.set(key, ow);
        this.lastBeliefDark.set(key, dk);
      }
      if (full) {
        frame.full = true;
        this.lastFull = t;
      }
      if (full || changed) {
        frame.own = own;
        frame.dark = dark;
      }
      frame.foe = o.foe.map((f) => [f.id, f.p, f.q, f.r] as [string, string, number, number]);
      frame.noisy = o.noisy.length;
      frame.units = o.mine.units.map((u) => [u.id, u.q, u.r, u.task ? u.task.path : 0] as [string, number, number, number]);
      frame.pact = o.pub.pact.active.length > 0 ? o.pub.pact.active.map((p) => p.a + p.b).join(',') : null;
      frame.cries = o.pub.cries.map((c) => [c[0], c[1]] as [string, number]);
      this.beliefN++;
      return frame;
    } catch {
      return null;
    }
  }
}

export function createStrategy(preset?: string): Strategy {
  return new ZoriaBot(preset);
}
