/* bot :: strategy
   "Zorya" - an own head, no mirror. Score is network minutes, so every
   decision is priced in minutes of coverage gained per tick of unit time:

   - a coverage model over the whole valley (own pull, known foreign pull,
     the Keeper's ring, the cell cap of 1) values every ruin, enemy needle,
     building site and feeding post by the exact marginal minutes it adds;
   - Tkachs greedily take the best (value / time) job: heat free ruins, build
     linked needles where coverage is thin or a bridge reaches more ruins,
     heat weak enemy needles, feed when nothing better is left; contracts get
     their 30 minutes added to the three cells, a cut-off cluster of ours is
     worth a bridge, and before dawn the Tkachs stage next to the Keeper's
     ring and step onto it the tick he leaves (until then they walk in legs
     that never touch his needles, so he has no one to ram);
   - Klinoks grab a near cache first, then guard frontier needles (a body on
     a needle blocks heating), ram enemy Tkachs heating our needles or ruins
     (a clean ram), ram jammers, and with spare channel jam enemy needles for
     loot; the channel is budgeted so working units keep their hands;
   - lots are bid on when their ruins link to our thread; pacts and cries
     are ignored; one accepted command every few ticks keeps the slot ours. */
import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, stormAt } from '@zoria/protocol';
/* ------------------------------------------------------------------ geometry */
const OFF = 20;
const SPAN = 2 * OFF + 1;
const NC = SPAN * SPAN;
const VR = 19;
const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];
const TK = 'ткач';
const KL = 'клинок';
const INF = 1e9;
function hd(aq, ar, bq, br) {
    const dq = aq - bq;
    const dr = ar - br;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
function cellAt(q, r) {
    if (!Number.isInteger(q) || !Number.isInteger(r))
        return -1;
    if (q < -VR || q > VR || r < -VR || r > VR || Math.abs(q + r) > VR)
        return -1;
    return (q + OFF) * SPAN + (r + OFF);
}
const CQ = new Int8Array(NC);
const CR = new Int8Array(NC);
for (let i = 0; i < NC; i++) {
    CQ[i] = Math.floor(i / SPAN) - OFF;
    CR[i] = (i % SPAN) - OFF;
}
function cq(i) {
    return CQ[i] ?? 0;
}
function cr(i) {
    return CR[i] ?? 0;
}
function cd(a, b) {
    return hd(cq(a), cr(a), cq(b), cr(b));
}
const ALL = [];
for (let i = 0; i < NC; i++)
    if (cellAt(cq(i), cr(i)) === i)
        ALL.push(i);
const OFFS = [];
for (let dq = -6; dq <= 6; dq++) {
    for (let dr = -6; dr <= 6; dr++) {
        const d = hd(0, 0, dq, dr);
        if (d <= 6)
            OFFS.push({ dq, dr, d });
    }
}
OFFS.sort((a, b) => a.d - b.d || a.dq - b.dq || a.dr - b.dr);
const NB = new Int32Array(NC * 6).fill(-1);
for (const i of ALL)
    for (let k = 0; k < 6; k++)
        NB[i * 6 + k] = cellAt(cq(i) + (DQ[k] ?? 0), cr(i) + (DR[k] ?? 0));
function nb(i, k) {
    return NB[i * 6 + k] ?? -1;
}
function share(m, o) {
    const s = m + o;
    return s <= 1 ? m : m / s;
}
function key(c) {
    return cq(c) + ',' + cr(c);
}
class MinHeap {
    ks = [];
    vs = [];
    top = 0;
    get size() {
        return this.ks.length;
    }
    clear() {
        this.ks.length = 0;
        this.vs.length = 0;
    }
    push(k, v) {
        const ks = this.ks;
        const vs = this.vs;
        let i = ks.length;
        ks.push(k);
        vs.push(v);
        while (i > 0) {
            const p = (i - 1) >> 1;
            const pk = ks[p] ?? 0;
            if (pk <= k)
                break;
            ks[i] = pk;
            vs[i] = vs[p] ?? 0;
            i = p;
        }
        ks[i] = k;
        vs[i] = v;
    }
    /* pops the value; its key goes to `top` */
    pop() {
        const ks = this.ks;
        const vs = this.vs;
        const rk = ks[0] ?? 0;
        const rv = vs[0] ?? 0;
        const lk = ks.pop() ?? 0;
        const lv = vs.pop() ?? 0;
        const n = ks.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= n)
                    break;
                const r = l + 1;
                let m = l;
                if (r < n && (ks[r] ?? 0) < (ks[l] ?? 0))
                    m = r;
                const mk = ks[m] ?? 0;
                if (mk >= lk)
                    break;
                ks[i] = mk;
                vs[i] = vs[m] ?? 0;
                i = m;
            }
            ks[i] = lk;
            vs[i] = lv;
        }
        this.top = rk;
        return rv;
    }
}
/* ------------------------------------------------------------------ the head */
class Zorya {
    preset;
    ready = false;
    slot = 'A';
    oracle = null;
    /* static valley */
    pass = new Uint8Array(NC);
    bld = new Uint8Array(NC);
    stepMul = new Float64Array(NC).fill(1);
    val = new Float64Array(NC);
    reachT = new Uint8Array(NC);
    block = new Uint8Array(NC);
    lev = new Float64Array(NC);
    dead = new Uint8Array(NC);
    still = new Uint8Array(NC);
    buildCells = [];
    seatsC = [];
    seatSlot = ['A', 'B', 'C'];
    citadelC = cellAt(0, 0);
    cherta = 6;
    rings = [1, 1, 2 / 3, 1 / 3];
    storms = [];
    finds = [];
    lots = [];
    ticks = 1200;
    dawnAt = 1000;
    dawnRing = 2;
    linkCache = new Map();
    /* world numbers */
    linkRange = 5;
    costT = 90;
    costK = 50;
    stepT = 2;
    stepK = 1;
    rise = 1;
    wT = 2;
    wK = 1;
    squad = 8;
    costNeedle = 60;
    buildTicks = 8;
    feedRing = 1;
    autonomy = 40;
    heatNeedle = 8;
    heatEnemy = 24;
    heatDark = 16;
    capGrace = 60;
    jamHold = 20;
    jamStart = 64;
    jamKeep = 8;
    orderBonus = 30;
    holdTicks = 12;
    chanOrder = 32;
    chanTick = 32;
    scanCost = 256;
    regen = 1;
    energyCap = 360;
    droneBuild = 4;
    ringPull = 1.25;
    minuteRate = 0.0005;
    stormCost = 2;
    crownMult = 1.15;
    /* per match memory */
    t = 0;
    hearthC = -1;
    enemyHearths = [];
    ndl = new Map();
    foes = new Map();
    asg = new Map();
    hulls = [];
    black = new Map();
    badSite = new Map();
    lastC = new Map();
    movedAt = new Map();
    lastOk = 0;
    klinokFirst = false;
    firstDone = false;
    threatAt = -1000;
    bidSent = new Map();
    contract = null;
    contractKey = '';
    replanAll = false;
    dawnReplanned = false;
    partner = null;
    lastObs = null;
    /* per tick */
    o = null;
    units = [];
    mine = new Map();
    myP = new Float64Array(NC);
    othP = new Float64Array(NC);
    plan = new Float64Array(NC);
    reachNow = new Uint8Array(NC);
    reachPlan = new Uint8Array(NC);
    zoneDist = new Int16Array(NC);
    myDist = new Int16Array(NC);
    danger = new Float64Array(NC);
    travelCache = new Map();
    forbid = new Uint8Array(NC);
    nearForbid = new Uint8Array(NC);
    forbidList = [];
    prevBuf = new Int32Array(NC);
    guardLine = true;
    heap = new MinHeap();
    out = [];
    meta = [];
    sentLast = [];
    cmdSpent = 0;
    chanAvail = 0;
    cap = 0;
    hands = 0;
    energy = 0;
    spent = 0;
    rate = 0;
    litCount = 0;
    reserved = new Set();
    jamRes = new Set();
    myJams = new Set();
    occupied = new Set();
    touched = new Set();
    dropped = new Set();
    hw = new Map();
    clusters = [];
    adjGain = new Float64Array(NC);
    /* belief diary */
    bOwn = new Map();
    bDark = new Map();
    bN = 0;
    constructor(preset) {
        this.preset = preset;
    }
    /* ================================================================ wire */
    init(manifestBytes, slot) {
        this.slot = slot;
        let man = null;
        try {
            man = decodeManifest(manifestBytes);
        }
        catch {
            man = null;
        }
        if (!man)
            return;
        try {
            this.oracle = new RulesOracle(createEngine, manifestBytes);
        }
        catch {
            this.oracle = null;
        }
        try {
            this.load(man);
            this.ready = true;
        }
        catch {
            /* a valley we cannot read: keep the slot alive with the bare minimum */
            this.ready = false;
        }
    }
    tick(observeBytes) {
        let orders = [];
        this.meta = [];
        try {
            const obs = decodeObserve(observeBytes);
            if (obs) {
                this.o = obs;
                this.lastObs = obs;
                if (this.ready) {
                    this.observe(obs);
                    orders = this.decide(obs);
                }
                else {
                    orders = this.fallback(obs);
                }
            }
        }
        catch {
            try {
                orders = this.o ? this.fallback(this.o) : [];
            }
            catch {
                orders = [];
            }
        }
        if (this.meta.length !== orders.length) {
            this.meta = orders.map((x) => ({ kind: x.kind, unit: '', tgt: -1, cls: null, lot: -1, amount: 0, fresh: false, foe: '' }));
        }
        this.sentLast = this.meta;
        try {
            return encodeOrders(orders);
        }
        catch {
            this.sentLast = [];
            return encodeOrders([]);
        }
    }
    feedback(verdictBytes) {
        try {
            const vs = decodeVerdicts(verdictBytes);
            if (!vs)
                return;
            for (const v of vs) {
                const i = v[0];
                const ok = v[1];
                const code = v[2];
                const m = this.sentLast[i];
                if (!m)
                    continue;
                if (ok) {
                    this.lastOk = this.t;
                    if (m.kind === 'yard' && m.cls)
                        this.hulls.push({ cls: m.cls, at: this.t + this.droneBuild });
                    if (m.kind === 'bid')
                        this.bidSent.set(m.lot, m.amount);
                    continue;
                }
                this.denied(m, code);
            }
        }
        catch {
            /* verdicts are advisory */
        }
    }
    denied(m, code) {
        if (!m.unit)
            return;
        const a = this.asg.get(m.unit);
        if (code === 4) {
            /* mid-step: keep the plan, resend later */
            if (a)
                a.sent = -100;
            return;
        }
        if (code === 11 || code === 12 || code === 21 || code === 13 || code === 17 || code === 16 || code === 18) {
            if (m.tgt >= 0)
                this.black.set(m.unit + ':' + m.tgt, this.t + 80);
            if (m.kind === 'needle' && m.tgt >= 0)
                this.badSite.set(m.tgt, this.t + 200);
            if (m.foe)
                this.black.set(m.unit + ':' + m.foe, this.t + 15);
        }
        if (a && (m.fresh || code !== 6))
            this.asg.delete(m.unit);
    }
    belief(obs) {
        try {
            const o = obs ?? this.lastObs;
            if (!o || !this.ready)
                return null;
            const full = this.bN % 200 === 0;
            this.bN++;
            const p = o.pulse;
            const f = {
                t: o.t,
                pulse: { energy: p.energy, chan: p.chan, ear: p.ear, minutes: p.minutes, needles: p.needles },
            };
            const own = {};
            const dark = {};
            let nOwn = 0;
            let nDark = 0;
            for (const n of this.ndl.values()) {
                const k = key(n.c);
                const ow = n.owner;
                if (full || this.bOwn.get(k) !== ow || !this.bOwn.has(k)) {
                    own[k] = ow;
                    nOwn++;
                }
                if (full || this.bDark.get(k) !== n.dark) {
                    dark[k] = n.dark;
                    nDark++;
                }
                this.bOwn.set(k, ow);
                this.bDark.set(k, n.dark);
            }
            if (full)
                f.full = true;
            if (full || nOwn)
                f.own = own;
            if (full || nDark)
                f.dark = dark;
            f.foe = o.foe.map((x) => [x.id, x.p, x.q, x.r]);
            f.noisy = o.noisy.length;
            f.units = o.mine.units.map((u) => [u.id, u.q, u.r, u.task ? u.task.path : 0]);
            f.pact = this.partner;
            f.cries = o.pub.cries.map((c) => [c[0], c[1]]);
            return f;
        }
        catch {
            return null;
        }
    }
    /* ================================================================ manifest */
    load(man) {
        const cfg = man.cfg;
        const num = (k, d) => {
            const v = cfg[k];
            return typeof v === 'number' && Number.isFinite(v) ? v : d;
        };
        this.linkRange = num('linkRange', 5);
        this.costT = num('costTkach', 90);
        this.costK = num('costKlinok', 50);
        this.stepT = num('stepTkach', 2);
        this.stepK = num('stepKlinok', 1);
        this.rise = num('stepRise', 1);
        this.wT = num('weightTkach', 2);
        this.wK = num('weightKlinok', 1);
        this.squad = num('squadWeight', 8);
        this.costNeedle = num('costNeedle', 60);
        this.buildTicks = num('buildTicks', 8);
        this.feedRing = num('feedRing', 1);
        this.autonomy = num('autonomy', 40);
        this.heatNeedle = num('heatNeedle', 8);
        this.heatEnemy = num('heatEnemy', 24);
        this.heatDark = num('heatDark', 16);
        this.capGrace = num('capGrace', 60);
        this.jamHold = num('jamHold', 20);
        this.jamStart = num('jamStart', 64);
        this.jamKeep = num('jamKeep', 8);
        this.orderBonus = num('orderBonus', 30);
        this.holdTicks = num('orderHoldTicks', 12);
        this.chanOrder = num('chanOrder', 32);
        this.chanTick = num('chanTick', 32);
        this.scanCost = num('scanCost', 256);
        this.regen = num('energyRegen', 1);
        this.energyCap = num('energyCap', 360);
        this.droneBuild = num('droneBuild', 4);
        this.ringPull = num('ringPull', 1.25);
        this.minuteRate = num('minuteRate', 0.0005);
        this.stormCost = num('stormCost', 2);
        this.crownMult = num('crownMult', 1.15);
        this.ticks = man.ticks > 0 ? man.ticks : 1200;
        this.dawnAt = man.dawn && man.dawn.at > 0 ? man.dawn.at : this.ticks - num('dawnTicks', 200);
        this.dawnRing = man.dawn && man.dawn.ring > 0 ? man.dawn.ring : num('dawnRing', 2);
        this.cherta = man.cherta > 0 ? man.cherta : 6;
        if (Array.isArray(man.rings) && man.rings.length >= 2)
            this.rings = man.rings.slice();
        this.storms = Array.isArray(man.storms) ? man.storms : [];
        const cc = cellAt(man.citadel.q, man.citadel.r);
        if (cc >= 0)
            this.citadelC = cc;
        /* terrain */
        const types = man.terrain.types;
        const byName = { bare: 2, meadow: 3, wood: 2, sand: 1, marsh: 1, hill: 1, water: 0, mount: 0, mountain: 0 };
        const tt = new Uint8Array(NC);
        for (const c of man.terrain.cells) {
            const i = cellAt(c[0], c[1]);
            if (i >= 0)
                tt[i] = c[2];
        }
        let valSum = 0;
        for (const i of ALL) {
            const ty = types[tt[i] ?? 0];
            if (!ty) {
                this.pass[i] = 1;
                this.bld[i] = 1;
                this.stepMul[i] = 1;
                this.val[i] = 2;
                continue;
            }
            this.pass[i] = ty.pass ? 1 : 0;
            this.bld[i] = ty.build ? 1 : 0;
            this.stepMul[i] = ty.cost > 0 ? ty.cost : 1;
            const v = typeof ty.min === 'number' && Number.isFinite(ty.min) ? ty.min : (byName[ty.name] ?? 1);
            this.val[i] = v;
            valSum += v;
            this.reachT[i] = ty.reach ? 1 : 0;
            this.block[i] = ty.block ? 1 : 0;
        }
        if (valSum <= 0) {
            for (const i of ALL) {
                const ty = types[tt[i] ?? 0];
                this.val[i] = ty ? (byName[ty.name] ?? 1) : 2;
            }
        }
        /* levels: (r, q) ascending; cross-checked against the engine when it is at hand */
        const lv = Array.isArray(man.levels) ? man.levels : [];
        const rMaj = new Float64Array(NC);
        const qMaj = new Float64Array(NC);
        let k = 0;
        for (let r = -VR; r <= VR; r++) {
            for (let q = -VR; q <= VR; q++) {
                const i = cellAt(q, r);
                if (i < 0)
                    continue;
                rMaj[i] = lv[k] ?? 0;
                k++;
            }
        }
        k = 0;
        for (let q = -VR; q <= VR; q++) {
            for (let r = -VR; r <= VR; r++) {
                const i = cellAt(q, r);
                if (i < 0)
                    continue;
                qMaj[i] = lv[k] ?? 0;
                k++;
            }
        }
        this.lev = rMaj;
        if (this.oracle) {
            try {
                const E = this.oracle.engine;
                let mr = 0;
                let mq = 0;
                let n = 0;
                for (const i of ALL) {
                    const x = E.terrainLevel(cq(i), cr(i));
                    if (typeof x !== 'number')
                        continue;
                    n++;
                    if (x === rMaj[i])
                        mr++;
                    if (x === qMaj[i])
                        mq++;
                }
                if (n > 0 && mq > mr && mq > n * 0.9)
                    this.lev = qMaj;
            }
            catch {
                /* keep r-major */
            }
        }
        /* finds */
        for (const f of man.finds) {
            const c = cellAt(f.q, f.r);
            if (c < 0)
                continue;
            this.finds.push({ kind: f.kind, c, taken: false });
            if (f.kind === 'dead')
                this.dead[c] = 1;
            if (f.kind === 'still') {
                for (const o of OFFS) {
                    if (o.d > 1)
                        break;
                    const j = cellAt(f.q + o.dq, f.r + o.dr);
                    if (j >= 0)
                        this.still[j] = 1;
                }
            }
        }
        /* seats */
        this.seatsC = man.seats.map((h) => cellAt(h.q, h.r));
        if (Array.isArray(man.perm) && man.perm.length === 3)
            this.seatSlot = man.perm.slice();
        const si = this.seatSlot.indexOf(this.slot);
        this.hearthC = this.seatsC[si >= 0 ? si : 'ABC'.indexOf(this.slot)] ?? -1;
        /* needles */
        for (const s of man.needles) {
            const c = cellAt(s.q, s.r);
            if (c < 0)
                continue;
            const ring = !!(s.ring || s.spoke);
            let owner = null;
            if (s.start) {
                let best = 0;
                let bd = INF;
                for (let j = 0; j < this.seatsC.length; j++) {
                    const d = cd(c, this.seatsC[j] ?? 0);
                    if (d < bd) {
                        bd = d;
                        best = j;
                    }
                }
                owner = this.seatSlot[best] ?? s.start;
            }
            else if (ring)
                owner = 'K';
            this.ndl.set(c, { c, owner, dark: false, seen: 0, look: 0, ring, start: !!s.start, grace: 0, jamUntil: -1, jamBy: '' });
        }
        /* lots */
        for (const l of man.lots) {
            const cells = [];
            for (const h of l.cells) {
                const c = cellAt(h.q, h.r);
                if (c >= 0)
                    cells.push(c);
            }
            this.lots.push({ at: l.at, cells });
        }
        /* building sites (static part) */
        for (const i of ALL) {
            if (!this.pass[i] || !this.bld[i] || this.dead[i])
                continue;
            let ok = true;
            for (const s of this.seatsC)
                if (s >= 0 && cd(i, s) <= 2)
                    ok = false;
            if (ok)
                this.buildCells.push(i);
        }
        /* the engine's thread test is preferred, but only if it speaks of the same geometry */
        if (this.oracle) {
            let n = 0;
            let agree = 0;
            try {
                for (let s = 0; s < ALL.length; s += 11) {
                    const a = ALL[s] ?? 0;
                    for (let k = 7; k < OFFS.length; k += 13) {
                        const o = OFFS[k];
                        if (!o || o.d > this.linkRange)
                            continue;
                        const b = cellAt(cq(a) + o.dq, cr(a) + o.dr);
                        if (b < 0)
                            continue;
                        n++;
                        const x = !!this.oracle.linkOk({ q: cq(a), r: cr(a) }, { q: cq(b), r: cr(b) });
                        if (x === this.linkOwn(a, b))
                            agree++;
                    }
                }
            }
            catch {
                n = 1;
                agree = 0;
            }
            if (n > 0 && agree < n * 0.8)
                this.oracle = null;
        }
    }
    /* ================================================================ helpers */
    link(a, b) {
        if (a === b)
            return true;
        const x = a < b ? a : b;
        const y = a < b ? b : a;
        const k = x * NC + y;
        const hit = this.linkCache.get(k);
        if (hit !== undefined)
            return hit;
        let ok = false;
        const rng = this.linkRange + (this.reachT[a] || this.reachT[b] ? 1 : 0);
        if (cd(a, b) <= rng) {
            if (this.oracle) {
                try {
                    ok = !!this.oracle.linkOk({ q: cq(a), r: cr(a) }, { q: cq(b), r: cr(b) });
                }
                catch {
                    ok = this.linkOwn(a, b);
                }
            }
            else
                ok = this.linkOwn(a, b);
        }
        this.linkCache.set(k, ok);
        return ok;
    }
    linkOwn(a, b) {
        const n = cd(a, b);
        if (n <= 1)
            return true;
        const aq = cq(a);
        const ar = cr(a);
        const bq = cq(b);
        const br = cr(b);
        for (let i = 1; i < n; i++) {
            const f = i / n;
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
            const j = cellAt(rx, rz);
            if (j >= 0 && this.block[j])
                return false;
        }
        return true;
    }
    storm(c, t) {
        if (c < 0 || !this.storms.length || this.still[c])
            return false;
        try {
            return stormAt(this.storms, cq(c), cr(c), t);
        }
        catch {
            return false;
        }
    }
    unitCost(u) {
        return this.chanOrder * (this.storm(cellAt(u.q, u.r), this.t) ? this.stormCost : 1);
    }
    homeCost() {
        return this.chanOrder * (this.storm(this.hearthC, this.t) ? this.stormCost : 1);
    }
    inLine(c) {
        return cd(c, this.citadelC) <= this.cherta;
    }
    ringW(d, fed) {
        const k = fed ? d - this.feedRing : d;
        if (k <= 0)
            return this.rings[0] ?? 1;
        return this.rings[k] ?? 0;
    }
    ringMult(n) {
        if (!n || !n.ring)
            return 1;
        return this.t >= this.dawnAt ? this.dawnRing : this.ringPull;
    }
    addPull(arr, c, mult, fed) {
        const q = cq(c);
        const r = cr(c);
        const maxD = fed ? 3 + this.feedRing : 3;
        for (const o of OFFS) {
            if (o.d > maxD)
                break;
            const j = cellAt(q + o.dq, r + o.dr);
            if (j < 0)
                continue;
            arr[j] = (arr[j] ?? 0) + this.ringW(o.d, fed) * mult;
        }
    }
    /* minutes per tick a new needle of ours at c would add; removeO - foreign pull it takes away */
    gainAt(c, mult, removeO) {
        const q = cq(c);
        const r = cr(c);
        let g = 0;
        for (const o of OFFS) {
            if (o.d > 3)
                break;
            const j = cellAt(q + o.dq, r + o.dr);
            if (j < 0)
                continue;
            const v = this.val[j] ?? 0;
            if (v <= 0)
                continue;
            const w = this.ringW(o.d, false);
            const p = this.plan[j] ?? 0;
            const oth = this.othP[j] ?? 0;
            const o2 = removeO > 0 ? Math.max(0, oth - w * removeO) : oth;
            g += v * (share(p + w * mult, o2) - share(p, oth));
        }
        return g * this.minuteRate;
    }
    /* minutes per tick the others lose when a needle with pull mult at c goes away from them */
    harmAt(c, mult) {
        const q = cq(c);
        const r = cr(c);
        let g = 0;
        for (const o of OFFS) {
            if (o.d > 3)
                break;
            const j = cellAt(q + o.dq, r + o.dr);
            if (j < 0)
                continue;
            const v = this.val[j] ?? 0;
            if (v <= 0)
                continue;
            const w = this.ringW(o.d, false) * mult;
            const p = this.plan[j] ?? 0;
            const oth = this.othP[j] ?? 0;
            g += v * (share(oth, p) - share(Math.max(0, oth - w), p));
        }
        return Math.max(0, g) * this.minuteRate;
    }
    feedGain(c, mult) {
        const q = cq(c);
        const r = cr(c);
        let g = 0;
        for (const o of OFFS) {
            if (o.d > 3 + this.feedRing)
                break;
            const j = cellAt(q + o.dq, r + o.dr);
            if (j < 0)
                continue;
            const v = this.val[j] ?? 0;
            if (v <= 0)
                continue;
            const dw = (this.ringW(o.d, true) - (o.d <= 3 ? this.ringW(o.d, false) : 0)) * mult;
            if (dw <= 0)
                continue;
            const p = this.plan[j] ?? 0;
            const oth = this.othP[j] ?? 0;
            g += v * (share(p + dw, oth) - share(p, oth));
        }
        return g * this.minuteRate;
    }
    /* travel times; a Tkach before dawn may end on a forbidden cell but never passes one */
    travel(from, cls) {
        const k = from * 2 + (cls === TK ? 0 : 1);
        const hit = this.travelCache.get(k);
        if (hit)
            return hit;
        const dist = this.search(from, cls, cls === TK && this.guardLine, null);
        this.travelCache.set(k, dist);
        return dist;
    }
    search(from, cls, avoid, prev) {
        const dist = new Float64Array(NC).fill(INF);
        if (from < 0)
            return dist;
        if (prev)
            prev.fill(-1);
        const step = cls === TK ? this.stepT : this.stepK;
        const h = this.heap;
        h.clear();
        dist[from] = 0;
        h.push(0, from);
        while (h.size > 0) {
            const u = h.pop();
            const du = h.top;
            if (du > (dist[u] ?? INF))
                continue;
            if (avoid && u !== from && this.forbid[u])
                continue;
            const lu = this.lev[u] ?? 0;
            for (let d = 0; d < 6; d++) {
                const v = nb(u, d);
                if (v < 0 || !this.pass[v])
                    continue;
                const dl = (this.lev[v] ?? 0) - lu;
                if (dl >= 2)
                    continue;
                const nd = du + step * (this.stepMul[v] ?? 1) + (dl >= 1 ? this.rise : 0);
                if (nd < (dist[v] ?? INF)) {
                    dist[v] = nd;
                    if (prev)
                        prev[v] = u;
                    h.push(nd, v);
                }
            }
        }
        return dist;
    }
    /* next waypoint for a Tkach: the server lays its own path, so near the
       Keeper's needles before dawn we walk in short legs around them */
    legFor(from, dest) {
        if (!this.guardLine || from === dest || !this.forbidList.length)
            return dest;
        const prev = this.prevBuf;
        const safe = this.search(from, TK, true, prev);
        if ((safe[dest] ?? INF) >= INF)
            return dest;
        const path = [];
        for (let c = dest; c >= 0 && c !== from && path.length < 200; c = prev[c] ?? -1)
            path.push(c);
        path.reverse();
        if (!path.length)
            return dest;
        const raw = this.search(from, TK, false, null);
        /* a leg is safe when no Keeper's needle lies on any shortest road to its end */
        const ok = (i) => {
            const p = path[i] ?? dest;
            const total = raw[p] ?? INF;
            if (total >= INF)
                return true;
            let maybe = false;
            for (const f of this.forbidList) {
                if (f !== p && (raw[f] ?? INF) + cd(f, p) * this.stepT <= total + 1e-9)
                    maybe = true;
            }
            if (!maybe)
                return true;
            const back = this.searchBack(p, TK);
            for (const f of this.forbidList) {
                if (f === p)
                    continue;
                if ((raw[f] ?? INF) + (back[f] ?? INF) <= total + 1e-9)
                    return false;
            }
            return true;
        };
        const last = path.length - 1;
        if (ok(last))
            return dest;
        if (!ok(0))
            return path[0] ?? dest;
        let lo = 0;
        let hi = last;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (ok(mid))
                lo = mid;
            else
                hi = mid;
        }
        return path[lo] ?? dest;
    }
    /* times to reach `to` from every cell */
    searchBack(to, cls) {
        const dist = new Float64Array(NC).fill(INF);
        if (to < 0)
            return dist;
        const step = cls === TK ? this.stepT : this.stepK;
        const h = this.heap;
        h.clear();
        dist[to] = 0;
        h.push(0, to);
        while (h.size > 0) {
            const u = h.pop();
            const du = h.top;
            if (du > (dist[u] ?? INF))
                continue;
            const lu = this.lev[u] ?? 0;
            const cu = step * (this.stepMul[u] ?? 1);
            for (let d = 0; d < 6; d++) {
                const v = nb(u, d);
                if (v < 0 || !this.pass[v])
                    continue;
                const dl = lu - (this.lev[v] ?? 0);
                if (dl >= 2)
                    continue;
                const nd = du + cu + (dl >= 1 ? this.rise : 0);
                if (nd < (dist[v] ?? INF)) {
                    dist[v] = nd;
                    h.push(nd, v);
                }
            }
        }
        return dist;
    }
    /* the order that moves a Tkach on along its assignment */
    tkOrder(u, a) {
        const c = this.uc(u);
        const leg = a.kind === 'cap' || a.kind === 'build' || a.kind === 'feed' ? this.legFor(c, a.dest) : a.dest;
        if (leg !== a.dest && leg !== c) {
            a.leg = leg;
            return { kind: 'move', unit: u.id, q: cq(leg), r: cr(leg), goal: null, home: false };
        }
        a.leg = -1;
        return this.orderFor(u, a.kind, a.dest, a.tgt);
    }
    stepTime(a, b, cls) {
        const dl = (this.lev[b] ?? 0) - (this.lev[a] ?? 0);
        return (cls === TK ? this.stepT : this.stepK) * (this.stepMul[b] ?? 1) + (dl >= 1 ? this.rise : 0);
    }
    uc(u) {
        return cellAt(u.q, u.r);
    }
    idle(u) {
        const k = u.task;
        if (!k)
            return true;
        return k.path <= 0 && !k.site && !k.feed && !k.jam && !k.ram && !k.goal;
    }
    heatable(c) {
        const n = this.ndl.get(c);
        if (!n || n.start || n.owner === this.slot)
            return false;
        if (this.partner && n.owner === this.partner)
            return false;
        return n.grace <= this.t;
    }
    acting(u) {
        if (!this.idle(u))
            return true;
        return u.cls === TK && this.heatable(this.uc(u));
    }
    isBlack(unit, tgt) {
        const until = this.black.get(unit + ':' + tgt);
        return until !== undefined && until > this.t;
    }
    hwOf(owner) {
        if (!owner)
            return 0;
        return this.hw.get(owner) ?? 0.4;
    }
    /* ================================================================ observation */
    observe(o) {
        this.t = o.t;
        this.travelCache.clear();
        this.units = o.mine.units.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        this.energy = o.pulse.energy;
        this.spent = 0;
        this.mine.clear();
        for (const n of o.mine.needles) {
            const c = cellAt(n.q, n.r);
            if (c >= 0)
                this.mine.set(c, n);
        }
        if (!this.firstDone)
            this.findHearth();
        /* pact partner */
        this.partner = null;
        for (const l of o.pub.pact.active) {
            if (l.a === this.slot)
                this.partner = l.b;
            else if (l.b === this.slot)
                this.partner = l.a;
        }
        /* harm weights: the leading opponent counts more */
        this.hw.clear();
        const sc = o.pub.score;
        const opp = ['A', 'B', 'C'].filter((s) => s !== this.slot);
        const s0 = sc['ABC'.indexOf(opp[0] ?? 'A')] ?? 0;
        const s1 = sc['ABC'.indexOf(opp[1] ?? 'B')] ?? 0;
        this.hw.set(opp[0] ?? 'A', s0 >= s1 ? 0.6 : 0.4);
        this.hw.set(opp[1] ?? 'B', s0 >= s1 ? 0.4 : 0.6);
        this.hw.set('K', 0);
        this.hw.set('?', 0.4);
        /* visible needles */
        for (const e of o.own) {
            const c = cellAt(e.q, e.r);
            if (c < 0)
                continue;
            let n = this.ndl.get(c);
            if (!n) {
                n = { c, owner: e.owner, dark: e.dark, seen: this.t, look: this.t, ring: false, start: false, grace: e.owner && e.owner !== this.slot ? this.t + this.capGrace / 2 : 0, jamUntil: -1, jamBy: '' };
                this.ndl.set(c, n);
            }
            if (n.owner !== e.owner && n.seen > 0)
                n.grace = Math.max(n.grace, this.t + this.capGrace - 4);
            n.owner = e.owner;
            n.dark = e.dark;
            n.seen = this.t;
            n.look = this.t;
        }
        /* events */
        for (const e of o.events) {
            switch (e.type) {
                case 'cap': {
                    const c = cellAt(e.q, e.r);
                    if (c < 0)
                        break;
                    const n = this.ensure(c);
                    n.owner = e.p;
                    n.grace = this.t + this.capGrace - 1;
                    n.seen = this.t;
                    n.dark = false;
                    if (e.from === this.slot)
                        this.threatAt = this.t;
                    break;
                }
                case 'raise': {
                    const c = cellAt(e.q, e.r);
                    if (c < 0)
                        break;
                    const n = this.ensure(c);
                    n.owner = e.p;
                    n.grace = this.t + this.capGrace - 1;
                    n.seen = this.t;
                    break;
                }
                case 'jam': {
                    const c = cellAt(e.q, e.r);
                    if (c < 0)
                        break;
                    const n = this.ensure(c);
                    n.jamUntil = this.t + this.jamHold;
                    n.jamBy = e.p;
                    if (e.own === this.slot)
                        this.threatAt = this.t;
                    break;
                }
                case 'lost': {
                    if (e.p !== this.slot) {
                        const c = cellAt(e.q, e.r);
                        for (const f of this.foes.values()) {
                            if (f.p === e.p && f.cls === e.cls && f.c === c) {
                                this.foes.delete(f.id);
                                break;
                            }
                        }
                    }
                    break;
                }
                case 'find': {
                    const c = cellAt(e.q, e.r);
                    for (const f of this.finds)
                        if (f.c === c)
                            f.taken = true;
                    break;
                }
                case 'lot': {
                    const l = this.lots[e.lot];
                    if (l && e.p) {
                        for (const c of l.cells) {
                            const n = this.ndl.get(c);
                            if (n && n.owner === null) {
                                n.owner = e.p;
                                n.grace = this.t;
                            }
                        }
                    }
                    break;
                }
                case 'build': {
                    if (e.p === this.slot) {
                        const i = this.hulls.findIndex((h) => h.cls === e.cls);
                        if (i >= 0)
                            this.hulls.splice(i, 1);
                    }
                    break;
                }
                case 'order':
                    this.replanAll = true;
                    break;
                case 'ram':
                    if (e.tgt === this.slot)
                        this.threatAt = this.t;
                    break;
                default:
                    break;
            }
        }
        this.hulls = this.hulls.filter((h) => h.at + 8 > this.t);
        /* fresh losses */
        for (const l of o.mine.losts) {
            const c = cellAt(l.q, l.r);
            if (c < 0)
                continue;
            const n = this.ensure(c);
            if (n.owner === this.slot || n.owner === null) {
                n.owner = l.owner;
                n.grace = Math.max(n.grace, l.t + this.capGrace);
            }
            n.dark = l.dark;
        }
        /* own needles are known in full */
        for (const n of this.ndl.values()) {
            if (n.owner === this.slot && !this.mine.has(n.c)) {
                n.owner = '?';
                n.grace = Math.max(n.grace, this.t + this.capGrace / 2);
            }
        }
        for (const [c, m] of this.mine) {
            const n = this.ensure(c);
            if (n.owner !== this.slot)
                n.grace = this.t + this.capGrace;
            n.owner = this.slot;
            n.dark = m.dark;
            n.seen = this.t;
            n.look = this.t;
        }
        /* foes */
        const seenNow = new Set();
        for (const f of o.foe) {
            const c = cellAt(f.q, f.r);
            seenNow.add(f.id);
            const old = this.foes.get(f.id);
            if (old) {
                old.still = old.c === c ? old.still + 1 : 0;
                old.c = c;
                old.seen = this.t;
            }
            else
                this.foes.set(f.id, { id: f.id, p: f.p, cls: f.cls, c, seen: this.t, still: 0 });
        }
        for (const [id, f] of this.foes)
            if (this.t - f.seen > 60)
                this.foes.delete(id);
        /* own units' motion */
        for (const u of this.units) {
            const c = this.uc(u);
            if (this.lastC.get(u.id) !== c) {
                this.lastC.set(u.id, c);
                this.movedAt.set(u.id, this.t);
            }
        }
        /* contract */
        const ob = o.pub.order;
        if (ob && this.t <= ob.to) {
            const cells = ob.cells.map((h) => cellAt(h.q, h.r)).filter((c) => c >= 0);
            const k = cells.join(',') + ':' + ob.to;
            if (k !== this.contractKey) {
                this.contractKey = k;
                this.replanAll = true;
            }
            this.contract = { cells, to: ob.to, active: false, bonus: ob.bonus > 0 ? ob.bonus : this.orderBonus };
        }
        else
            this.contract = null;
        if (!this.dawnReplanned && this.t >= this.dawnAt - 50) {
            this.dawnReplanned = true;
            this.replanAll = true;
        }
    }
    ensure(c) {
        let n = this.ndl.get(c);
        if (!n) {
            n = { c, owner: null, dark: false, seen: this.t, look: this.t, ring: false, start: false, grace: 0, jamUntil: -1, jamBy: '' };
            this.ndl.set(c, n);
        }
        return n;
    }
    findHearth() {
        this.firstDone = true;
        if (this.mine.size > 0 && this.seatsC.length) {
            let best = -1;
            let bd = INF;
            for (let j = 0; j < this.seatsC.length; j++) {
                const s = this.seatsC[j] ?? -1;
                if (s < 0)
                    continue;
                let d = 0;
                for (const c of this.mine.keys())
                    d += cd(c, s);
                if (d < bd) {
                    bd = d;
                    best = j;
                }
            }
            if (best >= 0) {
                this.hearthC = this.seatsC[best] ?? this.hearthC;
                if (this.seatSlot[best] !== this.slot) {
                    /* the seat table speaks another language: rebuild it around our own seat */
                    const others = ['A', 'B', 'C'].filter((s) => s !== this.slot);
                    let oi = 0;
                    const ss = [];
                    for (let j = 0; j < this.seatsC.length; j++)
                        ss.push(j === best ? this.slot : (others[oi++] ?? '?'));
                    for (const n of this.ndl.values()) {
                        if (!n.start)
                            continue;
                        let bj = 0;
                        let bdd = INF;
                        for (let j = 0; j < this.seatsC.length; j++) {
                            const d = cd(n.c, this.seatsC[j] ?? 0);
                            if (d < bdd) {
                                bdd = d;
                                bj = j;
                            }
                        }
                        n.owner = ss[bj] ?? n.owner;
                    }
                    this.seatSlot = ss;
                }
            }
        }
        if (this.hearthC < 0)
            this.hearthC = this.seatsC[0] ?? cellAt(6, -12);
        this.enemyHearths = this.seatsC.filter((s) => s >= 0 && s !== this.hearthC);
    }
    /* ================================================================ per tick model */
    model(o) {
        const t = this.t;
        this.guardLine = t < this.dawnAt && !o.pulse.mercy;
        this.forbid.fill(0);
        this.nearForbid.fill(0);
        this.forbidList = [];
        if (this.guardLine) {
            for (const n of this.ndl.values()) {
                if (n.owner === this.slot || n.start || !this.inLine(n.c))
                    continue;
                this.forbid[n.c] = 1;
                this.nearForbid[n.c] = 1;
                this.forbidList.push(n.c);
                for (let k = 0; k < 6; k++) {
                    const j = nb(n.c, k);
                    if (j >= 0)
                        this.nearForbid[j] = 1;
                }
            }
        }
        this.travelCache.clear();
        this.myP.fill(0);
        this.othP.fill(0);
        this.litCount = 0;
        let eSum = 0;
        const ews = [];
        for (const [c, m] of this.mine) {
            if (m.weight <= 0)
                continue;
            const n = this.ndl.get(c);
            this.addPull(this.myP, c, m.weight * this.ringMult(n), m.fed);
            ews.push(Math.min(1, m.weight));
            if (m.weight >= 0.99)
                this.litCount++;
        }
        ews.sort((a, b) => b - a);
        for (let i = 0; i < ews.length && i < 8; i++)
            eSum += ews[i] ?? 0;
        this.rate = (this.regen / 4) * eSum;
        this.myJams.clear();
        for (const j of o.mine.jams)
            if (j.until >= t)
                this.myJams.add(cellAt(j.q, j.r));
        for (const n of this.ndl.values()) {
            if (n.owner === this.slot || n.owner === null)
                continue;
            if (n.owner === 'K' && t >= this.dawnAt)
                continue;
            const m = this.ringMult(n);
            if (this.myJams.has(n.c)) {
                this.addPull(this.myP, n.c, m, false);
                continue;
            }
            if (n.dark && t - n.seen < 80)
                continue;
            this.addPull(this.othP, n.c, m, false);
        }
        /* planned needles join our pull and our thread */
        this.plan.set(this.myP);
        this.reserved.clear();
        this.jamRes.clear();
        this.occupied.clear();
        for (const u of this.units)
            this.occupied.add(this.uc(u));
        for (const a of this.asg.values()) {
            if (a.kind === 'cap' || a.kind === 'build' || a.kind === 'feed')
                this.reserved.add(a.tgt);
            if (a.kind === 'jam')
                this.jamRes.add(a.tgt);
            if (a.kind === 'post' || a.kind === 'guard' || a.kind === 'feed')
                this.occupied.add(a.dest);
            if (a.kind === 'cap' || a.kind === 'build') {
                const n = this.ndl.get(a.tgt);
                if (n && n.owner === this.slot)
                    continue;
                this.addPull(this.plan, a.tgt, this.ringMult(n) * (n && n.ring && t < this.dawnAt ? this.dawnRing / this.ringPull : 1), false);
            }
        }
        this.buildClusters();
        /* thread reach */
        const nodes = [];
        if (this.hearthC >= 0)
            nodes.push(this.hearthC);
        for (const [c, m] of this.mine)
            if (m.weight >= 0.99)
                nodes.push(c);
        this.reachNow.fill(0);
        for (const c of nodes)
            this.markReach(c, this.reachNow);
        this.reachPlan.set(this.reachNow);
        const pend = [];
        for (const a of this.asg.values())
            if ((a.kind === 'cap' || a.kind === 'build') && !this.mine.has(a.tgt))
                pend.push(a.tgt);
        for (let pass = 0; pass < 2; pass++) {
            for (const c of pend) {
                if (c < 0 || !this.reachPlan[c])
                    continue;
                this.markReach(c, this.reachPlan);
            }
        }
        /* comms zone and distance fields (hex steps) */
        const zq = [];
        this.zoneDist.fill(-1);
        for (const i of ALL) {
            if ((this.myP[i] ?? 0) > 0 || (this.hearthC >= 0 && cd(i, this.hearthC) <= this.linkRange)) {
                this.zoneDist[i] = 0;
                zq.push(i);
            }
        }
        this.bfs(zq, this.zoneDist);
        const mq = [];
        this.myDist.fill(-1);
        for (const c of this.mine.keys()) {
            this.myDist[c] = 0;
            mq.push(c);
        }
        if (!mq.length && this.hearthC >= 0) {
            this.myDist[this.hearthC] = 0;
            mq.push(this.hearthC);
        }
        this.bfs(mq, this.myDist);
        /* danger: enemy Klinoks seen lately */
        this.danger.fill(0);
        for (const f of this.foes.values()) {
            if (f.cls !== KL || f.p === 'K' || f.p === this.partner)
                continue;
            if (t - f.seen > 25)
                continue;
            const q = cq(f.c);
            const r = cr(f.c);
            for (const off of OFFS) {
                if (off.d > 4)
                    break;
                const j = cellAt(q + off.dq, r + off.dr);
                if (j >= 0)
                    this.danger[j] = (this.danger[j] ?? 0) + (off.d <= 2 ? 1 : 0.5);
            }
        }
    }
    markReach(c, arr) {
        const q = cq(c);
        const r = cr(c);
        for (const o of OFFS) {
            const j = cellAt(q + o.dq, r + o.dr);
            if (j < 0 || arr[j])
                continue;
            if (o.d <= this.linkRange + 1 && this.link(c, j))
                arr[j] = 1;
        }
    }
    bfs(queue, dist) {
        let h = 0;
        while (h < queue.length) {
            const u = queue[h++] ?? 0;
            const du = dist[u] ?? 0;
            for (let k = 0; k < 6; k++) {
                const v = nb(u, k);
                if (v < 0 || (dist[v] ?? 0) >= 0)
                    continue;
                dist[v] = du + 1;
                queue.push(v);
            }
        }
    }
    /* ================================================================ decisions */
    decide(o) {
        this.out = [];
        this.meta = [];
        this.cmdSpent = 0;
        this.chanAvail = Math.max(0, Math.min(o.pulse.chan, o.pulse.chanAt));
        this.cap = Math.floor(o.pulse.chanAt / this.chanOrder) + 4;
        this.touched.clear();
        this.dropped.clear();
        for (const [k, until] of this.black)
            if (until <= this.t)
                this.black.delete(k);
        this.model(o);
        this.validate();
        this.evalContract();
        this.hands = 0;
        for (const u of this.units)
            if (this.acting(u))
                this.hands += this.chanTick;
        /* the slot must hear an accepted command at least once in 6 ticks */
        if (this.t - this.lastOk >= 5)
            this.keepalive(true);
        const steps = [
            () => this.planThreats(o),
            () => this.maintain(),
            () => this.planBids(),
            () => this.planYard(),
            () => this.planTkachs(),
            () => this.planKlinoks(),
            () => this.planScan(o),
            () => this.haltDropped(),
        ];
        for (const s of steps) {
            try {
                s();
            }
            catch {
                /* one planner failing must not silence the tick */
            }
        }
        this.replanAll = false;
        /* rams and jams may be refused: they do not count as a sure command */
        const sure = this.out.some((x) => x.kind !== 'ram' && x.kind !== 'jam');
        if (!sure && this.t - this.lastOk >= 3)
            this.keepalive(this.t - this.lastOk >= 4);
        return this.out;
    }
    fallback(o) {
        this.out = [];
        this.meta = [];
        this.cmdSpent = 0;
        this.chanAvail = o.pulse.chan;
        this.cap = Math.floor(o.pulse.chanAt / 32) + 4;
        this.hands = 0;
        const s = o.mine.needles[0];
        if (s)
            this.issue({ kind: 'watch', q: s.q, r: s.r, keep: 0 }, 32, false, true, '', -1);
        return this.out;
    }
    /* command gate: hard limits always, soft (hands of working units) unless urgent */
    issue(ord, cost, newActor, urgent, unit, tgt, extra) {
        if (this.out.length >= this.cap)
            return false;
        const left = this.chanAvail - this.cmdSpent;
        if (cost > 0 ? left < cost : left < this.chanOrder)
            return false;
        const add = newActor ? this.chanTick : 0;
        if (!urgent && left - this.hands < cost + add)
            return false;
        this.out.push(ord);
        this.meta.push({ kind: ord.kind, unit, tgt, cls: null, lot: -1, amount: 0, fresh: false, foe: '', ...extra });
        this.cmdSpent += cost;
        this.hands += add;
        if (unit)
            this.touched.add(unit);
        return true;
    }
    softLeft() {
        return this.chanAvail - this.cmdSpent - this.hands;
    }
    keepalive(strong) {
        if (!strong) {
            /* a free halt to a unit that stands idle anyway */
            for (const u of this.units) {
                if (u.wait > 0 || !this.idle(u) || this.touched.has(u.id))
                    continue;
                const a = this.asg.get(u.id);
                if (a && a.kind !== 'post' && a.kind !== 'guard')
                    continue;
                if (u.cls === TK && this.heatable(this.uc(u)))
                    continue;
                if (this.issue({ kind: 'halt', unit: u.id }, 0, false, true, u.id, -1))
                    return;
            }
        }
        const h = this.hearthC >= 0 ? this.hearthC : cellAt(6, -12);
        const cost = this.chanOrder * (this.storm(h, this.t) ? this.stormCost : 1);
        this.issue({ kind: 'watch', q: cq(h), r: cr(h), keep: 0 }, cost, false, true, '', -1);
    }
    /* ---------------------------------------------------------------- validation */
    drop(u) {
        this.asg.delete(u.id);
        this.dropped.add(u.id);
    }
    validate() {
        const alive = new Set(this.units.map((u) => u.id));
        for (const id of [...this.asg.keys()])
            if (!alive.has(id))
                this.asg.delete(id);
        const t = this.t;
        for (const u of this.units) {
            const a = this.asg.get(u.id);
            if (!a)
                continue;
            const c = this.uc(u);
            if (c === a.dest && a.arrived < 0)
                a.arrived = t;
            if (c !== a.dest)
                a.arrived = -1;
            const lastMove = this.movedAt.get(u.id) ?? t;
            switch (a.kind) {
                case 'cap': {
                    const n = this.ndl.get(a.tgt);
                    if (!n || n.owner === this.slot || n.start || (this.partner && n.owner === this.partner)) {
                        this.drop(u);
                        break;
                    }
                    if (n.owner === 'K' && t < this.dawnAt - 60 && !(this.o && this.o.pulse.mercy)) {
                        this.drop(u);
                        break;
                    }
                    const heat = this.heatOf(n);
                    if (c === a.tgt) {
                        if (a.arrived >= 0 && t - a.arrived > heat + 8) {
                            n.grace = Math.max(n.grace, t + 30);
                            this.black.set(u.id + ':' + a.tgt, t + 60);
                            this.drop(u);
                        }
                        break;
                    }
                    if (!a.dawn && n.grace > Math.max(t + 6, a.eta - heat)) {
                        this.drop(u);
                        break;
                    }
                    if (t > a.eta + 40 || (u.wait === 0 && t - lastMove > 14 && c !== a.dest)) {
                        this.black.set(u.id + ':' + a.tgt, t + 60);
                        this.drop(u);
                    }
                    break;
                }
                case 'build': {
                    if (this.ndl.has(a.tgt) || (this.badSite.get(a.tgt) ?? 0) > t) {
                        this.drop(u);
                        break;
                    }
                    if (c === a.tgt) {
                        if (a.arrived >= 0 && t - a.arrived > this.buildTicks + 28)
                            this.drop(u);
                        else if (u.wait === 0 && !(u.task && u.task.site) && a.arrived >= 0 && t - a.arrived > 2)
                            this.drop(u);
                        break;
                    }
                    if (t > a.eta + 40 || (u.wait === 0 && t - lastMove > 14)) {
                        this.black.set(u.id + ':' + a.tgt, t + 60);
                        this.drop(u);
                    }
                    break;
                }
                case 'feed': {
                    const m = this.mine.get(a.tgt);
                    if (!m || m.weight < 0.99) {
                        this.drop(u);
                        break;
                    }
                    if (c !== a.dest && u.wait === 0 && t - lastMove > 14)
                        this.drop(u);
                    break;
                }
                case 'ram': {
                    const f = this.foes.get(a.foe);
                    if (!f || t - f.seen > 6)
                        this.drop(u);
                    else if (t - a.since > 45)
                        this.drop(u);
                    break;
                }
                case 'jam': {
                    const n = this.ndl.get(a.tgt);
                    const ours = this.myJams.has(a.tgt);
                    if (!n || n.owner === null || n.owner === this.slot || (n.dark && !ours && t - n.seen <= 1 && !(c === a.dest && t - a.sent <= 3)) || (n.owner === 'K' && t >= this.dawnAt) || n.owner === this.partner) {
                        this.drop(u);
                        break;
                    }
                    if (c !== a.dest && u.wait === 0 && t - lastMove > 12) {
                        this.black.set(u.id + ':' + a.tgt, t + 80);
                        this.drop(u);
                    }
                    break;
                }
                case 'cache': {
                    const f = this.finds.find((x) => x.c === a.tgt);
                    if (!f || f.taken || c === a.tgt || t > a.eta + 20)
                        this.drop(u);
                    else if (u.wait === 0 && t - lastMove > 12)
                        this.drop(u);
                    break;
                }
                case 'post':
                case 'guard': {
                    if (c !== a.dest && u.wait === 0 && t - lastMove > 12) {
                        this.black.set(u.id + ':' + a.dest, t + 100);
                        this.drop(u);
                    }
                    else if (a.kind === 'post') {
                        const m = this.mine.get(a.dest);
                        if (!m)
                            this.drop(u);
                    }
                    else if (t - a.since > 200)
                        this.drop(u);
                    break;
                }
                default:
                    break;
            }
        }
    }
    heatOf(n) {
        if (n.owner === null)
            return this.heatNeedle;
        if (n.owner === 'K' && this.t >= this.dawnAt - 2)
            return this.heatNeedle;
        return n.dark ? this.heatDark : this.heatEnemy;
    }
    /* re-send lost orders, hold jams, step onto the ring at dawn */
    maintain() {
        const t = this.t;
        for (const u of this.units) {
            const a = this.asg.get(u.id);
            if (!a || u.wait > 0 || u.stuck || this.touched.has(u.id))
                continue;
            const c = this.uc(u);
            if (a.kind === 'cap' && a.dawn) {
                if (c === a.dest && a.dest !== a.tgt) {
                    const st = this.stepTime(c, a.tgt, TK);
                    if (t >= this.dawnAt - st + 1) {
                        if (this.issue({ kind: 'move', unit: u.id, q: cq(a.tgt), r: cr(a.tgt), goal: null, home: false }, this.unitCost(u), false, true, u.id, a.tgt)) {
                            a.dest = a.tgt;
                            a.dawn = false;
                            a.sent = t;
                            a.arrived = -1;
                        }
                    }
                    continue;
                }
            }
            if (a.kind === 'jam' && c === a.dest && !a.hold) {
                if (this.issue({ kind: 'jam', unit: u.id, target: { q: cq(a.tgt), r: cr(a.tgt) }, hold: true }, 0, false, true, u.id, a.tgt))
                    a.hold = true;
                continue;
            }
            if (c === a.dest) {
                if (a.kind === 'feed' && !(u.task && u.task.feed) && t - a.sent > 3)
                    this.resend(u, a);
                continue;
            }
            if (a.kind === 'ram')
                continue;
            if (u.cls === TK && a.leg >= 0) {
                if (!this.idle(u))
                    continue;
                if (c !== a.leg) {
                    if (t - a.sent <= 2)
                        continue;
                    a.tries++;
                    if (a.tries > 4) {
                        this.black.set(u.id + ':' + a.tgt, t + 60);
                        this.drop(u);
                        continue;
                    }
                }
                this.resend(u, a);
                continue;
            }
            const lost = a.kind === 'build' ? !(u.task && u.task.site) : a.kind === 'feed' ? !(u.task && u.task.feed) : this.idle(u);
            if (lost && t - a.sent > 2) {
                a.tries++;
                if (a.tries > 4) {
                    this.black.set(u.id + ':' + a.tgt, t + 60);
                    this.drop(u);
                    continue;
                }
                this.resend(u, a);
            }
        }
    }
    resend(u, a) {
        const ord = u.cls === TK ? this.tkOrder(u, a) : this.orderFor(u, a.kind, a.dest, a.tgt);
        if (!ord)
            return;
        const ok = this.issue(ord, this.unitCost(u), !this.acting(u), a.kind === 'cap' || a.kind === 'build', u.id, a.tgt);
        if (ok) {
            a.sent = this.t;
            if (a.kind === 'jam') {
                const kn = this.ndl.get(a.tgt);
                if (!(kn && kn.owner === 'K'))
                    this.issue({ kind: 'jam', unit: u.id, target: { q: cq(a.tgt), r: cr(a.tgt) }, hold: false }, 0, false, true, u.id, a.tgt);
                a.hold = false;
            }
        }
    }
    orderFor(u, kind, dest, tgt) {
        switch (kind) {
            case 'build':
                return { kind: 'needle', unit: u.id, q: cq(tgt), r: cr(tgt) };
            case 'feed':
                return { kind: 'feed', unit: u.id, q: cq(tgt), r: cr(tgt) };
            case 'cap':
            case 'cache':
            case 'post':
            case 'guard':
            case 'jam':
                return { kind: 'move', unit: u.id, q: cq(dest), r: cr(dest), goal: null, home: false };
            default:
                return null;
        }
    }
    haltDropped() {
        for (const u of this.units) {
            if (!this.dropped.has(u.id) || this.touched.has(u.id) || this.asg.has(u.id))
                continue;
            if (u.wait > 0 || this.idle(u))
                continue;
            this.issue({ kind: 'halt', unit: u.id }, 0, false, true, u.id, -1);
        }
    }
    /* ---------------------------------------------------------------- contract */
    evalContract() {
        const k = this.contract;
        if (!k)
            return;
        const t = this.t;
        const need = [];
        for (const c of k.cells) {
            const n = this.ndl.get(c);
            if (!n || n.start) {
                k.active = false;
                return;
            }
            if (n.owner === this.slot)
                continue;
            if (n.owner === 'K' && t < this.dawnAt) {
                k.active = false;
                return;
            }
            if (this.partner && n.owner === this.partner) {
                k.active = false;
                return;
            }
            need.push(c);
        }
        /* all three must hang on our thread */
        for (const c of k.cells) {
            if (this.reachPlan[c])
                continue;
            let ok = false;
            for (const d of k.cells)
                if (d !== c && this.reachPlan[d] && this.link(c, d))
                    ok = true;
            if (!ok) {
                k.active = false;
                return;
            }
        }
        let worst = 0;
        const tks = this.units.filter((u) => u.cls === TK);
        if (need.length && !tks.length) {
            k.active = false;
            return;
        }
        let total = 0;
        for (const c of need) {
            const n = this.ndl.get(c);
            if (!n)
                continue;
            let best = INF;
            for (const u of tks)
                best = Math.min(best, cd(this.uc(u), c) * this.stepT * 1.35 + 2);
            const e = best + this.heatOf(n);
            total += e;
            worst = Math.max(worst, e);
        }
        const est = need.length > tks.length ? total / Math.max(1, tks.length) + worst / 2 : worst;
        k.active = t + est + this.holdTicks + 4 <= k.to;
        k.bonus = k.active && need.length ? (k.bonus * 0.9) / need.length : 0;
    }
    /* ---------------------------------------------------------------- threats */
    findThreats(o) {
        const res = [];
        const t = this.t;
        const working = new Set();
        for (const u of this.units) {
            if (u.cls !== TK)
                continue;
            const a = this.asg.get(u.id);
            if (a && (a.kind === 'cap' || a.kind === 'build') && a.arrived >= 0)
                working.add(this.uc(u));
        }
        for (const f of o.foe) {
            if (f.p === this.slot || f.p === 'K' || f.p === this.partner)
                continue;
            const c = cellAt(f.q, f.r);
            if (c < 0)
                continue;
            const fr = this.foes.get(f.id);
            const still = fr ? fr.still : 0;
            const near = this.myDist[c] ?? 99;
            const nearM = near < 0 ? 99 : near;
            const n = this.ndl.get(c);
            const inK = !!this.contract && this.contract.cells.includes(c);
            let pri = 0;
            let clean = false;
            let maxEta = 0;
            if (f.cls === TK) {
                if (n && n.owner === this.slot && !n.start) {
                    pri = 100;
                    clean = true;
                    maxEta = n.dark ? 20 : 30;
                }
                else if (n && inK) {
                    pri = 92;
                    clean = true;
                    maxEta = 26;
                }
                else if (n && !n.start && n.owner !== this.slot && (n.owner === null || (n.owner === 'K' && t >= this.dawnAt)) && (this.reachNow[c] || nearM <= 4)) {
                    pri = 62;
                    clean = true;
                    maxEta = 16;
                }
                else if (!n && still >= 2 && nearM <= 3) {
                    pri = 50;
                    clean = true;
                    maxEta = 8;
                }
                else if (nearM <= 2) {
                    pri = 28;
                    maxEta = 6;
                }
            }
            else {
                let jamNear = false;
                for (let k = -1; k < 6; k++) {
                    const j = k < 0 ? c : nb(c, k);
                    if (j < 0)
                        continue;
                    const m = this.ndl.get(j);
                    if (m && m.owner === this.slot && m.jamUntil >= t && m.jamBy === f.p)
                        jamNear = true;
                }
                let nearW = 99;
                for (const w of working)
                    nearW = Math.min(nearW, cd(w, c));
                if (jamNear) {
                    pri = inK ? 95 : 72;
                    maxEta = 24;
                }
                else if (nearW <= 2) {
                    pri = 46;
                    maxEta = 10;
                }
                else if (nearM <= 1) {
                    pri = 34;
                    maxEta = 8;
                }
            }
            if (pri > 0)
                res.push({ id: f.id, c, pri, clean, maxEta });
        }
        if (res.some((r) => r.pri >= 46))
            this.threatAt = t;
        res.sort((a, b) => b.pri - a.pri || (a.id < b.id ? -1 : 1));
        return res;
    }
    planThreats(o) {
        const threats = this.findThreats(o);
        if (!threats.length)
            return;
        const kls = this.units.filter((u) => u.cls === KL && !u.stuck);
        const t = this.t;
        for (const th of threats) {
            let handled = false;
            for (const u of kls) {
                const a = this.asg.get(u.id);
                if (!a || a.kind !== 'ram' || a.foe !== th.id)
                    continue;
                handled = true;
                /* the chase stalls when the target slips out of sight: renew it */
                if (u.wait === 0 && this.idle(u) && t - a.sent > 1 && !this.touched.has(u.id)) {
                    if (this.issue({ kind: 'ram', unit: u.id, target: th.id }, this.unitCost(u), true, true, u.id, -1, { foe: th.id }))
                        a.sent = t;
                }
            }
            if (handled)
                continue;
            if (!th.clean && th.pri < 40 && kls.length < 2)
                continue;
            let best = null;
            let bestEta = INF;
            for (const u of kls) {
                if (u.wait > 0 || this.touched.has(u.id))
                    continue;
                const a = this.asg.get(u.id);
                if (a && a.kind === 'ram')
                    continue;
                if (a && a.pri >= th.pri)
                    continue;
                const bl = this.black.get(u.id + ':' + th.id);
                if (bl !== undefined && bl > t)
                    continue;
                const d = this.travel(this.uc(u), KL);
                let e = INF;
                for (let k = 0; k < 6; k++) {
                    const j = nb(th.c, k);
                    if (j >= 0)
                        e = Math.min(e, d[j] ?? INF);
                }
                if (this.uc(u) !== th.c && cd(this.uc(u), th.c) <= 1)
                    e = 0;
                if (e < bestEta || (e === bestEta && best && u.id < best.id)) {
                    bestEta = e;
                    best = u;
                }
            }
            if (!best || bestEta > th.maxEta)
                continue;
            const zd = this.zoneDist[th.c] ?? 0;
            if (zd > 10)
                continue;
            if (this.issue({ kind: 'ram', unit: best.id, target: th.id }, this.unitCost(best), !this.acting(best), true, best.id, -1, { fresh: true, foe: th.id })) {
                this.asg.set(best.id, { kind: 'ram', dest: th.c, tgt: th.c, foe: th.id, since: t, eta: t + bestEta, arrived: -1, dawn: false, hold: false, tries: 0, sent: t, pri: th.pri, leg: -1 });
            }
        }
    }
    /* ---------------------------------------------------------------- bids */
    planBids() {
        const t = this.t;
        if (t >= this.dawnAt)
            return;
        for (let li = 0; li < this.lots.length; li++) {
            const l = this.lots[li];
            if (!l || l.at <= t)
                continue;
            if (t !== l.at - 1 && t !== l.at - 3)
                continue;
            const conn = this.lotConn(l);
            const prev = this.bidSent.get(li) ?? 0;
            if (!conn) {
                if (prev > 0 && t === l.at - 1)
                    this.issue({ kind: 'bid', lot: li, amount: 0 }, this.homeCost(), false, false, '', -1, { lot: li, amount: 0 });
                continue;
            }
            let buildRes = 0;
            for (const u of this.units) {
                const a = this.asg.get(u.id);
                if (a && a.kind === 'build' && cd(this.uc(u), a.tgt) <= 2)
                    buildRes += this.costNeedle;
            }
            const capAmt = conn >= 2 ? 131 : 73;
            const avail = Math.floor(this.energy - this.spent - buildRes - 2);
            const amount = Math.min(capAmt, avail);
            if (amount < this.costNeedle + 1) {
                if (prev > 0 && t === l.at - 1)
                    this.issue({ kind: 'bid', lot: li, amount: 0 }, this.homeCost(), false, false, '', -1, { lot: li, amount: 0 });
                continue;
            }
            if (amount === prev)
                continue;
            this.issue({ kind: 'bid', lot: li, amount }, this.homeCost(), false, t === l.at - 1, '', -1, { lot: li, amount });
        }
    }
    /* ---------------------------------------------------------------- yard */
    counts() {
        let nT = 0;
        let nK = 0;
        for (const u of this.units) {
            if (u.cls === TK)
                nT++;
            else
                nK++;
        }
        for (const h of this.hulls) {
            if (h.cls === TK)
                nT++;
            else
                nK++;
        }
        return { nT, nK, w: nT * this.wT + nK * this.wK };
    }
    wantUnit() {
        const t = this.t;
        if (t > this.ticks - 70)
            return null;
        const { nT, nK } = this.counts();
        if (this.klinokFirst && nK < 1 && t < 30)
            return KL;
        if (nT < 2)
            return TK;
        if (nT < 3 && t < this.ticks - 220)
            return TK;
        if (nK < 1 && (t >= 60 || t - this.threatAt < 40))
            return KL;
        if (nK < 2 && t >= 160 && (t - this.threatAt < 150 || this.energy >= 170))
            return KL;
        return null;
    }
    coreWant() {
        const w = this.wantUnit();
        const { nT, nK } = this.counts();
        if (w === TK && nT < 3)
            return this.costT;
        if (w === KL && nK < 1)
            return this.costK;
        return 0;
    }
    planYard() {
        const t = this.t;
        if (t <= 1 && !this.klinokFirst)
            this.decideOpening();
        const want = this.wantUnit();
        if (!want)
            return;
        const cost = want === TK ? this.costT : this.costK;
        const { w } = this.counts();
        if (w + (want === TK ? this.wT : this.wK) > this.squad)
            return;
        const keep = this.coreWant() > 0 ? 0 : this.lotReserve();
        if (this.energy - this.spent - keep < cost)
            return;
        if (this.issue({ kind: 'yard', cls: want }, this.homeCost(), false, true, '', -1, { cls: want }))
            this.spent += cost;
    }
    /* a near, uncontested cache is worth a Klinok before the first Tkach */
    decideOpening() {
        if (this.hearthC < 0)
            return;
        const mine = this.travel(this.hearthC, KL);
        const theirs = this.enemyHearths.map((h) => this.travel(h, KL));
        for (const f of this.finds) {
            if (f.kind !== 'cache' || f.taken)
                continue;
            const e = mine[f.c] ?? INF;
            if (e > 26)
                continue;
            let enemy = INF;
            for (const d of theirs)
                enemy = Math.min(enemy, d[f.c] ?? INF);
            if (e + 3 <= enemy) {
                this.klinokFirst = true;
                return;
            }
        }
    }
    /* ---------------------------------------------------------------- Tkachs */
    planTkachs() {
        const t = this.t;
        for (const u of this.units) {
            if (u.cls !== TK || u.wait > 0 || u.stuck || this.touched.has(u.id))
                continue;
            const a = this.asg.get(u.id);
            let free = !a;
            if (a && a.kind === 'feed' && (t - a.since >= 30 || this.replanAll))
                free = true;
            if (a && this.replanAll && (a.kind === 'cap' || a.kind === 'build') && a.arrived < 0 && !a.dawn)
                free = true;
            if (!free)
                continue;
            const pick = this.pickTkach(u, a);
            if (!pick) {
                if (a && a.kind !== 'feed')
                    this.drop(u);
                continue;
            }
            if (a && a.kind === pick.kind && (a.tgt === pick.tgt || a.kind === 'feed')) {
                a.since = t;
                continue;
            }
            const c = this.uc(u);
            const fresh = { kind: pick.kind, dest: pick.dest, tgt: pick.tgt, foe: '', since: t, eta: pick.eta, arrived: -1, dawn: pick.dawn, hold: false, tries: 0, sent: t, pri: 0, leg: -1 };
            if (pick.kind === 'cap' && pick.dest === c) {
                /* already standing on it: heating needs no order */
                fresh.arrived = t;
                this.asg.set(u.id, fresh);
                this.reserved.add(pick.tgt);
                continue;
            }
            const ord = this.tkOrder(u, fresh);
            if (!ord)
                continue;
            const urgent = pick.kind === 'cap' || pick.kind === 'build';
            if (this.issue(ord, this.unitCost(u), !this.acting(u), urgent && this.softLeft() >= -this.chanTick, u.id, pick.tgt, { fresh: true })) {
                this.asg.set(u.id, fresh);
                this.reserved.add(pick.tgt);
                if (pick.kind === 'cap' || pick.kind === 'build') {
                    const n = this.ndl.get(pick.tgt);
                    this.addPull(this.plan, pick.tgt, n && n.ring ? this.dawnRing : 1, false);
                    if (this.reachPlan[pick.tgt])
                        this.markReach(pick.tgt, this.reachPlan);
                }
            }
        }
    }
    energyBudget() {
        let res = 0;
        for (const a of this.asg.values())
            if (a.kind === 'build')
                res += this.costNeedle;
        return this.energy - this.spent - res - this.coreWant() - this.lotReserve();
    }
    /* energy kept for a lot that will be revealed soon on our thread */
    lotReserve() {
        const t = this.t;
        if (t >= this.dawnAt)
            return 0;
        let res = 0;
        for (const l of this.lots) {
            if (l.at <= t || l.at - t > 40)
                continue;
            const conn = this.lotConn(l);
            if (conn)
                res = Math.max(res, conn >= 2 ? 131 : 73);
        }
        return res;
    }
    lotConn(l) {
        let conn = 0;
        for (const c of l.cells) {
            const n = this.ndl.get(c);
            if (n && n.owner !== null)
                continue;
            let mineSoon = false;
            for (const a of this.asg.values())
                if (a.kind === 'cap' && a.tgt === c && a.eta < l.at)
                    mineSoon = true;
            if (mineSoon)
                continue;
            if (this.reachNow[c])
                conn++;
        }
        return conn;
    }
    riskAt(c, owner) {
        let r = 1 / (1 + 0.6 * (this.danger[c] ?? 0));
        let eh = INF;
        for (const h of this.enemyHearths)
            eh = Math.min(eh, cd(c, h));
        if (eh <= 4)
            r *= 0.45;
        else if (eh <= 7)
            r *= 0.75;
        if (owner && owner !== 'K' && owner !== this.slot)
            r *= 0.75;
        return r;
    }
    pickTkach(u, cur) {
        const t = this.t;
        const uc = this.uc(u);
        const dist = this.travel(uc, TK);
        const mercy = !!(this.o && this.o.pulse.mercy);
        const preDawn = t < this.dawnAt;
        let best = null;
        const consider = (p) => {
            if (p.score <= 0 || !Number.isFinite(p.score))
                return;
            if (!best || p.score > best.score || (p.score === best.score && p.tgt < best.tgt))
                best = p;
        };
        const k = this.contract;
        const litNeed = this.litCount < 8;
        /* heating */
        for (const n of this.ndl.values()) {
            if (n.owner === this.slot || n.start)
                continue;
            if (this.reserved.has(n.c) && !(cur && cur.tgt === n.c))
                continue;
            if (this.isBlack(u.id, n.c))
                continue;
            if (this.partner && n.owner === this.partner)
                continue;
            const tr = dist[n.c] ?? INF;
            if (tr >= INF)
                continue;
            const keeper = n.owner === 'K';
            let arrive = t + tr;
            let dawn = false;
            let dest = n.c;
            if (keeper && !mercy) {
                if (preDawn) {
                    if (t < this.dawnAt - 60)
                        continue;
                    if (arrive < this.dawnAt + 1) {
                        const st = this.stageFor(n.c, dist);
                        if (st < 0)
                            continue;
                        dest = st;
                        dawn = true;
                        arrive = this.dawnAt;
                    }
                }
            }
            else if (preDawn && !mercy && this.inLine(n.c))
                continue;
            if (n.grace > arrive)
                continue;
            const afterDawn = arrive >= this.dawnAt - 1;
            const heat = keeper && afterDawn ? this.heatNeedle : this.heatOf(n);
            const zd = this.zoneDist[n.c] ?? 0;
            if (zd > 0 && zd * this.stepT * 1.4 + heat > this.autonomy - 4)
                continue;
            const done = arrive + heat;
            const rem = this.ticks - done;
            if (rem < 3)
                continue;
            const mult = n.ring ? (done >= this.dawnAt ? this.dawnRing : this.ringPull) : 1;
            const enemyLit = n.owner !== null && !keeper && !n.dark;
            let conn = this.reachPlan[n.c] === 1;
            let connF = 1;
            if (!conn && keeper && afterDawn) {
                for (const m of this.ndl.values()) {
                    if (m.ring && m.c !== n.c && this.reachPlan[m.c] && this.link(m.c, n.c)) {
                        conn = true;
                        connF = 0.6;
                        break;
                    }
                }
            }
            /* the Keeper's own pull on these cells is gone after dawn */
            const rateG = this.gainAt(n.c, mult, enemyLit ? this.ringMult(n) : keeper && afterDawn && preDawn ? this.ringPull : 0);
            let v = rateG * rem * (conn ? connF : 0.22);
            if (conn) {
                v += this.reconnectGain(n.c) * rem;
                if (litNeed)
                    v += 0.25 * this.regen * Math.min(rem, 250) * 0.06;
            }
            if (enemyLit)
                v += this.harmAt(n.c, this.ringMult(n)) * rem * this.hwOf(n.owner);
            if (k && k.active && k.cells.includes(n.c))
                v += k.bonus;
            const lot = this.lotBonus(n.c, done);
            v += lot;
            v *= this.riskAt(n.c, n.owner);
            /* waiting at the ring for dawn is cheap time: count it at a third */
            const span = dawn ? tr + heat + (this.dawnAt - t - tr) / 3 : done - t;
            consider({ kind: 'cap', dest, tgt: n.c, score: v / (span + 6), eta: done, dawn });
        }
        /* building */
        const eb = this.energyBudget() + (cur && cur.kind === 'build' ? this.costNeedle : 0);
        if (eb + this.rate * 30 >= this.costNeedle && this.rate > 0) {
            const late = t >= this.dawnAt - 400;
            for (const c of this.buildCells) {
                if (!this.reachPlan[c] || this.ndl.has(c))
                    continue;
                if (this.reserved.has(c) && !(cur && cur.tgt === c))
                    continue;
                if (this.occupied.has(c) && c !== uc)
                    continue;
                if ((this.badSite.get(c) ?? 0) > t || this.isBlack(u.id, c))
                    continue;
                if (preDawn && !mercy && this.inLine(c))
                    continue;
                const tr = dist[c] ?? INF;
                if (tr >= INF)
                    continue;
                let wait = 0;
                const eAt = eb + this.rate * tr;
                if (eAt < this.costNeedle) {
                    wait = (this.costNeedle - eAt) / Math.max(0.05, this.rate);
                    if (wait > 18)
                        continue;
                }
                const done = t + tr + wait + this.buildTicks;
                const rem = this.ticks - done;
                if (rem < 8)
                    continue;
                const g = this.gainAt(c, 1, 0);
                const rg = this.reconnectGain(c);
                let v = g * rem + rg * rem + this.bridgeBonus(c, done, late);
                if (rg <= 0)
                    v += 0.45 * this.halfBridge(c) * Math.max(0, rem - 25);
                if (v <= 0.5)
                    continue;
                if (litNeed)
                    v += 0.25 * this.regen * Math.min(rem, 250) * 0.06;
                const factor = this.energy >= this.energyCap - 40 ? 1 : 0.8;
                v *= factor * this.riskAt(c, null);
                consider({ kind: 'build', dest: c, tgt: c, score: v / (done - t + 6), eta: done, dawn: false });
            }
        }
        /* feeding: what is left for an idle Tkach */
        for (const [c, m] of this.mine) {
            if (m.weight < 0.99 || m.fed)
                continue;
            if (this.reserved.has(c) && !(cur && cur.tgt === c))
                continue;
            if (this.occupied.has(c) && c !== uc && !(cur && cur.tgt === c))
                continue;
            if (this.isBlack(u.id, c))
                continue;
            if (preDawn && this.inLine(c))
                continue;
            const tr = dist[c] ?? INF;
            if (tr >= INF)
                continue;
            const rem = this.ticks - t - tr;
            if (rem < 20)
                continue;
            const g = this.feedGain(c, m.weight * this.ringMult(this.ndl.get(c)));
            const D = Math.min(150, rem);
            const blockBonus = 1 + 0.15 * Math.max(0, 6 - this.minEnemyDist(c)) / 6;
            consider({ kind: 'feed', dest: c, tgt: c, score: (g * D * blockBonus) / (tr + D), eta: t + tr, dawn: false });
        }
        return best;
    }
    minEnemyDist(c) {
        let d = INF;
        for (const h of this.enemyHearths)
            d = Math.min(d, cd(c, h) / 2);
        for (const f of this.foes.values())
            if (f.p !== 'K' && this.t - f.seen < 60)
                d = Math.min(d, cd(c, f.c));
        return d;
    }
    /* our dark needles that come back on the thread through c */
    reconnectGain(c) {
        let g = 0;
        for (const k of this.clusters) {
            for (const d of k.cells) {
                if (cd(c, d) <= this.linkRange + 1 && this.link(c, d)) {
                    g += k.gain;
                    break;
                }
            }
        }
        return g;
    }
    /* our cut-off needles, grouped by their own threads, with the minutes per tick each group brings back */
    buildClusters() {
        this.clusters = [];
        const t = this.t;
        const dark = [];
        for (const [d, m] of this.mine) {
            if (m.weight >= 0.99)
                continue;
            const n = this.ndl.get(d);
            if (n && n.jamUntil >= t)
                continue;
            dark.push(d);
        }
        const seen = new Set();
        for (const s0 of dark) {
            if (seen.has(s0))
                continue;
            const comp = [s0];
            seen.add(s0);
            for (let i = 0; i < comp.length; i++) {
                const a = comp[i] ?? s0;
                for (const b of dark) {
                    if (seen.has(b) || cd(a, b) > this.linkRange + 1 || !this.link(a, b))
                        continue;
                    seen.add(b);
                    comp.push(b);
                }
            }
            let g = 0;
            for (const d of comp)
                g += this.relightGain(d);
            this.clusters.push({ cells: comp, gain: g });
        }
        /* free sites that would link a cluster: one needle short of a bridge */
        this.adjGain.fill(0);
        for (const k of this.clusters) {
            if (k.gain <= 0)
                continue;
            for (const d of k.cells) {
                const q = cq(d);
                const r = cr(d);
                for (const o of OFFS) {
                    if (o.d > this.linkRange + 1)
                        break;
                    const x = cellAt(q + o.dq, r + o.dr);
                    if (x < 0 || !this.pass[x] || !this.bld[x] || this.dead[x] || this.ndl.has(x))
                        continue;
                    if ((this.adjGain[x] ?? 0) >= k.gain || !this.link(d, x))
                        continue;
                    this.adjGain[x] = k.gain;
                }
            }
        }
    }
    halfBridge(c) {
        if (!this.clusters.length)
            return 0;
        const q = cq(c);
        const r = cr(c);
        let best = 0;
        for (const o of OFFS) {
            if (o.d > this.linkRange + 1)
                break;
            const x = cellAt(q + o.dq, r + o.dr);
            if (x < 0)
                continue;
            const g = this.adjGain[x] ?? 0;
            if (g <= best || this.reachPlan[x])
                continue;
            if (this.link(c, x))
                best = g;
        }
        return best;
    }
    relightGain(d) {
        const m = this.mine.get(d);
        if (!m)
            return 0;
        const q = cq(d);
        const r = cr(d);
        const lack = (1 - Math.min(1, m.weight)) * this.ringMult(this.ndl.get(d));
        let s = 0;
        for (const o of OFFS) {
            if (o.d > 3)
                break;
            const j = cellAt(q + o.dq, r + o.dr);
            if (j < 0)
                continue;
            const v = this.val[j] ?? 0;
            if (v <= 0)
                continue;
            const w = this.ringW(o.d, false) * lack;
            const p = this.plan[j] ?? 0;
            const oth = this.othP[j] ?? 0;
            s += v * (share(p + w, oth) - share(p, oth));
        }
        return s * this.minuteRate;
    }
    /* a site that brings free ruins, the ring at dawn or contract cells onto our thread */
    bridgeBonus(c, done, late) {
        let b = 0;
        let nr = 0;
        let nk = 0;
        const t = this.t;
        const rem = this.ticks - done;
        for (const n of this.ndl.values()) {
            if (n.owner === this.slot || n.start)
                continue;
            if (this.reachPlan[n.c])
                continue;
            if (cd(c, n.c) > this.linkRange + 1)
                continue;
            if (!this.link(c, n.c))
                continue;
            if (n.ring) {
                if (!late || n.owner !== 'K' || nk >= 2)
                    continue;
                nk++;
                b += this.gainAt(n.c, this.dawnRing, this.ringPull) * Math.max(0, this.ticks - this.dawnAt - 15) * 0.5;
            }
            else if (n.owner === null) {
                if (nr >= 3)
                    continue;
                nr++;
                b += this.gainAt(n.c, 1, 0) * Math.max(0, rem - 20) * 0.35;
            }
            if (this.contract && this.contract.active && this.contract.cells.includes(n.c))
                b += this.contract.bonus * 0.5;
        }
        return b;
    }
    lotBonus(c, done) {
        for (const l of this.lots) {
            if (l.at <= this.t || !l.cells.includes(c))
                continue;
            /* taking a lot ruin by heat before the reveal saves the bid */
            if (done < l.at)
                return 2;
        }
        return 0;
    }
    /* a free neighbour of a ring needle to wait on until dawn */
    stageFor(c, dist) {
        let best = -1;
        let bt = INF;
        for (let k = 0; k < 6; k++) {
            const j = nb(c, k);
            if (j < 0 || !this.pass[j] || this.ndl.has(j))
                continue;
            if ((this.lev[c] ?? 0) - (this.lev[j] ?? 0) >= 2)
                continue;
            let tt = dist[j] ?? INF;
            if (tt >= INF)
                continue;
            if (this.inLine(j))
                tt += 3;
            let taken = false;
            for (const a of this.asg.values())
                if (a.dest === j)
                    taken = true;
            if (taken)
                continue;
            if (tt < bt) {
                bt = tt;
                best = j;
            }
        }
        return best;
    }
    /* ---------------------------------------------------------------- Klinoks */
    planKlinoks() {
        const t = this.t;
        const posted = new Set();
        for (const a of this.asg.values())
            if (a.kind === 'post' || a.kind === 'guard' || a.kind === 'feed')
                posted.add(a.dest);
        for (const u of this.units) {
            if (u.cls !== KL || u.wait > 0 || u.stuck || this.touched.has(u.id))
                continue;
            const a = this.asg.get(u.id);
            if (a && a.kind !== 'post' && a.kind !== 'guard')
                continue;
            const uc = this.uc(u);
            const dist = this.travel(uc, KL);
            /* cache */
            let cache = -1;
            let ce = INF;
            for (const f of this.finds) {
                if (f.kind !== 'cache' || f.taken)
                    continue;
                let claimed = false;
                for (const b of this.asg.values())
                    if (b.kind === 'cache' && b.tgt === f.c)
                        claimed = true;
                if (claimed || this.isBlack(u.id, f.c))
                    continue;
                const e = dist[f.c] ?? INF;
                if (e > 36)
                    continue;
                let eh = INF;
                for (const h of this.enemyHearths)
                    eh = Math.min(eh, cd(h, f.c));
                if (t < 70 && e > eh + 6)
                    continue;
                if (e < ce) {
                    ce = e;
                    cache = f.c;
                }
            }
            if (cache >= 0 && this.energy < this.energyCap - 60) {
                if (this.issue({ kind: 'move', unit: u.id, q: cq(cache), r: cr(cache), goal: null, home: false }, this.unitCost(u), true, false, u.id, cache, { fresh: true })) {
                    this.asg.set(u.id, this.mk('cache', cache, cache, t + ce));
                }
                continue;
            }
            /* dawn: stand by our ring targets to ram rival heaters */
            if (t >= this.dawnAt - 30 && t < this.ticks - 25) {
                if (a && a.kind === 'guard')
                    continue;
                let spot = -1;
                let se = INF;
                for (const b of this.asg.values()) {
                    if (b.kind !== 'cap')
                        continue;
                    const n = this.ndl.get(b.tgt);
                    if (!n || !n.ring)
                        continue;
                    for (let k = 0; k < 6; k++) {
                        const j = nb(b.tgt, k);
                        if (j < 0 || !this.pass[j] || this.ndl.has(j) || posted.has(j))
                            continue;
                        let used = false;
                        for (const x of this.asg.values())
                            if (x.dest === j)
                                used = true;
                        if (used)
                            continue;
                        const e = dist[j] ?? INF;
                        if (e < se) {
                            se = e;
                            spot = j;
                        }
                    }
                }
                if (spot >= 0 && se <= 40) {
                    if (this.issue({ kind: 'move', unit: u.id, q: cq(spot), r: cr(spot), goal: null, home: false }, this.unitCost(u), true, false, u.id, spot, { fresh: true })) {
                        this.asg.set(u.id, this.mk('guard', spot, spot, t + se));
                        posted.add(spot);
                    }
                    continue;
                }
            }
            /* jam for loot when the channel has room; one Klinok always stays on guard */
            let jammers = 0;
            let nK = 0;
            for (const x of this.units)
                if (x.cls === KL)
                    nK++;
            for (const b of this.asg.values())
                if (b.kind === 'jam')
                    jammers++;
            const maxJam = nK >= 2 ? nK - 1 : t - this.threatAt > 150 ? 1 : 0;
            if (jammers < maxJam && t >= 90 && t < this.ticks - 20 && this.softLeft() >= this.chanOrder + this.chanTick + this.jamStart + this.jamKeep) {
                const jp = this.pickJam(u, dist);
                if (jp) {
                    const ok = this.issue({ kind: 'move', unit: u.id, q: cq(jp.dest), r: cr(jp.dest), goal: null, home: false }, this.unitCost(u), true, false, u.id, jp.tgt, { fresh: true });
                    if (ok) {
                        /* the Keeper's needle is jammed only from the stand outside the line */
                        const kn = this.ndl.get(jp.tgt);
                        if (!(kn && kn.owner === 'K'))
                            this.issue({ kind: 'jam', unit: u.id, target: { q: cq(jp.tgt), r: cr(jp.tgt) }, hold: false }, 0, false, true, u.id, jp.tgt);
                        this.hands += this.jamStart;
                        this.asg.set(u.id, this.mk('jam', jp.dest, jp.tgt, jp.eta));
                        this.jamRes.add(jp.tgt);
                    }
                    continue;
                }
            }
            /* post on an exposed needle: a body there stops enemy heating */
            if (a && a.kind === 'post' && t - a.since < 80)
                continue;
            const post = this.pickPost(u, dist, posted);
            if (post < 0)
                continue;
            if (a && a.dest === post) {
                a.since = t;
                continue;
            }
            if (post === uc) {
                this.asg.set(u.id, this.mk('post', post, post, t));
                posted.add(post);
                continue;
            }
            if (this.softLeft() < this.chanOrder + this.chanTick * 2)
                continue;
            if (this.issue({ kind: 'move', unit: u.id, q: cq(post), r: cr(post), goal: null, home: false }, this.unitCost(u), true, false, u.id, post, { fresh: true })) {
                this.asg.set(u.id, this.mk('post', post, post, t + (dist[post] ?? 0)));
                posted.add(post);
            }
        }
    }
    mk(kind, dest, tgt, eta) {
        return { kind, dest, tgt, foe: '', since: this.t, eta, arrived: -1, dawn: false, hold: false, tries: 0, sent: this.t, pri: kind === 'cache' ? 30 : 0, leg: -1 };
    }
    pickPost(u, dist, posted) {
        let best = -1;
        let bs = -INF;
        const t = this.t;
        for (const [c, m] of this.mine) {
            const n = this.ndl.get(c);
            if (!n || n.start || m.weight < 0.99)
                continue;
            if (posted.has(c) || this.isBlack(u.id, c))
                continue;
            if (t < this.dawnAt && this.inLine(c))
                continue;
            const e = dist[c] ?? INF;
            if (e > 40)
                continue;
            let s = -this.minEnemyDist(c);
            if (this.contract && this.contract.cells.includes(c))
                s += 6;
            if (n.jamUntil >= t - 60)
                s += 3;
            if (this.occupied.has(c) && c !== this.uc(u))
                continue;
            s -= e * 0.05;
            if (s > bs) {
                bs = s;
                best = c;
            }
        }
        return best;
    }
    pickJam(u, dist) {
        const t = this.t;
        let best = null;
        for (const n of this.ndl.values()) {
            if (n.start || n.owner === null || n.owner === this.slot || n.owner === '?' || n.owner === this.partner)
                continue;
            if (n.dark || t - n.seen > 40 || this.jamRes.has(n.c) || this.reserved.has(n.c) || this.isBlack(u.id, n.c))
                continue;
            const keeper = n.owner === 'K';
            if (keeper && t >= this.dawnAt - 5)
                continue;
            if (n.jamUntil >= t && n.jamBy === this.slot)
                continue;
            let st = -1;
            let se = INF;
            for (let k = -1; k < 6; k++) {
                const j = k < 0 ? n.c : nb(n.c, k);
                if (j < 0 || !this.pass[j])
                    continue;
                if (keeper && this.inLine(j))
                    continue;
                if (j !== n.c && this.ndl.has(j))
                    continue;
                let used = false;
                for (const x of this.asg.values())
                    if (x.dest === j)
                        used = true;
                if (used)
                    continue;
                const e = dist[j] ?? INF;
                if (e < se) {
                    se = e;
                    st = j;
                }
            }
            if (st < 0 || se > 24)
                continue;
            const zd = this.zoneDist[st] ?? 0;
            if (zd > 0 && zd * this.stepK + 4 > this.autonomy - 6)
                continue;
            const rem = this.ticks - t - se;
            if (rem < 25)
                continue;
            const m = this.ringMult(n);
            const loot = this.gainAt(n.c, m, m);
            const harm = keeper ? 0 : this.harmAt(n.c, m) * this.hwOf(n.owner);
            const v = (loot + harm) * Math.min(rem, 160) / (1 + 0.8 * (this.danger[st] ?? 0));
            const score = v / (se + 10);
            if (v < 0.6)
                continue;
            if (!best || score > best.score)
                best = { kind: 'jam', dest: st, tgt: n.c, score, eta: t + se, dawn: false };
        }
        return best;
    }
    /* ---------------------------------------------------------------- scan */
    planScan(o) {
        const t = this.t;
        if (t < 6 || t % 5 !== 0)
            return;
        let bestC = -1;
        let bw = 0;
        const cands = [];
        for (const n of this.ndl.values()) {
            if (n.owner === this.slot || n.start)
                continue;
            if (this.hearthC >= 0 && cd(n.c, this.hearthC) > 17 && (this.myDist[n.c] ?? 99) > 7)
                continue;
            cands.push(n.c);
        }
        if (this.contract)
            for (const c of this.contract.cells)
                cands.push(c);
        for (const c of cands) {
            let w = 0;
            const q = cq(c);
            const r = cr(c);
            for (const off of OFFS) {
                if (off.d > 3)
                    break;
                const j = cellAt(q + off.dq, r + off.dr);
                if (j < 0)
                    continue;
                const m = this.ndl.get(j);
                if (!m || m.owner === this.slot || m.start)
                    continue;
                const age = t - Math.max(m.seen, m.look);
                if (age < 35)
                    continue;
                let wt = Math.min(1.5, age / 80);
                if (this.contract && this.contract.cells.includes(j))
                    wt += 1.5;
                if (m.ring && t >= this.dawnAt - 80)
                    wt += 0.5;
                if (this.reachPlan[j])
                    wt += 0.5;
                w += wt;
            }
            if (w > bw) {
                bw = w;
                bestC = c;
            }
        }
        if (bestC < 0 || bw < 1)
            return;
        const cost = this.scanCost * (this.storm(bestC, t) ? this.stormCost : 1);
        if (o.pulse.ear < cost + 64)
            return;
        if (this.issue({ kind: 'scan', q: cq(bestC), r: cr(bestC), rad: 3 }, 0, false, false, '', -1)) {
            const q = cq(bestC);
            const r = cr(bestC);
            for (const off of OFFS) {
                if (off.d > 3)
                    break;
                const j = cellAt(q + off.dq, r + off.dr);
                const m = j >= 0 ? this.ndl.get(j) : undefined;
                if (m)
                    m.look = t;
            }
        }
    }
}
/* ------------------------------------------------------------------ exports */
export function presets() {
    return ['зоря'];
}
export function createStrategy(preset) {
    return new Zorya(preset ?? 'зоря');
}
