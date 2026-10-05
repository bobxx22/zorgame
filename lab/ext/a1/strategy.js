/* bot :: strategy
   "Зоря" - own head, no mirror. One pass per tick:
     ingest   - belief of the valley: needles (owner, dark, capture tick), finds, foes, jams;
     rebuild  - pull maps of every actor, comms zone, thread nodes, danger cells of the line;
     plan     - production, contract, dawn staging, Tkach greedy by rate (minutes per
                Tkach tick), Klinok duties (rams, cache, jam loot, guard);
     assemble - commands by priority inside the channel, hands and frame cap; a keepalive
                guarantees an accepted command at least every 3 ticks.
   Rules numbers come from the manifest cfg; the thread check uses RulesOracle when the
   engine is available and falls back to a hex line test. */
import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, stormAt } from '@zoria/protocol';
/* ------------------------------------------------------------------ grid */
const OFF = 20;
const W = 41;
const NC = W * W;
const RADV = 19;
const INF = 1e9;
const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];
const TK = 'ткач';
const KL = 'клинок';
const DISK_Q = [];
const DISK_R = [];
const DISK_D = [];
const DISK_N = [];
{
    const all = [];
    for (let dq = -6; dq <= 6; dq++) {
        for (let dr = -6; dr <= 6; dr++) {
            const d = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
            if (d <= 6)
                all.push([dq, dr, d]);
        }
    }
    all.sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1]);
    for (const [q, r, d] of all) {
        DISK_Q.push(q);
        DISK_R.push(r);
        DISK_D.push(d);
    }
    for (let R = 0; R <= 6; R++)
        DISK_N.push(1 + 3 * R * (R + 1));
}
function inGrid(q, r) {
    return q >= -OFF && q <= OFF && r >= -OFF && r <= OFF;
}
function cidx(q, r) {
    return (q + OFF) * W + (r + OFF);
}
function cq(c) {
    return Math.floor(c / W) - OFF;
}
function cr(c) {
    return (c % W) - OFF;
}
function hdist(aq, ar, bq, br) {
    const dq = aq - bq;
    const dr = ar - br;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
function cdist(a, b) {
    return hdist(cq(a), cr(a), cq(b), cr(b));
}
function share(p, tot) {
    if (tot <= 1)
        return p;
    return p / tot;
}
function actIdx(a) {
    switch (a) {
        case 'A':
            return 0;
        case 'B':
            return 1;
        case 'C':
            return 2;
        case 'K':
            return 3;
        default:
            return 4;
    }
}
function byId(a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/* ------------------------------------------------------------------ heap */
class Heap {
    ks = [];
    vs = [];
    lastKey = 0;
    size() {
        return this.ks.length;
    }
    clear() {
        this.ks.length = 0;
        this.vs.length = 0;
    }
    push(key, val) {
        const ks = this.ks;
        const vs = this.vs;
        let i = ks.length;
        ks.push(key);
        vs.push(val);
        while (i > 0) {
            const p = (i - 1) >> 1;
            const pk = ks[p];
            const pv = vs[p];
            if (pk < key || (pk === key && pv <= val))
                break;
            ks[i] = pk;
            vs[i] = pv;
            i = p;
        }
        ks[i] = key;
        vs[i] = val;
    }
    pop() {
        const ks = this.ks;
        const vs = this.vs;
        const topK = ks[0];
        const topV = vs[0];
        const lk = ks.pop();
        const lv = vs.pop();
        const n = ks.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= n)
                    break;
                const r = l + 1;
                let m = l;
                if (r < n && (ks[r] < ks[l] || (ks[r] === ks[l] && vs[r] < vs[l])))
                    m = r;
                const mk = ks[m];
                const mv = vs[m];
                if (mk > lk || (mk === lk && mv >= lv))
                    break;
                ks[i] = mk;
                vs[i] = mv;
                i = m;
            }
            ks[i] = lk;
            vs[i] = lv;
        }
        this.lastKey = topK;
        return topV;
    }
}
const DEF_TERRAIN = [
    { pass: true, build: true, cost: 1, min: 2, reach: false, block: false },
    { pass: true, build: true, cost: 1, min: 3, reach: false, block: false },
    { pass: true, build: true, cost: 1, min: 2, reach: false, block: false },
    { pass: true, build: true, cost: 1, min: 1, reach: false, block: false },
    { pass: true, build: true, cost: 2, min: 1, reach: false, block: false },
    { pass: true, build: true, cost: 2, min: 1, reach: true, block: false },
    { pass: false, build: false, cost: 1, min: 0, reach: false, block: false },
    { pass: false, build: false, cost: 1, min: 0, reach: false, block: true },
];
/* ------------------------------------------------------------------ head */
class ZoriaHead {
    /* static world */
    ok = false;
    slot = 'A';
    me = 0;
    oracle = null;
    T = 1200;
    cfg = {};
    valid = new Uint8Array(NC);
    cells = [];
    pass = new Uint8Array(NC);
    bld = new Uint8Array(NC);
    block = new Uint8Array(NC);
    reach = new Uint8Array(NC);
    mult = new Float64Array(NC);
    val = new Float64Array(NC);
    lvl = new Float64Array(NC);
    mtn = new Int16Array(NC);
    nbr = new Int32Array(NC * 6);
    deadCell = new Uint8Array(NC);
    rings = [1, 1, 2 / 3, 1 / 3];
    hearths = [];
    hearth = -1;
    hearthFixed = false;
    oppHearths = [];
    center = cidx(0, 0);
    cherta = 6;
    dawnAt = 1000;
    dawnMult = 2;
    storms = [];
    caches = [];
    lots = [];
    ringCells = [];
    oppKD = new Float64Array(NC);
    /* cfg numbers */
    linkRange = 5;
    costT = 90;
    costK = 50;
    stepT = 2;
    stepK = 1;
    rise = 1;
    costNeedle = 60;
    buildTicks = 8;
    feedRing = 1;
    autonomy = 40;
    heatNeedle = 8;
    heatEnemy = 24;
    heatDark = 16;
    capGrace = 60;
    jamStart = 64;
    chanOrder = 32;
    chanTick = 32;
    scanCost = 256;
    scanRad = 3;
    stormMul = 2;
    ringPull = 1.25;
    rate = 0.0005;
    /* dynamic */
    t = 0;
    dawn = false;
    mercy = false;
    needles = new Map();
    myN = new Map();
    prevMine = new Set();
    takenFinds = new Set();
    jammedMine = new Map();
    myJams = new Set();
    foes = new Map();
    foeAt = new Map();
    unitAt = new Map();
    mem = new Map();
    ban = new Map();
    jamBan = new Map();
    pendingYard = [];
    knownUnits = new Set();
    lastAccept = 0;
    sent = [];
    bidSent = new Map();
    bidPlan = [];
    bidReserve = 0;
    threatAt = -1000;
    threatCell = -1;
    lastStolen = 0;
    stolenAt = -1000;
    cachePlan = -1;
    contract = null;
    cmds = [];
    income = 0.5;
    wOpp = [0.7, 0.7, 0.7, 0, 0.6];
    errors = 0;
    /* maps */
    P = [new Float64Array(NC), new Float64Array(NC), new Float64Array(NC), new Float64Array(NC), new Float64Array(NC)];
    tot = new Float64Array(NC);
    zone = new Uint8Array(NC);
    danger = new Uint8Array(NC);
    nearD = new Int16Array(NC);
    nearNS = new Int16Array(NC);
    nodes = [];
    myLit = new Set();
    myDisc = new Set();
    fields = new Map();
    heap = new Heap();
    linkCache = new Map();
    wCache = new Map();
    lastOpp = 0;
    /* belief diary */
    bOwn = new Map();
    beliefN = 0;
    lastObs = null;
    /* ------------------------------------------------------------ contract */
    init(manifestBytes, slot) {
        this.slot = slot;
        this.me = actIdx(slot);
        try {
            const m = decodeManifest(manifestBytes);
            if (m)
                this.setup(m);
        }
        catch {
            this.ok = false;
        }
        if (this.ok) {
            try {
                this.oracle = new RulesOracle(createEngine, manifestBytes);
            }
            catch {
                this.oracle = null;
            }
        }
    }
    tick(observeBytes) {
        let obs = null;
        try {
            obs = decodeObserve(observeBytes);
        }
        catch {
            obs = null;
        }
        if (!obs)
            return this.fallbackBytes(null);
        this.lastObs = obs;
        try {
            const orders = this.think(obs);
            return encodeOrders(orders);
        }
        catch {
            return this.fallbackBytes(obs);
        }
    }
    feedback(verdictBytes) {
        try {
            const vs = decodeVerdicts(verdictBytes);
            if (!vs)
                return;
            let any = false;
            for (const v of vs) {
                const i = v[0];
                const ok = v[1];
                const code = v[2];
                if (ok) {
                    any = true;
                    continue;
                }
                const s = this.sent[i];
                if (s)
                    this.onDeny(s, code);
            }
            if (any)
                this.lastAccept = this.t;
        }
        catch {
            /* verdicts are advisory */
        }
    }
    belief(obs) {
        try {
            const o = obs ?? this.lastObs;
            const full = this.beliefN % 200 === 0;
            this.beliefN++;
            const own = {};
            const dark = {};
            for (const b of this.needles.values()) {
                const sig = (b.owner ?? '-') + (b.dark ? '1' : '0');
                if (full || this.bOwn.get(b.c) !== sig) {
                    const k = cq(b.c) + ',' + cr(b.c);
                    own[k] = b.owner;
                    dark[k] = b.dark;
                    this.bOwn.set(b.c, sig);
                }
            }
            const foe = [];
            for (const f of this.foes.values())
                foe.push([f.id, f.p, f.q, f.r]);
            const units = [];
            if (o)
                for (const u of o.mine.units)
                    units.push([u.id, u.q, u.r, u.task ? u.task.path : 0]);
            const frame = {
                t: o ? o.t : this.t,
                pulse: {
                    energy: o ? o.pulse.energy : 0,
                    chan: o ? o.pulse.chan : 0,
                    ear: o ? o.pulse.ear : 0,
                    minutes: o ? o.pulse.minutes : 0,
                    needles: o ? o.pulse.needles : 0,
                },
                own,
                dark,
                foe,
                noisy: o ? o.noisy.length : 0,
                units,
                pact: null,
                cries: [],
            };
            if (full)
                frame.full = true;
            return frame;
        }
        catch {
            return null;
        }
    }
    /* ------------------------------------------------------------ setup */
    cf(k, d) {
        const v = this.cfg[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : d;
    }
    setup(m) {
        this.cfg = m.cfg ?? {};
        this.T = m.ticks > 0 ? m.ticks : 1200;
        this.linkRange = this.cf('linkRange', 5);
        this.costT = this.cf('costTkach', 90);
        this.costK = this.cf('costKlinok', 50);
        this.stepT = this.cf('stepTkach', 2);
        this.stepK = this.cf('stepKlinok', 1);
        this.rise = this.cf('stepRise', 1);
        this.costNeedle = this.cf('costNeedle', 60);
        this.buildTicks = this.cf('buildTicks', 8);
        this.feedRing = Math.max(0, Math.round(this.cf('feedRing', 1)));
        this.autonomy = this.cf('autonomy', 40);
        this.heatNeedle = this.cf('heatNeedle', 8);
        this.heatEnemy = this.cf('heatEnemy', 24);
        this.heatDark = this.cf('heatDark', 16);
        this.capGrace = this.cf('capGrace', 60);
        this.jamStart = this.cf('jamStart', 64);
        this.chanOrder = this.cf('chanOrder', 32);
        this.chanTick = this.cf('chanTick', 32);
        this.scanCost = this.cf('scanCost', 256);
        this.scanRad = Math.max(0, Math.min(3, Math.round(this.cf('scanRad', 3))));
        this.stormMul = this.cf('stormCost', 2);
        this.ringPull = this.cf('ringPull', 1.25);
        this.rate = this.cf('minuteRate', 0.0005);
        for (let q = -OFF; q <= OFF; q++) {
            for (let r = -OFF; r <= OFF; r++) {
                if (hdist(q, r, 0, 0) <= RADV) {
                    const c = cidx(q, r);
                    this.valid[c] = 1;
                    this.cells.push(c);
                }
            }
        }
        this.nbr.fill(-1);
        for (const c of this.cells) {
            const q = cq(c);
            const r = cr(c);
            for (let k = 0; k < 6; k++) {
                const nq = q + DQ[k];
                const nr = r + DR[k];
                if (inGrid(nq, nr) && this.valid[cidx(nq, nr)])
                    this.nbr[c * 6 + k] = cidx(nq, nr);
            }
        }
        /* terrain passports */
        const tps = [];
        const types = m.terrain && Array.isArray(m.terrain.types) ? m.terrain.types : [];
        for (let i = 0; i < Math.max(8, types.length); i++) {
            const d = DEF_TERRAIN[i] ?? DEF_TERRAIN[0];
            const tt = types[i];
            if (tt && typeof tt === 'object') {
                tps.push({
                    pass: typeof tt.pass === 'boolean' ? tt.pass : d.pass,
                    build: typeof tt.build === 'boolean' ? tt.build : d.build,
                    cost: typeof tt.cost === 'number' && tt.cost > 0 ? tt.cost : d.cost,
                    min: typeof tt.min === 'number' && tt.min >= 0 ? tt.min : d.min,
                    reach: typeof tt.reach === 'boolean' ? tt.reach : d.reach,
                    block: typeof tt.block === 'boolean' ? tt.block : d.block,
                });
            }
            else
                tps.push(d);
        }
        const tcells = m.terrain && Array.isArray(m.terrain.cells) ? m.terrain.cells : [];
        const terr = new Int16Array(NC);
        const apply = (swap, into) => {
            into.fill(0);
            for (const e of tcells) {
                const q = swap ? e[1] : e[0];
                const r = swap ? e[0] : e[1];
                const ty = e[2];
                if (typeof q !== 'number' || typeof r !== 'number' || typeof ty !== 'number')
                    continue;
                if (!inGrid(q, r))
                    continue;
                const c = cidx(q, r);
                if (this.valid[c])
                    into[c] = ty;
            }
        };
        const badCount = (arr) => {
            let bad = 0;
            const chk = (q, r) => {
                if (!inGrid(q, r))
                    return;
                const tp = tps[arr[cidx(q, r)]];
                if (tp && !tp.pass)
                    bad++;
            };
            for (const n of m.needles ?? [])
                chk(n.q, n.r);
            for (const s of m.seats ?? [])
                chk(s.q, s.r);
            return bad;
        };
        apply(false, terr);
        const bad0 = badCount(terr);
        if (bad0 > 0) {
            const alt = new Int16Array(NC);
            apply(true, alt);
            if (badCount(alt) < bad0)
                terr.set(alt);
        }
        for (const c of this.cells) {
            const tp = tps[terr[c]] ?? DEF_TERRAIN[0];
            this.pass[c] = tp.pass ? 1 : 0;
            this.bld[c] = tp.build ? 1 : 0;
            this.block[c] = tp.block ? 1 : 0;
            this.reach[c] = tp.reach ? 1 : 0;
            this.mult[c] = tp.cost;
            this.val[c] = tp.min;
        }
        /* levels in (r, q) ascending order */
        const levels = Array.isArray(m.levels) ? m.levels : [];
        let k = 0;
        for (let r = -RADV; r <= RADV; r++) {
            for (let q = -RADV; q <= RADV; q++) {
                if (hdist(q, r, 0, 0) <= RADV) {
                    const v = levels[k++];
                    this.lvl[cidx(q, r)] = typeof v === 'number' ? v : 0;
                }
            }
        }
        /* distance to the nearest thread-cutting cell */
        const blocks = [];
        for (const c of this.cells)
            if (this.block[c])
                blocks.push(c);
        for (const c of this.cells) {
            let best = 99;
            for (const b of blocks) {
                const d = cdist(c, b);
                if (d < best)
                    best = d;
            }
            this.mtn[c] = best;
        }
        if (Array.isArray(m.rings) && m.rings.length >= 2 && m.rings.every((x) => typeof x === 'number'))
            this.rings = m.rings.slice();
        this.center = m.citadel && inGrid(m.citadel.q, m.citadel.r) ? cidx(m.citadel.q, m.citadel.r) : cidx(0, 0);
        this.cherta = typeof m.cherta === 'number' ? m.cherta : 6;
        this.dawnAt = m.dawn && typeof m.dawn.at === 'number' ? m.dawn.at : this.T - this.cf('dawnTicks', 200);
        this.dawnMult = m.dawn && typeof m.dawn.ring === 'number' ? m.dawn.ring : this.cf('dawnRing', 2);
        this.storms = Array.isArray(m.storms) ? m.storms : [];
        for (const s of m.seats ?? [])
            if (inGrid(s.q, s.r))
                this.hearths.push(cidx(s.q, s.r));
        const mySeat = Math.max(0, Math.min(2, this.me));
        this.hearth = this.hearths[mySeat] ?? -1;
        for (const f of m.finds ?? []) {
            if (!inGrid(f.q, f.r))
                continue;
            const c = cidx(f.q, f.r);
            if (f.kind === 'cache')
                this.caches.push(c);
            if (f.kind === 'dead')
                this.deadCell[c] = 1;
        }
        for (const L of m.lots ?? []) {
            const cells = [];
            for (const h of L.cells ?? [])
                if (inGrid(h.q, h.r))
                    cells.push(cidx(h.q, h.r));
            this.lots.push({ at: L.at, cells });
        }
        for (const n of m.needles ?? []) {
            if (!inGrid(n.q, n.r))
                continue;
            const c = cidx(n.q, n.r);
            if (!this.valid[c])
                continue;
            const b = {
                c,
                owner: n.ring ? 'K' : n.start ? n.start : null,
                dark: false,
                seen: 0,
                ring: !!n.ring,
                start: !!n.start,
                capAt: -INF,
            };
            this.needles.set(c, b);
            if (n.ring)
                this.ringCells.push(c);
        }
        this.ok = true;
    }
    /* ------------------------------------------------------------ fallback */
    fallbackBytes(obs) {
        try {
            const orders = [];
            if (obs) {
                const idle = obs.mine.units.find((u) => this.isIdle(u));
                if (idle)
                    orders.push({ kind: 'halt', unit: idle.id });
            }
            if (!orders.length) {
                const h = this.hearth >= 0 ? this.hearth : cidx(0, 0);
                orders.push({ kind: 'watch', q: cq(h), r: cr(h), keep: 0 });
            }
            this.sent = orders.map((o) => ({ unit: o.kind === 'halt' ? o.unit : '', kind: o.kind, cell: -1, lot: -1, cls: null }));
            return encodeOrders(orders);
        }
        catch {
            return new Uint8Array(0);
        }
    }
    safe(fn) {
        try {
            fn();
        }
        catch {
            this.errors++;
        }
    }
    /* ------------------------------------------------------------ main pass */
    think(obs) {
        this.t = obs.t;
        this.fields.clear();
        this.cmds = [];
        this.dawn = !!obs.pub.dawn || obs.t >= this.dawnAt;
        this.mercy = !!obs.pulse.mercy;
        if (!this.ok)
            return this.keepaliveOnly(obs);
        this.safe(() => this.ingest(obs));
        this.safe(() => this.rebuild(obs));
        this.safe(() => this.validate(obs));
        this.safe(() => this.planBidsPre(obs));
        this.safe(() => this.planProduction(obs));
        this.safe(() => this.planContract(obs));
        this.safe(() => this.planTkachs(obs));
        this.safe(() => this.planKlinoks(obs));
        this.safe(() => this.unitCommands(obs));
        this.safe(() => this.planBids(obs));
        this.safe(() => this.planScan(obs));
        return this.assemble(obs);
    }
    keepaliveOnly(obs) {
        const idle = obs.mine.units.find((u) => this.isIdle(u));
        const o = idle ? { kind: 'halt', unit: idle.id } : { kind: 'watch', q: 0, r: 0, keep: 0 };
        this.sent = [{ unit: idle ? idle.id : '', kind: o.kind, cell: -1, lot: -1, cls: null }];
        return [o];
    }
    /* ------------------------------------------------------------ belief */
    nb(c) {
        let b = this.needles.get(c);
        if (!b) {
            b = { c, owner: null, dark: false, seen: this.t, ring: false, start: false, capAt: this.t };
            this.needles.set(c, b);
        }
        return b;
    }
    ingest(obs) {
        const t = obs.t;
        const me = this.slot;
        if (!this.hearthFixed) {
            this.hearthFixed = true;
            let best = -1;
            let bd = INF;
            for (const n of obs.mine.needles) {
                if (!inGrid(n.q, n.r))
                    continue;
                const nc = cidx(n.q, n.r);
                for (const h of this.hearths) {
                    const d = cdist(nc, h);
                    if (d < bd) {
                        bd = d;
                        best = h;
                    }
                }
            }
            if (best >= 0 && bd <= 2)
                this.hearth = best;
            this.oppHearths = this.hearths.filter((h) => h !== this.hearth);
            for (const b of this.needles.values()) {
                if (!b.start)
                    continue;
                if (this.hearth >= 0 && cdist(b.c, this.hearth) <= 2)
                    b.owner = me;
                else if (b.owner === me)
                    b.owner = 'X';
            }
            this.safe(() => this.decideCache());
        }
        const nowMine = new Map();
        for (const n of obs.mine.needles) {
            if (!inGrid(n.q, n.r))
                continue;
            const c = cidx(n.q, n.r);
            if (!this.valid[c])
                continue;
            nowMine.set(c, n);
            const b = this.nb(c);
            if (b.owner !== me)
                b.capAt = t;
            b.owner = me;
            b.dark = n.dark;
            b.seen = t;
        }
        for (const c of this.prevMine) {
            if (nowMine.has(c))
                continue;
            const b = this.needles.get(c);
            if (!b)
                continue;
            let owner = 'X';
            for (const l of obs.mine.losts) {
                if (inGrid(l.q, l.r) && cidx(l.q, l.r) === c) {
                    owner = l.owner;
                    b.dark = l.dark;
                }
            }
            b.owner = owner === me ? 'X' : owner;
            b.capAt = t;
            b.seen = t;
        }
        this.prevMine = new Set(nowMine.keys());
        this.myN = nowMine;
        for (const e of obs.own) {
            if (!inGrid(e.q, e.r))
                continue;
            const c = cidx(e.q, e.r);
            if (!this.valid[c])
                continue;
            if (nowMine.has(c))
                continue;
            if (e.owner === me)
                continue;
            const b = this.nb(c);
            if (b.owner !== e.owner && e.owner !== null && !(b.ring && e.owner === 'K'))
                b.capAt = t;
            b.owner = e.owner;
            b.dark = e.dark;
            b.seen = t;
        }
        for (const ev of obs.events) {
            switch (ev.type) {
                case 'cap': {
                    if (!inGrid(ev.q, ev.r))
                        break;
                    const c = cidx(ev.q, ev.r);
                    if (nowMine.has(c))
                        break;
                    const b = this.nb(c);
                    b.owner = ev.p === me ? 'X' : ev.p;
                    b.capAt = t;
                    b.dark = false;
                    b.seen = t;
                    break;
                }
                case 'lot': {
                    if (!ev.p)
                        break;
                    const L = this.lots[ev.lot];
                    if (!L)
                        break;
                    for (const c of L.cells) {
                        const b = this.needles.get(c);
                        if (b && b.owner === null && !nowMine.has(c)) {
                            b.owner = ev.p === me ? 'X' : ev.p;
                            b.capAt = -INF;
                            b.dark = false;
                        }
                    }
                    break;
                }
                case 'find': {
                    if (inGrid(ev.q, ev.r))
                        this.takenFinds.add(cidx(ev.q, ev.r));
                    break;
                }
                case 'jam': {
                    if (ev.own === me && ev.p !== me && inGrid(ev.q, ev.r)) {
                        const c = cidx(ev.q, ev.r);
                        this.jammedMine.set(c, { by: ev.p, t });
                        this.threatAt = t;
                        this.threatCell = c;
                    }
                    break;
                }
                case 'ram': {
                    if (ev.tgt === me && ev.p !== 'K' && inGrid(ev.q, ev.r)) {
                        this.threatAt = t;
                        this.threatCell = cidx(ev.q, ev.r);
                    }
                    break;
                }
                default:
                    break;
            }
        }
        for (const [c, info] of this.jammedMine) {
            const n = nowMine.get(c);
            if (!n || !n.dark || t - info.t > 200)
                this.jammedMine.delete(c);
        }
        if (this.dawn) {
            for (const c of this.ringCells) {
                const b = this.needles.get(c);
                if (b && b.owner === 'K')
                    b.dark = true;
            }
        }
        this.myJams.clear();
        for (const j of obs.mine.jams)
            if (inGrid(j.q, j.r))
                this.myJams.add(cidx(j.q, j.r));
        const stolen = obs.mine.ledger ? obs.mine.ledger.stolen : 0;
        if (stolen > this.lastStolen + 1e-12)
            this.stolenAt = t;
        this.lastStolen = stolen;
        this.foes.clear();
        this.foeAt.clear();
        for (const f of obs.foe) {
            if (f.p === me)
                continue;
            if (!inGrid(f.q, f.r))
                continue;
            this.foes.set(f.id, f);
            this.foeAt.set(cidx(f.q, f.r), f);
        }
        this.unitAt.clear();
        const ids = new Set();
        for (const u of obs.mine.units) {
            ids.add(u.id);
            if (inGrid(u.q, u.r))
                this.unitAt.set(cidx(u.q, u.r), u.id);
            if (!this.knownUnits.has(u.id)) {
                const i = this.pendingYard.findIndex((p) => p.cls === u.cls);
                if (i >= 0)
                    this.pendingYard.splice(i, 1);
            }
        }
        for (const id of [...this.mem.keys()])
            if (!ids.has(id))
                this.mem.delete(id);
        this.knownUnits = ids;
        this.pendingYard = this.pendingYard.filter((p) => t - p.t < 25);
    }
    /* ------------------------------------------------------------ maps */
    wArr(mult) {
        const key = Math.round(mult * 10000);
        let w = this.wCache.get(key);
        if (!w) {
            w = this.rings.map((x) => x * mult);
            this.wCache.set(key, w);
        }
        return w;
    }
    fedArr(mult) {
        const key = -1 - Math.round(mult * 10000);
        let w = this.wCache.get(key);
        if (!w) {
            w = [];
            const n = this.rings.length + this.feedRing;
            for (let d = 0; d < n; d++)
                w.push((this.rings[Math.max(0, d - this.feedRing)] ?? 0) * mult);
            this.wCache.set(key, w);
        }
        return w;
    }
    fedExtra(mult) {
        const key = -500000 - Math.round(mult * 10000);
        let w = this.wCache.get(key);
        if (!w) {
            const f = this.fedArr(mult);
            w = f.map((x, d) => Math.max(0, x - (this.rings[d] ?? 0) * mult));
            this.wCache.set(key, w);
        }
        return w;
    }
    addCov(a, c, w) {
        const P = this.P[a];
        const q0 = cq(c);
        const r0 = cr(c);
        const R = Math.min(6, w.length - 1);
        const n = DISK_N[R];
        for (let k = 0; k < n; k++) {
            const q = q0 + DISK_Q[k];
            const r = r0 + DISK_R[k];
            if (!inGrid(q, r))
                continue;
            const x = cidx(q, r);
            if (!this.valid[x])
                continue;
            P[x] = P[x] + (w[DISK_D[k]] ?? 0);
        }
    }
    ringMultNow() {
        return this.dawn ? this.dawnMult : this.ringPull;
    }
    rebuild(obs) {
        for (const a of this.P)
            a.fill(0);
        this.tot.fill(0);
        const rm = this.ringMultNow();
        const me = this.slot;
        this.nodes = [];
        if (this.hearth >= 0)
            this.nodes.push(this.hearth);
        this.myLit.clear();
        this.myDisc.clear();
        for (const [c, n] of this.myN) {
            const b = this.needles.get(c);
            const mm = b && b.ring ? rm : 1;
            const w = n.dark ? 0 : n.weight * mm;
            if (w > 0)
                this.addCov(this.me, c, n.fed ? this.fedArr(w) : this.wArr(w));
            if (!n.dark && n.weight >= 0.999) {
                this.nodes.push(c);
                this.myLit.add(c);
            }
            else if (!this.jammedMine.has(c))
                this.myDisc.add(c);
        }
        for (const b of this.needles.values()) {
            if (b.owner === null || b.owner === me || b.dark)
                continue;
            if (this.myN.has(b.c))
                continue;
            if (b.owner === 'K' && this.dawn)
                continue;
            this.addCov(actIdx(b.owner), b.c, this.wArr(b.ring ? rm : 1));
        }
        for (let a = 0; a < 5; a++) {
            const P = this.P[a];
            for (const c of this.cells)
                this.tot[c] = this.tot[c] + P[c];
        }
        const Pm = this.P[this.me];
        for (const c of this.cells) {
            this.zone[c] = Pm[c] > 0 || (this.hearth >= 0 && cdist(c, this.hearth) <= this.linkRange) ? 1 : 0;
        }
        /* danger: cells inside the line with a needle my Tkach may heat (provokes the Keeper) */
        this.danger.fill(0);
        if (!this.dawn && !this.mercy) {
            for (const b of this.needles.values()) {
                if (b.start || b.owner === me)
                    continue;
                if (cdist(b.c, this.center) <= this.cherta)
                    this.danger[b.c] = 1;
            }
        }
        /* distance to my property */
        this.nearD.fill(99);
        this.nearNS.fill(99);
        const mark = (c, arr) => {
            const q0 = cq(c);
            const r0 = cr(c);
            for (let k = 0; k < DISK_N[6]; k++) {
                const q = q0 + DISK_Q[k];
                const r = r0 + DISK_R[k];
                if (!inGrid(q, r))
                    continue;
                const x = cidx(q, r);
                const d = DISK_D[k];
                if (arr[x] > d)
                    arr[x] = d;
            }
        };
        if (this.hearth >= 0)
            mark(this.hearth, this.nearD);
        for (const c of this.myN.keys()) {
            mark(c, this.nearD);
            const b = this.needles.get(c);
            if (b && !b.start)
                mark(c, this.nearNS);
        }
        /* weights of the opponents' losses */
        const sc = obs.pub.score;
        const my = sc[this.me] ?? 0;
        for (let a = 0; a < 3; a++) {
            if (a === this.me) {
                this.wOpp[a] = 0;
                continue;
            }
            const s = sc[a] ?? 0;
            this.wOpp[a] = s >= my - 3 ? 0.85 : 0.5;
        }
        this.wOpp[3] = 0;
        this.wOpp[4] = 0.6;
        this.income = 0.25 * Math.min(8, Math.max(this.myLit.size, 2));
    }
    /* gain for me (returned) and loss for actor remA (this.lastOpp), minutes per tick */
    delta(c, add, remA, rem) {
        const q0 = cq(c);
        const r0 = cr(c);
        const R = Math.min(6, Math.max(add.length, rem ? rem.length : 0) - 1);
        const n = DISK_N[Math.max(0, R)];
        const Pm = this.P[this.me];
        const Pa = remA >= 0 && rem ? this.P[remA] : null;
        let dm = 0;
        let dop = 0;
        for (let k = 0; k < n; k++) {
            const q = q0 + DISK_Q[k];
            const r = r0 + DISK_R[k];
            if (!inGrid(q, r))
                continue;
            const x = cidx(q, r);
            if (!this.valid[x])
                continue;
            const v = this.val[x];
            if (v <= 0)
                continue;
            const d = DISK_D[k];
            const a = add[d] ?? 0;
            const rv = rem ? (rem[d] ?? 0) : 0;
            if (a === 0 && rv === 0)
                continue;
            const m = Pm[x];
            const T0 = this.tot[x];
            const T1 = Math.max(0, T0 + a - rv);
            dm += v * (share(m + a, T1) - share(m, T0));
            if (Pa) {
                const o = Pa[x];
                dop += v * (share(o, T0) - share(Math.max(0, o - rv), T1));
            }
        }
        this.lastOpp = dop * this.rate;
        return dm * this.rate;
    }
    /* ------------------------------------------------------------ geometry */
    linkOk(a, b) {
        const d = cdist(a, b);
        const range = this.linkRange + (this.reach[a] || this.reach[b] ? 1 : 0);
        if (d > range)
            return false;
        if (d <= 1)
            return true;
        if (this.mtn[a] > d)
            return true;
        const key = a < b ? a * NC + b : b * NC + a;
        const hit = this.linkCache.get(key);
        if (hit !== undefined)
            return hit;
        let ok = null;
        if (this.oracle) {
            try {
                ok = !!this.oracle.linkOk({ q: cq(a), r: cr(a) }, { q: cq(b), r: cr(b) });
            }
            catch {
                ok = null;
            }
        }
        if (ok === null)
            ok = this.lineClear(a, b);
        this.linkCache.set(key, ok);
        return ok;
    }
    lineClear(a, b) {
        const aq = cq(a);
        const ar = cr(a);
        const bq = cq(b);
        const br = cr(b);
        const n = hdist(aq, ar, bq, br);
        for (let i = 1; i < n; i++) {
            const f = i / n;
            const x = aq + (bq - aq) * f + 1e-6;
            const z = ar + (br - ar) * f + 2e-6;
            const y = -x - z;
            let rx = Math.round(x);
            let ry = Math.round(y);
            let rz = Math.round(z);
            const dx = Math.abs(rx - x);
            const dy = Math.abs(ry - y);
            const dz = Math.abs(rz - z);
            if (dx > dy && dx > dz)
                rx = -ry - rz;
            else if (dy > dz)
                ry = -rx - rz;
            else
                rz = -rx - ry;
            if (inGrid(rx, rz) && this.block[cidx(rx, rz)])
                return false;
        }
        return true;
    }
    linkTo(c, nodes) {
        for (const n of nodes) {
            if (n === c)
                continue;
            if (cdist(n, c) > this.linkRange + 1)
                continue;
            if (this.linkOk(n, c))
                return true;
        }
        return false;
    }
    inLine(c) {
        return cdist(c, this.center) <= this.cherta;
    }
    lineOK() {
        return this.dawn || this.mercy;
    }
    stormed(c) {
        try {
            return this.storms.length > 0 && stormAt(this.storms, cq(c), cr(c), this.t);
        }
        catch {
            return false;
        }
    }
    field(src, tk) {
        const key = src * 2 + (tk ? 1 : 0);
        const f = this.fields.get(key);
        if (f)
            return f;
        const nf = this.dijkstra(src, tk);
        this.fields.set(key, nf);
        return nf;
    }
    /* a short hop along a path that walks around visible bodies: the node's own search
       ignores units, so after a block the unit is led by near waypoints */
    detour(u, dest) {
        const src = cidx(u.q, u.r);
        const occ = new Uint8Array(NC);
        for (const c of this.foeAt.keys())
            occ[c] = 1;
        for (const [c, id] of this.unitAt)
            if (id !== u.id)
                occ[c] = 1;
        occ[dest] = 0;
        const F = this.dijkstra(src, u.cls === TK, occ);
        if (F.d[dest] >= INF)
            return dest;
        const path = [];
        let c = dest;
        let guard = 0;
        while (c >= 0 && c !== src && guard++ < 400) {
            path.push(c);
            c = F.p[c];
        }
        if (c !== src || !path.length)
            return dest;
        path.reverse();
        const F0 = this.field(src, u.cls === TK);
        let f0 = dest;
        guard = 0;
        while (f0 >= 0 && F0.p[f0] !== src && guard++ < 400)
            f0 = F0.p[f0];
        if (path[0] !== f0)
            return path[0];
        return path[Math.min(path.length - 1, 4)] ?? dest;
    }
    dijkstra(src, tk, occ = null) {
        const d = new Float64Array(NC).fill(INF);
        const p = new Int32Array(NC).fill(-1);
        const oz = new Float64Array(NC);
        const dg = new Uint8Array(NC);
        const done = new Uint8Array(NC);
        const out = { src, d, p, oz, dg };
        if (src < 0 || src >= NC || !this.valid[src])
            return out;
        const step = tk ? this.stepT : this.stepK;
        const h = this.heap;
        h.clear();
        d[src] = 0;
        h.push(0, src);
        while (h.size() > 0) {
            const c = h.pop();
            const key = h.lastKey;
            if (done[c])
                continue;
            if (key > d[c])
                continue;
            done[c] = 1;
            const pc = p[c];
            if (pc >= 0) {
                oz[c] = oz[pc] + (this.zone[c] ? 0 : d[c] - d[pc]);
                dg[c] = dg[pc] || (pc !== src && this.danger[pc]) ? 1 : 0;
            }
            const lc = this.lvl[c];
            for (let k = 0; k < 6; k++) {
                const nb = this.nbr[c * 6 + k];
                if (nb < 0 || done[nb] || !this.pass[nb])
                    continue;
                if (occ && occ[nb])
                    continue;
                const climb = this.lvl[nb] - lc;
                if (climb >= 2)
                    continue;
                const nd = d[c] + step * this.mult[nb] + (climb > 0 ? climb * this.rise : 0);
                if (nd < d[nb]) {
                    d[nb] = nd;
                    p[nb] = c;
                    h.push(nd, nb);
                }
            }
        }
        return out;
    }
    waypoint(u, dest) {
        const src = cidx(u.q, u.r);
        const F = this.field(src, u.cls === TK);
        const path = [];
        let c = dest;
        let guard = 0;
        while (c >= 0 && c !== src && guard++ < 400) {
            path.push(c);
            c = F.p[c];
        }
        if (c !== src || !path.length)
            return dest;
        path.reverse();
        return path[Math.min(path.length - 1, 7)] ?? dest;
    }
    nearestZone(u) {
        const src = cidx(u.q, u.r);
        const F = this.field(src, u.cls === TK);
        let best = -1;
        let bd = INF;
        for (const c of this.cells) {
            if (!this.zone[c] || !this.pass[c])
                continue;
            if (this.unitAt.has(c) && c !== src)
                continue;
            const d = F.d[c];
            if (d < bd) {
                bd = d;
                best = c;
            }
        }
        return best;
    }
    /* ------------------------------------------------------------ units */
    memOf(id) {
        let m = this.mem.get(id);
        if (!m) {
            m = { job: null, cmdT: -1, cmdC: -1, cmdK: '', wpUntil: -1, fails: 0, cmdDest: -1 };
            this.mem.set(id, m);
        }
        return m;
    }
    mkJob(k, c, eta, work, prio, tag = '') {
        const b = this.needles.get(c);
        return { k, c, s: -1, tgt: '', tag, since: this.t, eta: Math.min(eta, 500), work, atSince: -1, owner: b ? b.owner : null, prio };
    }
    setJob(u, j) {
        const m = this.memOf(u.id);
        const old = m.job;
        if (old && old.k === j.k && old.c === j.c && old.s === j.s && old.tgt === j.tgt) {
            old.since = this.t;
            old.tag = j.tag;
            old.prio = j.prio;
            return;
        }
        m.job = j;
        m.fails = 0;
        m.wpUntil = -1;
        m.cmdDest = -1;
    }
    isIdle(u) {
        const k = u.task;
        if (!k)
            return true;
        return k.path === 0 && !k.site && !k.feed && !k.jam && !k.ram && !k.goal;
    }
    canCmd(u) {
        return !(u.task && u.task.path > 0 && u.wait > 0);
    }
    heatableAt(c) {
        const b = this.needles.get(c);
        return !!b && !b.start && b.owner !== this.slot && !this.myN.has(c);
    }
    isActing(u) {
        if (!this.isIdle(u))
            return true;
        return u.cls === TK && inGrid(u.q, u.r) && this.heatableAt(cidx(u.q, u.r));
    }
    frozen(u) {
        return u.cls === TK && u.away >= this.autonomy && inGrid(u.q, u.r) && !this.zone[cidx(u.q, u.r)];
    }
    awayOf(u) {
        return inGrid(u.q, u.r) && this.zone[cidx(u.q, u.r)] ? 0 : Math.max(0, u.away);
    }
    heatCost(b) {
        if (b.owner === null)
            return this.heatNeedle;
        if (b.owner === 'K')
            return this.dawn ? this.heatNeedle : b.dark ? this.heatDark : this.heatEnemy;
        return b.dark ? this.heatDark : this.heatEnemy;
    }
    banned(c) {
        return (this.ban.get(c) ?? -1) > this.t;
    }
    working(j) {
        return (j.k === 'heat' || j.k === 'build') && j.atSince >= 0;
    }
    validate(obs) {
        const t = obs.t;
        for (const u of obs.mine.units) {
            const m = this.memOf(u.id);
            if (m.job && !this.jobOk(u, m.job, m))
                m.job = null;
            if (u.cls !== TK || !inGrid(u.q, u.r) || this.frozen(u))
                continue;
            const uc = cidx(u.q, u.r);
            if (this.zone[uc])
                continue;
            const j = m.job;
            if (j && j.k === 'home')
                continue;
            const away = Math.max(0, u.away);
            const F = this.field(uc, true);
            let safe = false;
            if (j) {
                const target = j.k === 'stage' ? j.s : j.c;
                if (target >= 0) {
                    const remain = this.working(j) ? Math.max(0, j.work - (t - j.atSince)) : F.d[target] + j.work;
                    const lights = (j.k === 'heat' || j.k === 'build') && this.linkTo(target, this.nodes);
                    if ((lights || this.zone[target]) && away + remain <= this.autonomy - 3)
                        safe = true;
                }
            }
            if (safe)
                continue;
            const hc = this.nearestZone(u);
            if (hc < 0)
                continue;
            if (!j || away + F.d[hc] >= this.autonomy - 8)
                this.setJob(u, this.mkJob('home', hc, F.d[hc], 0, 92));
        }
    }
    jobOk(u, j, m) {
        const t = this.t;
        const uc = cidx(u.q, u.r);
        switch (j.k) {
            case 'heat': {
                if (this.myN.has(j.c))
                    return false;
                const b = this.needles.get(j.c);
                if (!b || b.start)
                    return false;
                if (b.owner !== j.owner)
                    return false;
                if (!this.lineOK() && this.inLine(j.c))
                    return false;
                if (uc === j.c) {
                    if (j.atSince < 0)
                        j.atSince = t;
                    if (t - j.atSince > j.work + 10) {
                        this.ban.set(j.c, t + 80);
                        return false;
                    }
                }
                else {
                    j.atSince = -1;
                    if (t - j.since > j.eta * 1.5 + j.work + 30) {
                        this.ban.set(j.c, t + 50);
                        return false;
                    }
                    const f = this.foeAt.get(j.c);
                    if (f && cdist(uc, j.c) <= 3 && j.tag !== 'contract')
                        return false;
                }
                if (m.fails > 5) {
                    this.ban.set(j.c, t + 40);
                    return false;
                }
                return true;
            }
            case 'build': {
                if (this.needles.has(j.c))
                    return false;
                if (t - j.since > j.eta * 1.5 + 50) {
                    this.ban.set(j.c, t + 60);
                    return false;
                }
                if (uc === j.c && u.task && u.task.site && j.atSince < 0)
                    j.atSince = t;
                if (m.fails > 5) {
                    this.ban.set(j.c, t + 60);
                    return false;
                }
                return true;
            }
            case 'feed': {
                const other = this.unitAt.get(j.c);
                return this.myLit.has(j.c) && (!other || other === u.id) && m.fails <= 5;
            }
            case 'park': {
                const other = this.unitAt.get(j.c);
                if (other && other !== u.id)
                    return false;
                return this.myN.has(j.c) && m.fails <= 6;
            }
            case 'stage': {
                const b = this.needles.get(j.c);
                return t <= this.dawnAt + 3 && !this.myN.has(j.c) && !!b && (b.owner === 'K' || b.owner === null) && m.fails <= 6;
            }
            case 'cache':
                return !this.takenFinds.has(j.c) && t - j.since <= j.eta + 25 && m.fails <= 5;
            case 'home':
                return !this.zone[uc] && this.zone[j.c] === 1 && t - j.since < 60 && m.fails <= 6;
            case 'ram': {
                if (this.foes.has(j.tgt)) {
                    j.atSince = t;
                    return t - j.since < 60;
                }
                return t - j.atSince <= 3;
            }
            case 'jam': {
                const b = this.needles.get(j.c);
                if (!b || b.start || b.owner === null || b.owner === this.slot || this.myN.has(j.c))
                    return false;
                if (b.owner === 'K' && (this.dawn || t >= this.dawnAt - 3))
                    return false;
                const live = this.myJams.has(j.c);
                if (live) {
                    if (j.atSince < 0)
                        j.atSince = t;
                    if (t - j.atSince >= 12 && this.stolenAt < t - 10 && !this.supported(j.c)) {
                        this.jamBan.set(j.c, t + 250);
                        return false;
                    }
                }
                else if (t - j.since > j.eta + 30) {
                    this.jamBan.set(j.c, t + 100);
                    return false;
                }
                if (t - j.since > 250)
                    return false;
                return m.fails <= 5;
            }
            default:
                return false;
        }
    }
    supported(c) {
        for (const m of this.mem.values())
            if (m.job && m.job.k === 'heat' && m.job.c === c)
                return true;
        return false;
    }
    /* ------------------------------------------------------------ production */
    decideCache() {
        this.oppKD.fill(INF);
        for (const h of this.oppHearths) {
            const F = this.dijkstra(h, false);
            for (const c of this.cells)
                if (F.d[c] < this.oppKD[c])
                    this.oppKD[c] = F.d[c];
        }
        if (this.hearth < 0)
            return;
        const F = this.dijkstra(this.hearth, false);
        let best = -1;
        let bd = INF;
        for (const c of this.caches) {
            const d = F.d[c];
            if (d <= 20 && d <= this.oppKD[c] + 2 && d < bd) {
                bd = d;
                best = c;
            }
        }
        this.cachePlan = best;
    }
    planProduction(obs) {
        const t = obs.t;
        if (t < 1 || t > this.T - 60)
            return;
        let nT = 0;
        let nK = 0;
        for (const u of obs.mine.units) {
            if (u.cls === TK)
                nT++;
            else
                nK++;
        }
        for (const p of this.pendingYard) {
            if (p.cls === TK)
                nT++;
            else
                nK++;
        }
        const wT = this.cf('weightTkach', 2);
        const wK = this.cf('weightKlinok', 1);
        const cap = this.cf('squadWeight', 8);
        const weight = nT * wT + nK * wK;
        const en = obs.pulse.energy - this.bidReserve;
        const threat = t - this.threatAt < 100;
        let want = null;
        if (this.cachePlan >= 0 && t <= 3 && nK === 0 && nT === 0)
            want = KL;
        else if (nT < 3)
            want = TK;
        else if (nK < 1 && (t >= 70 || threat))
            want = KL;
        else if (nK < 2 && (t >= 150 || threat))
            want = KL;
        if (!want)
            return;
        if (weight + (want === TK ? wT : wK) > cap) {
            if (want === TK && nK < 2 && weight + wK <= cap && t >= 70)
                want = KL;
            else
                return;
        }
        const cost = want === TK ? this.costT : this.costK;
        if (en < cost)
            return;
        if (want === KL && nK >= 1 && !threat && en < cost + 40 && t < 400)
            return;
        this.cmds.push({
            orders: [{ kind: 'yard', cls: want }],
            prio: 80,
            cost: this.chanOrder * (this.hearth >= 0 && this.stormed(this.hearth) ? this.stormMul : 1),
            hands: 0,
            unit: '',
            kind: 'yard',
            cell: -1,
            lot: -1,
            cls: want,
            dest: -1,
        });
    }
    energyFree(obs) {
        let nT = 0;
        let nK = 0;
        for (const u of obs.mine.units) {
            if (u.cls === TK)
                nT++;
            else
                nK++;
        }
        for (const p of this.pendingYard) {
            if (p.cls === TK)
                nT++;
            else
                nK++;
        }
        let e = obs.pulse.energy - this.bidReserve;
        if (nT < 3)
            e -= this.costT;
        else if (nK < 1 && obs.t >= 70)
            e -= this.costK;
        for (const m of this.mem.values())
            if (m.job && m.job.k === 'build')
                e -= this.costNeedle;
        for (const c of this.cmds) {
            if (c.kind === 'yard' && c.cls === KL && nT >= 3)
                e -= this.costK;
        }
        return e;
    }
    /* ------------------------------------------------------------ contract */
    planContract(obs) {
        this.contract = null;
        const ord = obs.pub.order;
        if (!ord)
            return;
        const t = obs.t;
        const cells = [];
        for (const h of ord.cells)
            if (inGrid(h.q, h.r) && this.valid[cidx(h.q, h.r)])
                cells.push(cidx(h.q, h.r));
        if (cells.length !== 3)
            return;
        const hold = ord.holdTicks > 0 ? ord.holdTicks : this.cf('orderHoldTicks', 12);
        const plan = { cells, need: [], assign: new Map(), to: ord.to };
        this.contract = plan;
        const need = cells.filter((c) => !this.myN.has(c));
        plan.need = need;
        if (!need.length)
            return;
        if (t + hold + 2 > ord.to)
            return;
        if (!cells.some((c) => this.myLit.has(c) || this.linkTo(c, this.nodes)))
            return;
        const costs = new Map();
        for (const c of need) {
            const b = this.needles.get(c);
            if (!b || b.start)
                return;
            if (!this.lineOK() && this.inLine(c))
                return;
            let hc = this.heatCost(b);
            if (b.owner !== null && b.capAt + this.capGrace > t)
                hc += b.capAt + this.capGrace - t;
            if (this.foeAt.has(c))
                hc += 10;
            costs.set(c, hc);
        }
        const tks = obs.mine.units.filter((u) => u.cls === TK && !this.frozen(u)).sort(byId);
        if (!tks.length)
            return;
        const info = tks.map((u) => {
            const m = this.memOf(u.id);
            const j = m.job;
            let busy = 0;
            if (j && this.working(j) && !(j.k === 'heat' && need.includes(j.c)))
                busy = Math.max(0, j.work - (t - j.atSince));
            if (j && j.k === 'home')
                busy = INF;
            return { u, F: this.field(cidx(u.q, u.r), true), busy };
        });
        const mN = need.length;
        const n = info.length;
        let total = 1;
        for (let i = 0; i < mN; i++)
            total *= n;
        let best = INF;
        let bestSeq = null;
        const perms = (arr) => {
            if (arr.length <= 1)
                return [arr.slice()];
            const out = [];
            for (let i = 0; i < arr.length; i++) {
                const rest = arr.slice(0, i).concat(arr.slice(i + 1));
                for (const p of perms(rest))
                    out.push([arr[i], ...p]);
            }
            return out;
        };
        for (let a = 0; a < total; a++) {
            let x = a;
            const groups = [];
            for (let j = 0; j < n; j++)
                groups.push([]);
            for (let i = 0; i < mN; i++) {
                groups[x % n].push(need[i]);
                x = Math.floor(x / n);
            }
            let span = 0;
            const seqs = [];
            for (let j = 0; j < n; j++) {
                const g = groups[j];
                if (!g.length) {
                    seqs.push([]);
                    continue;
                }
                const I = info[j];
                let bj = INF;
                let bs = [];
                for (const p of perms(g)) {
                    const first = p[0];
                    let tm = I.busy + I.F.d[first];
                    if (tm >= INF)
                        continue;
                    if (I.F.dg[first])
                        continue;
                    const away = this.awayOf(I.u) + I.F.oz[first] + (this.zone[first] ? 0 : (costs.get(first) ?? 0));
                    if (away > this.autonomy - 6)
                        continue;
                    tm += costs.get(first) ?? 0;
                    for (let i = 1; i < p.length; i++)
                        tm += this.stepT * 1.3 * cdist(p[i - 1], p[i]) + (costs.get(p[i]) ?? 0);
                    if (tm < bj) {
                        bj = tm;
                        bs = p;
                    }
                }
                if (bj >= INF) {
                    span = INF;
                    break;
                }
                seqs.push(bs);
                if (bj > span)
                    span = bj;
            }
            if (span < best) {
                best = span;
                bestSeq = seqs;
            }
        }
        if (!bestSeq || t + best + hold + 1 > ord.to)
            return;
        for (let j = 0; j < n; j++) {
            const s = bestSeq[j];
            if (s && s.length)
                plan.assign.set(info[j].u.id, s);
        }
    }
    /* ------------------------------------------------------------ Tkachs */
    planTkachs(obs) {
        const t = obs.t;
        const tks = obs.mine.units.filter((u) => u.cls === TK && !this.frozen(u)).sort(byId);
        if (!tks.length)
            return;
        const plan = this.contract;
        if (plan && plan.assign.size) {
            for (const u of tks) {
                const seq = plan.assign.get(u.id);
                if (!seq || !seq.length)
                    continue;
                const m = this.memOf(u.id);
                const j = m.job;
                if (j && j.k === 'home')
                    continue;
                const first = seq[0];
                if (j && j.k === 'heat' && j.c === first) {
                    j.tag = 'contract';
                    j.prio = 85;
                    continue;
                }
                if (j && this.working(j))
                    continue;
                const b = this.needles.get(first);
                if (!b)
                    continue;
                const F = this.field(cidx(u.q, u.r), true);
                this.setJob(u, this.mkJob('heat', first, F.d[first], this.heatCost(b), 85, 'contract'));
            }
        }
        this.planDawnTk(obs, tks);
        const free = tks.filter((u) => {
            const j = this.memOf(u.id).job;
            return !j || ((j.k === 'feed' || j.k === 'park') && t - j.since >= 10);
        });
        if (free.length)
            this.greedy(obs, free);
        /* a Tkach left without work outside the comms zone walks back before the leash freezes it */
        for (const u of tks) {
            const m = this.memOf(u.id);
            if (m.job || !inGrid(u.q, u.r))
                continue;
            if (this.zone[cidx(u.q, u.r)])
                continue;
            const hc = this.nearestZone(u);
            if (hc >= 0)
                this.setJob(u, this.mkJob('home', hc, 0, 0, 92));
        }
    }
    stageCell(R, used, self) {
        let best = -1;
        let bd = -1;
        for (let k = 0; k < 6; k++) {
            const x = this.nbr[R * 6 + k];
            if (x < 0 || !this.pass[x])
                continue;
            if (cdist(x, this.center) <= this.cherta)
                continue;
            if (this.needles.has(x) || used.has(x))
                continue;
            const o = this.unitAt.get(x);
            if (o !== undefined && x !== self)
                continue;
            if (this.foeAt.has(x))
                continue;
            if (this.lvl[R] - this.lvl[x] >= 2)
                continue;
            const d = cdist(x, this.center) * 10 - this.lvl[x];
            if (d > bd) {
                bd = d;
                best = x;
            }
        }
        return best;
    }
    planDawnTk(obs, tks) {
        const t = obs.t;
        if (t < this.dawnAt - 32 || t > this.dawnAt + 3)
            return;
        if (t >= this.dawnAt - 1) {
            for (const u of tks) {
                const m = this.memOf(u.id);
                const j = m.job;
                if (!j || j.k !== 'stage')
                    continue;
                const uc = cidx(u.q, u.r);
                if (uc === j.s || cdist(uc, j.c) <= 1 || t >= this.dawnAt) {
                    const b = this.needles.get(j.c);
                    if (!b)
                        continue;
                    const F = this.field(uc, true);
                    this.setJob(u, this.mkJob('heat', j.c, F.d[j.c], this.heatNeedle, 88, 'dawn'));
                }
            }
            return;
        }
        const usedR = new Set();
        const usedS = new Set();
        const planned = this.nodes.slice();
        for (const u of tks) {
            const j = this.memOf(u.id).job;
            if (j && j.k === 'stage') {
                usedR.add(j.c);
                usedS.add(j.s);
                planned.push(j.c);
            }
        }
        for (const u of tks) {
            const m = this.memOf(u.id);
            const j = m.job;
            if (j && (j.k === 'stage' || j.k === 'home' || j.tag === 'contract' || this.working(j)))
                continue;
            const uc = cidx(u.q, u.r);
            const F = this.field(uc, true);
            let bestR = -1;
            let bestS = -1;
            let bd = INF;
            for (const R of this.ringCells) {
                if (usedR.has(R))
                    continue;
                const b = this.needles.get(R);
                if (!b || (b.owner !== 'K' && b.owner !== null) || this.myN.has(R))
                    continue;
                if (!this.linkTo(R, planned))
                    continue;
                const S = this.stageCell(R, usedS, uc);
                if (S < 0)
                    continue;
                const d = F.d[S];
                if (d >= INF || F.dg[S])
                    continue;
                if (this.awayOf(u) + F.oz[S] > this.autonomy + 10)
                    continue;
                if (d < bd) {
                    bd = d;
                    bestR = R;
                    bestS = S;
                }
            }
            if (bestR < 0 || bd > this.dawnAt - t + 40)
                continue;
            const nj = this.mkJob('stage', bestR, bd, 0, 75, 'dawn');
            nj.s = bestS;
            this.setJob(u, nj);
            usedR.add(bestR);
            usedS.add(bestS);
            planned.push(bestR);
        }
    }
    buildSiteOk(c) {
        if (!this.valid[c] || !this.pass[c] || !this.bld[c] || this.deadCell[c])
            return false;
        if (this.needles.has(c))
            return false;
        for (const h of this.hearths)
            if (cdist(c, h) <= 2)
                return false;
        if (!this.lineOK() && this.inLine(c))
            return false;
        return true;
    }
    greedy(obs, free) {
        const t = obs.t;
        const me = this.slot;
        const taken = new Map();
        for (const u of obs.mine.units) {
            const j = this.memOf(u.id).job;
            if (j) {
                taken.set(j.c, u.id);
                if (j.s >= 0)
                    taken.set(j.s, u.id);
            }
        }
        const reserved = new Set();
        if (this.contract)
            for (const s of this.contract.assign.values())
                for (const c of s)
                    reserved.add(c);
        const rm = this.ringMultNow();
        const cands = [];
        const mk = (c, kind, work, remA, mult, owner, pri, graceEnd) => ({
            c,
            kind,
            work,
            remA,
            mult,
            g: 0,
            dirty: true,
            link: false,
            near: false,
            bonus: 0,
            used: false,
            owner,
            pri,
            graceEnd,
        });
        /* heat targets */
        for (const b of this.needles.values()) {
            if (b.start || b.owner === me || this.myN.has(b.c))
                continue;
            if (!this.lineOK() && (b.ring || this.inLine(b.c)))
                continue;
            if (this.banned(b.c) || reserved.has(b.c))
                continue;
            if (this.foeAt.has(b.c))
                continue;
            const lit = !b.dark && !(b.owner === 'K' && this.dawn);
            const remA = b.owner !== null && lit ? actIdx(b.owner) : -1;
            const mult = b.ring ? rm : 1;
            const ge = b.owner !== null && b.capAt > -INF ? b.capAt + this.capGrace : -INF;
            cands.push(mk(b.c, 'heat', this.heatCost(b), remA, mult, b.owner, 0, ge));
        }
        /* build sites */
        const enFree = this.energyFree(obs);
        let energyLeft = enFree;
        if (enFree + this.income * 25 >= this.costNeedle && t < this.T - 40) {
            const seen = new Uint8Array(NC);
            for (const n of this.nodes) {
                const q0 = cq(n);
                const r0 = cr(n);
                const R = this.linkRange + (this.reach[n] ? 1 : 0);
                for (let k = 0; k < DISK_N[Math.min(6, R)]; k++) {
                    const q = q0 + DISK_Q[k];
                    const r = r0 + DISK_R[k];
                    if (!inGrid(q, r))
                        continue;
                    const x = cidx(q, r);
                    if (seen[x])
                        continue;
                    seen[x] = 1;
                    if (DISK_D[k] < 2)
                        continue;
                    if (!this.buildSiteOk(x) || this.banned(x) || this.foeAt.has(x))
                        continue;
                    if (this.unitAt.has(x))
                        continue;
                    cands.push(mk(x, 'build', this.buildTicks, -1, 1, null, 0, -INF));
                }
            }
        }
        /* caches */
        const lamC = t < 300 ? 0.12 : t < 600 ? 0.06 : t < 900 ? 0.03 : 0;
        if (lamC > 0) {
            for (const c of this.caches) {
                if (this.takenFinds.has(c) || this.banned(c))
                    continue;
                cands.push(mk(c, 'cache', 0, -1, 1, null, 0, -INF));
            }
        }
        /* feed and park */
        let acting = 0;
        for (const u of obs.mine.units)
            if (this.isActing(u))
                acting++;
        let headroom = obs.pulse.chanAt - this.chanTick * acting - 2 * this.chanOrder;
        for (const c of this.myLit) {
            const n = this.myN.get(c);
            if (!n)
                continue;
            const b = this.needles.get(c);
            if (headroom >= this.chanTick && !n.fed)
                cands.push(mk(c, 'feed', 0, -1, (b && b.ring ? rm : 1) * n.weight, me, 0, -INF));
            if (b && !b.start) {
                let pri = 1 + Math.max(0, 6 - this.nearNSForeign(c));
                if (this.contract && this.contract.cells.includes(c))
                    pri += 40;
                cands.push(mk(c, 'park', 0, -1, 1, me, pri, -INF));
            }
        }
        const planned = this.nodes.slice();
        for (const cd of cands) {
            if (cd.kind === 'heat' || cd.kind === 'build') {
                cd.link = this.linkTo(cd.c, planned);
                if (!cd.link && cd.kind === 'heat') {
                    for (const n of this.nodes) {
                        if (cdist(n, cd.c) <= 2 * this.linkRange) {
                            cd.near = true;
                            break;
                        }
                    }
                }
            }
        }
        this.computeBonus(cands, t);
        const savedP = this.P[this.me].slice();
        const savedT = this.tot.slice();
        const lam = energyLeft >= 280 ? 0 : energyLeft >= 160 ? 0.02 : 0.05;
        const pool = free.slice();
        try {
            while (pool.length) {
                for (const cd of cands)
                    if (cd.dirty && !cd.used)
                        this.evalCand(cd);
                let bestRate = 0;
                let bu = null;
                let bc = null;
                let beta = 0;
                for (const u of pool) {
                    const uc = cidx(u.q, u.r);
                    const F = this.field(uc, true);
                    const cur = this.memOf(u.id).job;
                    const away = this.awayOf(u);
                    for (const cd of cands) {
                        if (cd.used)
                            continue;
                        const tk = taken.get(cd.c);
                        if (tk !== undefined && tk !== u.id)
                            continue;
                        if (cd.kind === 'park' || cd.kind === 'feed') {
                            const o = this.unitAt.get(cd.c);
                            if (o !== undefined && o !== u.id)
                                continue;
                        }
                        const eta = F.d[cd.c];
                        if (eta >= INF)
                            continue;
                        if (F.dg[cd.c])
                            continue;
                        if (away + F.oz[cd.c] + (this.zone[cd.c] ? 0 : cd.work) > this.autonomy - 8)
                            continue;
                        if (cd.kind === 'build' && (!cd.link || energyLeft + this.income * eta < this.costNeedle))
                            continue;
                        if (cd.kind === 'heat' && t + eta < cd.graceEnd)
                            continue;
                        let rate = this.rateOf(cd, eta, t, lam);
                        if (rate <= 0)
                            continue;
                        if (cur && cur.c === cd.c && ((cur.k === 'feed' && cd.kind === 'feed') || (cur.k === 'park' && cd.kind === 'park')))
                            rate *= 1.3;
                        if (rate > bestRate) {
                            bestRate = rate;
                            bu = u;
                            bc = cd;
                            beta = eta;
                        }
                    }
                }
                if (!bu || !bc)
                    break;
                const kind = bc.kind;
                const prio = kind === 'heat' || kind === 'build' ? 60 : kind === 'cache' ? 70 : kind === 'feed' ? 30 : 25;
                this.setJob(bu, this.mkJob(kind, bc.c, beta, bc.work, prio));
                bc.used = true;
                taken.set(bc.c, bu.id);
                pool.splice(pool.indexOf(bu), 1);
                if (kind === 'build')
                    energyLeft -= this.costNeedle;
                if (kind === 'feed') {
                    headroom -= this.chanTick;
                    if (headroom < this.chanTick)
                        for (const cd of cands)
                            if (cd.kind === 'feed')
                                cd.used = true;
                }
                if (kind === 'heat' || kind === 'build') {
                    const add = this.wArr(bc.mult);
                    this.addCov(this.me, bc.c, add);
                    const q0 = cq(bc.c);
                    const r0 = cr(bc.c);
                    const R = Math.min(6, add.length - 1);
                    for (let k = 0; k < DISK_N[R]; k++) {
                        const q = q0 + DISK_Q[k];
                        const r = r0 + DISK_R[k];
                        if (!inGrid(q, r))
                            continue;
                        const x = cidx(q, r);
                        if (!this.valid[x])
                            continue;
                        this.tot[x] = this.tot[x] + (add[DISK_D[k]] ?? 0);
                    }
                    planned.push(bc.c);
                    for (const cd of cands) {
                        if (cd.used)
                            continue;
                        const d = cdist(cd.c, bc.c);
                        if (d <= 7)
                            cd.dirty = true;
                        if (!cd.link && (cd.kind === 'heat' || cd.kind === 'build') && d <= this.linkRange + 1 && this.linkOk(bc.c, cd.c)) {
                            cd.link = true;
                            cd.dirty = true;
                        }
                    }
                    for (const cd of cands)
                        if (cd.kind === 'build' && !cd.used && cdist(cd.c, bc.c) <= 1)
                            cd.used = true;
                }
            }
        }
        finally {
            this.P[this.me].set(savedP);
            this.tot.set(savedT);
        }
    }
    nearNSForeign(c) {
        let best = 99;
        for (const b of this.needles.values()) {
            if (b.owner === null || b.owner === this.slot || b.owner === 'K' || this.myN.has(b.c))
                continue;
            const d = cdist(b.c, c);
            if (d < best)
                best = d;
        }
        for (const f of this.foes.values()) {
            if (f.p === 'K')
                continue;
            const d = cdist(cidx(f.q, f.r), c);
            if (d < best)
                best = d;
        }
        return best;
    }
    evalCand(cd) {
        cd.dirty = false;
        if (cd.kind === 'heat') {
            const add = this.wArr(cd.mult);
            const gm = this.delta(cd.c, add, cd.remA, cd.remA >= 0 ? add : null);
            cd.g = gm + (cd.remA >= 0 ? (this.wOpp[cd.remA] ?? 0) * this.lastOpp : 0);
        }
        else if (cd.kind === 'build') {
            cd.g = this.delta(cd.c, this.wArr(1), -1, null);
        }
        else if (cd.kind === 'feed') {
            cd.g = this.delta(cd.c, this.fedExtra(cd.mult), -1, null);
        }
        else
            cd.g = 0;
    }
    computeBonus(cands, t) {
        const H = Math.max(0, this.T - t - 60);
        const frontier = [];
        for (const cd of cands) {
            if (cd.kind !== 'heat' || cd.link)
                continue;
            this.evalCand(cd);
            if (cd.g > 0)
                frontier.push({ c: cd.c, g: cd.g, mine: false });
        }
        for (const c of this.myDisc) {
            const b = this.needles.get(c);
            if (!b || b.start)
                continue;
            const g = this.delta(c, this.wArr(b.ring ? this.ringMultNow() : 1), -1, null);
            if (g > 0)
                frontier.push({ c, g, mine: true });
        }
        let ringNeed = false;
        const outerRing = [];
        if (t >= this.dawnAt - 220 && t < this.dawnAt - 10) {
            for (const R of this.ringCells)
                if (cdist(R, this.center) > this.cherta - 1)
                    outerRing.push(R);
            ringNeed = outerRing.length > 0 && !this.ringCells.some((R) => this.linkTo(R, this.nodes));
        }
        for (const cd of cands) {
            if (cd.kind !== 'heat' && cd.kind !== 'build')
                continue;
            if (!cd.link)
                continue;
            let b1 = 0;
            let b2 = 0;
            for (const f of frontier) {
                if (f.c === cd.c)
                    continue;
                if (cdist(f.c, cd.c) > this.linkRange + 1)
                    continue;
                if (!this.linkOk(cd.c, f.c))
                    continue;
                const v = (f.mine ? 1 : 0.3) * f.g * H;
                if (v > b1) {
                    b2 = b1;
                    b1 = v;
                }
                else if (v > b2)
                    b2 = v;
            }
            cd.bonus = b1 + b2;
            if (ringNeed && !this.inLine(cd.c)) {
                for (const R of outerRing) {
                    if (cdist(R, cd.c) <= this.linkRange + 1 && this.linkOk(cd.c, R)) {
                        cd.bonus += 8;
                        break;
                    }
                }
            }
        }
    }
    rateOf(cd, eta, t, lam) {
        switch (cd.kind) {
            case 'heat': {
                const H = this.T - (t + eta + cd.work);
                if (H <= 0)
                    return 0;
                const linkF = cd.link ? 1 : cd.near ? 0.35 : 0;
                const risk = cd.owner !== null && cd.owner !== 'K' ? 0.85 : 1;
                const v = cd.g * H * linkF * risk + cd.bonus;
                return v / (eta + cd.work + 2);
            }
            case 'build': {
                const H = this.T - (t + eta + this.buildTicks);
                if (H <= 0)
                    return 0;
                const v = cd.g * H + cd.bonus - this.costNeedle * lam;
                return v / (eta + this.buildTicks + 2);
            }
            case 'cache': {
                const lamC = t < 300 ? 0.12 : t < 600 ? 0.06 : t < 900 ? 0.03 : 0;
                if (t < 80 && eta > this.oppKD[cd.c] * 2 + 4)
                    return 0;
                if (eta > 40)
                    return 0;
                return (this.cf('cacheEnergy', 150) * lamC) / (eta + 3);
            }
            case 'feed': {
                if (this.T - t < 5)
                    return 0;
                return (cd.g * 100) / (eta + 100);
            }
            case 'park':
                return (1e-6 * cd.pri) / (eta + 10);
            default:
                return 0;
        }
    }
    /* ------------------------------------------------------------ Klinoks */
    findThreats(obs) {
        const out = [];
        const t = obs.t;
        const working = new Set();
        const tkCells = [];
        for (const u of obs.mine.units) {
            if (u.cls !== TK || !inGrid(u.q, u.r))
                continue;
            const c = cidx(u.q, u.r);
            tkCells.push(c);
            const j = this.memOf(u.id).job;
            if ((j && this.working(j)) || (u.task && u.task.site) || this.heatableAt(c))
                working.add(c);
        }
        for (const f of this.foes.values()) {
            if (f.p === 'K' || f.p === this.slot)
                continue;
            const c = cidx(f.q, f.r);
            if (!this.valid[c])
                continue;
            if (!this.dawn && this.inLine(c))
                continue;
            const b = this.needles.get(c);
            const nd = this.nearD[c];
            let prio = 0;
            if (f.cls === TK) {
                if (b && this.myN.has(c) && !b.start)
                    prio = 100;
                else if (b && !b.start && b.owner !== f.p)
                    prio = nd <= 4 ? 75 : 50;
                else if (nd <= 2)
                    prio = 40;
                else if (nd <= 5)
                    prio = 25;
                else
                    prio = 12;
                if (this.contract && this.contract.cells.some((x) => cdist(x, c) <= 1))
                    prio += 10;
            }
            else {
                let jam = false;
                for (const [jc, info] of this.jammedMine)
                    if (info.by === f.p && cdist(jc, c) <= 1)
                        jam = true;
                let nearWork = false;
                let nearTk = false;
                for (const x of tkCells) {
                    const d = cdist(x, c);
                    if (d <= 2 && working.has(x))
                        nearWork = true;
                    if (d <= 3)
                        nearTk = true;
                }
                if (jam)
                    prio = 80;
                else if (nearWork)
                    prio = 60;
                else if (this.nearNS[c] <= 1)
                    prio = 45;
                else if (nearTk)
                    prio = 30;
            }
            if (prio > 0)
                out.push({ f, c, prio, handled: false });
        }
        out.sort((a, b) => b.prio - a.prio || (a.f.id < b.f.id ? -1 : a.f.id > b.f.id ? 1 : 0));
        const top = out[0];
        if (top && top.prio >= 45) {
            this.threatAt = t;
            this.threatCell = top.c;
        }
        return out;
    }
    planKlinoks(obs) {
        const t = obs.t;
        const ks = obs.mine.units.filter((u) => u.cls === KL).sort(byId);
        if (!ks.length)
            return;
        const threats = this.findThreats(obs);
        const busy = new Set();
        for (const k of ks) {
            const j = this.memOf(k.id).job;
            if (j && j.k === 'ram') {
                const th = threats.find((x) => x.f.id === j.tgt);
                if (th) {
                    j.prio = Math.max(th.prio, 30);
                    th.handled = true;
                }
                busy.add(k.id);
            }
        }
        for (const th of threats) {
            if (th.handled)
                continue;
            let best = null;
            let bd = INF;
            for (const k of ks) {
                const j = this.memOf(k.id).job;
                if (j && j.k === 'ram' && j.prio >= th.prio)
                    continue;
                if (busy.has(k.id) && (!j || j.k !== 'ram' || j.prio >= th.prio))
                    continue;
                const F = this.field(cidx(k.q, k.r), false);
                let d = F.d[th.c];
                if (d >= INF) {
                    for (let q = 0; q < 6; q++) {
                        const x = this.nbr[th.c * 6 + q];
                        if (x >= 0 && F.d[x] < d)
                            d = F.d[x];
                    }
                }
                if (j && j.k === 'jam')
                    d += 6;
                if (d < bd) {
                    bd = d;
                    best = k;
                }
            }
            const lim = th.prio >= 100 ? 26 : th.prio >= 75 ? 18 : th.prio >= 45 ? 12 : 8;
            if (best && bd <= lim) {
                const nj = this.mkJob('ram', th.c, bd, 0, Math.max(th.prio, 30));
                nj.tgt = th.f.id;
                nj.atSince = t;
                this.setJob(best, nj);
                busy.add(best.id);
                th.handled = true;
            }
        }
        const free = ks.filter((k) => {
            if (busy.has(k.id))
                return false;
            const j = this.memOf(k.id).job;
            if (j && (j.k === 'ram' || j.k === 'cache'))
                return false;
            return true;
        });
        if (!free.length)
            return;
        /* caches */
        if (t < 700) {
            for (const k of free.slice()) {
                let onCache = false;
                for (const m of this.mem.values())
                    if (m.job && m.job.k === 'cache')
                        onCache = true;
                if (onCache)
                    break;
                const F = this.field(cidx(k.q, k.r), false);
                let best = -1;
                let bd = INF;
                for (const c of this.caches) {
                    if (this.takenFinds.has(c) || this.banned(c))
                        continue;
                    const d = F.d[c];
                    const ok = t < 60 ? d <= 22 && d <= this.oppKD[c] + 2 + t : d <= 16;
                    if (ok && d < bd) {
                        bd = d;
                        best = c;
                    }
                }
                if (best >= 0) {
                    this.setJob(k, this.mkJob('cache', best, bd, 0, 70));
                    free.splice(free.indexOf(k), 1);
                }
            }
        }
        if (!free.length)
            return;
        /* guard: one Klinok parks on a post; the others jam for loot */
        const occupied = new Map();
        for (const [id, m] of this.mem)
            if (m.job && (m.job.k === 'park' || m.job.k === 'feed'))
                occupied.set(m.job.c, id);
        let guard = null;
        if (ks.length >= 2) {
            for (const k of free) {
                const j = this.memOf(k.id).job;
                if (j && j.k === 'park') {
                    guard = k;
                    break;
                }
            }
            if (!guard) {
                for (const k of free) {
                    const j = this.memOf(k.id).job;
                    if (!j || j.k !== 'jam') {
                        guard = k;
                        break;
                    }
                }
            }
            if (!guard) {
                let anyGuard = false;
                for (const k of ks) {
                    const j = this.memOf(k.id).job;
                    if (j && j.k === 'park')
                        anyGuard = true;
                }
                if (!anyGuard)
                    guard = free[0] ?? null;
            }
        }
        else
            guard = free[0] ?? null;
        const jamTaken = new Set();
        for (const m of this.mem.values())
            if (m.job && m.job.k === 'jam')
                jamTaken.add(m.job.c);
        for (const k of free) {
            const m = this.memOf(k.id);
            const j = m.job;
            if (k === guard) {
                if (j && j.k === 'jam')
                    m.job = null;
                this.assignPark(k, occupied);
                continue;
            }
            if (j && j.k === 'jam')
                continue;
            const jt = this.bestJam(k, jamTaken);
            if (jt) {
                const nj = this.mkJob('jam', jt.n, jt.eta, 0, 50);
                nj.s = jt.s;
                this.setJob(k, nj);
                jamTaken.add(jt.n);
            }
            else
                this.assignPark(k, occupied);
        }
    }
    assignPark(k, occupied) {
        const m = this.memOf(k.id);
        const cur = m.job;
        const mineOrFree = (c) => {
            const o = occupied.get(c);
            return o === undefined || o === k.id;
        };
        if (cur && cur.k === 'park' && this.myN.has(cur.c) && mineOrFree(cur.c) && this.t - cur.since < 60) {
            occupied.set(cur.c, k.id);
            return;
        }
        const post = this.guardPost(k, occupied);
        if (post < 0)
            return;
        if (cur && cur.k === 'park' && cur.c !== post && cdist(cur.c, post) <= 3 && this.myN.has(cur.c) && mineOrFree(cur.c)) {
            cur.since = this.t;
            occupied.set(cur.c, k.id);
            return;
        }
        const F = this.field(cidx(k.q, k.r), false);
        this.setJob(k, this.mkJob('park', post, F.d[post], 0, 20));
        occupied.set(post, k.id);
    }
    guardPost(k, occupied) {
        const kc = cidx(k.q, k.r);
        const ok = (c) => {
            const oc = occupied.get(c);
            if (oc !== undefined && oc !== k.id)
                return false;
            const o = this.unitAt.get(c);
            return o === undefined || o === k.id;
        };
        if (this.contract)
            for (const c of this.contract.cells)
                if (this.myLit.has(c) && ok(c))
                    return c;
        const list = [];
        for (const c of this.myLit) {
            const b = this.needles.get(c);
            if (b && !b.start && ok(c))
                list.push(c);
        }
        if (!list.length)
            return -1;
        if (this.t - this.threatAt < 80 && this.threatCell >= 0) {
            let best = -1;
            let bd = INF;
            for (const c of list) {
                const d = cdist(c, this.threatCell) * 10 + cdist(c, kc) * 0.1;
                if (d < bd) {
                    bd = d;
                    best = c;
                }
            }
            return best;
        }
        let best = -1;
        let bd = INF;
        for (const c of list) {
            let s = 0;
            for (const x of list)
                s += cdist(c, x);
            s += cdist(c, kc) * 0.05;
            if (s < bd) {
                bd = s;
                best = c;
            }
        }
        return best;
    }
    bestJam(k, exclude) {
        const t = this.t;
        const kc = cidx(k.q, k.r);
        const F = this.field(kc, false);
        let best = null;
        let bestRate = 0.003;
        for (const b of this.needles.values()) {
            if (b.owner === null || b.owner === this.slot || b.start || b.dark || this.myN.has(b.c))
                continue;
            if (exclude.has(b.c))
                continue;
            const keeper = b.owner === 'K';
            if (keeper && (this.dawn || t >= this.dawnAt - 3))
                continue;
            if ((this.jamBan.get(b.c) ?? -1) > t)
                continue;
            if (!keeper && t - b.seen > 200)
                continue;
            let s = -1;
            let sd = INF;
            for (let q = 0; q < 6; q++) {
                const x = this.nbr[b.c * 6 + q];
                if (x < 0 || !this.pass[x])
                    continue;
                if (keeper && cdist(x, this.center) <= this.cherta)
                    continue;
                const o = this.unitAt.get(x);
                if (o !== undefined && o !== k.id)
                    continue;
                if (this.foeAt.has(x))
                    continue;
                const d = F.d[x];
                if (d < sd) {
                    sd = d;
                    s = x;
                }
            }
            if (s < 0 || sd > 60)
                continue;
            if (F.oz[s] > this.autonomy + 15)
                continue;
            const mult = b.ring ? this.ringMultNow() : 1;
            const w = this.wArr(mult);
            const a = actIdx(b.owner);
            const gm = this.delta(b.c, w, a, w);
            let v = gm + (keeper ? 0 : (this.wOpp[a] ?? 0) * this.lastOpp);
            if (this.supported(b.c))
                v += 0.03;
            const H = Math.max(0, Math.min(300, (keeper ? this.dawnAt : this.T) - t - sd));
            const rate = (v * H) / (sd + H + 1);
            if (rate > bestRate) {
                bestRate = rate;
                best = { n: b.c, s, eta: sd };
            }
        }
        return best;
    }
    /* ------------------------------------------------------------ commands */
    unitCost(u) {
        return this.chanOrder * (inGrid(u.q, u.r) && this.stormed(cidx(u.q, u.r)) ? this.stormMul : 1);
    }
    mv(u, c, home) {
        return { kind: 'move', unit: u.id, q: cq(c), r: cr(c), goal: null, home };
    }
    enRoute(u, m, dest) {
        return !!u.task && u.task.path > 0 && m.cmdK === 'move' && m.cmdDest === dest;
    }
    /* the unit dropped its path short of the commanded cell: a body blocked it */
    gaveUp(u, m) {
        if (m.cmdT < 0 || m.cmdC < 0 || !this.isIdle(u))
            return false;
        if (m.cmdK !== 'move' && m.cmdK !== 'needle' && m.cmdK !== 'feed')
            return false;
        return inGrid(u.q, u.r) && cidx(u.q, u.r) !== m.cmdC;
    }
    unitCommands(obs) {
        const t = obs.t;
        for (const u of obs.mine.units) {
            const m = this.mem.get(u.id);
            if (!m || !m.job)
                continue;
            const j = m.job;
            if (!inGrid(u.q, u.r))
                continue;
            const uc = cidx(u.q, u.r);
            const can = this.canCmd(u);
            const acting = this.isActing(u);
            const cost = this.unitCost(u);
            const hands = acting ? 0 : this.chanTick;
            const push = (orders, kind, cell, c, h, dest = cell) => {
                this.cmds.push({ orders, prio: j.prio, cost: c, hands: h, unit: u.id, kind, cell, lot: -1, cls: null, dest });
            };
            const blocked = this.gaveUp(u, m);
            switch (j.k) {
                case 'heat':
                case 'park':
                case 'stage':
                case 'cache':
                case 'home': {
                    const dest = j.k === 'stage' ? j.s : j.c;
                    if (dest < 0)
                        break;
                    if (uc === dest) {
                        if ((j.k === 'park' || j.k === 'stage') && !this.isIdle(u) && can)
                            push([{ kind: 'halt', unit: u.id }], 'halt', dest, 0, 0);
                        break;
                    }
                    if (!can)
                        break;
                    if (this.enRoute(u, m, dest))
                        break;
                    let tgt = dest;
                    if (blocked || m.fails >= 2)
                        tgt = this.detour(u, dest);
                    else if (m.wpUntil > t)
                        tgt = this.waypoint(u, dest);
                    const home = u.cls === KL && this.zone[tgt] === 1;
                    push([this.mv(u, tgt, home)], 'move', tgt, cost, hands, dest);
                    break;
                }
                case 'build': {
                    if (u.task && u.task.site && cidx(u.task.site.q, u.task.site.r) === j.c)
                        break;
                    if (!can)
                        break;
                    if ((blocked || (m.wpUntil > t && cdist(uc, j.c) > 6)) && cdist(uc, j.c) > 1) {
                        if (this.enRoute(u, m, j.c))
                            break;
                        const tgt = blocked ? this.detour(u, j.c) : this.waypoint(u, j.c);
                        if (tgt !== j.c) {
                            push([this.mv(u, tgt, false)], 'move', tgt, cost, hands, j.c);
                            break;
                        }
                    }
                    if (this.enRoute(u, m, j.c))
                        break;
                    push([{ kind: 'needle', unit: u.id, q: cq(j.c), r: cr(j.c) }], 'needle', j.c, cost, hands);
                    break;
                }
                case 'feed': {
                    if (u.task && u.task.feed && cidx(u.task.feed.q, u.task.feed.r) === j.c)
                        break;
                    if (!can)
                        break;
                    push([{ kind: 'feed', unit: u.id, q: cq(j.c), r: cr(j.c) }], 'feed', j.c, cost, hands);
                    break;
                }
                case 'ram': {
                    if (u.task && u.task.ram === j.tgt)
                        break;
                    if (!can || !this.foes.has(j.tgt))
                        break;
                    push([{ kind: 'ram', unit: u.id, target: j.tgt }], 'ram', -1, cost, hands);
                    break;
                }
                case 'jam': {
                    const tj = u.task && u.task.jam ? cidx(u.task.jam.q, u.task.jam.r) : -1;
                    if (tj === j.c)
                        break;
                    const b = this.needles.get(j.c);
                    const keeper = !!b && b.owner === 'K';
                    const tgtHex = { q: cq(j.c), r: cr(j.c) };
                    if (cdist(uc, j.c) <= 1 && (!keeper || cdist(uc, this.center) > this.cherta)) {
                        if (!can)
                            break;
                        push([{ kind: 'jam', unit: u.id, target: tgtHex, hold: true }], 'jam', j.c, 0, (acting ? 0 : this.chanTick) + this.jamStart);
                        break;
                    }
                    if (!can || j.s < 0)
                        break;
                    if (this.enRoute(u, m, j.s))
                        break;
                    const hop = blocked || m.fails >= 2 ? this.detour(u, j.s) : j.s;
                    const ord = [this.mv(u, hop, this.zone[hop] === 1)];
                    if (!keeper)
                        ord.push({ kind: 'jam', unit: u.id, target: tgtHex, hold: false });
                    push(ord, 'move', hop, cost, hands, j.s);
                    break;
                }
                default:
                    break;
            }
        }
    }
    /* ------------------------------------------------------------ bidding */
    planBidsPre(obs) {
        const t = obs.t;
        this.bidReserve = 0;
        this.bidPlan = [];
        const heating = new Set();
        for (const u of obs.mine.units) {
            if (u.cls !== TK || !inGrid(u.q, u.r))
                continue;
            heating.add(cidx(u.q, u.r));
        }
        for (let i = 0; i < this.lots.length; i++) {
            const L = this.lots[i];
            const dt = L.at - t;
            if (dt < 1 || dt > 10)
                continue;
            if (L.at >= this.dawnAt)
                continue;
            let nLink = 0;
            for (const c of L.cells) {
                const b = this.needles.get(c);
                if (!b || b.owner !== null || this.myN.has(c) || heating.has(c))
                    continue;
                if (this.linkTo(c, this.nodes))
                    nLink++;
            }
            if (!nLink)
                continue;
            const amount = 45 + 55 * nLink;
            this.bidReserve += amount;
            this.bidPlan.push({ lot: i, amount, dt });
        }
    }
    planBids(obs) {
        for (const bp of this.bidPlan) {
            if (bp.dt > 2)
                continue;
            if (this.bidSent.has(bp.lot))
                continue;
            const amt = Math.min(bp.amount, Math.floor(obs.pulse.energy) - 1);
            if (amt < this.costNeedle + 1)
                continue;
            this.cmds.push({
                orders: [{ kind: 'bid', lot: bp.lot, amount: Math.max(0, Math.floor(amt)) }],
                prio: 70,
                cost: this.chanOrder * (this.hearth >= 0 && this.stormed(this.hearth) ? this.stormMul : 1),
                hands: 0,
                unit: '',
                kind: 'bid',
                cell: -1,
                lot: bp.lot,
                cls: null,
                dest: -1,
            });
        }
    }
    /* ------------------------------------------------------------ scans */
    planScan(obs) {
        const t = obs.t;
        const ear = obs.pulse.ear;
        if (ear < this.scanCost)
            return;
        let best = -1;
        let bestS = 0;
        const consider = (c, w) => {
            const b = this.needles.get(c);
            const age = b ? Math.min(120, t - b.seen) : 60;
            const s = w * age;
            if (s > bestS) {
                bestS = s;
                best = c;
            }
        };
        if (this.contract)
            for (const c of this.contract.need)
                consider(c, 6);
        for (const m of this.mem.values()) {
            const j = m.job;
            if (j && j.k === 'heat') {
                const b = this.needles.get(j.c);
                consider(j.c, b && b.owner === null ? 1.5 : 3);
            }
        }
        for (const b of this.needles.values()) {
            if (b.owner === null || b.owner === this.slot || b.owner === 'K' || this.myN.has(b.c))
                continue;
            if (this.nearD[b.c] <= 6)
                consider(b.c, 1);
        }
        if (t >= this.dawnAt - 15 && t <= this.dawnAt + 30) {
            for (const m of this.mem.values())
                if (m.job && (m.job.k === 'stage' || m.job.tag === 'dawn'))
                    consider(m.job.c, 2);
        }
        for (const L of this.lots) {
            if (L.at - t > 0 && L.at - t <= 25)
                for (const c of L.cells)
                    consider(c, 2);
        }
        if (best < 0 || bestS < 40)
            return;
        if (this.stormed(best) && ear < this.scanCost * this.stormMul)
            return;
        this.cmds.push({
            orders: [{ kind: 'scan', q: cq(best), r: cr(best), rad: this.scanRad }],
            prio: 15,
            cost: 0,
            hands: 0,
            unit: '',
            kind: 'scan',
            cell: best,
            lot: -1,
            cls: null,
            dest: -1,
        });
    }
    /* ------------------------------------------------------------ frame */
    assemble(obs) {
        const t = obs.t;
        const B = obs.pulse.chan;
        const cap = Math.max(1, Math.floor(obs.pulse.chanAt / Math.max(1, this.chanOrder)) + 4);
        const cmdUnits = new Set();
        for (const c of this.cmds)
            if (c.unit)
                cmdUnits.add(c.unit);
        let actingBase = 0;
        for (const u of obs.mine.units)
            if (!cmdUnits.has(u.id) && this.isActing(u))
                actingBase++;
        const sorted = this.cmds.slice().sort((a, b) => b.prio - a.prio);
        const out = [];
        const sent = [];
        let spend = 0;
        const gap = t - this.lastAccept;
        if (gap >= 3) {
            /* keepalive: the slot stays ours only with an accepted command every 6 ticks */
            const idle = obs.mine.units.find((u) => this.isIdle(u) && !cmdUnits.has(u.id));
            let held = false;
            if (idle && B >= this.chanOrder) {
                out.push({ kind: 'halt', unit: idle.id });
                sent.push({ unit: idle.id, kind: 'halt', cell: -1, lot: -1, cls: null });
                held = gap < 4;
            }
            if (!held && gap < 4 && !sorted.some((c) => c.kind === 'scan') && obs.pulse.ear >= this.scanCost * 2 && this.hearth >= 0) {
                out.push({ kind: 'scan', q: cq(this.hearth), r: cr(this.hearth), rad: 0 });
                sent.push({ unit: '', kind: 'scan', cell: this.hearth, lot: -1, cls: null });
                held = true;
            }
            if (!held && (gap >= 4 || !sorted.length) && B >= this.chanOrder) {
                const h = this.hearth >= 0 ? this.hearth : cidx(0, 0);
                out.push({ kind: 'watch', q: cq(h), r: cr(h), keep: 0 });
                sent.push({ unit: '', kind: 'watch', cell: h, lot: -1, cls: null });
                spend += this.chanOrder;
            }
        }
        for (const c of sorted) {
            if (out.length + c.orders.length > cap)
                continue;
            const add = c.cost + c.hands;
            if (out.length > 0 && c.prio < 90 && spend + add + this.chanTick * actingBase > B)
                continue;
            if (c.cost > 0 && spend + c.cost > B)
                continue;
            for (const o of c.orders) {
                out.push(o);
                sent.push({ unit: c.unit, kind: c.kind, cell: c.cell, lot: c.lot, cls: c.cls });
            }
            spend += add;
            if (c.kind === 'yard' && c.cls)
                this.pendingYard.push({ cls: c.cls, t });
            if (c.kind === 'bid')
                this.bidSent.set(c.lot, t);
            if (c.unit && (c.kind === 'move' || c.kind === 'needle' || c.kind === 'feed' || c.kind === 'ram')) {
                const m = this.memOf(c.unit);
                if (m.cmdC === c.cell && m.cmdK === c.kind)
                    m.fails++;
                m.cmdT = t;
                m.cmdC = c.cell;
                m.cmdK = c.kind;
                m.cmdDest = c.dest;
            }
        }
        this.sent = sent;
        return out;
    }
    onDeny(s, code) {
        const t = this.t;
        if (s.kind === 'yard') {
            for (let i = this.pendingYard.length - 1; i >= 0; i--) {
                const p = this.pendingYard[i];
                if (p.t === t && p.cls === s.cls) {
                    this.pendingYard.splice(i, 1);
                    break;
                }
            }
            return;
        }
        if (s.kind === 'bid') {
            this.bidSent.delete(s.lot);
            return;
        }
        if (!s.unit)
            return;
        const m = this.mem.get(s.unit);
        if (!m)
            return;
        if (s.kind === 'move' || s.kind === 'needle' || s.kind === 'feed' || s.kind === 'ram') {
            m.cmdC = -1;
            m.cmdK = '';
            m.cmdDest = -1;
        }
        const j = m.job;
        switch (code) {
            case 12:
                m.wpUntil = t + 25;
                m.fails++;
                break;
            case 11:
            case 13:
            case 21:
                if (j) {
                    if (j.k === 'jam')
                        this.jamBan.set(j.c, t + 150);
                    else
                        this.ban.set(s.cell >= 0 ? s.cell : j.c, t + 120);
                    if (j.k !== 'ram')
                        m.job = null;
                }
                break;
            case 3:
            case 16:
            case 17:
            case 18:
                m.job = null;
                break;
            default:
                break;
        }
    }
}
/* names of the head's presets: one head, one name */
export function presets() {
    return ['зоря'];
}
export function createStrategy(preset = 'зоря') {
    void preset;
    return new ZoriaHead();
}
