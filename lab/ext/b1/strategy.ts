/* zoria bot :: strategy.ts - economy-first network builder with guards, contracts, bids and dawn-ring grab */

import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import type { BeliefFrame, WireBot } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, stormAt } from '@zoria/protocol';
import type { ActorName, ClsName, Manifest, MineUnit, Observe, Order, SlotName } from '@zoria/protocol';

export interface Strategy extends WireBot {
  /* belief diary frame for the tick; null - there is no frame */
  belief(obs: Observe | null): BeliefFrame | null;
}

const OFF = 20;
const STRIDE = 41;
const RAD = 19;
const INF = 1000000;
const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];
const TKACH: ClsName = 'ткач';
const KLINOK: ClsName = 'клинок';

function hd(aq: number, ar: number, bq: number, br: number): number {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) >> 1;
}

const OFFS6: [number, number][] = (() => {
  const a: [number, number][] = [];
  for (let dq = -6; dq <= 6; dq++) for (let dr = -6; dr <= 6; dr++) if ((dq !== 0 || dr !== 0) && hd(dq, dr, 0, 0) <= 6) a.push([dq, dr]);
  return a;
})();

class Valley {
  readonly n: number;
  readonly q: Int16Array;
  readonly r: Int16Array;
  readonly lvl: Int8Array;
  readonly val: Float32Array;
  readonly mul: Uint8Array;
  readonly pass: Uint8Array;
  readonly bld: Uint8Array;
  readonly hill: Uint8Array;
  readonly mount: Uint8Array;
  readonly nbr: Int16Array;
  readonly covI: Int16Array[] = [];
  readonly covW: Float32Array[] = [];
  readonly feI: Int16Array[] = [];
  readonly feW: Float32Array[] = [];
  private readonly look: Int16Array;

  constructor(m: Manifest, rings: number[]) {
    const look = new Int16Array(STRIDE * STRIDE).fill(-1);
    const qs: number[] = [];
    const rs: number[] = [];
    for (let r = -RAD; r <= RAD; r++) {
      for (let q = -RAD; q <= RAD; q++) {
        if (hd(q, r, 0, 0) <= RAD) {
          look[(r + OFF) * STRIDE + (q + OFF)] = qs.length;
          qs.push(q);
          rs.push(r);
        }
      }
    }
    this.look = look;
    const n = qs.length;
    this.n = n;
    this.q = Int16Array.from(qs);
    this.r = Int16Array.from(rs);
    const T = m.terrain.types;
    let valT = [2, 3, 2, 1, 1, 1, 0, 0];
    let mulT = [1, 1, 1, 1, 2, 2, 1, 1];
    let passT = [1, 1, 1, 1, 1, 1, 0, 0];
    let bldT = [1, 1, 1, 1, 1, 1, 0, 0];
    let hillT = [0, 0, 0, 0, 0, 1, 0, 0];
    let mountT = [0, 0, 0, 0, 0, 0, 0, 1];
    const t0 = T[0];
    const t1 = T[1];
    const t4 = T[4];
    if (T.length === 8 && t0 && t1 && t4 && t0.min === 2 && t1.min === 3 && t0.cost === 1 && t4.cost === 2) {
      valT = T.map((x) => x.min);
      mulT = T.map((x) => Math.max(1, x.cost));
      passT = T.map((x) => (x.pass ? 1 : 0));
      bldT = T.map((x) => (x.build ? 1 : 0));
      hillT = T.map((x) => (x.reach ? 1 : 0));
      mountT = T.map((x) => (x.block ? 1 : 0));
    }
    const terr = new Uint8Array(n);
    for (const e of m.terrain.cells) {
      const c = this.id(e[0], e[1]);
      if (c >= 0) terr[c] = e[2];
    }
    this.lvl = new Int8Array(n);
    this.val = new Float32Array(n);
    this.mul = new Uint8Array(n);
    this.pass = new Uint8Array(n);
    this.bld = new Uint8Array(n);
    this.hill = new Uint8Array(n);
    this.mount = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      const ty = terr[c]!;
      this.lvl[c] = m.levels[c] ?? 0;
      this.val[c] = valT[ty] ?? 0;
      this.mul[c] = mulT[ty] ?? 1;
      this.pass[c] = passT[ty] ?? 0;
      this.bld[c] = bldT[ty] ?? 0;
      this.hill[c] = hillT[ty] ?? 0;
      this.mount[c] = mountT[ty] ?? 0;
    }
    this.nbr = new Int16Array(n * 6).fill(-1);
    for (let c = 0; c < n; c++) {
      for (let d = 0; d < 6; d++) this.nbr[c * 6 + d] = this.id(qs[c]! + DQ[d]!, rs[c]! + DR[d]!);
    }
    const rw = (d: number): number => rings[d] ?? [1, 1, 2 / 3, 1 / 3][d] ?? 0;
    const offs: [number, number, number][] = [];
    for (let dq = -4; dq <= 4; dq++) for (let dr = -4; dr <= 4; dr++) {
      const d = hd(dq, dr, 0, 0);
      if (d <= 4) offs.push([dq, dr, d]);
    }
    for (let c = 0; c < n; c++) {
      const bi: number[] = [];
      const bw: number[] = [];
      const fi: number[] = [];
      const fw: number[] = [];
      for (const [dq, dr, d] of offs) {
        const x = this.id(qs[c]! + dq, rs[c]! + dr);
        if (x < 0) continue;
        if (d <= 3) {
          bi.push(x);
          bw.push(rw(d));
        }
        fi.push(x);
        fw.push(rw(Math.max(0, d - 1)));
      }
      this.covI.push(Int16Array.from(bi));
      this.covW.push(Float32Array.from(bw));
      this.feI.push(Int16Array.from(fi));
      this.feW.push(Float32Array.from(fw));
    }
  }

  id(q: number, r: number): number {
    if (q < -RAD || q > RAD || r < -RAD || r > RAD) return -1;
    return this.look[(r + OFF) * STRIDE + (q + OFF)] ?? -1;
  }
}

function dijkstra(V: Valley, src: number, base: number, rise: number, maxD: number): Int32Array {
  const dist = new Int32Array(V.n).fill(INF);
  if (src < 0 || src >= V.n) return dist;
  const buckets: (number[] | undefined)[] = new Array(maxD + 1);
  dist[src] = 0;
  buckets[0] = [src];
  for (let d = 0; d <= maxD; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let k = 0; k < b.length; k++) {
      const u = b[k]!;
      if (dist[u] !== d) continue;
      for (let dd = 0; dd < 6; dd++) {
        const v = V.nbr[u * 6 + dd]!;
        if (v < 0 || !V.pass[v]) continue;
        const climb = V.lvl[v]! - V.lvl[u]!;
        if (climb > 1) continue;
        const nd = d + Math.max(1, base * V.mul[v]! + (climb > 0 ? climb * rise : 0));
        if (nd <= maxD && nd < dist[v]!) {
          dist[v] = nd;
          (buckets[nd] ??= []).push(v);
        }
      }
    }
  }
  return dist;
}

class LinkCache {
  private memo = new Map<number, boolean>();
  constructor(
    private V: Valley,
    private oracle: RulesOracle | null,
    private range: number,
  ) {}

  ok(a: number, b: number): boolean {
    if (a === b) return false;
    const V = this.V;
    const d = hd(V.q[a]!, V.r[a]!, V.q[b]!, V.r[b]!);
    if (d > this.range + 1) return false;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const k = lo * 2048 + hi;
    const hit = this.memo.get(k);
    if (hit !== undefined) return hit;
    let res = false;
    if (this.oracle) {
      try {
        res = this.oracle.linkOk({ q: V.q[a]!, r: V.r[a]! }, { q: V.q[b]!, r: V.r[b]! });
      } catch {
        res = this.fallback(a, b, d);
      }
    } else res = this.fallback(a, b, d);
    this.memo.set(k, res);
    return res;
  }

  private fallback(a: number, b: number, d: number): boolean {
    const V = this.V;
    const lim = this.range + (V.hill[a] || V.hill[b] ? 1 : 0);
    if (d > lim) return false;
    const aq = V.q[a]!;
    const ar = V.r[a]!;
    const bq = V.q[b]!;
    const br = V.r[b]!;
    for (let i = 1; i < d; i++) {
      const f = i / d;
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
      const c = V.id(rx, rz);
      if (c >= 0 && V.mount[c]) return false;
    }
    return true;
  }
}

type Role = 'cap' | 'build' | 'feed' | 'ram' | 'guard' | 'cache' | 'stage';
interface Assign {
  role: Role;
  cell: number;
  t0: number;
  tries: number;
  tgt: string;
}
interface Cmd {
  pri: number;
  seq: number;
  order: Order;
  unit: string;
  wake: boolean;
  hard: boolean;
  free: boolean;
  cost: number;
  dead: boolean;
}
interface Foe {
  id: string;
  p: ActorName;
  cls: ClsName;
  q: number;
  r: number;
  c: number;
}
interface Cand {
  cell: number;
  kind: 'ruin' | 'enemy' | 'site';
  work: number;
  energy: number;
  rate: number;
  bonus: number;
  dark: boolean;
}

function share(pm: number, po: number): number {
  const s = pm + po;
  return s <= 1 ? pm : pm / s;
}

class ZoriaBot implements Strategy {
  private readonly pactsOn: boolean;
  private ready = false;
  private slot: SlotName = 'A';
  private me = 0;
  private V!: Valley;
  private link!: LinkCache;
  private man!: Manifest;
  private cfg: Record<string, number> = {};
  private total = 1200;
  private dawnAt = 1000;
  private center = 0;
  private cherta = 6;
  private seatCells: number[] = [];
  private hearth = 0;
  private hearthKnown = false;
  private own!: Int8Array;
  private dk!: Uint8Array;
  private grace!: Int32Array;
  private isN!: Uint8Array;
  private isStart!: Uint8Array;
  private isRing!: Uint8Array;
  private isDead!: Uint8Array;
  private mark!: Uint8Array;
  private pMe!: Float32Array;
  private pOpp!: Float32Array;
  private dp!: Float32Array;
  private wMine!: Float32Array;
  private fedMine!: Uint8Array;
  private needleCells: number[] = [];
  private ringCells: number[] = [];
  private stageCell = new Map<number, number>();
  private taken = new Set<number>();
  private bad = new Map<number, number>();
  private assign = new Map<string, Assign>();
  private reserved = new Set<number>();
  private distMap = new Map<number, Int32Array>();
  private touched: number[] = [];
  private pendT: number[] = [];
  private pendK: number[] = [];
  private prevIds = new Set<string>();
  private t = 0;
  private myN: number[] = [];
  private myLit: number[] = [];
  private netNodes: number[] = [];
  private baseLit = new Set<number>();
  private ringAccess = false;
  private foes: Foe[] = [];
  private partner: SlotName | null = null;
  private partnerCode = -1;
  private dawn = false;
  private cachePlan = -1;
  private emergencyK = false;
  private lotRes = 0;
  private yardSpent = 0;
  private lastOkT = 0;
  private offered = 0;
  private lastOffer = -100;
  private cmds: Cmd[] = [];
  private sent: Cmd[] = [];
  private unitCmd = new Map<string, Cmd>();
  private unitCell = new Map<string, number>();
  private unitById = new Map<string, MineUnit>();
  private seq = 0;
  private beliefN = 0;
  private bOwn = new Map<string, string | null>();
  private bDark = new Map<string, boolean>();

  constructor(pacts: boolean) {
    this.pactsOn = pacts;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.slot = slot;
    this.me = slot === 'A' ? 0 : slot === 'B' ? 1 : 2;
    try {
      const m = decodeManifest(manifest);
      if (!m) return;
      this.setup(m, manifest);
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  private cfgNum(k: string, d: number): number {
    const v = this.cfg[k];
    return typeof v === 'number' ? v : d;
  }

  private setup(m: Manifest, bytes: Uint8Array): void {
    this.man = m;
    this.cfg = m.cfg;
    this.total = m.ticks;
    this.dawnAt = m.dawn.at;
    this.cherta = m.cherta;
    const V = new Valley(m, m.rings);
    this.V = V;
    let oracle: RulesOracle | null = null;
    try {
      oracle = new RulesOracle(createEngine, bytes);
    } catch {
      oracle = null;
    }
    this.link = new LinkCache(V, oracle, this.cfgNum('linkRange', 5));
    this.center = Math.max(0, V.id(m.citadel.q, m.citadel.r));
    this.seatCells = m.seats.map((h) => V.id(h.q, h.r));
    const gi = m.perm.indexOf(this.slot);
    this.hearth = this.seatCells[gi >= 0 ? gi : this.me] ?? this.seatCells[0] ?? 0;
    const n = V.n;
    this.own = new Int8Array(n).fill(-1);
    this.dk = new Uint8Array(n);
    this.grace = new Int32Array(n);
    this.isN = new Uint8Array(n);
    this.isStart = new Uint8Array(n);
    this.isRing = new Uint8Array(n);
    this.isDead = new Uint8Array(n);
    this.mark = new Uint8Array(n);
    this.pMe = new Float32Array(n);
    this.pOpp = new Float32Array(n);
    this.dp = new Float32Array(n);
    this.wMine = new Float32Array(n);
    this.fedMine = new Uint8Array(n);
    for (const nd of m.needles) {
      const c = V.id(nd.q, nd.r);
      if (c < 0) continue;
      this.isN[c] = 1;
      this.needleCells.push(c);
      if (nd.start) {
        this.isStart[c] = 1;
        this.own[c] = nd.start === 'A' ? 0 : nd.start === 'B' ? 1 : 2;
      } else if (nd.ring || nd.spoke) {
        this.own[c] = 3;
        this.isRing[c] = 1;
        this.ringCells.push(c);
      } else this.own[c] = 4;
    }
    for (const f of m.finds) {
      const c = V.id(f.q, f.r);
      if (c >= 0 && f.kind === 'dead') this.isDead[c] = 1;
    }
    for (const rc of this.ringCells) {
      let best = -1;
      let bd = 99;
      for (let x = 0; x < n; x++) {
        if (!V.pass[x] || this.isN[x]) continue;
        if (hd(V.q[x]!, V.r[x]!, V.q[this.center]!, V.r[this.center]!) <= this.cherta) continue;
        const d = hd(V.q[x]!, V.r[x]!, V.q[rc]!, V.r[rc]!);
        if (d < bd) {
          bd = d;
          best = x;
        }
      }
      if (best >= 0) this.stageCell.set(rc, best);
    }
  }

  /* ---------- helpers ---------- */

  private cellOf(u: MineUnit): number {
    return this.V.id(u.q, u.r);
  }

  private canCommand(u: MineUnit): boolean {
    return !(u.task && u.task.path > 0 && u.wait > 0);
  }

  private dist(src: number, kl: boolean): Int32Array {
    const key = src * 2 + (kl ? 1 : 0);
    let d = this.distMap.get(key);
    if (!d) {
      if (this.distMap.size > 500) this.distMap.clear();
      d = dijkstra(this.V, src, kl ? this.cfgNum('stepKlinok', 1) : this.cfgNum('stepTkach', 2), this.cfgNum('stepRise', 1), 320);
      this.distMap.set(key, d);
    }
    return d;
  }

  private ringMul(c: number): number {
    if (!this.isRing[c]) return 1;
    return this.dawn ? this.cfgNum('dawnRing', 2) : this.cfgNum('ringPull', 1.25);
  }

  private inZone(c: number): boolean {
    const V = this.V;
    return this.pMe[c]! > 0 || hd(V.q[c]!, V.r[c]!, V.q[this.hearth]!, V.r[this.hearth]!) <= 5;
  }

  private code(a: ActorName | null): number {
    return a === null ? 4 : a === 'A' ? 0 : a === 'B' ? 1 : a === 'C' ? 2 : 3;
  }

  private active(u: MineUnit): boolean {
    const k = u.task;
    if (k && (k.path > 0 || k.site || k.feed || k.jam || k.ram)) return true;
    if (u.cls === TKACH) {
      const c = this.cellOf(u);
      if (c >= 0 && this.isN[c] && !this.isStart[c]) {
        const ow = this.own[c]!;
        if (ow !== this.me && ow !== this.partnerCode && (ow !== 3 || this.dawn) && this.grace[c]! <= this.t) return true;
      }
    }
    return false;
  }

  private emit(order: Order, pri: number, unit = '', hard = false): void {
    const V = this.V;
    let cost = 32;
    let free = false;
    if (order.kind === 'halt' || order.kind === 'jam') {
      cost = 0;
      free = true;
    } else {
      const cell = unit ? (this.unitCell.get(unit) ?? this.hearth) : this.hearth;
      if (cell >= 0 && stormAt(this.man.storms, V.q[cell]!, V.r[cell]!, this.t)) cost = 64;
    }
    let wake = false;
    if (unit && order.kind !== 'halt') {
      const u = this.unitById.get(unit);
      wake = u ? !this.active(u) : false;
    }
    if (unit) {
      const prev = this.unitCmd.get(unit);
      if (prev && !prev.dead) {
        if (prev.pri >= pri) return;
        prev.dead = true;
      }
    }
    const cmd: Cmd = { pri, seq: this.seq++, order, unit, wake, hard, free, cost, dead: false };
    this.cmds.push(cmd);
    if (unit) this.unitCmd.set(unit, cmd);
  }

  private engaged(u: MineUnit, role: Role, cell: number, tgt: string): boolean {
    const k = u.task;
    const V = this.V;
    const q = V.q[cell]!;
    const r = V.r[cell]!;
    switch (role) {
      case 'build':
        return k !== null && k.site !== null && k.site.q === q && k.site.r === r;
      case 'feed':
        return k !== null && k.feed !== null && k.feed.q === q && k.feed.r === r;
      case 'ram':
        return k !== null && k.ram === tgt;
      default:
        return this.cellOf(u) === cell || (k !== null && k.path > 0);
    }
  }

  private plan(u: MineUnit, role: Role, cell: number, pri: number, tgt = ''): void {
    const V = this.V;
    const a = this.assign.get(u.id);
    const keep = a !== undefined && a.role === role && a.cell === cell && a.tgt === tgt ? a : null;
    if (keep && this.engaged(u, role, cell, tgt)) return;
    if (!this.canCommand(u)) return;
    const q = V.q[cell]!;
    const r = V.r[cell]!;
    if (this.cellOf(u) === cell && (role === 'cap' || role === 'guard' || role === 'stage' || role === 'cache')) {
      this.assign.set(u.id, { role, cell, t0: keep ? keep.t0 : this.t, tries: 0, tgt });
      return;
    }
    const tries = keep ? keep.tries + 1 : 0;
    if (tries > 4) {
      this.bad.set(cell, this.t + 80);
      this.assign.delete(u.id);
      return;
    }
    let order: Order;
    if (role === 'build') order = { kind: 'needle', unit: u.id, q, r };
    else if (role === 'feed') order = { kind: 'feed', unit: u.id, q, r };
    else if (role === 'ram') order = { kind: 'ram', unit: u.id, target: tgt };
    else order = { kind: 'move', unit: u.id, q, r, goal: null, home: role === 'guard' };
    this.assign.set(u.id, { role, cell, t0: keep ? keep.t0 : this.t, tries, tgt });
    this.emit(order, pri, u.id);
  }

  /* ---------- tick pipeline ---------- */

  tick(observe: Uint8Array): Uint8Array {
    let orders: Order[] = [];
    try {
      const o = decodeObserve(observe);
      if (o && this.ready) orders = this.think(o);
    } catch {
      orders = this.safe();
    }
    try {
      return encodeOrders(orders);
    } catch {
      return new Uint8Array(0);
    }
  }

  private safe(): Order[] {
    if (!this.ready) return [];
    const V = this.V;
    return [{ kind: 'watch', q: V.q[this.hearth] ?? 0, r: V.r[this.hearth] ?? 0, keep: 0 }];
  }

  private run(f: () => void): void {
    try {
      f();
    } catch {
      /* a failing module must not take the others down */
    }
  }

  private think(o: Observe): Order[] {
    this.t = o.t;
    this.cmds = [];
    this.unitCmd.clear();
    this.seq = 0;
    this.unitCell.clear();
    this.unitById.clear();
    for (const u of o.mine.units) {
      this.unitCell.set(u.id, this.V.id(u.q, u.r));
      this.unitById.set(u.id, u);
    }
    this.run(() => this.ingest(o));
    this.run(() => this.derive());
    this.run(() => this.resolve(o));
    this.run(() => this.lotPlan());
    this.run(() => this.doPact(o));
    this.run(() => this.doThreats(o));
    this.run(() => this.doYard(o));
    this.run(() => this.doTkachs(o));
    this.run(() => this.doKlinoks(o));
    this.run(() => this.doBids(o));
    return this.finalize(o);
  }

  /* ---------- memory ---------- */

  private ingest(o: Observe): void {
    const V = this.V;
    const t = o.t;
    const me = this.me;
    if (!this.hearthKnown && o.mine.needles.length > 0) {
      let sq = 0;
      let sr = 0;
      for (const nd of o.mine.needles) {
        sq += nd.q;
        sr += nd.r;
      }
      sq = Math.round(sq / o.mine.needles.length);
      sr = Math.round(sr / o.mine.needles.length);
      let best = -1;
      let bd = 99;
      for (const s of this.seatCells) {
        if (s < 0) continue;
        const d = hd(sq, sr, V.q[s]!, V.r[s]!);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best >= 0 && bd <= 4) {
        this.hearth = best;
        this.hearthKnown = true;
        this.planOpening();
      }
    }
    this.dawn = o.pub.dawn || t >= this.dawnAt;
    this.partner = null;
    this.partnerCode = -1;
    for (const p of o.pub.pact.active) {
      if (p.a === this.slot) this.partner = p.b;
      else if (p.b === this.slot) this.partner = p.a;
    }
    if (this.partner) this.partnerCode = this.partner === 'A' ? 0 : this.partner === 'B' ? 1 : 2;
    for (const e of o.events) {
      switch (e.type) {
        case 'cap': {
          const c = V.id(e.q, e.r);
          if (c >= 0) {
            this.own[c] = this.code(e.p);
            this.grace[c] = t + 60;
            this.isN[c] = 1;
          }
          break;
        }
        case 'raise': {
          const c = V.id(e.q, e.r);
          if (c >= 0) this.grace[c] = t + 60;
          break;
        }
        case 'find': {
          const c = V.id(e.q, e.r);
          if (c >= 0) this.taken.add(c);
          break;
        }
        default:
          break;
      }
    }
    for (const e of o.own) {
      const c = V.id(e.q, e.r);
      if (c < 0) continue;
      if (!this.isN[c]) {
        this.isN[c] = 1;
        this.needleCells.push(c);
      }
      this.own[c] = this.code(e.owner);
      this.dk[c] = e.dark ? 1 : 0;
    }
    const prevMine = this.myN;
    this.myN = [];
    this.wMine.fill(0);
    this.fedMine.fill(0);
    for (const nd of o.mine.needles) {
      const c = V.id(nd.q, nd.r);
      if (c < 0) continue;
      if (!this.isN[c]) {
        this.isN[c] = 1;
        this.needleCells.push(c);
      }
      this.own[c] = me;
      this.dk[c] = nd.dark ? 1 : 0;
      this.wMine[c] = nd.dark ? 0 : nd.weight;
      this.fedMine[c] = nd.fed ? 1 : 0;
      this.myN.push(c);
    }
    for (const c of prevMine) if (this.own[c] === me && this.wMine[c] === 0 && !this.myN.includes(c)) this.own[c] = 5;
    for (const l of o.mine.losts) {
      const c = V.id(l.q, l.r);
      if (c < 0) continue;
      this.own[c] = this.code(l.owner);
      this.dk[c] = l.dark ? 1 : 0;
      this.grace[c] = Math.max(this.grace[c]!, l.t + 60);
    }
    this.foes = [];
    for (const f of o.foe) this.foes.push({ id: f.id, p: f.p, cls: f.cls, q: f.q, r: f.r, c: V.id(f.q, f.r) });
    const ids = new Set<string>();
    for (const u of o.mine.units) {
      ids.add(u.id);
      if (!this.prevIds.has(u.id)) {
        if (u.cls === TKACH) this.pendT.shift();
        else this.pendK.shift();
      }
    }
    this.prevIds = ids;
    this.pendT = this.pendT.filter((x) => t - x < 25);
    this.pendK = this.pendK.filter((x) => t - x < 25);
  }

  private planOpening(): void {
    const V = this.V;
    this.cachePlan = -1;
    const dK = this.dist(this.hearth, true);
    let bestEta = INF;
    for (const f of this.man.finds) {
      if (f.kind !== 'cache') continue;
      const c = V.id(f.q, f.r);
      if (c < 0) continue;
      const e = 5 + dK[c]!;
      if (e > 36) continue;
      let rival = INF;
      for (const s of this.seatCells) if (s >= 0 && s !== this.hearth) rival = Math.min(rival, 5 + this.dist(s, true)[c]!);
      if (e < rival && e < bestEta) {
        bestEta = e;
        this.cachePlan = c;
      }
    }
  }

  private addPull(arr: Float32Array, c: number, mult: number, fed: boolean): void {
    const V = this.V;
    const I = fed ? V.feI[c]! : V.covI[c]!;
    const W = fed ? V.feW[c]! : V.covW[c]!;
    for (let k = 0; k < I.length; k++) arr[I[k]!]! += W[k]! * mult;
  }

  private derive(): void {
    const me = this.me;
    this.pMe.fill(0);
    this.pOpp.fill(0);
    this.myLit = [];
    for (const c of this.myN) {
      const w = this.wMine[c]!;
      if (w > 0) {
        this.myLit.push(c);
        this.addPull(this.pMe, c, w * this.ringMul(c), this.fedMine[c] === 1);
      }
    }
    for (const c of this.needleCells) {
      const ow = this.own[c]!;
      if (ow === me || ow === 4 || ow < 0 || this.dk[c]) continue;
      if (ow === 3 && this.dawn) continue;
      this.addPull(this.pOpp, c, this.isRing[c] ? this.ringMul(c) : 1, false);
    }
    this.netNodes = [this.hearth];
    for (const c of this.myN) this.netNodes.push(c);
    this.baseLit = new Set(this.litCells([]));
    let acc = false;
    for (const r of this.ringCells) {
      if (this.own[r] === me) acc = true;
      else for (const c of this.myLit) if (this.link.ok(c, r)) acc = true;
    }
    this.ringAccess = acc;
  }

  private litCells(extra: number[]): number[] {
    const nodes = this.netNodes.concat(extra);
    const m = nodes.length;
    const seen = new Uint8Array(m);
    const out: number[] = [];
    const queue = [0];
    seen[0] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi]!;
      const cu = nodes[u]!;
      out.push(cu);
      for (let v = 0; v < m; v++) {
        if (!seen[v] && this.link.ok(cu, nodes[v]!)) {
          seen[v] = 1;
          queue.push(v);
        }
      }
    }
    return out;
  }

  private connect(c: number): number[] | null {
    let tl = false;
    let td = false;
    for (const n of this.netNodes) {
      if (!this.link.ok(c, n)) continue;
      if (this.baseLit.has(n)) tl = true;
      else td = true;
    }
    if (!tl && !td) return null;
    if (!td) return [c];
    const lc = this.litCells([c]);
    if (!lc.includes(c)) return null;
    const out: number[] = [];
    for (const x of lc) if (x !== this.hearth && !this.baseLit.has(x)) out.push(x);
    return out;
  }

  private settle(): number {
    const V = this.V;
    const dp = this.dp;
    let g = 0;
    for (const x of this.touched) {
      const pm = this.pMe[x]!;
      const po = this.pOpp[x]!;
      g += V.val[x]! * (share(pm + dp[x]!, po) - share(pm, po));
      dp[x] = 0;
    }
    this.touched.length = 0;
    return g * this.cfgNum('minuteRate', 0.0005);
  }

  private gainOf(cells: number[]): number {
    const V = this.V;
    const dp = this.dp;
    this.touched.length = 0;
    for (const c of cells) {
      const w = this.ringMul(c);
      const I = V.covI[c]!;
      const W = V.covW[c]!;
      for (let k = 0; k < I.length; k++) {
        const x = I[k]!;
        if (dp[x] === 0) this.touched.push(x);
        dp[x]! += W[k]! * w;
      }
    }
    return this.settle();
  }

  private feedGain(c: number): number {
    const V = this.V;
    const dp = this.dp;
    const rings = this.man.rings;
    const mult = this.ringMul(c);
    const I = V.feI[c]!;
    const W = V.feW[c]!;
    this.touched.length = 0;
    for (let k = 0; k < I.length; k++) {
      const x = I[k]!;
      const d = hd(V.q[c]!, V.r[c]!, V.q[x]!, V.r[x]!);
      const base = d <= 3 ? (rings[d] ?? 0) : 0;
      const delta = (W[k]! - base) * mult;
      if (delta <= 0) continue;
      if (dp[x] === 0) this.touched.push(x);
      dp[x]! += delta;
    }
    return this.settle();
  }

  /* ---------- assignments ---------- */

  private resolve(o: Observe): void {
    const t = this.t;
    const me = this.me;
    this.reserved.clear();
    for (const [id, a] of [...this.assign]) {
      const u = this.unitById.get(id);
      if (!u) {
        this.assign.delete(id);
        continue;
      }
      const age = t - a.t0;
      let drop = false;
      switch (a.role) {
        case 'cap':
          if (this.own[a.cell] === me) drop = true;
          else if (age > 80 || (this.cellOf(u) === a.cell && age > 40)) {
            this.bad.set(a.cell, t + 100);
            drop = true;
          }
          break;
        case 'build':
          if (this.own[a.cell] === me || age > 70) drop = true;
          break;
        case 'cache':
          if (this.taken.has(a.cell) || age > 70) drop = true;
          break;
        case 'feed':
          if (this.own[a.cell] !== me || this.wMine[a.cell]! <= 0) drop = true;
          break;
        case 'stage':
          if (t >= this.dawnAt) drop = true;
          break;
        default:
          break;
      }
      if (drop) this.assign.delete(id);
      else if (a.role === 'cap' || a.role === 'build') this.reserved.add(a.cell);
    }
    void o;
  }

  /* ---------- pacts ---------- */

  private doPact(o: Observe): void {
    if (!this.pactsOn || this.partner !== null) return;
    for (const p of o.mine.pact.in) {
      if (p.left >= 1) {
        this.emit({ kind: 'pact', op: 'accept', to: p.who }, 75, '', true);
        return;
      }
    }
    if (o.mine.pact.out.length > 0 || o.mine.pact.offersLeft <= 0 || this.offered >= 2) return;
    if (this.t < 30 || this.t - this.lastOffer < 22) return;
    const names: SlotName[] = ['A', 'B', 'C'];
    const to = names[(this.me + 1 + this.offered) % 3]!;
    if (to === this.slot) return;
    this.emit({ kind: 'pact', op: 'offer', to }, 40, '', true);
    this.offered++;
    this.lastOffer = this.t;
  }

  /* ---------- defense ---------- */

  private doThreats(o: Observe): void {
    const V = this.V;
    this.emergencyK = false;
    for (const u of o.mine.units) {
      const a = this.assign.get(u.id);
      if (a && a.role === 'ram' && !this.foes.some((f) => f.id === a.tgt)) {
        this.assign.delete(u.id);
        if (u.task && u.task.ram) this.emit({ kind: 'halt', unit: u.id }, 88, u.id);
      }
    }
    const anchors = [this.hearth, ...this.myN];
    const ths: { f: Foe; pri: number }[] = [];
    for (const f of this.foes) {
      if (f.p === 'K' || f.p === this.slot || f.p === this.partner || f.c < 0) continue;
      let dm = 99;
      for (const a of anchors) dm = Math.min(dm, hd(V.q[a]!, V.r[a]!, f.q, f.r));
      if (dm > 4) continue;
      const onMine = this.own[f.c] === this.me;
      const pri = f.cls === TKACH ? (onMine ? 5 : dm <= 2 ? 3 : 2) : dm <= 2 ? 4 : 2;
      ths.push({ f, pri });
    }
    if (!ths.length) return;
    ths.sort((a, b) => b.pri - a.pri || (a.f.id < b.f.id ? -1 : 1));
    const ks = o.mine.units.filter((u) => u.cls === KLINOK && this.canCommand(u));
    const takenT = new Set<string>();
    for (const a of this.assign.values()) if (a.role === 'ram') takenT.add(a.tgt);
    for (const th of ths) {
      if (takenT.has(th.f.id)) continue;
      let best: MineUnit | null = null;
      let bd = 99;
      for (const u of ks) {
        const a = this.assign.get(u.id);
        if (a && a.role === 'ram') continue;
        const d = hd(u.q, u.r, th.f.q, th.f.r);
        if (d < bd) {
          bd = d;
          best = u;
        }
      }
      if (best && bd <= 16) {
        this.plan(best, 'ram', th.f.c, 85, th.f.id);
        takenT.add(th.f.id);
      } else if (th.pri >= 3) this.emergencyK = true;
    }
  }

  /* ---------- yard ---------- */

  private want(nT: number, nK: number): ClsName | null {
    const w = 2 * nT + nK;
    const cap = this.cfgNum('squadWeight', 8);
    if (this.t > this.total - 90) return null;
    if (this.cachePlan >= 0 && this.t <= 2 && nT === 0 && nK === 0) return KLINOK;
    if (nT < 2) return w + 2 <= cap ? TKACH : null;
    if (this.emergencyK && nK < 3 && w + 1 <= cap) return KLINOK;
    if (nK < 1 && w + 1 <= cap && (this.t >= 90 || this.myLit.length >= 6)) return KLINOK;
    if (nT < 3 && w + 2 <= cap) return TKACH;
    if (nK < 2 && w + 1 <= cap && this.t >= 160) return KLINOK;
    return null;
  }

  private doYard(o: Observe): void {
    let nT = this.pendT.length;
    let nK = this.pendK.length;
    for (const u of o.mine.units) if (u.cls === TKACH) nT++;
    else nK++;
    let builds = 0;
    for (const a of this.assign.values()) if (a.role === 'build') builds++;
    const energy = o.pulse.energy - this.lotRes - 60 * builds;
    let spent = 0;
    for (let k = 0; k < 3; k++) {
      const w = this.want(nT, nK);
      if (!w) break;
      const cost = w === TKACH ? this.cfgNum('costTkach', 90) : this.cfgNum('costKlinok', 50);
      if (energy - spent < cost) break;
      this.emit({ kind: 'yard', cls: w }, w === KLINOK && this.t <= 2 ? 90 : 70, '', true);
      spent += cost;
      if (w === TKACH) {
        nT++;
        this.pendT.push(this.t);
      } else {
        nK++;
        this.pendK.push(this.t);
      }
    }
    this.yardSpent = spent;
  }

  /* ---------- Tkachs ---------- */

  private doTkachs(o: Observe): void {
    const tk = o.mine.units.filter((u) => u.cls === TKACH && this.canCommand(u));
    let free = tk.filter((u) => {
      const a = this.assign.get(u.id);
      return !a || a.role === 'feed';
    });
    if (!free.length) return;
    const t = this.t;
    if (t >= this.dawnAt - 40 && t < this.dawnAt) free = this.doStage(free);
    if (!free.length) return;
    let builds = 0;
    for (const a of this.assign.values()) if (a.role === 'build') builds++;
    const energyFree = o.pulse.energy - this.yardSpent - this.lotRes - 60 * builds;
    const cands = this.candidates(energyFree, o);
    const rest = this.match(free, cands, energyFree);
    this.doFeed(rest);
  }

  private doStage(free: MineUnit[]): MineUnit[] {
    const reach = new Set<number>();
    const pool = this.ringCells.filter((r) => this.own[r] === 3);
    const queue: number[] = [];
    for (const r of pool) {
      for (const c of this.myLit) {
        if (this.link.ok(c, r)) {
          reach.add(r);
          queue.push(r);
          break;
        }
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const a = queue[qi]!;
      for (const r of pool) if (!reach.has(r) && this.link.ok(a, r)) {
        reach.add(r);
        queue.push(r);
      }
    }
    if (!reach.size) return free;
    const used = new Set<number>();
    for (const a of this.assign.values()) if (a.role === 'stage') used.add(a.cell);
    let staged = used.size;
    const left: MineUnit[] = [];
    for (const u of free) {
      if (staged >= 3 || this.assign.get(u.id)?.role === 'feed' && false) {
        left.push(u);
        continue;
      }
      const D = this.dist(this.cellOf(u), false);
      let best = -1;
      let bd = INF;
      for (const r of reach) {
        const sc = this.stageCell.get(r);
        if (sc === undefined || used.has(sc)) continue;
        const d = D[sc]!;
        if (d < bd) {
          bd = d;
          best = sc;
        }
      }
      if (best < 0 || bd >= INF) {
        left.push(u);
        continue;
      }
      used.add(best);
      staged++;
      this.plan(u, 'stage', best, 50);
    }
    return left;
  }

  private siteTaken(x: number): boolean {
    const V = this.V;
    for (const a of this.assign.values()) {
      if (a.role === 'build' && hd(V.q[x]!, V.r[x]!, V.q[a.cell]!, V.r[a.cell]!) < 3) return true;
    }
    return false;
  }

  private siteCands(): Cand[] {
    const V = this.V;
    const t = this.t;
    const list: number[] = [];
    for (const a of this.netNodes) {
      if (!this.baseLit.has(a)) continue;
      for (const [dq, dr] of OFFS6) {
        const x = V.id(V.q[a]! + dq, V.r[a]! + dr);
        if (x < 0 || this.mark[x]) continue;
        this.mark[x] = 1;
        list.push(x);
      }
    }
    const sc: { x: number; g: number; b: number }[] = [];
    const rem = Math.max(0, this.total - t - 20);
    for (const x of list) {
      this.mark[x] = 0;
      if (this.isN[x] || !V.bld[x] || this.isDead[x] || (this.bad.get(x) ?? 0) > t) continue;
      const xq = V.q[x]!;
      const xr = V.r[x]!;
      let ok = true;
      for (const s of this.seatCells) if (s >= 0 && hd(xq, xr, V.q[s]!, V.r[s]!) <= 2) ok = false;
      if (!ok) continue;
      if (!this.dawn && hd(xq, xr, V.q[this.center]!, V.r[this.center]!) <= this.cherta) continue;
      let md = 99;
      for (const c of this.myN) md = Math.min(md, hd(xq, xr, V.q[c]!, V.r[c]!));
      if (md < 3 || this.siteTaken(x)) continue;
      const nl = this.connect(x);
      if (!nl) continue;
      const g = this.gainOf(nl);
      let b = 0;
      if (!this.ringAccess && t < this.dawnAt && t > this.dawnAt - 420 && this.ringCells.some((r) => this.link.ok(x, r))) b = 8;
      sc.push({ x, g, b });
    }
    sc.sort((a, b) => b.g * rem + b.b - (a.g * rem + a.b) || a.x - b.x);
    const out: Cand[] = [];
    for (const s of sc.slice(0, 10)) {
      out.push({ cell: s.x, kind: 'site', work: this.cfgNum('buildTicks', 8), energy: this.cfgNum('costNeedle', 60), rate: s.g, bonus: s.b, dark: false });
    }
    return out;
  }

  private candidates(energyFree: number, o: Observe): Cand[] {
    const V = this.V;
    const t = this.t;
    const me = this.me;
    const out: Cand[] = [];
    const bonusOf = new Map<number, number>();
    const ord = o.pub.order;
    if (ord && ord.to - t >= 32) {
      const cs: number[] = [];
      let ok = true;
      for (const h of ord.cells) {
        const c = V.id(h.q, h.r);
        if (c < 0) {
          ok = false;
          break;
        }
        cs.push(c);
      }
      const todo: number[] = [];
      if (ok) {
        for (const c of cs) {
          const ow = this.own[c]!;
          if (ow === me) continue;
          if (this.isStart[c] || ow === 3 || (this.partnerCode >= 0 && ow === this.partnerCode) || (ow !== 4 && this.dk[c] !== 1)) {
            ok = false;
            break;
          }
          todo.push(c);
        }
      }
      if (ok && todo.length > 0) {
        const lc = this.litCells(todo);
        if (todo.every((c) => lc.includes(c))) for (const c of todo) bonusOf.set(c, (0.8 * ord.bonus) / todo.length);
      }
    }
    const heatN = this.cfgNum('heatNeedle', 8);
    const heatE = this.cfgNum('heatEnemy', 24);
    const heatD = this.cfgNum('heatDark', 16);
    for (const c of this.needleCells) {
      if (this.isStart[c]) continue;
      const ow = this.own[c]!;
      if (ow === me || this.reserved.has(c) || (this.bad.get(c) ?? 0) > t) continue;
      let work = heatN;
      let dark = false;
      let enemy = false;
      if (ow === 3) {
        if (!this.dawn) continue;
      } else if (ow !== 4) {
        if (this.partnerCode >= 0 && ow === this.partnerCode) continue;
        if (this.grace[c]! > t + 6) continue;
        enemy = true;
        dark = this.dk[c] === 1;
        work = dark ? heatD : heatE;
        if (!dark) {
          let danger = false;
          for (const f of this.foes) if (f.cls === KLINOK && f.p !== 'K' && f.p !== this.slot && hd(f.q, f.r, V.q[c]!, V.r[c]!) <= 8) danger = true;
          if (danger) continue;
        }
      }
      const nl = this.connect(c);
      const bonus = bonusOf.get(c) ?? 0;
      if (!nl && bonus === 0) continue;
      let rate = nl ? this.gainOf(nl) : 0;
      if (enemy && !dark) rate += 0.5 * this.gainOf([c]);
      out.push({ cell: c, kind: enemy ? 'enemy' : 'ruin', work, energy: 0, rate, bonus, dark });
    }
    if (energyFree + 0.5 * 15 >= this.cfgNum('costNeedle', 60)) for (const s of this.siteCands()) out.push(s);
    return out;
  }

  private match(free: MineUnit[], cands: Cand[], energyFree: number): MineUnit[] {
    const V = this.V;
    const t = this.t;
    const regen = 0.25 * Math.min(8, this.myLit.length);
    const ps: { u: MineUnit; c: Cand; s: number; eta: number }[] = [];
    for (const u of free) {
      const D = this.dist(this.cellOf(u), false);
      for (const c of cands) {
        const eta = D[c.cell]!;
        if (eta >= INF) continue;
        const tot = eta + c.work;
        if (t + tot + 3 >= this.total) continue;
        if (!this.inZone(c.cell) && tot > 36) continue;
        let v = c.rate * (this.total - t - tot) + c.bonus - c.energy * 0.04;
        if (c.kind === 'enemy' && !c.dark) v *= 0.5;
        const thr = c.kind === 'site' ? (energyFree > 250 ? 1.2 : 3) : 0.4;
        if (v < thr) continue;
        ps.push({ u, c, s: v / (tot + 4), eta });
      }
    }
    ps.sort((a, b) => b.s - a.s || (a.u.id < b.u.id ? -1 : a.u.id > b.u.id ? 1 : a.c.cell - b.c.cell));
    const usedU = new Set<string>();
    const usedC = new Set<number>();
    const sites: number[] = [];
    let eLeft = energyFree;
    for (const p of ps) {
      if (usedU.has(p.u.id) || usedC.has(p.c.cell)) continue;
      if (p.c.kind === 'site') {
        if (eLeft + regen * p.eta < p.c.energy) continue;
        let near = false;
        for (const s of sites) if (hd(V.q[s]!, V.r[s]!, V.q[p.c.cell]!, V.r[p.c.cell]!) < 3) near = true;
        if (near) continue;
        eLeft -= p.c.energy;
        sites.push(p.c.cell);
        this.plan(p.u, 'build', p.c.cell, 62);
      } else this.plan(p.u, 'cap', p.c.cell, 60);
      usedU.add(p.u.id);
      usedC.add(p.c.cell);
    }
    return free.filter((u) => !usedU.has(u.id));
  }

  private doFeed(rest: MineUnit[]): void {
    const t = this.t;
    const taken = new Set<number>();
    for (const a of this.assign.values()) if (a.role === 'feed') taken.add(a.cell);
    for (const u of rest) {
      const a = this.assign.get(u.id);
      if (a && a.role === 'feed') {
        this.plan(u, 'feed', a.cell, 50);
        continue;
      }
      const D = this.dist(this.cellOf(u), false);
      let best = -1;
      let bs = 0;
      for (const c of this.myLit) {
        if (taken.has(c) || this.fedMine[c] === 1 || this.isStart[c] && false) continue;
        const eta = D[c]!;
        if (eta >= INF) continue;
        const g = this.feedGain(c);
        if (g < 0.002) continue;
        const s = (g * Math.max(0, this.total - t - eta)) / (eta + 5);
        if (s > bs) {
          bs = s;
          best = c;
        }
      }
      if (best >= 0) {
        taken.add(best);
        this.plan(u, 'feed', best, 50);
      }
    }
  }

  /* ---------- Klinoks ---------- */

  private station(k: number): number {
    const V = this.V;
    const L = this.myLit;
    if (!L.length) return this.hearth;
    let tq = 0;
    let tr = 0;
    for (const c of L) {
      tq += V.q[c]!;
      tr += V.r[c]!;
    }
    tq /= L.length;
    tr /= L.length;
    let tgtQ = tq;
    let tgtR = tr;
    if (k % 2 === 1) {
      let bd = 99;
      for (const s of this.seatCells) {
        if (s < 0 || s === this.hearth) continue;
        const d = hd(V.q[s]!, V.r[s]!, V.q[this.hearth]!, V.r[this.hearth]!);
        if (d < bd) {
          bd = d;
          tgtQ = V.q[s]!;
          tgtR = V.r[s]!;
        }
      }
    }
    let best = L[0]!;
    let bd = 1e9;
    for (const c of L) {
      const d = Math.abs(V.q[c]! - tgtQ) + Math.abs(V.r[c]! - tgtR);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    for (let d = 0; d < 6; d++) {
      const x = V.nbr[best * 6 + d]!;
      if (x >= 0 && V.pass[x] && !this.isN[x]) return x;
    }
    return best;
  }

  private doKlinoks(o: Observe): void {
    const V = this.V;
    const ks = o.mine.units.filter((u) => u.cls === KLINOK).sort((a, b) => (a.id < b.id ? -1 : 1));
    let k = 0;
    for (const u of ks) {
      const idx = k++;
      if (!this.canCommand(u)) continue;
      const a = this.assign.get(u.id);
      if (a && a.role !== 'guard' && a.role !== 'cache') continue;
      if (this.cachePlan >= 0 && !this.taken.has(this.cachePlan) && this.t < 90 && (!a || a.role === 'cache')) {
        this.plan(u, 'cache', this.cachePlan, 55);
        continue;
      }
      const st = this.station(idx);
      if (hd(u.q, u.r, V.q[st]!, V.r[st]!) > 3) this.plan(u, 'guard', st, 30);
      else if (a && a.role === 'cache') this.assign.delete(u.id);
    }
  }

  /* ---------- auctions ---------- */

  private lotBid(i: number): number {
    const lot = this.man.lots[i];
    if (!lot) return 0;
    const cells: number[] = [];
    for (const h of lot.cells) {
      const c = this.V.id(h.q, h.r);
      if (c >= 0 && this.own[c] === 4) cells.push(c);
    }
    if (!cells.length) return 0;
    const lc = this.litCells(cells);
    const nl = lc.filter((x) => x !== this.hearth && !this.baseLit.has(x));
    if (!nl.length) return 0;
    const v = this.gainOf(nl) * Math.max(0, this.total - lot.at - 10);
    return Math.min(220, Math.floor(v / 0.1));
  }

  private lotPlan(): void {
    this.lotRes = 0;
    const lots = this.man.lots;
    for (let i = 0; i < lots.length; i++) {
      const d = lots[i]!.at - this.t;
      if (d >= 1 && d <= 25) {
        const b = this.lotBid(i);
        if (b >= 60) this.lotRes = Math.max(this.lotRes, Math.min(b, 120));
      }
    }
  }

  private doBids(o: Observe): void {
    const lots = this.man.lots;
    for (let i = 0; i < lots.length; i++) {
      if (lots[i]!.at !== this.t + 1) continue;
      const amount = Math.min(this.lotBid(i), Math.floor(o.pulse.energy));
      if (amount >= 60) this.emit({ kind: 'bid', lot: i, amount }, 78, '', true);
    }
  }

  /* ---------- budget ---------- */

  private finalize(o: Observe): Order[] {
    const chan = o.pulse.chan;
    const cap = Math.floor(chan / 32) + 4;
    let hands = 0;
    for (const u of o.mine.units) if (this.active(u)) hands++;
    const live = this.cmds.filter((c) => !c.dead).sort((a, b) => b.pri - a.pri || a.seq - b.seq);
    const out: Cmd[] = [];
    let used = 0;
    let wakes = 0;
    for (const c of live) {
      if (out.length >= cap) break;
      if (used + c.cost > chan) continue;
      if (c.free && chan - used < 32) continue;
      if (!c.hard && c.pri < 80 && used + c.cost + 32 * (hands + wakes + (c.wake ? 1 : 0)) > chan) continue;
      out.push(c);
      used += c.cost;
      if (c.wake) wakes++;
    }
    if (this.t - this.lastOkT >= 3 && out.length < cap && chan - used >= 32) {
      const V = this.V;
      out.push({
        pri: 1,
        seq: this.seq++,
        order: { kind: 'watch', q: V.q[this.hearth] ?? 0, r: V.r[this.hearth] ?? 0, keep: 0 },
        unit: '',
        wake: false,
        hard: true,
        free: false,
        cost: 32,
        dead: false,
      });
    }
    this.sent = out;
    return out.map((c) => c.order);
  }

  feedback(verdicts: Uint8Array): void {
    try {
      const v = decodeVerdicts(verdicts);
      if (!v) return;
      for (const [i, ok, code] of v) {
        const c = this.sent[i];
        if (!c) continue;
        if (ok) {
          this.lastOkT = this.t;
          continue;
        }
        this.denied(c, code);
      }
    } catch {
      /* feedback never throws */
    }
  }

  private denied(c: Cmd, code: number): void {
    const o = c.order;
    const V = this.V;
    if (o.kind === 'yard') {
      if (code === 9 || code === 10 || code === 8 || code === 6 || code === 2) {
        if (o.cls === TKACH) this.pendT.pop();
        else this.pendK.pop();
      }
    } else if (o.kind === 'move' || o.kind === 'needle' || o.kind === 'feed') {
      if (code === 11 || code === 12 || code === 13 || code === 21) {
        const cell = V.id(o.q, o.r);
        if (cell >= 0) this.bad.set(cell, this.t + 80);
        this.assign.delete(o.unit);
      } else if (code === 3) this.assign.delete(o.unit);
    } else if (o.kind === 'ram') {
      if (code === 17 || code === 16 || code === 3) this.assign.delete(o.unit);
    }
  }

  /* ---------- belief diary ---------- */

  belief(obs: Observe | null): BeliefFrame | null {
    if (!obs || !this.ready) return null;
    try {
      const V = this.V;
      const full = this.beliefN % 200 === 0;
      this.beliefN++;
      const own: Record<string, string | null> = {};
      const dark: Record<string, boolean> = {};
      for (const c of this.needleCells) {
        const key = V.q[c]! + ',' + V.r[c]!;
        const ow = this.own[c]!;
        const s: string | null = ow === 0 ? 'A' : ow === 1 ? 'B' : ow === 2 ? 'C' : ow === 3 ? 'K' : null;
        const d = this.dk[c] === 1;
        if (full || !this.bOwn.has(key) || this.bOwn.get(key) !== s) own[key] = s;
        if (full || this.bDark.get(key) !== d) dark[key] = d;
        this.bOwn.set(key, s);
        this.bDark.set(key, d);
      }
      const f: BeliefFrame = {
        t: obs.t,
        pulse: { energy: obs.pulse.energy, chan: obs.pulse.chan, ear: obs.pulse.ear, minutes: obs.pulse.minutes, needles: obs.pulse.needles },
        own,
        dark,
        foe: obs.foe.map((x) => [x.id, x.p, x.q, x.r] as [string, string, number, number]),
        noisy: obs.noisy.length,
        units: obs.mine.units.map((u) => [u.id, u.q, u.r, u.task ? u.task.path : 0] as [string, number, number, number]),
        pact: this.partner,
        cries: obs.pub.cries.map((x) => [x[0], x[1]] as [string, number]),
      };
      if (full) f.full = true;
      return f;
    } catch {
      return null;
    }
  }
}

/* names of the presets: the preset-change handle uses them */
export function presets(): string[] {
  return ['зоря', 'самітник'];
}

export function createStrategy(preset = process.env['ZARIA_PRESET'] || 'зоря'): Strategy {
  return new ZoriaBot(preset !== 'самітник');
}
