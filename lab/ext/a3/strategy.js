/* bot :: strategy
   Head "Vatra": an own Zoria head built on WireBot, without a mirror engine.

   Tkachs work a greedy schedule of jobs ranked by (minutes gained until the
   end of the match) / (Tkach ticks spent): ruin captures linked to the thread,
   recaptures of lost or dark enemy needles, building of needles on free land
   (with a bonus for bridges that unlock ruins or the ring), contract cells,
   caches; with nothing better they feed their best lit needle. Klinoks grab
   caches, ram intruders (a ram on a working Tkach is clean), and otherwise
   hold loot jams on enemy needles or on the Keeper's ring from outside the
   line. Before dawn Tkachs stage next to ring needles and step on exactly
   when it is safe. Surplus energy goes to lots. Scans are paid by the ears
   only, so the head scans every tick it can, which also keeps the slot. */
import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, stormAt } from '@zoria/protocol';
/* ---------------------------------------------------------------- geometry */
const PAD = 26;
const W = 2 * PAD + 1;
const NC = W * W;
const VR = 19;
const INF = 1 << 29;
const TK = 'ткач';
const KL = 'клинок';
const NEI = [W, W - 1, -1, -W, -W + 1, 1];
const SLOTS = ['A', 'B', 'C'];
function ix(q, r) {
    return (q + PAD) * W + (r + PAD);
}
function cq(i) {
    return Math.floor(i / W) - PAD;
}
function cr(i) {
    return (i % W) - PAD;
}
function hd(aq, ar, bq, br) {
    const dq = aq - bq;
    const dr = ar - br;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
function dist(a, b) {
    return hd(cq(a), cr(a), cq(b), cr(b));
}
function shr(m, o) {
    return m <= 0 ? 0 : m / Math.max(1, m + o);
}
/* disks: flat pairs [offset, distance] */
const DISK = [];
for (let R = 0; R <= 6; R++) {
    const a = [];
    for (let dq = -R; dq <= R; dq++) {
        for (let dr = -R; dr <= R; dr++) {
            const d = hd(dq, dr, 0, 0);
            if (d <= R)
                a.push(dq * W + dr, d);
        }
    }
    DISK.push(Int32Array.from(a));
}
class Heap {
    k = [];
    v = [];
    key = 0;
    get size() {
        return this.k.length;
    }
    push(key, val) {
        const k = this.k;
        const v = this.v;
        let i = k.length;
        k.push(key);
        v.push(val);
        while (i > 0) {
            const p = (i - 1) >> 1;
            const pk = k[p];
            if (pk <= key)
                break;
            k[i] = pk;
            v[i] = v[p];
            i = p;
        }
        k[i] = key;
        v[i] = val;
    }
    pop() {
        const k = this.k;
        const v = this.v;
        const rk = k[0];
        const rv = v[0];
        const lk = k.pop();
        const lv = v.pop();
        const n = k.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                let c = 2 * i + 1;
                if (c >= n)
                    break;
                if (c + 1 < n && k[c + 1] < k[c])
                    c++;
                if (k[c] >= lk)
                    break;
                k[i] = k[c];
                v[i] = v[c];
                i = c;
            }
            k[i] = lk;
            v[i] = lv;
        }
        this.key = rk;
        return rv;
    }
}
/* ------------------------------------------------------------ world numbers */
const DEF = {
    linkRange: 5,
    heatNeedle: 8,
    heatEnemy: 24,
    heatDark: 16,
    capGrace: 60,
    costTkach: 90,
    costKlinok: 50,
    stepTkach: 2,
    stepKlinok: 1,
    stepRise: 1,
    weightTkach: 2,
    weightKlinok: 1,
    squadWeight: 8,
    costNeedle: 60,
    buildTicks: 8,
    feedRing: 1,
    autonomy: 40,
    jamStart: 64,
    jamKeep: 8,
    jamHold: 20,
    chanOrder: 32,
    chanTick: 32,
    scanCost: 256,
    scanRad: 3,
    stormCost: 2,
    minuteRate: 0.0005,
    ringPull: 1.25,
    dawnRing: 2,
    energyCap: 360,
    orderHoldTicks: 12,
    visExact: 2,
    visTkach: 3,
    visKlinok: 1,
    droneBuild: 4,
};
/* terrain defaults by dictionary index: pass, build, step, value, reach, block */
const DEF_T = [
    [1, 1, 1, 2, 0, 0],
    [1, 1, 1, 3, 0, 0],
    [1, 1, 1, 2, 0, 0],
    [1, 1, 1, 1, 0, 0],
    [1, 1, 2, 1, 0, 0],
    [1, 1, 2, 1, 1, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0, 1],
];
class Out {
    orders = [];
    meta = [];
    chan = 0;
    ear = 0;
    cap = 0;
    acting = 0;
    tick = 32;
    energy = 0;
    room(cost, add) {
        return this.orders.length < this.cap && this.chan - cost >= this.tick * (this.acting + add);
    }
    push(o, m, chanCost, earCost, add) {
        this.orders.push(o);
        this.meta.push(m);
        this.chan -= chanCost;
        this.ear -= earCost;
        this.acting += add;
    }
    front(o, m, earCost) {
        this.orders.unshift(o);
        this.meta.unshift(m);
        this.ear -= earCost;
    }
}
const KNOBS = { order: 'TTKTK', jam: 1, guard: 1, hunt: 1, open: 1 };
function mkJob(kind, i, t, prio) {
    return { kind, i, stand: -1, foe: '', since: t, issued: -1, tries: 0, arrived: -1, phase: 0, prio, seenFoe: t };
}
/* -------------------------------------------------------------------- head */
class Vatra {
    kn;
    constructor(kn) {
        this.kn = kn;
    }
    man = null;
    slot = 'A';
    oracle = null;
    oracleLink = false;
    oraclePath = false;
    oracleStorm = false;
    ready = false;
    K = { ...DEF };
    inV = new Uint8Array(NC);
    pass = new Uint8Array(NC);
    bld = new Uint8Array(NC);
    stepM = new Uint8Array(NC);
    reach = new Uint8Array(NC);
    block = new Uint8Array(NC);
    lev = new Int16Array(NC);
    val = new Float64Array(NC);
    dead = new Uint8Array(NC);
    cdist = new Int16Array(NC);
    seatD = new Int16Array(NC);
    cells = [];
    T = 1200;
    dawnAt = 1000;
    dawnMul = 2;
    cherta = 6;
    rings = [1, 1, 2 / 3, 1 / 3];
    fedW = [1, 1, 1, 2 / 3, 1 / 3];
    feedDelta = [0, 0, 1 / 3, 1 / 3, 1 / 3];
    seats = [];
    hearth = -1;
    needles = new Map();
    finds = [];
    lots = [];
    linkCache = new Map();
    black = new Map();
    jobs = new Map();
    pending = [];
    prevUnits = new Set();
    foeMem = new Map();
    jammedMine = new Map();
    sent = [];
    sentAt = -1;
    lastOk = 0;
    t = 0;
    openK = false;
    yardHold = 0;
    dawnDone = false;
    unitReserve = 0;
    others = [];
    obs = null;
    mine = new Set();
    mineW = new Map();
    myPull = new Float64Array(NC);
    othPull = new Float64Array(NC);
    zoneD = new Int16Array(NC);
    nearD = new Int16Array(NC);
    avoid = new Uint8Array(NC);
    foeEye = new Uint8Array(NC);
    sources = [];
    orphans = [];
    orphanRate = new Map();
    units = [];
    occupied = new Set();
    stormC = new Map();
    dijC = new Map();
    lineFree = false;
    contract = null;
    jamByMe = new Set();
    beliefN = 0;
    beliefOwn = new Map();
    /* ------------------------------------------------------------ wire face */
    init(manifestBytes, slot) {
        this.slot = slot;
        this.others = SLOTS.filter((s) => s !== slot);
        try {
            const m = decodeManifest(manifestBytes);
            if (m) {
                this.setup(m);
                try {
                    this.oracle = new RulesOracle(createEngine, manifestBytes);
                }
                catch {
                    this.oracle = null;
                }
                this.probeOracle();
                this.ready = true;
            }
        }
        catch {
            this.ready = this.man !== null;
        }
    }
    tick(observeBytes) {
        let orders = [];
        let meta = [];
        let t = this.t;
        try {
            const o = decodeObserve(observeBytes);
            if (o) {
                t = o.t;
                if (this.ready) {
                    const r = this.step(o);
                    orders = r.orders;
                    meta = r.meta;
                }
                else {
                    orders = this.fallback(o);
                    meta = orders.map((x) => ({ kind: x.kind, unit: '', i: -1 }));
                }
            }
        }
        catch {
            orders = [];
            meta = [];
            try {
                if (this.obs) {
                    orders = this.fallback(this.obs);
                    meta = orders.map((x) => ({ kind: x.kind, unit: '', i: -1 }));
                }
            }
            catch {
                orders = [];
            }
        }
        this.sent = meta;
        this.sentAt = t;
        try {
            return encodeOrders(orders);
        }
        catch {
            try {
                return encodeOrders([]);
            }
            catch {
                return new Uint8Array(0);
            }
        }
    }
    feedback(verdictBytes) {
        try {
            const v = decodeVerdicts(verdictBytes);
            if (!v)
                return;
            for (const row of v) {
                const idx = row[0];
                const ok = row[1];
                const code = row[2];
                const m = this.sent[idx];
                if (ok) {
                    this.lastOk = this.sentAt;
                    continue;
                }
                if (!m)
                    continue;
                this.onDeny(m, code);
            }
        }
        catch {
            /* verdicts are advice only */
        }
    }
    belief(obs) {
        try {
            if (!this.ready)
                return null;
            const p = obs ? obs.pulse : this.obs ? this.obs.pulse : null;
            const f = {
                t: obs ? obs.t : this.t,
                pulse: { energy: p ? p.energy : 0, chan: p ? p.chan : 0, ear: p ? p.ear : 0, minutes: p ? p.minutes : 0, needles: p ? p.needles : 0 },
            };
            const full = this.beliefN % 200 === 0;
            this.beliefN++;
            if (full)
                f.full = true;
            const own = {};
            const dark = {};
            let nOwn = 0;
            for (const N of this.needles.values()) {
                const key = cq(N.i) + ',' + cr(N.i);
                const sig = (N.owner ?? '-') + (N.dark ? '0' : '1');
                if (full || this.beliefOwn.get(N.i) !== sig) {
                    own[key] = N.owner;
                    dark[key] = N.dark;
                    this.beliefOwn.set(N.i, sig);
                    nOwn++;
                }
            }
            if (nOwn > 0 || full) {
                f.own = own;
                f.dark = dark;
            }
            const src = obs ?? this.obs;
            if (src) {
                f.foe = src.foe.map((e) => [e.id, e.p, e.q, e.r]);
                f.noisy = src.noisy.length;
                f.units = src.mine.units.map((u) => [u.id, u.q, u.r, u.task ? u.task.path : 0]);
                const act = src.pub.pact.active.find((a) => a.a === this.slot || a.b === this.slot);
                f.pact = act ? (act.a === this.slot ? act.b : act.a) : null;
            }
            return f;
        }
        catch {
            return null;
        }
    }
    /* minimal frame that keeps the slot: used before setup or after a fault */
    fallback(o) {
        for (const u of o.mine.units) {
            if (!u.task && u.wait === 0)
                return [{ kind: 'halt', unit: u.id }];
        }
        const h = this.hearth >= 0 ? this.hearth : -1;
        if (h >= 0)
            return [{ kind: 'watch', q: cq(h), r: cr(h), keep: 0 }];
        const s = this.man ? this.man.seats[0] : null;
        return [{ kind: 'watch', q: s ? s.q : 0, r: s ? s.r : 0, keep: 0 }];
    }
    /* ---------------------------------------------------------------- setup */
    setup(m) {
        this.man = m;
        const cfg = m.cfg ?? {};
        for (const key of Object.keys(DEF)) {
            const v = cfg[key];
            if (typeof v === 'number' && Number.isFinite(v))
                this.K[key] = v;
        }
        this.T = m.ticks > 0 ? m.ticks : 1200;
        this.dawnAt = m.dawn && m.dawn.at > 0 ? m.dawn.at : this.T - 200;
        this.dawnMul = m.dawn && m.dawn.ring > 0 ? m.dawn.ring : this.K.dawnRing;
        this.cherta = m.cherta > 0 ? m.cherta : 6;
        if (Array.isArray(m.rings) && m.rings.length >= 2 && m.rings.every((x) => typeof x === 'number' && Number.isFinite(x))) {
            this.rings = m.rings.slice(0, 5);
        }
        const fr = Math.max(0, Math.min(2, Math.round(this.K.feedRing)));
        this.fedW = [];
        this.feedDelta = [];
        for (let d = 0; d < this.rings.length + fr; d++) {
            const w = this.rings[Math.max(0, d - fr)] ?? 0;
            this.fedW.push(w);
            this.feedDelta.push(Math.max(0, w - (this.rings[d] ?? 0)));
        }
        /* terrain passports */
        const tp = [];
        for (let k = 0; k < 8; k++) {
            const d = DEF_T[k];
            const x = m.terrain && m.terrain.types ? m.terrain.types[k] : undefined;
            if (!x) {
                tp.push([d[0], d[1], d[2], d[3], d[4], d[5]]);
                continue;
            }
            const cost = typeof x.cost === 'number' && x.cost > 0 && x.cost < 10 ? x.cost : d[2];
            const mn = typeof x.min === 'number' && Number.isFinite(x.min) && x.min >= 0 && x.min < 20 ? x.min : d[3];
            tp.push([x.pass ? 1 : 0, x.build ? 1 : 0, cost, mn, x.reach ? 1 : 0, x.block ? 1 : 0]);
        }
        const ter = new Uint8Array(NC);
        for (let q = -VR; q <= VR; q++) {
            for (let r = -VR; r <= VR; r++) {
                if (hd(q, r, 0, 0) > VR)
                    continue;
                const i = ix(q, r);
                this.inV[i] = 1;
                this.cells.push(i);
                this.cdist[i] = hd(q, r, 0, 0);
            }
        }
        this.cells.sort((a, b) => a - b);
        /* non-bare cells: detect the tuple layout by checking that no needle,
           seat or find lands on impassable ground */
        const tc = m.terrain && Array.isArray(m.terrain.cells) ? m.terrain.cells : [];
        const layouts = [
            [0, 1, 2],
            [1, 0, 2],
            [1, 2, 0],
            [2, 1, 0],
        ];
        const probes = [];
        for (const n of m.needles)
            probes.push(ix(n.q, n.r));
        for (const s of m.seats)
            probes.push(ix(s.q, s.r));
        for (const f of m.finds)
            probes.push(ix(f.q, f.r));
        let best = 0;
        let bestBad = INF;
        for (let li = 0; li < layouts.length; li++) {
            const L = layouts[li];
            let valid = true;
            const tmp = new Uint8Array(NC);
            for (const c of tc) {
                const q = c[L[0]];
                const r = c[L[1]];
                const ty = c[L[2]];
                if (q === undefined || r === undefined || ty === undefined || !(ty >= 0 && ty <= 7) || hd(q, r, 0, 0) > VR + 1) {
                    valid = false;
                    break;
                }
                tmp[ix(q, r)] = ty;
            }
            if (!valid)
                continue;
            let bad = 0;
            for (const p of probes) {
                const ty = tmp[p];
                if (!(tp[ty][0] > 0))
                    bad++;
            }
            if (bad < bestBad) {
                bestBad = bad;
                best = li;
            }
        }
        const L = layouts[best];
        for (const c of tc) {
            const q = c[L[0]];
            const r = c[L[1]];
            const ty = c[L[2]];
            if (q === undefined || r === undefined || ty === undefined || !(ty >= 0 && ty <= 7))
                continue;
            if (hd(q, r, 0, 0) > VR)
                continue;
            ter[ix(q, r)] = ty;
        }
        for (const i of this.cells) {
            const p = tp[ter[i]];
            this.pass[i] = p[0];
            this.bld[i] = p[1];
            this.stepM[i] = Math.max(1, Math.round(p[2]));
            this.val[i] = p[3] * this.K.minuteRate;
            this.reach[i] = p[4];
            this.block[i] = p[5];
        }
        /* levels, (r, q) ascending */
        const lv = Array.isArray(m.levels) ? m.levels : [];
        if (lv.length === this.cells.length) {
            let k = 0;
            for (let r = -VR; r <= VR; r++) {
                for (let q = -VR; q <= VR; q++) {
                    if (hd(q, r, 0, 0) > VR)
                        continue;
                    this.lev[ix(q, r)] = lv[k] ?? 0;
                    k++;
                }
            }
        }
        for (const n of m.needles) {
            const i = ix(n.q, n.r);
            const ring = !!(n.ring || n.spoke);
            this.needles.set(i, { i, start: n.start !== null && n.start !== undefined, ring, owner: ring ? 'K' : (n.start ?? null), dark: false, seen: -1, grace: 0 });
        }
        this.seats = m.seats.map((s) => ix(s.q, s.r));
        for (const i of this.cells) {
            let d = INF;
            for (const s of this.seats)
                d = Math.min(d, dist(i, s));
            this.seatD[i] = d;
        }
        for (const f of m.finds) {
            const i = ix(f.q, f.r);
            this.finds.push({ kind: f.kind, i, taken: false });
            if (f.kind === 'dead')
                this.dead[i] = 1;
        }
        for (const l of m.lots)
            this.lots.push({ at: l.at, cells: l.cells.map((h) => ix(h.q, h.r)), done: false, bid: 0 });
    }
    probeOracle() {
        const o = this.oracle;
        if (!o || !this.man)
            return;
        /* levels straight from the engine, if it answers */
        try {
            const E = o.engine;
            if (E && typeof E.terrainLevel === 'function') {
                let okAll = true;
                const tmp = new Int16Array(NC);
                for (const i of this.cells) {
                    const v = E.terrainLevel(cq(i), cr(i));
                    if (typeof v !== 'number' || !Number.isFinite(v)) {
                        okAll = false;
                        break;
                    }
                    tmp[i] = v;
                }
                if (okAll)
                    this.lev = tmp;
            }
        }
        catch {
            /* keep manifest levels */
        }
        const s0 = this.man.seats[0];
        const nd = this.man.needles.find((n) => n.start !== null && s0 && hd(n.q, n.r, s0.q, s0.r) <= 1);
        try {
            if (s0 && nd)
                this.oracleLink = o.linkOk({ q: s0.q, r: s0.r }, { q: nd.q, r: nd.r }) === true;
        }
        catch {
            this.oracleLink = false;
        }
        try {
            if (s0 && nd) {
                const p = o.path({ q: s0.q, r: s0.r }, { q: nd.q, r: nd.r }, TK);
                this.oraclePath = Array.isArray(p);
            }
        }
        catch {
            this.oraclePath = false;
        }
        try {
            const v = o.storm({ q: 0, r: 0 }, 1);
            this.oracleStorm = typeof v === 'boolean';
        }
        catch {
            this.oracleStorm = false;
        }
    }
    /* ---------------------------------------------------------- primitives */
    link(a, b) {
        if (a === b)
            return true;
        const d = dist(a, b);
        const lr = this.K.linkRange;
        const mx = Math.max(lr + (this.reach[a] ? 1 : 0), lr + (this.reach[b] ? 1 : 0));
        if (d > mx)
            return false;
        if (d <= 1)
            return true;
        const key = a < b ? a * NC + b : b * NC + a;
        const c = this.linkCache.get(key);
        if (c !== undefined)
            return c;
        let ok = false;
        if (this.oracle && this.oracleLink) {
            try {
                ok = this.oracle.linkOk({ q: cq(a), r: cr(a) }, { q: cq(b), r: cr(b) }) === true;
            }
            catch {
                ok = this.lineClear(a, b);
            }
        }
        else
            ok = this.lineClear(a, b);
        this.linkCache.set(key, ok);
        return ok;
    }
    lineClear(a, b) {
        const aq = cq(a);
        const ar = cr(a);
        const bq = cq(b);
        const br = cr(b);
        const n = Math.max(1, dist(a, b)) * 4;
        for (let k = 1; k < n; k++) {
            const f = k / n;
            const x = aq + (bq - aq) * f + 1e-6;
            const z = ar + (br - ar) * f + 1e-6;
            const y = -x - z;
            let rx = Math.round(x);
            let rz = Math.round(z);
            const ry = Math.round(y);
            const dx = Math.abs(rx - x);
            const dy = Math.abs(ry - y);
            const dz = Math.abs(rz - z);
            if (dx > dy && dx > dz)
                rx = -ry - rz;
            else if (dy <= dz)
                rz = -rx - ry;
            const c = ix(rx, rz);
            if (c !== a && c !== b && this.block[c])
                return false;
        }
        return true;
    }
    linkAny(i, list) {
        const lr = this.K.linkRange + 1;
        for (const s of list) {
            if (s === i)
                continue;
            if (dist(i, s) <= lr && this.link(i, s))
                return true;
        }
        return false;
    }
    stormy(i) {
        const m = this.man;
        if (!m || m.storms.length === 0)
            return false;
        const c = this.stormC.get(i);
        if (c !== undefined)
            return c;
        let v = false;
        if (this.oracle && this.oracleStorm) {
            try {
                v = this.oracle.storm({ q: cq(i), r: cr(i) }, this.t) === true;
            }
            catch {
                v = false;
            }
        }
        else {
            try {
                v = stormAt(m.storms, cq(i), cr(i), this.t);
            }
            catch {
                v = false;
            }
        }
        this.stormC.set(i, v);
        return v;
    }
    ucost(u) {
        return this.K.chanOrder * (this.stormy(ix(u.q, u.r)) ? this.K.stormCost : 1);
    }
    hcost() {
        return this.K.chanOrder * (this.hearth >= 0 && this.stormy(this.hearth) ? this.K.stormCost : 1);
    }
    addCov(arr, i, w, mult) {
        const disk = DISK[Math.min(6, w.length - 1)];
        const inV = this.inV;
        for (let k = 0; k < disk.length; k += 2) {
            const c = i + disk[k];
            if (!inV[c])
                continue;
            arr[c] = arr[c] + (w[disk[k + 1]] ?? 0) * mult;
        }
    }
    /* minutes per tick I gain by adding pull w*mult at needle i, optionally
       removing someone else's pull rem*remMult at the same needle */
    gain(i, w, mult, my, oth, rem, remMult) {
        const R = Math.max(w.length, rem ? rem.length : 0) - 1;
        const disk = DISK[Math.min(6, Math.max(0, R))];
        const inV = this.inV;
        const val = this.val;
        let g = 0;
        for (let k = 0; k < disk.length; k += 2) {
            const c = i + disk[k];
            if (!inV[c])
                continue;
            const v = val[c];
            if (v <= 0)
                continue;
            const d = disk[k + 1];
            const add = (w[d] ?? 0) * mult;
            const rm = rem ? (rem[d] ?? 0) * remMult : 0;
            const m = my[c];
            const o = oth[c];
            g += v * (shr(m + add, Math.max(0, o - rm)) - shr(m, o));
        }
        return g;
    }
    lossAt(i, rem, remMult, my, oth) {
        const disk = DISK[Math.min(6, rem.length - 1)];
        let g = 0;
        for (let k = 0; k < disk.length; k += 2) {
            const c = i + disk[k];
            if (!this.inV[c])
                continue;
            const v = this.val[c];
            if (v <= 0)
                continue;
            const x = (rem[disk[k + 1]] ?? 0) * remMult;
            g += (v * x) / Math.max(1, my[c] + oth[c]);
        }
        return g;
    }
    multFor(i, owner, at) {
        const N = this.needles.get(i);
        if (!N || !N.ring)
            return 1;
        if (owner === 'K')
            return at >= this.dawnAt ? 0 : this.K.ringPull;
        return at >= this.dawnAt ? this.dawnMul : this.K.ringPull;
    }
    heatCost(N, at) {
        if (N.owner === null)
            return this.K.heatNeedle;
        if (N.owner === 'K' && at >= this.dawnAt)
            return this.K.heatNeedle;
        return N.dark ? this.K.heatDark : this.K.heatEnemy;
    }
    dij(src, cls) {
        const key = src * 2 + cls;
        const hit = this.dijC.get(key);
        if (hit)
            return hit;
        const d = new Int32Array(NC).fill(INF);
        const p = new Int32Array(NC).fill(-1);
        const base = cls === 0 ? this.K.stepTkach : this.K.stepKlinok;
        const rise = this.K.stepRise;
        const useAvoid = cls === 0 && !this.lineFree;
        const h = new Heap();
        d[src] = 0;
        h.push(0, src);
        while (h.size > 0) {
            const i = h.pop();
            const di = h.key;
            if (di > d[i])
                continue;
            const li = this.lev[i];
            for (let k = 0; k < 6; k++) {
                const n = i + NEI[k];
                if (!this.inV[n] || !this.pass[n])
                    continue;
                const climb = this.lev[n] - li;
                if (climb >= 2)
                    continue;
                if (useAvoid && this.avoid[n])
                    continue;
                const nd = di + base * this.stepM[n] + (climb > 0 ? rise * climb : 0);
                if (nd < d[n]) {
                    d[n] = nd;
                    p[n] = i;
                    h.push(nd, n);
                }
            }
        }
        const r = { d, p };
        this.dijC.set(key, r);
        return r;
    }
    bfs(seeds, out) {
        out.fill(999);
        const q = [];
        for (const s of seeds) {
            if (out[s] !== 0) {
                out[s] = 0;
                q.push(s);
            }
        }
        for (let h = 0; h < q.length; h++) {
            const i = q[h];
            const nd = out[i] + 1;
            for (let k = 0; k < 6; k++) {
                const n = i + NEI[k];
                if (!this.inV[n] || out[n] <= nd)
                    continue;
                out[n] = nd;
                q.push(n);
            }
        }
    }
    idle(u) {
        const k = u.task;
        return !k || (k.path === 0 && !k.site && !k.feed && !k.jam && !k.ram && !k.goal);
    }
    canCmd(u) {
        if (u.stuck)
            return false;
        return !(u.wait > 0 && u.task !== null && u.task.path > 0);
    }
    heatableAt(i) {
        const N = this.needles.get(i);
        return !!N && N.owner !== this.slot && !N.start && N.grace <= this.t;
    }
    acting(u) {
        if (!this.idle(u))
            return true;
        return u.cls === TK && this.heatableAt(ix(u.q, u.r));
    }
    isBlack(unit, i) {
        const a = this.black.get(unit + '|' + i);
        if (a !== undefined && a > this.t)
            return true;
        const g = this.black.get('*|' + i);
        return g !== undefined && g > this.t;
    }
    setBlack(unit, i, ticks) {
        this.black.set(unit + '|' + i, this.t + ticks);
    }
    dangerRaw(i) {
        let f = 1;
        for (const m of this.foeMem.values()) {
            if (m.p === 'K' || m.p === this.slot || m.cls !== KL)
                continue;
            const age = this.t - m.t;
            if (age > 20)
                continue;
            if (dist(m.i, i) <= 6)
                f = Math.min(f, 0.6);
        }
        if (this.foeEye[i])
            f *= 0.85;
        return f;
    }
    /* survival factor of a Tkach working at i: enemy Klinoks seen nearby,
       enemy eyes on the cell, my own Klinoks close by */
    danger(i) {
        let f = 1;
        for (const m of this.foeMem.values()) {
            if (m.p === 'K' || m.p === this.slot || m.cls !== KL)
                continue;
            const age = this.t - m.t;
            if (age > 20)
                continue;
            const d = dist(m.i, i);
            if (d <= 4 && age <= 8)
                f = Math.min(f, 0.4);
            else if (d <= 6)
                f = Math.min(f, 0.7);
        }
        if (this.foeEye[i])
            f *= 0.85;
        if (f < 1) {
            for (const u of this.units)
                if (u.cls === KL && dist(ix(u.q, u.r), i) <= 2)
                    return Math.min(1, f * 1.6);
        }
        return f;
    }
    ev(energy) {
        const base = energy >= 300 ? 0.003 : energy >= 200 ? 0.01 : 0.03;
        return (base * Math.max(0, this.T - this.t)) / this.T;
    }
    /* exact sight of my eyes (level rule included) */
    exactSees(i) {
        const li = this.lev[i];
        const ok = (e, rad) => dist(e, i) <= rad && li <= this.lev[e];
        if (this.hearth >= 0 && ok(this.hearth, this.K.visExact))
            return true;
        for (const n of this.mine)
            if (ok(n, this.K.visExact))
                return true;
        for (const u of this.units)
            if (ok(ix(u.q, u.r), u.cls === TK ? this.K.visTkach : this.K.visKlinok))
                return true;
        return false;
    }
    /* ----------------------------------------------------------- the tick */
    step(o) {
        this.begin(o);
        const F = new Out();
        F.chan = o.pulse.chan;
        F.ear = o.pulse.ear;
        F.cap = Math.floor(o.pulse.chanAt / this.K.chanOrder) + 4;
        F.tick = this.K.chanTick;
        F.energy = o.pulse.energy;
        let act = 0;
        for (const u of this.units)
            if (this.acting(u))
                act++;
        F.acting = act;
        /* the first free halt is kept in reserve so the slot stays ours */
        const freeKeep = this.t - this.lastOk >= 2 ? this.freeKeepalive() : null;
        if (freeKeep)
            F.cap--;
        this.planYard(F);
        this.planKlinoks(F);
        this.planTkachs(F);
        this.planBids(F);
        const scanned = this.planScan(F);
        if (freeKeep)
            F.cap++;
        if (!scanned && this.t - this.lastOk >= 2) {
            if (freeKeep && !F.meta.some((m) => m.unit === freeKeep.unit)) {
                F.orders.unshift(freeKeep.order);
                F.meta.unshift({ kind: freeKeep.order.kind, unit: freeKeep.unit, i: -1 });
            }
            else if (this.t - this.lastOk >= 4)
                this.watchKeep(F);
        }
        return { orders: F.orders, meta: F.meta };
    }
    /* a free command that changes nothing: halt to a unit without a task, or
       clearing the jam intent of a Klinok that has none (accepted mid-step) */
    freeKeepalive() {
        for (const u of this.units) {
            if (!u.task && this.canCmd(u))
                return { order: { kind: 'halt', unit: u.id }, unit: u.id };
        }
        for (const u of this.units) {
            if (u.cls === KL && (!u.task || !u.task.jam) && !u.stuck)
                return { order: { kind: 'jam', unit: u.id, target: null, hold: false }, unit: u.id };
        }
        return null;
    }
    watchKeep(F) {
        if (this.hearth < 0)
            return;
        const c = this.hcost();
        F.orders.unshift({ kind: 'watch', q: cq(this.hearth), r: cr(this.hearth), keep: 0 });
        F.meta.unshift({ kind: 'watch', unit: '', i: -1 });
        F.chan -= c;
    }
    begin(o) {
        const t = o.t;
        this.t = t;
        this.obs = o;
        this.stormC.clear();
        this.dijC.clear();
        const me = this.slot;
        if (this.hearth < 0)
            this.findHearth(o);
        if ((o.pub.dawn || t >= this.dawnAt) && !this.dawnDone) {
            this.dawnDone = true;
            for (const N of this.needles.values())
                if (N.ring && N.owner === 'K')
                    N.dark = true;
        }
        this.lineFree = this.dawnDone || o.pulse.mercy;
        /* events */
        for (const e of o.events) {
            switch (e.type) {
                case 'find': {
                    const i = ix(e.q, e.r);
                    for (const f of this.finds)
                        if (f.i === i)
                            f.taken = true;
                    break;
                }
                case 'lot': {
                    const L = this.lots[e.lot];
                    if (L) {
                        L.done = true;
                        if (e.p) {
                            for (const c of L.cells) {
                                const N = this.needles.get(c);
                                if (N && N.owner === null) {
                                    N.owner = e.p;
                                    N.dark = false;
                                    N.grace = 0;
                                    N.seen = t;
                                }
                            }
                        }
                    }
                    break;
                }
                case 'cap': {
                    const i = ix(e.q, e.r);
                    const N = this.needle(i);
                    N.owner = e.p;
                    N.dark = false;
                    N.seen = t;
                    N.grace = t + this.K.capGrace - 1;
                    break;
                }
                case 'raise': {
                    const N = this.needle(ix(e.q, e.r));
                    N.owner = e.p;
                    N.dark = false;
                    N.seen = t;
                    N.grace = t + this.K.capGrace - 1;
                    break;
                }
                case 'jam': {
                    if (e.own === me)
                        this.jammedMine.set(ix(e.q, e.r), t);
                    break;
                }
                default:
                    break;
            }
        }
        /* own needles */
        const prev = this.mine;
        this.mine = new Set();
        this.mineW.clear();
        for (const n of o.mine.needles) {
            const i = ix(n.q, n.r);
            this.mine.add(i);
            this.mineW.set(i, n.weight);
            const N = this.needle(i);
            N.owner = me;
            N.dark = n.dark;
            N.seen = t;
        }
        for (const l of o.mine.losts) {
            const i = ix(l.q, l.r);
            if (this.mine.has(i))
                continue;
            const N = this.needle(i);
            N.owner = l.owner;
            N.dark = l.dark;
            N.seen = t;
            N.grace = Math.max(N.grace, l.t + this.K.capGrace - 1);
        }
        for (const i of prev) {
            if (this.mine.has(i))
                continue;
            const N = this.needles.get(i);
            if (N && N.owner === me) {
                N.owner = this.others[0] ?? null;
                N.seen = -1;
                N.grace = t + this.K.capGrace - 1;
            }
        }
        /* what is visible */
        for (const e of o.own) {
            const i = ix(e.q, e.r);
            if (this.mine.has(i))
                continue;
            const had = this.needles.has(i);
            const N = this.needle(i);
            if (!had)
                N.grace = t + Math.floor(this.K.capGrace / 2);
            else if (N.owner !== e.owner && e.owner !== null) {
                const from = N.seen >= 0 ? Math.max(N.seen + 1, t - Math.floor(this.K.capGrace / 2)) : t - Math.floor(this.K.capGrace / 2);
                N.grace = Math.max(N.grace, from + this.K.capGrace - 1);
            }
            N.owner = e.owner;
            N.dark = e.dark;
            N.seen = t;
        }
        if (this.dawnDone)
            for (const N of this.needles.values())
                if (N.ring && N.owner === 'K')
                    N.dark = true;
        /* foes */
        for (const f of o.foe) {
            const i = ix(f.q, f.r);
            const m = this.foeMem.get(f.id);
            this.foeMem.set(f.id, { p: f.p, cls: f.cls, i, t, still: m && m.i === i ? m.still + 1 : 0 });
        }
        for (const [k, m] of this.foeMem)
            if (t - m.t > 40)
                this.foeMem.delete(k);
        for (const [k, v] of this.jammedMine)
            if (t - v > 60)
                this.jammedMine.delete(k);
        for (const [k, v] of this.black)
            if (v <= t)
                this.black.delete(k);
        /* units */
        this.units = o.mine.units.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const ids = new Set();
        this.occupied.clear();
        for (const u of this.units) {
            ids.add(u.id);
            this.occupied.add(ix(u.q, u.r));
            if (!this.prevUnits.has(u.id)) {
                const k = this.pending.findIndex((p) => p.cls === u.cls);
                if (k >= 0)
                    this.pending.splice(k, 1);
            }
        }
        for (const id of [...this.jobs.keys()])
            if (!ids.has(id))
                this.jobs.delete(id);
        this.prevUnits = ids;
        this.pending = this.pending.filter((p) => t - p.at <= this.K.droneBuild + 14);
        /* pull */
        this.myPull.fill(0);
        this.othPull.fill(0);
        this.jamByMe.clear();
        for (const n of o.mine.needles) {
            if (n.weight <= 0)
                continue;
            const i = ix(n.q, n.r);
            this.addCov(this.myPull, i, n.fed ? this.fedW : this.rings, n.weight * this.multFor(i, me, t));
        }
        for (const j of o.mine.jams) {
            const i = ix(j.q, j.r);
            const N = this.needles.get(i);
            if (!N || !N.owner || N.owner === me)
                continue;
            this.jamByMe.add(i);
            if (N.owner === 'K' && this.dawnDone)
                continue;
            this.addCov(this.myPull, i, this.rings, 1);
        }
        for (const N of this.needles.values()) {
            if (!N.owner || N.owner === me || N.dark || this.jamByMe.has(N.i))
                continue;
            const mu = this.multFor(N.i, N.owner, t);
            if (mu > 0)
                this.addCov(this.othPull, N.i, this.rings, mu);
        }
        /* cells watched by enemy needles */
        this.foeEye.fill(0);
        const d2 = DISK[Math.min(6, Math.max(0, Math.round(this.K.visExact)))];
        for (const N of this.needles.values()) {
            if (!N.owner || N.owner === me || N.owner === 'K')
                continue;
            for (let k = 0; k < d2.length; k += 2) {
                const c = N.i + d2[k];
                if (this.inV[c])
                    this.foeEye[c] = 1;
            }
        }
        /* thread sources and orphans */
        this.sources = this.hearth >= 0 ? [this.hearth] : [];
        this.orphans = [];
        this.orphanRate.clear();
        for (const [i, w] of this.mineW) {
            if (w >= 0.99)
                this.sources.push(i);
            else {
                const N = this.needles.get(i);
                const jt = this.jammedMine.get(i);
                const jammed = !!N && N.dark && jt !== undefined && t - jt < 40;
                if (!jammed)
                    this.orphans.push(i);
            }
        }
        for (const i of this.orphans) {
            const mu = this.multFor(i, me, t);
            this.orphanRate.set(i, this.gain(i, this.rings, mu, this.myPull, this.othPull, null, 0));
        }
        /* comms zone distance and network distance */
        const zs = [];
        for (const i of this.cells) {
            if (this.myPull[i] > 0 || (this.hearth >= 0 && dist(i, this.hearth) <= this.K.linkRange))
                zs.push(i);
        }
        this.bfs(zs, this.zoneD);
        const ns = [...this.mine];
        if (this.hearth >= 0)
            ns.push(this.hearth);
        this.bfs(ns, this.nearD);
        /* ring cells and line needles a Tkach must not step on before dawn */
        this.avoid.fill(0);
        if (!this.lineFree)
            for (const N of this.needles.values())
                if (this.cdist[N.i] <= this.cherta)
                    this.avoid[N.i] = 1;
        this.computeContract(o);
    }
    needle(i) {
        let N = this.needles.get(i);
        if (!N) {
            N = { i, start: false, ring: false, owner: null, dark: false, seen: -1, grace: 0 };
            this.needles.set(i, N);
        }
        return N;
    }
    findHearth(o) {
        for (const s of this.seats) {
            for (const n of o.mine.needles) {
                if (hd(cq(s), cr(s), n.q, n.r) <= 1) {
                    this.hearth = s;
                    break;
                }
            }
            if (this.hearth >= 0)
                break;
        }
        if (this.hearth < 0 && this.man) {
            const k = this.man.perm.indexOf(this.slot);
            const s = this.seats[k >= 0 ? k : SLOTS.indexOf(this.slot)];
            if (s !== undefined)
                this.hearth = s;
        }
        if (this.hearth < 0)
            return;
        /* starting needles: mine are next to my hearth, the rest belong to others */
        for (const N of this.needles.values()) {
            if (!N.start)
                continue;
            if (dist(N.i, this.hearth) <= 1)
                N.owner = this.slot;
            else if (N.owner === this.slot || N.owner === null)
                N.owner = this.others[0] ?? null;
        }
        /* opening: a Klinok first if a cache is clearly ours to take */
        const D = this.dij(this.hearth, 1).d;
        for (const f of this.finds) {
            if (f.kind !== 'cache')
                continue;
            const mineEta = D[f.i];
            if (mineEta > 24)
                continue;
            let opp = INF;
            for (const s of this.seats) {
                if (s === this.hearth)
                    continue;
                opp = Math.min(opp, this.dij(s, 1).d[f.i]);
            }
            if (mineEta < opp)
                this.openK = true;
        }
        this.dijC.clear();
    }
    computeContract(o) {
        this.contract = null;
        const ord = o.pub.order;
        if (!ord || this.t > ord.to)
            return;
        const me = this.slot;
        const cells = ord.cells.map((h) => ix(h.q, h.r));
        const notMine = cells.filter((c) => !this.mine.has(c));
        const o0 = this.needles.get(cells[0])?.owner ?? null;
        const deny = o0 !== null && o0 !== me && o0 !== 'K' && cells.every((c) => this.needles.get(c)?.owner === o0);
        let feasible = notMine.length > 0;
        let need = 0;
        for (const c of notMine) {
            const N = this.needles.get(c);
            if (!N || N.start || (!this.lineFree && this.cdist[c] <= this.cherta))
                feasible = false;
            else
                need += this.heatCost(N, this.t);
        }
        const tks = this.units.filter((u) => u.cls === TK);
        if (tks.length === 0)
            feasible = false;
        let eta = INF;
        for (const u of tks)
            for (const c of notMine)
                eta = Math.min(eta, dist(ix(u.q, u.r), c) * this.K.stepTkach * 1.3);
        const par = Math.max(1, Math.min(tks.length, notMine.length));
        const est = this.t + (eta >= INF ? 999 : eta) + need / par + 8 + this.K.orderHoldTicks;
        if (est > ord.to)
            feasible = false;
        if (feasible) {
            const L = this.sources.slice();
            const inL = new Set();
            for (let pass = 0; pass < 3; pass++) {
                for (const c of cells) {
                    if (inL.has(c))
                        continue;
                    if (this.linkAny(c, L)) {
                        inL.add(c);
                        L.push(c);
                    }
                }
            }
            for (const c of cells)
                if (!inL.has(c) && !this.sources.includes(c))
                    feasible = false;
        }
        const bonus = typeof ord.bonus === 'number' ? ord.bonus : 30;
        this.contract = { cells, to: ord.to, per: notMine.length > 0 ? (bonus * 0.85) / notMine.length : 0, feasible, deny, bonus };
    }
    /* ------------------------------------------------------------ verdicts */
    onDeny(m, code) {
        if (m.kind === 'yard') {
            if (code === 10) {
                this.yardHold = this.t + 12;
                this.pending = [];
            }
            if (code === 9)
                this.pending.pop();
            return;
        }
        if (m.kind === 'bid') {
            const L = this.lots[m.i];
            if (L)
                L.bid = 0;
            return;
        }
        if (!m.unit)
            return;
        const j = this.jobs.get(m.unit);
        const transient = code === 2 || code === 4 || code === 6 || code === 7;
        if (transient) {
            if (j)
                j.issued = -1;
            return;
        }
        if (code === 3) {
            this.jobs.delete(m.unit);
            return;
        }
        if (m.i >= 0) {
            this.setBlack(m.unit, m.i, 150);
            if (m.kind === 'needle' && (code === 11 || code === 21))
                this.black.set('*|' + m.i, this.t + (code === 21 ? 400 : 150));
        }
        if (j && (j.i === m.i || j.stand === m.i || m.i < 0 || j.kind === 'ram'))
            this.jobs.delete(m.unit);
    }
    /* --------------------------------------------------------------- yard */
    nextUnit(nT, nK) {
        if (this.openK && this.kn.open && nK === 0 && this.t < 80)
            return KL;
        let a = 0;
        let b = 0;
        for (const ch of this.kn.order) {
            if (ch === 'T') {
                a++;
                if (nT < a)
                    return TK;
            }
            else {
                b++;
                if (nK < b)
                    return KL;
            }
        }
        return null;
    }
    planYard(F) {
        this.unitReserve = 0;
        const t = this.t;
        if (t < 1 || t > this.T - 40 || this.hearth < 0)
            return;
        let nT = 0;
        let nK = 0;
        for (const u of this.units) {
            if (u.cls === TK)
                nT++;
            else
                nK++;
        }
        for (const p of this.pending) {
            if (p.cls === TK)
                nT++;
            else
                nK++;
        }
        let weight = nT * this.K.weightTkach + nK * this.K.weightKlinok;
        for (let k = 0; k < 2; k++) {
            const nx = this.nextUnit(nT, nK);
            if (!nx)
                return;
            const cost = nx === TK ? this.K.costTkach : this.K.costKlinok;
            const w = nx === TK ? this.K.weightTkach : this.K.weightKlinok;
            if (weight + w > this.K.squadWeight)
                return;
            if (t < this.yardHold)
                return;
            if (nx === TK && t > this.T - 70)
                return;
            if (F.energy - this.bidLock() < cost) {
                if (t < 700)
                    this.unitReserve = cost;
                return;
            }
            const hc = this.hcost();
            if (!F.room(hc, 0))
                return;
            F.push({ kind: 'yard', cls: nx }, { kind: 'yard', unit: '', i: -1 }, hc, 0, 0);
            F.energy -= cost;
            this.pending.push({ cls: nx, at: t });
            weight += w;
            if (nx === TK)
                nT++;
            else
                nK++;
        }
    }
    /* ------------------------------------------------------------- Klinoks */
    planKlinoks(F) {
        const t = this.t;
        const me = this.slot;
        const o = this.obs;
        const kls = this.units.filter((u) => u.cls === KL);
        if (kls.length === 0)
            return;
        for (const u of kls) {
            const j = this.jobs.get(u.id);
            if (j)
                this.checkKJob(u, j, F);
        }
        /* threats */
        const th = [];
        const working = [];
        for (const u of this.units) {
            if (u.cls !== TK)
                continue;
            const ui = ix(u.q, u.r);
            const j = this.jobs.get(u.id);
            if (this.heatableAt(ui) || (u.task && (u.task.site || u.task.feed)) || (j && j.kind === 'cap' && j.i === ui))
                working.push(ui);
        }
        for (const f of o.foe) {
            if (f.p === me || f.p === 'K')
                continue;
            const fi = ix(f.q, f.r);
            let prio = 0;
            if (f.cls === TK) {
                const N = this.needles.get(fi);
                if (N && N.owner === me && !N.start)
                    prio = 10;
                else if (this.kn.hunt && N && N.owner !== f.p && !N.start && this.nearD[fi] <= 7)
                    prio = 6;
                else if (this.kn.hunt && !N && this.bld[fi] && this.nearD[fi] <= 6) {
                    const m = this.foeMem.get(f.id);
                    if (m && m.still >= 2)
                        prio = 5;
                }
            }
            else {
                for (const w of working)
                    if (dist(w, fi) <= 3)
                        prio = Math.max(prio, 8);
                for (const n of this.mine) {
                    if (dist(n, fi) > 1)
                        continue;
                    const N = this.needles.get(n);
                    if (N && N.start)
                        continue;
                    const jt = this.jammedMine.get(n);
                    if ((N && N.dark) || (jt !== undefined && t - jt < 25))
                        prio = Math.max(prio, 7);
                }
            }
            if (prio > 0)
                th.push({ f, i: fi, prio });
        }
        th.sort((a, b) => b.prio - a.prio || (a.f.id < b.f.id ? -1 : 1));
        const used = new Set();
        for (const x of th) {
            let best = null;
            let be = INF;
            for (const k of kls) {
                if (used.has(k.id) || k.stuck)
                    continue;
                const j = this.jobs.get(k.id);
                if (j && j.kind === 'ram' && j.foe === x.f.id) {
                    best = k;
                    be = -1;
                    break;
                }
                if (j && j.prio >= x.prio)
                    continue;
                if (!this.canCmd(k))
                    continue;
                const eta = this.dij(ix(k.q, k.r), 1).d[x.i];
                const lim = x.prio >= 7 ? 14 : 9;
                if (eta <= lim && eta < be) {
                    best = k;
                    be = eta;
                }
            }
            if (!best)
                continue;
            used.add(best.id);
            if (be < 0)
                continue;
            const add = this.acting(best) ? 0 : 1;
            const cost = this.ucost(best);
            if (!F.room(cost, add)) {
                if (!this.freeFeeder(F) || !F.room(cost, add)) {
                    if (!(F.orders.length < F.cap && F.chan - cost >= 0))
                        continue;
                }
            }
            const job = mkJob('ram', x.i, t, x.prio);
            job.foe = x.f.id;
            job.issued = t;
            job.tries = 1;
            if (this.exactSees(x.i)) {
                F.push({ kind: 'ram', unit: best.id, target: x.f.id }, { kind: 'ram', unit: best.id, i: x.i }, cost, 0, add);
            }
            else {
                F.push({ kind: 'move', unit: best.id, q: x.f.q, r: x.f.r, goal: null, home: false }, { kind: 'move', unit: best.id, i: x.i }, cost, 0, add);
                job.phase = 1;
            }
            this.jobs.set(best.id, job);
        }
        /* re-issue pending Klinok jobs */
        for (const u of kls) {
            const j = this.jobs.get(u.id);
            if (!j || j.issued !== -1 || !this.canCmd(u))
                continue;
            this.issueK(F, u, j);
        }
        /* escorts for Tkachs working on exposed ground */
        const guarded = new Set();
        for (const j of this.jobs.values())
            if (j.kind === 'guard')
                guarded.add(j.foe);
        const exposed = [];
        for (const u of this.units) {
            if (!this.kn.guard || u.cls !== TK || guarded.has(u.id))
                continue;
            const j = this.jobs.get(u.id);
            if (!j || (j.kind !== 'cap' && j.kind !== 'build' && j.kind !== 'stage'))
                continue;
            const wi = j.kind === 'stage' ? j.stand : j.i;
            const ui = ix(u.q, u.r);
            if (dist(ui, wi) > 6)
                continue;
            const f = this.dangerRaw(wi);
            if (f >= 0.7)
                continue;
            exposed.push({ u, i: wi, f });
        }
        exposed.sort((a, b) => a.f - b.f || (a.u.id < b.u.id ? -1 : 1));
        for (const x of exposed) {
            let best = null;
            let be = INF;
            let bs = -1;
            for (const k of kls) {
                if (k.stuck || !this.canCmd(k))
                    continue;
                const j = this.jobs.get(k.id);
                if (j && j.prio >= 4)
                    continue;
                const D = this.dij(ix(k.q, k.r), 1).d;
                for (let n = 0; n < 6; n++) {
                    const c = x.i + NEI[n];
                    if (!this.inV[c] || !this.pass[c])
                        continue;
                    const e = c === ix(k.q, k.r) ? 0 : D[c];
                    if (e <= 16 && e < be) {
                        be = e;
                        best = k;
                        bs = c;
                    }
                }
            }
            if (!best || bs < 0)
                continue;
            const old = this.jobs.get(best.id);
            const job = mkJob('guard', x.i, t, 4);
            job.foe = x.u.id;
            job.stand = bs;
            if (ix(best.q, best.r) === bs) {
                job.issued = t;
                this.jobs.set(best.id, job);
                continue;
            }
            if (this.issueK(F, best, job))
                this.jobs.set(best.id, job);
            else if (old)
                this.jobs.set(best.id, old);
        }
        /* idle Klinoks: cache, then jam, then home */
        const claimed = new Set();
        for (const j of this.jobs.values())
            if (j.kind === 'jam' || j.kind === 'cache')
                claimed.add(j.i);
        const stands = new Set();
        for (const j of this.jobs.values())
            if (j.kind === 'jam' && j.stand >= 0)
                stands.add(j.stand);
        for (const u of kls) {
            if (this.jobs.has(u.id) || !this.canCmd(u))
                continue;
            const ui = ix(u.q, u.r);
            const D = this.dij(ui, 1).d;
            /* cache */
            let ci = -1;
            let ce = INF;
            for (const f of this.finds) {
                if (f.kind !== 'cache' || f.taken || claimed.has(f.i))
                    continue;
                const e = D[f.i];
                if (e <= 30 && e < ce && F.energy + 40 < this.K.energyCap) {
                    ci = f.i;
                    ce = e;
                }
            }
            if (ci >= 0) {
                const job = mkJob('cache', ci, t, 3);
                if (this.issueK(F, u, job)) {
                    this.jobs.set(u.id, job);
                    claimed.add(ci);
                    continue;
                }
            }
            /* jam */
            const jt = this.kn.jam ? this.pickJam(u, D, claimed, stands, F) : null;
            if (jt) {
                const job = mkJob('jam', jt.i, t, 2);
                job.stand = jt.s;
                if (this.issueK(F, u, job)) {
                    this.jobs.set(u.id, job);
                    claimed.add(jt.i);
                    stands.add(jt.s);
                    continue;
                }
            }
            /* back into the comms zone */
            if (this.zoneD[ui] > 0 && this.hearth >= 0) {
                let hi = -1;
                let he = INF;
                for (const s of this.sources) {
                    for (let k = 0; k < 6; k++) {
                        const c = s + NEI[k];
                        if (!this.inV[c] || !this.pass[c] || this.occupied.has(c))
                            continue;
                        const e = D[c];
                        if (e < he) {
                            he = e;
                            hi = c;
                        }
                    }
                }
                if (hi >= 0) {
                    const job = mkJob('home', hi, t, 1);
                    if (this.issueK(F, u, job))
                        this.jobs.set(u.id, job);
                }
            }
        }
    }
    pickJam(u, D, claimed, stands, F) {
        const t = this.t;
        const me = this.slot;
        if (!F.room(this.ucost(u) + this.K.jamStart, 2))
            return null;
        let best = null;
        let bs = 0;
        for (const N of this.needles.values()) {
            if (!N.owner || N.owner === me || N.start || N.dark || claimed.has(N.i))
                continue;
            const keeper = N.owner === 'K';
            if (keeper && (this.dawnDone || !N.ring))
                continue;
            if (!keeper && t - N.seen > 120)
                continue;
            if (this.isBlack(u.id, N.i))
                continue;
            let si = -1;
            let se = INF;
            for (let k = -1; k < 6; k++) {
                const c = k < 0 ? N.i : N.i + NEI[k];
                if (!this.inV[c] || !this.pass[c] || stands.has(c))
                    continue;
                if (keeper && this.cdist[c] <= this.cherta)
                    continue;
                if (this.occupied.has(c) && c !== ix(u.q, u.r))
                    continue;
                const e = D[c];
                if (e < se) {
                    se = e;
                    si = c;
                }
            }
            if (si < 0 || se > 40)
                continue;
            const mu = this.multFor(N.i, N.owner, t);
            let rate = this.gain(N.i, this.rings, 1, this.myPull, this.othPull, this.rings, mu);
            if (!keeper)
                rate += 0.5 * this.lossAt(N.i, this.rings, mu, this.myPull, this.othPull);
            let bonus = 0;
            const C = this.contract;
            if (C && C.deny && C.cells.includes(N.i) && !keeper)
                bonus += C.bonus * 0.7;
            const risk = keeper ? 1 : 0.75;
            const rem = Math.min(this.T, keeper ? this.dawnAt : this.T) - t - se;
            if (rem <= 10)
                continue;
            const s = ((rate * rem + bonus) * risk) / (se + 10);
            if (rate < 0.003 && bonus <= 0)
                continue;
            if (s > bs) {
                bs = s;
                best = { i: N.i, s: si };
            }
        }
        return best;
    }
    issueK(F, u, j) {
        const ui = ix(u.q, u.r);
        const add = this.acting(u) ? 0 : 1;
        const cost = this.ucost(u);
        if (j.kind === 'jam' && ui === j.stand) {
            if (!(F.orders.length < F.cap && F.chan >= this.K.chanOrder + this.K.jamStart))
                return false;
            F.push({ kind: 'jam', unit: u.id, target: { q: cq(j.i), r: cr(j.i) }, hold: true }, { kind: 'jam', unit: u.id, i: j.i }, 0, 0, add);
            j.phase = 1;
            j.issued = this.t;
            j.tries++;
            if (j.arrived < 0)
                j.arrived = this.t;
            return true;
        }
        if (j.kind === 'ram') {
            const f = this.obs.foe.find((x) => x.id === j.foe);
            if (!f)
                return false;
            if (!F.room(cost, add))
                return false;
            if (this.exactSees(ix(f.q, f.r)))
                F.push({ kind: 'ram', unit: u.id, target: f.id }, { kind: 'ram', unit: u.id, i: ix(f.q, f.r) }, cost, 0, add);
            else
                F.push({ kind: 'move', unit: u.id, q: f.q, r: f.r, goal: null, home: false }, { kind: 'move', unit: u.id, i: ix(f.q, f.r) }, cost, 0, add);
            j.issued = this.t;
            j.tries++;
            return true;
        }
        const dest = j.kind === 'jam' || j.kind === 'guard' ? j.stand : j.i;
        if (dest < 0 || dest === ui)
            return false;
        if (!F.room(cost, add))
            return false;
        const home = j.kind === 'home';
        F.push({ kind: 'move', unit: u.id, q: cq(dest), r: cr(dest), goal: null, home }, { kind: 'move', unit: u.id, i: dest }, cost, 0, add);
        j.issued = this.t;
        j.tries++;
        return true;
    }
    checkKJob(u, j, F) {
        const t = this.t;
        const ui = ix(u.q, u.r);
        const me = this.slot;
        const drop = (black, halt) => {
            this.jobs.delete(u.id);
            if (black > 0)
                this.setBlack(u.id, j.i, black);
            if (halt && !this.idle(u) && this.canCmd(u) && F.orders.length < F.cap && F.chan >= this.K.chanOrder) {
                if (j.kind === 'jam' && j.phase === 1)
                    F.push({ kind: 'jam', unit: u.id, target: null, hold: false }, { kind: 'jam', unit: u.id, i: -1 }, 0, 0, 0);
                else
                    F.push({ kind: 'halt', unit: u.id }, { kind: 'halt', unit: u.id, i: -1 }, 0, 0, this.acting(u) ? -1 : 0);
            }
        };
        if (j.tries > 6) {
            drop(120, true);
            return;
        }
        if (u.away >= this.K.autonomy - 4 && this.zoneD[ui] > 0 && j.kind !== 'home' && j.kind !== 'ram') {
            drop(200, true);
            return;
        }
        switch (j.kind) {
            case 'ram': {
                const f = this.obs.foe.find((x) => x.id === j.foe);
                if (f) {
                    j.seenFoe = t;
                    j.i = ix(f.q, f.r);
                }
                if (t - j.seenFoe > 2 || t - j.since > 40) {
                    drop(0, true);
                    return;
                }
                if (f && this.canCmd(u) && (this.idle(u) || (j.phase === 1 && this.exactSees(j.i)))) {
                    j.phase = 0;
                    j.issued = -1;
                }
                return;
            }
            case 'cache': {
                const fd = this.finds.find((x) => x.i === j.i);
                if (!fd || fd.taken || ui === j.i || t - j.since > 60) {
                    drop(0, false);
                    return;
                }
                break;
            }
            case 'jam': {
                const N = this.needles.get(j.i);
                if (!N || !N.owner || N.owner === me || (N.owner === 'K' && this.dawnDone)) {
                    drop(0, true);
                    return;
                }
                if (j.phase === 0) {
                    if (ui === j.stand && this.canCmd(u))
                        j.issued = -1;
                    else if (this.idle(u) && this.canCmd(u) && t - j.issued >= 2)
                        j.issued = -1;
                    if (t - j.since > 80)
                        drop(100, true);
                    return;
                }
                /* holding: the jam must be live; if the needle went dark under someone else, leave */
                if (ui !== j.stand) {
                    j.phase = 0;
                    if (this.idle(u) && this.canCmd(u))
                        j.issued = -1;
                    return;
                }
                if (!this.jamByMe.has(j.i) && t - j.issued >= 3 && this.canCmd(u))
                    j.issued = -1;
                if (N.dark && !this.jamByMe.has(j.i) && t - j.issued > 6)
                    drop(100, true);
                return;
            }
            case 'guard': {
                const tk = this.units.find((x) => x.id === j.foe);
                const tj = tk ? this.jobs.get(tk.id) : undefined;
                const wi = tj ? (tj.kind === 'stage' ? tj.stand : tj.i) : -1;
                if (!tk || !tj || (tj.kind !== 'cap' && tj.kind !== 'build' && tj.kind !== 'stage') || t - j.since > 150) {
                    drop(0, false);
                    return;
                }
                if (wi !== j.i) {
                    drop(0, false);
                    return;
                }
                if (ui === j.stand)
                    return;
                break;
            }
            case 'home': {
                if (ui === j.i || this.zoneD[ui] === 0 || t - j.since > 40) {
                    drop(0, false);
                    return;
                }
                break;
            }
            default:
                break;
        }
        if (this.idle(u) && this.canCmd(u) && t - j.issued >= 2)
            j.issued = -1;
    }
    /* halt one feeding Tkach to free hands for something urgent */
    freeFeeder(F) {
        for (const u of this.units) {
            const j = this.jobs.get(u.id);
            if (!j || j.kind !== 'feed' || u.cls !== TK || !this.canCmd(u) || this.idle(u))
                continue;
            if (!(F.orders.length < F.cap && F.chan >= this.K.chanOrder))
                return false;
            F.push({ kind: 'halt', unit: u.id }, { kind: 'halt', unit: u.id, i: -1 }, 0, 0, -1);
            this.jobs.delete(u.id);
            return true;
        }
        return false;
    }
    /* -------------------------------------------------------------- Tkachs */
    planTkachs(F) {
        const t = this.t;
        const tks = this.units.filter((u) => u.cls === TK);
        if (tks.length === 0)
            return;
        for (const u of tks) {
            const j = this.jobs.get(u.id);
            if (j)
                this.checkTJob(u, j);
        }
        const planned = [];
        for (const j of this.jobs.values())
            if (j.kind === 'cap' || j.kind === 'build')
                planned.push(j.i);
        const plan = Float64Array.from(this.myPull);
        for (const i of planned)
            this.addCov(plan, i, this.rings, this.multFor(i, this.slot, t + 20));
        const src = this.sources.concat(planned);
        /* dawn staging */
        if (!this.lineFree && t >= this.dawnAt - 45 && t < this.dawnAt)
            this.planStage(F, tks, src);
        if (!this.lineFree)
            this.stageGo(F, tks);
        /* re-issue lost commands */
        for (const u of tks) {
            const j = this.jobs.get(u.id);
            if (j && j.issued === -1 && this.canCmd(u))
                this.issueT(F, u, j);
        }
        const free = [];
        for (const u of tks) {
            if (!this.canCmd(u))
                continue;
            const j = this.jobs.get(u.id);
            if (!j)
                free.push(u);
            else if (j.kind === 'feed' && t - j.since >= 15)
                free.push(u);
        }
        if (free.length === 0)
            return;
        const cands = this.tCands(plan, src, F);
        const picks = [];
        const hold = this.K.orderHoldTicks;
        for (const u of free) {
            const ui = ix(u.q, u.r);
            const D = this.dij(ui, 0).d;
            for (const c of cands) {
                if (this.isBlack(u.id, c.i))
                    continue;
                const eta = c.i === ui ? 0 : D[c.i];
                if (eta >= INF)
                    continue;
                const wait = Math.max(0, c.grace - (t + eta));
                const work = c.work + wait;
                if (c.outside > 0 && c.outside * this.K.stepTkach + work > this.K.autonomy - 6)
                    continue;
                const done = t + eta + work;
                const rem = this.T - done;
                if (rem <= 0)
                    continue;
                let total = c.rate * rem + c.bonus;
                if (c.cbonus > 0 && this.contract && done + hold <= this.contract.to)
                    total += c.cbonus;
                total = total * c.risk - c.cost;
                if (total <= 0)
                    continue;
                picks.push({ u, c, s: total / (eta + work + 2) });
            }
        }
        picks.sort((a, b) => b.s - a.s || (a.u.id < b.u.id ? -1 : a.u.id > b.u.id ? 1 : a.c.i - b.c.i));
        const done = new Set();
        const claimed = new Set();
        const builds = [];
        for (const j of this.jobs.values()) {
            if (j.kind === 'cap' || j.kind === 'build' || j.kind === 'cache' || j.kind === 'stage' || j.kind === 'feed')
                claimed.add(j.i);
            if (j.kind === 'build')
                builds.push(j.i);
        }
        let buildE = F.energy - this.K.costNeedle * builds.length - this.bidLock();
        const hasCap = cands.some((c) => c.kind === 0);
        for (const p of picks) {
            if (done.has(p.u.id) || claimed.has(p.c.i))
                continue;
            if (p.c.kind === 1) {
                let near = false;
                for (const b of builds)
                    if (dist(b, p.c.i) <= 2)
                        near = true;
                if (near)
                    continue;
                const reserve = hasCap || p.c.bonus <= 0 ? this.unitReserve : 0;
                if (buildE - this.K.costNeedle < reserve)
                    continue;
            }
            const cur = this.jobs.get(p.u.id);
            if (cur && cur.kind === 'feed') {
                const fr = this.gain(cur.i, this.feedDelta, this.multFor(cur.i, this.slot, t), this.myPull, this.othPull, null, 0);
                if (p.s < fr * 4 + 0.01)
                    continue;
            }
            const job = mkJob(p.c.kind === 0 ? 'cap' : p.c.kind === 1 ? 'build' : 'cache', p.c.i, t, 2);
            if (!this.issueT(F, p.u, job))
                continue;
            this.jobs.set(p.u.id, job);
            done.add(p.u.id);
            claimed.add(p.c.i);
            if (p.c.kind === 1) {
                builds.push(p.c.i);
                buildE -= this.K.costNeedle;
            }
        }
        /* feeding as the fallback */
        for (const u of free) {
            if (done.has(u.id) || this.jobs.has(u.id))
                continue;
            const ui = ix(u.q, u.r);
            const D = this.dij(ui, 0).d;
            let bi = -1;
            let bsc = 0;
            for (const [i, w] of this.mineW) {
                if (w < 0.99 || claimed.has(i))
                    continue;
                if (!this.lineFree && this.cdist[i] <= this.cherta && i !== ui)
                    continue;
                const eta = i === ui ? 0 : D[i];
                if (eta >= INF)
                    continue;
                const rate = this.gain(i, this.feedDelta, this.multFor(i, this.slot, t), this.myPull, this.othPull, null, 0);
                const rem = this.T - t - eta;
                if (rem <= 0)
                    continue;
                const sc = rate * (rem / (rem + eta)) * this.danger(i);
                if (sc > bsc) {
                    bsc = sc;
                    bi = i;
                }
            }
            if (bi < 0 || bsc < 0.0012)
                continue;
            const job = mkJob('feed', bi, t, 1);
            if (this.issueT(F, u, job)) {
                this.jobs.set(u.id, job);
                claimed.add(bi);
            }
        }
    }
    tCands(plan, src, F) {
        const t = this.t;
        const me = this.slot;
        const out = [];
        const claimed = new Set();
        for (const j of this.jobs.values())
            if (j.kind === 'cap' || j.kind === 'build' || j.kind === 'stage')
                claimed.add(j.i);
        const C = this.contract;
        const remBase = Math.max(0, this.T - t - 20);
        /* reconnect value of orphans reachable through a candidate */
        const reconnect = (i) => {
            if (this.orphans.length === 0)
                return 0;
            const seen = new Set();
            const q = [];
            for (const o of this.orphans)
                if (this.link(i, o)) {
                    seen.add(o);
                    q.push(o);
                }
            for (let h = 0; h < q.length; h++) {
                const a = q[h];
                for (const o of this.orphans) {
                    if (seen.has(o) || !this.link(a, o))
                        continue;
                    seen.add(o);
                    q.push(o);
                }
            }
            let v = 0;
            for (const o of seen)
                v += (this.orphanRate.get(o) ?? 0) * remBase;
            return v;
        };
        /* unlinked targets for bridge bonuses */
        const unl = [];
        const ringSoon = t >= this.dawnAt - 260;
        for (const N of this.needles.values()) {
            if (N.start || N.owner === me || claimed.has(N.i))
                continue;
            const free = N.owner === null;
            const ringT = N.ring && N.owner === 'K' && ringSoon;
            if (!free && !ringT)
                continue;
            if (this.linkAny(N.i, src))
                continue;
            const from = N.ring && t < this.dawnAt ? this.dawnAt : t;
            const mu = this.multFor(N.i, me, Math.max(from, t + 20));
            const r = this.gain(N.i, this.rings, mu, plan, this.othPull, null, 0);
            unl.push({ i: N.i, v: 0.35 * r * Math.max(0, this.T - from - 40) });
        }
        /* captures */
        for (const N of this.needles.values()) {
            const i = N.i;
            if (N.owner === me || N.start || claimed.has(i))
                continue;
            if (!this.lineFree && this.cdist[i] <= this.cherta)
                continue;
            if (N.owner === 'K' && !this.lineFree)
                continue;
            if (this.isBlack('*', i))
                continue;
            if (!this.linkAny(i, src))
                continue;
            const heat = this.heatCost(N, t);
            const mu = this.multFor(i, me, t + 20);
            const enemy = N.owner !== null && N.owner !== 'K';
            let rem = null;
            let rmu = 0;
            if (N.owner !== null && !N.dark) {
                rem = this.rings;
                rmu = this.multFor(i, N.owner, t);
            }
            let rate = this.gain(i, this.rings, mu, plan, this.othPull, rem, rmu);
            if (enemy && rem)
                rate += 0.5 * this.lossAt(i, rem, rmu, plan, this.othPull);
            const bonus = reconnect(i);
            let cb = 0;
            if (C && C.feasible && C.cells.includes(i))
                cb = C.per;
            const risk = (enemy ? 0.7 : 1) * this.danger(i);
            out.push({ kind: 0, i, rate, bonus, cbonus: cb, work: heat, risk, cost: 0, grace: N.grace, outside: this.zoneD[i] });
        }
        /* builds */
        if (F.energy - this.K.costNeedle * this.countJobs('build') >= this.K.costNeedle) {
            const near = new Int16Array(NC);
            this.bfs(src, near);
            const ev = this.ev(F.energy);
            const lr = this.K.linkRange + 1;
            for (const i of this.cells) {
                if (!this.bld[i] || this.dead[i] || this.needles.has(i) || this.seatD[i] <= 2)
                    continue;
                if (near[i] > lr || near[i] < 2)
                    continue;
                if (!this.lineFree && this.cdist[i] <= this.cherta)
                    continue;
                if (this.occupied.has(i) || this.isBlack('*', i))
                    continue;
                let close = false;
                for (const c of claimed)
                    if (dist(c, i) <= 1)
                        close = true;
                if (close)
                    continue;
                if (!this.linkAny(i, src))
                    continue;
                const rate = this.gain(i, this.rings, 1, plan, this.othPull, null, 0);
                let bridge = 0;
                for (const x of unl)
                    if (dist(x.i, i) <= lr && this.link(i, x.i))
                        bridge += x.v;
                bridge += reconnect(i);
                if (rate < 0.002 && bridge <= 0)
                    continue;
                out.push({ kind: 1, i, rate, bonus: bridge, cbonus: 0, work: this.K.buildTicks, risk: this.danger(i), cost: this.K.costNeedle * ev, grace: 0, outside: this.zoneD[i] });
            }
        }
        /* caches */
        for (const f of this.finds) {
            if (f.kind !== 'cache' || f.taken || claimed.has(f.i))
                continue;
            let taken = false;
            for (const j of this.jobs.values())
                if (j.kind === 'cache' && j.i === f.i)
                    taken = true;
            if (taken)
                continue;
            const e = F.energy;
            const gainE = Math.min(150, this.K.energyCap - e);
            if (gainE <= 20)
                continue;
            const evc = (e < 150 ? 0.06 : e < 250 ? 0.03 : 0.008) * (Math.max(0, this.T - t) / this.T);
            out.push({ kind: 2, i: f.i, rate: 0, bonus: gainE * evc, cbonus: 0, work: 0, risk: this.danger(f.i), cost: 0, grace: 0, outside: this.zoneD[f.i] });
        }
        return out;
    }
    countJobs(kind) {
        let n = 0;
        for (const j of this.jobs.values())
            if (j.kind === kind)
                n++;
        return n;
    }
    checkTJob(u, j) {
        const t = this.t;
        const ui = ix(u.q, u.r);
        const drop = (black) => {
            this.jobs.delete(u.id);
            if (black > 0)
                this.setBlack(u.id, j.i, black);
        };
        if (j.tries > 6) {
            drop(150);
            return;
        }
        if (j.kind !== 'feed' && j.kind !== 'stage' && t - j.since > 300) {
            drop(60);
            return;
        }
        if (u.away >= this.K.autonomy - 4 && this.zoneD[ui] > 0 && this.zoneD[j.i] > 0 && !(j.kind === 'cap' && ui === j.i)) {
            drop(200);
            return;
        }
        switch (j.kind) {
            case 'cap': {
                const N = this.needles.get(j.i);
                if (!N || this.mine.has(j.i)) {
                    this.jobs.delete(u.id);
                    return;
                }
                if (N.start) {
                    drop(0);
                    return;
                }
                if (!this.lineFree && this.cdist[j.i] <= this.cherta && !(j.phase === 1 && t >= this.dawnAt - 4)) {
                    drop(0);
                    return;
                }
                if (ui === j.i) {
                    if (j.arrived < 0)
                        j.arrived = t;
                    const lim = this.K.heatEnemy + 12 + Math.max(0, N.grace - j.arrived);
                    if (t - j.arrived > lim)
                        drop(150);
                    return;
                }
                if (N.grace > t + 40) {
                    drop(0);
                    return;
                }
                break;
            }
            case 'build': {
                if (this.mine.has(j.i)) {
                    this.jobs.delete(u.id);
                    return;
                }
                if (this.needles.has(j.i)) {
                    drop(0);
                    return;
                }
                if (ui === j.i) {
                    if ((u.task && u.task.site) || u.work > 0)
                        return;
                    if (j.arrived < 0)
                        j.arrived = t;
                    else if (t - j.arrived >= 3) {
                        this.black.set('*|' + j.i, t + 200);
                        drop(0);
                        return;
                    }
                    if (this.canCmd(u))
                        j.issued = -1;
                    return;
                }
                break;
            }
            case 'feed': {
                const w = this.mineW.get(j.i);
                if (w === undefined || w < 0.99) {
                    drop(0);
                    return;
                }
                if (ui === j.i && u.task && u.task.feed)
                    return;
                break;
            }
            case 'cache': {
                const f = this.finds.find((x) => x.i === j.i);
                if (!f || f.taken || ui === j.i || t - j.since > 60) {
                    drop(0);
                    return;
                }
                break;
            }
            case 'stage': {
                const N = this.needles.get(j.i);
                if (!N || N.owner !== 'K') {
                    drop(0);
                    return;
                }
                if (ui === j.stand)
                    return;
                break;
            }
            default:
                break;
        }
        if (this.idle(u) && this.canCmd(u) && t - j.issued >= 2)
            j.issued = -1;
    }
    /* route for a Tkach before dawn: the node's path must not step on a line needle */
    route(u, target) {
        const ui = ix(u.q, u.r);
        if (this.lineFree || !this.oracle || !this.oraclePath)
            return target;
        const from = { q: u.q, r: u.r };
        const bad = (to) => {
            let p = null;
            try {
                p = this.oracle.path(from, { q: cq(to), r: cr(to) }, TK);
            }
            catch {
                return 0;
            }
            if (!p)
                return -1;
            for (const h of p) {
                const c = ix(h.q, h.r);
                if (c !== to && c !== ui && this.avoid[c])
                    return 1;
            }
            return 0;
        };
        const b = bad(target);
        if (b === 0)
            return target;
        if (b < 0)
            return -1;
        const { d, p } = this.dij(ui, 0);
        if (d[target] >= INF)
            return -1;
        const chain = [];
        let c = target;
        while (c !== ui && c >= 0 && chain.length < 400) {
            chain.push(c);
            c = p[c];
        }
        chain.reverse();
        for (const fr of [0.7, 0.45, 0.25]) {
            const k = Math.max(0, Math.floor(chain.length * fr) - 1);
            const w = chain[k];
            if (w !== undefined && w !== target && bad(w) === 0)
                return w;
        }
        return chain[Math.min(1, chain.length - 1)] ?? target;
    }
    issueT(F, u, j) {
        const ui = ix(u.q, u.r);
        const add = this.acting(u) ? 0 : 1;
        const cost = this.ucost(u);
        const t = this.t;
        let target = j.i;
        if (j.kind === 'stage')
            target = j.stand;
        if (j.kind === 'cap' && ui === j.i) {
            j.issued = t;
            return true;
        }
        if (j.kind === 'stage' && ui === j.stand) {
            j.issued = t;
            return true;
        }
        if (!F.room(cost, add)) {
            if (j.prio < 3 || !this.freeFeeder(F) || !F.room(cost, add))
                return false;
        }
        const dest = j.kind === 'cap' && j.phase === 1 ? target : this.route(u, target);
        if (dest < 0) {
            this.setBlack(u.id, j.i, 150);
            return false;
        }
        let o;
        if (dest !== target || j.kind === 'cap' || j.kind === 'cache' || j.kind === 'stage') {
            if (dest === ui)
                return false;
            o = { kind: 'move', unit: u.id, q: cq(dest), r: cr(dest), goal: null, home: false };
        }
        else if (j.kind === 'build') {
            o = { kind: 'needle', unit: u.id, q: cq(target), r: cr(target) };
        }
        else if (j.kind === 'feed') {
            o = { kind: 'feed', unit: u.id, q: cq(target), r: cr(target) };
        }
        else {
            if (dest === ui)
                return false;
            o = { kind: 'move', unit: u.id, q: cq(dest), r: cr(dest), goal: null, home: false };
        }
        F.push(o, { kind: o.kind, unit: u.id, i: j.i }, cost, 0, add);
        j.issued = t;
        j.tries++;
        return true;
    }
    /* before dawn: post free Tkachs next to linkable ring needles */
    planStage(F, tks, src) {
        const t = this.t;
        const taken = new Set();
        const stands = new Set();
        for (const j of this.jobs.values()) {
            if (j.kind === 'stage' || j.kind === 'cap')
                taken.add(j.i);
            if (j.kind === 'stage')
                stands.add(j.stand);
        }
        const targets = [];
        for (const N of this.needles.values()) {
            if (!N.ring || N.owner !== 'K' || taken.has(N.i))
                continue;
            if (!this.linkAny(N.i, src))
                continue;
            const v = this.gain(N.i, this.rings, this.dawnMul, this.myPull, this.othPull, null, 0);
            if (v < 0.004)
                continue;
            targets.push({ i: N.i, v });
        }
        if (targets.length === 0)
            return;
        targets.sort((a, b) => b.v - a.v || a.i - b.i);
        for (const u of tks) {
            if (!this.canCmd(u))
                continue;
            const j = this.jobs.get(u.id);
            if (j && j.kind !== 'feed') {
                /* a short job that ends well before dawn may stay */
                continue;
            }
            const ui = ix(u.q, u.r);
            const D = this.dij(ui, 0).d;
            let best = null;
            for (const x of targets) {
                if (taken.has(x.i))
                    continue;
                for (let k = 0; k < 6; k++) {
                    const s = x.i + NEI[k];
                    if (!this.inV[s] || !this.pass[s] || this.cdist[s] <= this.cherta || stands.has(s))
                        continue;
                    if (this.lev[x.i] - this.lev[s] >= 2)
                        continue;
                    const e = s === ui ? 0 : D[s];
                    if (e >= INF || t + e > this.dawnAt + 6)
                        continue;
                    const sc = x.v * 1000 - e;
                    if (!best || sc > best.s)
                        best = { i: x.i, s: sc, e: s };
                }
            }
            if (!best)
                continue;
            if (j)
                this.jobs.delete(u.id);
            const job = mkJob('stage', best.i, t, 3);
            job.stand = best.e;
            if (this.issueT(F, u, job)) {
                this.jobs.set(u.id, job);
                taken.add(best.i);
                stands.add(best.e);
            }
            else if (j)
                this.jobs.set(u.id, j);
        }
    }
    /* step onto the ring so that the Tkach lands no earlier than the last tick before dawn */
    stageGo(F, tks) {
        const t = this.t;
        for (const u of tks) {
            const j = this.jobs.get(u.id);
            if (!j || j.kind !== 'stage')
                continue;
            const ui = ix(u.q, u.r);
            if (ui !== j.stand) {
                if (t >= this.dawnAt) {
                    j.kind = 'cap';
                    j.phase = 1;
                    j.issued = -1;
                }
                continue;
            }
            const climb = Math.max(0, this.lev[j.i] - this.lev[ui]);
            const st = this.K.stepTkach * this.stepM[j.i] + this.K.stepRise * climb;
            if (t >= this.dawnAt - st && this.canCmd(u)) {
                j.kind = 'cap';
                j.phase = 1;
                j.arrived = -1;
                j.prio = 4;
                j.tries = 0;
                if (!this.issueT(F, u, j))
                    j.issued = -1;
            }
        }
    }
    /* ---------------------------------------------------------------- bids */
    planBids(F) {
        const t = this.t;
        if (this.hearth < 0)
            return;
        for (let li = 0; li < this.lots.length; li++) {
            const L = this.lots[li];
            if (L.done || L.at >= this.dawnAt || t >= L.at || t < L.at - 3)
                continue;
            const commit = this.K.costNeedle * this.countJobs('build') + this.unitReserve;
            const stock = F.energy - commit - 1;
            if (L.bid > 0) {
                /* an envelope is in: lower it only if the stock no longer covers it */
                if (L.bid <= F.energy - this.K.costNeedle * this.countJobs('build') - 1)
                    continue;
                let amount = Math.floor(Math.max(0, stock));
                if (amount < 61)
                    amount = 0;
                else if (amount % 10 === 0)
                    amount -= 1;
                const hc = this.hcost();
                if (!F.room(hc, 0))
                    continue;
                F.push({ kind: 'bid', lot: li, amount }, { kind: 'bid', unit: '', i: li }, hc, 0, 0);
                L.bid = amount;
                continue;
            }
            let v = 0;
            let any = false;
            for (const c of L.cells) {
                const N = this.needles.get(c);
                if (!N || N.owner !== null)
                    continue;
                let mineSoon = false;
                for (const u of this.units) {
                    const j = this.jobs.get(u.id);
                    if (j && j.kind === 'cap' && j.i === c && ix(u.q, u.r) === c)
                        mineSoon = true;
                }
                if (mineSoon)
                    continue;
                any = true;
                if (this.linkAny(c, this.sources))
                    v += this.gain(c, this.rings, 1, this.myPull, this.othPull, null, 0) * (this.T - L.at);
            }
            if (!any || v < 4)
                continue;
            let amount = Math.floor(Math.min(stock, 60 + v * 22));
            if (amount < 61)
                continue;
            if (amount % 10 === 0)
                amount -= 1;
            const hc = this.hcost();
            if (!F.room(hc, 0))
                continue;
            F.push({ kind: 'bid', lot: li, amount }, { kind: 'bid', unit: '', i: li }, hc, 0, 0);
            L.bid = amount;
        }
    }
    /* energy that must stay in stock for envelopes about to open */
    bidLock() {
        let x = 0;
        for (const L of this.lots)
            if (!L.done && L.bid > 0 && L.at > this.t)
                x = Math.max(x, L.bid);
        return x;
    }
    /* ---------------------------------------------------------------- scan */
    planScan(F) {
        const t = this.t;
        const me = this.slot;
        if (F.orders.length >= F.cap)
            return false;
        if (F.ear < this.K.scanCost)
            return false;
        const rad = Math.max(0, Math.min(3, Math.round(this.K.scanRad)));
        const interest = new Map();
        const targets = new Set();
        for (const j of this.jobs.values())
            targets.add(j.i);
        const C = this.contract;
        for (const N of this.needles.values()) {
            if (N.owner === me)
                continue;
            const stale = N.seen < 0 ? 150 : Math.min(150, t - N.seen);
            if (stale < 6)
                continue;
            const nd = this.nearD[N.i];
            let w = nd <= 6 ? 2 : nd <= 10 ? 1 : 0.25;
            if (targets.has(N.i))
                w += 4;
            if (C && C.cells.includes(N.i))
                w += 3;
            if (N.ring && t > this.dawnAt - 60)
                w += 2;
            if (N.owner !== null && N.owner !== 'K')
                w *= 1.5;
            if (N.start)
                w *= 0.1;
            interest.set(N.i, w * stale);
        }
        for (const L of this.lots) {
            if (L.done || L.at <= t || L.at - t > 30)
                continue;
            for (const c of L.cells)
                interest.set(c, (interest.get(c) ?? 0) + 200);
        }
        /* noisy contacts near my working units */
        const o = this.obs;
        const workers = [];
        for (const u of this.units)
            if (u.cls === TK && this.acting(u))
                workers.push(ix(u.q, u.r));
        for (const h of o.noisy) {
            const i = ix(h.q, h.r);
            if (!this.inV[i])
                continue;
            for (const w of workers)
                if (dist(w, i) <= 5)
                    interest.set(i, (interest.get(i) ?? 0) + 150);
        }
        if (interest.size === 0)
            return false;
        let best = -1;
        let bs = 0;
        const pts = [...interest.keys()];
        for (const c of pts) {
            if (!this.inV[c])
                continue;
            let s = 0;
            for (const p of pts)
                if (dist(c, p) <= rad)
                    s += interest.get(p) ?? 0;
            if (s > bs) {
                bs = s;
                best = c;
            }
        }
        if (best < 0 || bs < 40)
            return false;
        const cost = this.K.scanCost * (this.stormy(best) ? this.K.stormCost : 1);
        if (F.ear < cost)
            return false;
        F.front({ kind: 'scan', q: cq(best), r: cr(best), rad }, { kind: 'scan', unit: '', i: -1 }, cost);
        return true;
    }
}
/* the head's names: one head, the preset only names it */
export function presets() {
    return ['ватра'];
}
export function createStrategy(preset) {
    const kn = { ...KNOBS };
    if (typeof preset === 'string' && preset.includes('=')) {
        for (const part of preset.split(';')) {
            const [k, v] = part.split('=');
            if (k === 'order' && v && /^[TK]+$/.test(v))
                kn.order = v;
            else if (k === 'jam' || k === 'guard' || k === 'hunt' || k === 'open')
                kn[k] = Number(v) ? 1 : 0;
        }
    }
    return new Vatra(kn);
}
