/* zoria :: strategy "Mesh"

   Economy first, then a defended mesh:
   - opening: a Klinok runs to a cache we can win the race for (+150 energy),
     otherwise a Tkach goes out first; then Tkachs up to the target count;
   - every Tkach is sent to the job with the best minutes-per-tick return:
     free ruins, built needles, contract needles, enemy dark needles, the
     Keeper's ring after dawn; sites are scored by the marginal pull gain on
     the cell map (saturation, contested share, crown mesh, unlocked ruins);
   - spare Tkachs feed the needle where the extra ring adds most;
   - Klinoks guard the network and ram intruding Tkachs (a ram on a working
     Tkach is clean), one may jam frontier needles of an enemy;
   - energy goes into units, needles and lot bids (second-price: bid value);
   - never silent: a cheap accepted command at least every 4 ticks;
   - safety net: any internal failure falls back to an SDK mirror head. */
import { createEngine } from '@zoria/engine';
import { RulesOracle, sampleBot } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeOrders, decodeVerdicts, encodeOrders } from '@zoria/protocol';
/* ------------------------------------------------------------------ */
/* constants and small helpers                                         */
/* ------------------------------------------------------------------ */
const OFF = 19;
const WID = 39;
const NCELL = WID * WID;
const INF = 1 << 28;
const TK = 'ткач';
const KL = 'клинок';
const idxOf = (q, r) => (q + OFF) * WID + (r + OFF);
const inRange = (q, r) => q >= -OFF && q <= OFF && r >= -OFF && r <= OFF;
const hexd = (aq, ar, bq, br) => {
    const dq = aq - bq;
    const dr = ar - br;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/* neighbour directions */
const DQ = [1, 1, 0, -1, -1, 0];
const DR = [0, -1, -1, 0, 1, 1];
/* offsets of a hex disk of radius 4 with their distances */
const OQ = [];
const OR = [];
const OD = [];
for (let dq = -4; dq <= 4; dq++) {
    for (let dr = -4; dr <= 4; dr++) {
        const d = hexd(0, 0, dq, dr);
        if (d <= 4) {
            OQ.push(dq);
            OR.push(dr);
            OD.push(d);
        }
    }
}
/* fallback terrain tables, in the wire dictionary order:
   bare, meadow, wood, sand, marsh, hill, water, mountain */
const FB_VAL = [2, 3, 2, 1, 1, 1, 0, 0];
const FB_STEP = [1, 1, 1, 1, 2, 2, 1, 1];
const FB_PASS = [1, 1, 1, 1, 1, 1, 0, 0];
const PRESETS = {
    mesh: { tkach: 3, klinok: 2, raid: true, hunt: true, attack: true, cont: 0.5 },
    calm: { tkach: 3, klinok: 2, raid: false, hunt: true, attack: false, cont: 0.25 },
    hard: { tkach: 3, klinok: 2, raid: true, hunt: true, attack: true, cont: 0.8 },
};
export function presets() {
    return Object.keys(PRESETS);
}
/* ------------------------------------------------------------------ */
/* the bot                                                             */
/* ------------------------------------------------------------------ */
class Zoria {
    knobs;
    ok = false;
    man = null;
    slot = 'A';
    me = 'A';
    oracle = null;
    mirror = null;
    lastSource = 'none';
    consecFaults = 0;
    faults = 0;
    /* config numbers */
    K = {
        link: 5,
        costT: 90,
        costK: 50,
        costN: 60,
        stepT: 2,
        stepK: 1,
        rise: 1,
        squad: 8,
        heatN: 8,
        heatE: 24,
        heatD: 16,
        build: 8,
        rate: 0.0005,
        ringPull: 1.25,
        dawnRing: 2,
        chan: 32,
        hands: 32,
        grace: 60,
        orderBonus: 30,
        hold: 12,
        feedRing: 1,
        ticks: 1200,
    };
    tend = 1200;
    dawnAt = 1000;
    cherta = 6;
    /* grid */
    valid = new Uint8Array(NCELL);
    qOf = new Int8Array(NCELL);
    rOf = new Int8Array(NCELL);
    val = new Float32Array(NCELL);
    pass = new Uint8Array(NCELL);
    bld = new Uint8Array(NCELL);
    lvl = new Int16Array(NCELL);
    tmul = new Uint8Array(NCELL);
    hill = new Uint8Array(NCELL);
    mount = new Uint8Array(NCELL);
    nbr = new Int16Array(NCELL * 6).fill(-1);
    ecT = new Int16Array(NCELL * 6);
    ecK = new Int16Array(NCELL * 6);
    cells = [];
    wN = [1, 1, 2 / 3, 1 / 3, 0];
    wF = [1, 1, 1, 2 / 3, 1 / 3];
    wD = [0, 0, 1 / 3, 1 / 3, 1 / 3];
    /* world memory */
    spec = new Map();
    known = new Map();
    ruinList = [];
    finds = new Map();
    deadCells = new Set();
    stills = [];
    seats = [];
    rivals = [];
    hearth = -1;
    citadel = idxOf(0, 0);
    rivalDistK = [];
    linkMemo = new Map();
    /* per-tick */
    t = 0;
    units = [];
    prevIds = new Set();
    myPull = new Float32Array(NCELL);
    foePull = new Float32Array(NCELL);
    humPull = new Float32Array(NCELL);
    linkSrc = [];
    lit = 0;
    crownOn = false;
    dawnOn = false;
    energy = 0;
    reserve = 0;
    out = [];
    avail = 0;
    cap = 8;
    needKeep = false;
    active = new Set();
    distCache = new Map();
    foeSeen = new Map();
    myN = new Map();
    /* long-lived */
    jobs = new Map();
    penal = new Map();
    ramBan = new Map();
    pending = [];
    bids = new Map();
    lastCmds = [];
    lastAcceptT = 0;
    cachePlan = -1;
    stations = new Map();
    raidAt = 0;
    bn = 0;
    bOwn = new Map();
    bDark = new Map();
    constructor(preset) {
        this.knobs = PRESETS[preset] ?? PRESETS['mesh'];
    }
    /* ---------------------------------------------------------------- */
    /* wire contract                                                     */
    /* ---------------------------------------------------------------- */
    init(manifestBytes, slot) {
        this.slot = slot;
        this.me = slot;
        try {
            this.initWorld(manifestBytes, slot);
            this.ok = true;
        }
        catch {
            this.ok = false;
        }
        try {
            const m = sampleBot(createEngine, 'рівний');
            m.init(manifestBytes, slot);
            this.mirror = m;
        }
        catch {
            this.mirror = null;
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
        let mout = null;
        if (this.mirror) {
            try {
                mout = this.mirror.tick(observeBytes);
            }
            catch {
                mout = null;
            }
        }
        let orders = null;
        if (obs && this.ok) {
            try {
                orders = this.plan(obs);
                this.consecFaults = 0;
            }
            catch {
                this.faults++;
                this.consecFaults++;
                orders = null;
            }
        }
        if (orders === null) {
            /* internal failure: a keepalive for a few ticks, then the mirror head */
            if (mout && mout.length > 0 && (this.consecFaults >= 3 || !this.ok || !obs)) {
                this.lastSource = 'mirror';
                try {
                    const dec = decodeOrders(mout);
                    this.lastCmds = dec ?? [];
                }
                catch {
                    this.lastCmds = [];
                }
                return mout;
            }
            orders = [];
            if (obs)
                this.t = obs.t;
            this.keepaliveFront(orders);
        }
        this.lastSource = 'own';
        const clean = this.sanitize(orders);
        this.lastCmds = clean;
        try {
            return encodeOrders(clean);
        }
        catch {
            this.lastCmds = [];
            return encodeOrders([]);
        }
    }
    feedback(verdictBytes) {
        try {
            if (this.lastSource === 'mirror' && this.mirror) {
                this.mirror.feedback(verdictBytes);
                return;
            }
            const vs = decodeVerdicts(verdictBytes);
            if (!vs)
                return;
            for (const v of vs) {
                const i = v[0];
                const ok = v[1];
                const code = v[2];
                if (ok) {
                    this.lastAcceptT = this.t;
                    const o = this.lastCmds[i];
                    if (o && o.kind === 'bid') {
                        const st = this.bids.get(o.lot);
                        if (st)
                            st.ok = true;
                    }
                    continue;
                }
                const o = this.lastCmds[i];
                if (o)
                    this.denied(o, code);
            }
        }
        catch {
            /* nothing: verdicts are a hint only */
        }
    }
    belief(obs) {
        try {
            if (!obs)
                return null;
            const frame = {
                t: obs.t,
                pulse: {
                    energy: obs.pulse.energy,
                    chan: obs.pulse.chan,
                    ear: obs.pulse.ear,
                    minutes: obs.pulse.minutes,
                    needles: obs.pulse.needles,
                },
            };
            const full = this.bn % 200 === 0;
            this.bn++;
            const own = {};
            const dark = {};
            const seen = new Set();
            let any = false;
            let anyD = false;
            for (const info of this.known.values()) {
                const key = info.q + ',' + info.r;
                seen.add(key);
                const o = info.owner;
                if (full || this.bOwn.get(key) !== o) {
                    own[key] = o;
                    any = true;
                }
                if (full || this.bDark.get(key) !== info.dark) {
                    dark[key] = info.dark;
                    anyD = true;
                }
                this.bOwn.set(key, o);
                this.bDark.set(key, info.dark);
            }
            if (full)
                frame.full = true;
            if (any)
                frame.own = own;
            if (anyD)
                frame.dark = dark;
            if (obs.foe.length)
                frame.foe = obs.foe.map((f) => [f.id, f.p, f.q, f.r]);
            frame.noisy = obs.noisy.length;
            if (obs.mine.units.length) {
                frame.units = obs.mine.units.map((u) => [u.id, u.q, u.r, u.task ? u.task.path : 0]);
            }
            const act = obs.pub.pact.active.find((p) => p.a === this.slot || p.b === this.slot);
            frame.pact = act ? (act.a === this.slot ? act.b : act.a) : null;
            if (obs.pub.cries.length)
                frame.cries = obs.pub.cries.map((c) => [c[0], c[1]]);
            return frame;
        }
        catch {
            return null;
        }
    }
    /* ---------------------------------------------------------------- */
    /* static world                                                      */
    /* ---------------------------------------------------------------- */
    initWorld(bytes, slot) {
        const m = decodeManifest(bytes);
        if (!m)
            throw new Error('manifest');
        this.man = m;
        const cfg = m.cfg;
        const num = (k, d) => {
            const v = cfg[k];
            return typeof v === 'number' && Number.isFinite(v) ? v : d;
        };
        const K = this.K;
        K.link = num('linkRange', 5);
        K.costT = num('costTkach', 90);
        K.costK = num('costKlinok', 50);
        K.costN = num('costNeedle', 60);
        K.stepT = num('stepTkach', 2);
        K.stepK = num('stepKlinok', 1);
        K.rise = num('stepRise', 1);
        K.squad = num('squadWeight', 8);
        K.heatN = num('heatNeedle', 8);
        K.heatE = num('heatEnemy', 24);
        K.heatD = num('heatDark', 16);
        K.build = num('buildTicks', 8);
        K.rate = num('minuteRate', 0.0005);
        K.ringPull = num('ringPull', 1.25);
        K.dawnRing = num('dawnRing', 2);
        K.chan = num('chanOrder', 32);
        K.hands = num('chanTick', 32);
        K.grace = num('capGrace', 60);
        K.orderBonus = num('orderBonus', 30);
        K.hold = num('orderHoldTicks', 12);
        K.feedRing = num('feedRing', 1);
        this.tend = m.ticks > 0 ? m.ticks : 1200;
        this.dawnAt = m.dawn && m.dawn.at > 0 ? m.dawn.at : 1000;
        this.cherta = m.cherta > 0 ? m.cherta : 6;
        this.citadel = idxOf(m.citadel.q, m.citadel.r);
        /* ring weights */
        const rw = m.rings;
        if (Array.isArray(rw) && rw.length >= 4 && rw.every((x) => typeof x === 'number')) {
            this.wN = [rw[0], rw[1], rw[2], rw[3], 0];
        }
        const fr = Math.max(0, Math.round(K.feedRing));
        this.wF = [0, 1, 2, 3, 4].map((d) => this.wN[Math.max(0, d - fr)]);
        this.wD = [0, 1, 2, 3, 4].map((d) => this.wF[d] - this.wN[d]);
        /* grid */
        const ordered = [];
        for (let r = -OFF; r <= OFF; r++) {
            for (let q = -OFF; q <= OFF; q++) {
                if (hexd(0, 0, q, r) > OFF)
                    continue;
                const i = idxOf(q, r);
                this.valid[i] = 1;
                this.qOf[i] = q;
                this.rOf[i] = r;
                ordered.push(i);
            }
        }
        this.cells = ordered;
        const lv = m.levels;
        if (Array.isArray(lv) && lv.length === ordered.length) {
            for (let k = 0; k < ordered.length; k++)
                this.lvl[ordered[k]] = lv[k] ?? 0;
        }
        for (const i of ordered) {
            const q = this.qOf[i];
            const r = this.rOf[i];
            for (let d = 0; d < 6; d++) {
                const nq = q + DQ[d];
                const nr = r + DR[d];
                if (inRange(nq, nr) && this.valid[idxOf(nq, nr)])
                    this.nbr[i * 6 + d] = idxOf(nq, nr);
            }
        }
        /* terrain */
        const types = m.terrain.types;
        let useM = false;
        if (types.length >= 8) {
            const mar = types[4];
            const mea = types[1];
            if (mar && mea && mar.cost === 2 && mar.min === 1 && mea.min === 3)
                useM = true;
        }
        const tt = new Int8Array(NCELL);
        for (const c of m.terrain.cells) {
            const q = c[0];
            const r = c[1];
            if (!inRange(q, r))
                continue;
            const i = idxOf(q, r);
            if (this.valid[i])
                tt[i] = c[2];
        }
        for (const i of ordered) {
            const t = tt[i];
            const ty = useM ? types[t] : undefined;
            this.val[i] = ty ? ty.min : (FB_VAL[t] ?? 0);
            this.pass[i] = ty ? (ty.pass ? 1 : 0) : (FB_PASS[t] ?? 0);
            this.bld[i] = ty ? (ty.build ? 1 : 0) : (FB_PASS[t] ?? 0);
            this.tmul[i] = ty ? Math.max(1, Math.round(ty.cost)) : (FB_STEP[t] ?? 1);
            this.hill[i] = t === 5 ? 1 : 0;
            this.mount[i] = t === 7 ? 1 : 0;
        }
        /* edge costs per class */
        for (const i of ordered) {
            for (let d = 0; d < 6; d++) {
                const j = this.nbr[i * 6 + d];
                if (j < 0 || !this.pass[j])
                    continue;
                const rise = this.lvl[j] - this.lvl[i];
                if (rise >= 2)
                    continue;
                const up = rise > 0 ? K.rise * rise : 0;
                this.ecT[i * 6 + d] = K.stepT * this.tmul[j] + up;
                this.ecK[i * 6 + d] = K.stepK * this.tmul[j] + up;
            }
        }
        /* needles of the manifest */
        for (const s of m.needles) {
            if (!inRange(s.q, s.r))
                continue;
            const i = idxOf(s.q, s.r);
            if (!this.valid[i])
                continue;
            const start = s.start !== null && s.start !== undefined;
            const ring = !!(s.ring || s.spoke);
            this.spec.set(i, { start, ring });
            const owner = start ? s.start : ring ? 'K' : null;
            this.known.set(i, { q: s.q, r: s.r, owner, dark: false, start, ring, seen: 0, first: 0 });
            if (!start && !ring)
                this.ruinList.push(i);
        }
        /* finds */
        for (const f of m.finds) {
            if (!inRange(f.q, f.r))
                continue;
            const i = idxOf(f.q, f.r);
            if (f.kind === 'dead')
                this.deadCells.add(i);
            else if (f.kind === 'still')
                this.stills.push(i);
            else
                this.finds.set(i, f.kind);
        }
        this.seats = m.seats.map((s) => idxOf(s.q, s.r));
        /* oracle: exact link and storm geometry; optional */
        try {
            this.oracle = new RulesOracle(createEngine, bytes);
        }
        catch {
            this.oracle = null;
        }
        this.slot = slot;
    }
    ownLink(a, b) {
        const aq = this.qOf[a];
        const ar = this.rOf[a];
        const bq = this.qOf[b];
        const br = this.rOf[b];
        const d = hexd(aq, ar, bq, br);
        const lim = this.K.link + (this.hill[a] || this.hill[b] ? 1 : 0);
        if (d > lim)
            return false;
        /* walk the straight line, a mountain on it cuts the thread */
        for (let s = 1; s < d; s++) {
            const f = s / d;
            const x = aq + (bq - aq) * f;
            const z = ar + (br - ar) * f;
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
            if (inRange(rx, rz) && this.mount[idxOf(rx, rz)])
                return false;
        }
        return true;
    }
    link(a, b) {
        if (a === b)
            return false;
        const key = a < b ? a * 2048 + b : b * 2048 + a;
        const c = this.linkMemo.get(key);
        if (c !== undefined)
            return c;
        const aq = this.qOf[a];
        const ar = this.rOf[a];
        const bq = this.qOf[b];
        const br = this.rOf[b];
        let res;
        if (hexd(aq, ar, bq, br) > this.K.link + 1)
            res = false;
        else if (this.oracle) {
            try {
                res = !!this.oracle.linkOk({ q: aq, r: ar }, { q: bq, r: br });
            }
            catch {
                res = this.ownLink(a, b);
            }
        }
        else
            res = this.ownLink(a, b);
        this.linkMemo.set(key, res);
        return res;
    }
    ownStorm(q, r, t) {
        const m = this.man;
        if (!m)
            return false;
        for (const s of this.stills) {
            if (hexd(this.qOf[s], this.rOf[s], q, r) <= 1)
                return false;
        }
        const x = Math.sqrt(3) * (q + r / 2);
        const y = 1.5 * r;
        for (const s of m.storms) {
            const dx = x - (s.x0 + s.vx * t);
            const dy = y - (s.y0 + s.vy * t);
            if (Math.sqrt(dx * dx + dy * dy) < s.r)
                return true;
        }
        return false;
    }
    stormAt(i) {
        const q = this.qOf[i];
        const r = this.rOf[i];
        if (this.oracle) {
            try {
                return !!this.oracle.storm({ q, r }, this.t);
            }
            catch {
                /* fall through */
            }
        }
        return this.ownStorm(q, r, this.t);
    }
    /* cost of a command issued at a cell */
    ucost(i) {
        return this.K.chan * (this.stormAt(i) ? 2 : 1);
    }
    hcost() {
        return this.hearth >= 0 ? this.ucost(this.hearth) : this.K.chan;
    }
    dist(src, cls) {
        const D = new Int32Array(NCELL).fill(INF);
        if (src < 0 || !this.valid[src])
            return D;
        const ec = cls === 0 ? this.ecT : this.ecK;
        const buckets = [];
        D[src] = 0;
        buckets[0] = [src];
        let maxD = 0;
        for (let d = 0; d <= maxD; d++) {
            const b = buckets[d];
            if (!b)
                continue;
            for (let k = 0; k < b.length; k++) {
                const u = b[k];
                if (D[u] !== d)
                    continue;
                for (let e = 0; e < 6; e++) {
                    const c = ec[u * 6 + e];
                    if (c === 0)
                        continue;
                    const v = this.nbr[u * 6 + e];
                    const nd = d + c;
                    if (nd < D[v]) {
                        D[v] = nd;
                        let bb = buckets[nd];
                        if (!bb) {
                            bb = [];
                            buckets[nd] = bb;
                        }
                        bb.push(v);
                        if (nd > maxD)
                            maxD = nd;
                    }
                }
            }
        }
        return D;
    }
    distFor(u) {
        const key = u.id + (u.cls === TK ? 'T' : 'K') + ':' + u.q + ',' + u.r;
        let D = this.distCache.get(key);
        if (!D) {
            D = this.dist(idxOf(u.q, u.r), u.cls === TK ? 0 : 1);
            this.distCache.set(key, D);
        }
        return D;
    }
    /* ---------------------------------------------------------------- */
    /* per-tick: memory                                                  */
    /* ---------------------------------------------------------------- */
    ingest(obs) {
        const t = obs.t;
        this.t = t;
        this.energy = obs.pulse.energy;
        this.distCache.clear();
        if (obs.pub.dawn)
            this.dawnOn = true;
        /* own needles */
        this.myN.clear();
        for (const n of obs.mine.needles) {
            const i = idxOf(n.q, n.r);
            this.myN.set(i, { dark: n.dark, weight: n.weight, fed: n.fed });
        }
        /* hearth: the seat next to our starting needles */
        if (this.hearth < 0 && obs.mine.needles.length > 0 && this.man) {
            let best = -1;
            let bd = 99;
            for (const s of this.seats) {
                for (const n of obs.mine.needles) {
                    const d = hexd(this.qOf[s], this.rOf[s], n.q, n.r);
                    if (d < bd) {
                        bd = d;
                        best = s;
                    }
                }
            }
            if (best >= 0 && bd <= 2) {
                this.hearth = best;
                this.rivals = this.seats.filter((s) => s !== best);
                this.rivalDistK = this.rivals.map((s) => this.dist(s, 1));
            }
        }
        /* losses carry the new owner */
        for (const l of obs.mine.losts) {
            const i = idxOf(l.q, l.r);
            const info = this.touch(i, l.q, l.r);
            info.owner = l.owner;
            info.dark = l.dark;
            info.first = t;
            info.seen = t;
        }
        for (const [i, n] of this.myN) {
            const info = this.touch(i, this.qOf[i], this.rOf[i]);
            if (info.owner !== this.me)
                info.first = t;
            info.owner = this.me;
            info.dark = n.dark;
            info.seen = t;
        }
        for (const [i, info] of this.known) {
            if (info.owner === this.me && !this.myN.has(i))
                info.owner = null;
        }
        /* what the eyes see */
        for (const e of obs.own) {
            const i = idxOf(e.q, e.r);
            const info = this.touch(i, e.q, e.r);
            if (info.owner !== e.owner)
                info.first = info.seen > 0 || e.owner === null ? t : t - 30;
            info.owner = e.owner;
            info.dark = e.dark;
            info.seen = t;
        }
        /* events */
        for (const ev of obs.events) {
            switch (ev.type) {
                case 'find': {
                    if (inRange(ev.q, ev.r))
                        this.finds.delete(idxOf(ev.q, ev.r));
                    break;
                }
                case 'cap': {
                    if (inRange(ev.q, ev.r)) {
                        const info = this.touch(idxOf(ev.q, ev.r), ev.q, ev.r);
                        info.owner = ev.p;
                        info.first = t;
                        info.seen = t;
                    }
                    break;
                }
                case 'lot': {
                    const lot = this.man ? this.man.lots[ev.lot] : undefined;
                    if (lot && ev.p !== null) {
                        for (const h of lot.cells) {
                            if (!inRange(h.q, h.r))
                                continue;
                            const info = this.known.get(idxOf(h.q, h.r));
                            if (info && info.owner === null) {
                                info.owner = ev.p;
                                info.first = t;
                            }
                        }
                    }
                    break;
                }
                case 'dawn':
                    this.dawnOn = true;
                    break;
                default:
                    break;
            }
        }
        /* enemy units */
        for (const f of obs.foe) {
            if (f.p === this.me || f.p === 'K')
                continue;
            this.foeSeen.set(f.id, { p: f.p, cls: f.cls, q: f.q, r: f.r, t });
        }
        for (const [id, s] of this.foeSeen) {
            if (t - s.t > 12)
                this.foeSeen.delete(id);
        }
        /* units and the yard queue */
        this.units = obs.mine.units;
        const ids = new Set();
        for (const u of this.units) {
            ids.add(u.id);
            if (!this.prevIds.has(u.id)) {
                const k = this.pending.findIndex((p) => p.cls === u.cls);
                if (k >= 0)
                    this.pending.splice(k, 1);
            }
        }
        this.prevIds = ids;
        this.pending = this.pending.filter((p) => t - p.t <= 24);
        for (const id of [...this.jobs.keys()]) {
            if (!ids.has(id))
                this.jobs.delete(id);
        }
        for (const id of [...this.stations.keys()]) {
            if (!ids.has(id))
                this.stations.delete(id);
        }
    }
    touch(i, q, r) {
        let info = this.known.get(i);
        if (!info) {
            info = { q, r, owner: null, dark: false, start: false, ring: false, seen: 0, first: 0 };
            this.known.set(i, info);
        }
        return info;
    }
    inLine(i) {
        return !this.dawnOn && hexd(this.qOf[this.citadel], this.rOf[this.citadel], this.qOf[i], this.rOf[i]) <= this.cherta;
    }
    ringMult(i) {
        const sp = this.spec.get(i);
        if (!sp || !sp.ring)
            return 1;
        return this.dawnOn ? this.K.dawnRing : this.K.ringPull;
    }
    stamp(arr, i, w, fed) {
        const tab = fed ? this.wF : this.wN;
        const rad = fed ? 4 : 3;
        const q0 = this.qOf[i];
        const r0 = this.rOf[i];
        for (let k = 0; k < OQ.length; k++) {
            const d = OD[k];
            if (d > rad)
                continue;
            const q = q0 + OQ[k];
            const r = r0 + OR[k];
            if (!inRange(q, r))
                continue;
            const j = idxOf(q, r);
            if (!this.valid[j])
                continue;
            arr[j] = arr[j] + tab[d] * w;
        }
    }
    buildMaps(obs) {
        this.myPull.fill(0);
        this.foePull.fill(0);
        this.humPull.fill(0);
        this.linkSrc.length = 0;
        this.lit = 0;
        for (const n of obs.mine.needles) {
            const i = idxOf(n.q, n.r);
            if (n.weight > 0)
                this.stamp(this.myPull, i, n.weight * this.ringMult(i), n.fed);
            if (!n.dark && n.weight >= 0.99) {
                this.linkSrc.push(i);
                this.lit++;
            }
        }
        if (this.hearth >= 0)
            this.linkSrc.push(this.hearth);
        for (const [i, info] of this.known) {
            if (info.owner === null || info.owner === this.me || info.dark)
                continue;
            if (info.owner === 'K') {
                if (this.dawnOn)
                    continue;
                this.stamp(this.foePull, i, this.K.ringPull, false);
            }
            else {
                this.stamp(this.foePull, i, 1, false);
                this.stamp(this.humPull, i, 1, false);
            }
        }
        this.crownOn = obs.mine.needles.some((n) => n.weight > 1.0001);
    }
    /* captures and builds already under way count as ours with a discount */
    applyPending() {
        for (const j of this.jobs.values()) {
            if (j.kind !== 'heat' && j.kind !== 'build')
                continue;
            if (this.myN.has(j.cell))
                continue;
            const mult = (j.kind === 'heat' ? this.ringMult(j.cell) : 1) * 0.8;
            this.stamp(this.myPull, j.cell, mult, false);
            this.linkSrc.push(j.cell);
        }
    }
    /* per-tick minutes gained by adding the weights `tab` x mult around cell c;
       en > 0 - the enemy needle at c is taken over (its pull leaves) */
    gainCore(c, tab, mult, en, rad) {
        const q0 = this.qOf[c];
        const r0 = this.rOf[c];
        const CW = this.knobs.cont;
        let g = 0;
        for (let k = 0; k < OQ.length; k++) {
            const d = OD[k];
            if (d > rad)
                continue;
            const w0 = tab[d];
            if (w0 <= 0)
                continue;
            const q = q0 + OQ[k];
            const r = r0 + OR[k];
            if (!inRange(q, r))
                continue;
            const i = idxOf(q, r);
            if (!this.valid[i])
                continue;
            const v = this.val[i];
            if (v <= 0)
                continue;
            const w = w0 * mult;
            const wen = w0 * en;
            const m = this.myPull[i];
            const e = this.foePull[i];
            const h = this.humPull[i];
            const tot0 = m + e;
            const f0 = 1 / (tot0 > 1 ? tot0 : 1);
            const e1 = e - wen > 0 ? e - wen : 0;
            const h1 = h - wen > 0 ? h - wen : 0;
            const tot1 = m + w + e1;
            const f1 = 1 / (tot1 > 1 ? tot1 : 1);
            g += v * ((m + w) * f1 - m * f0 + CW * (h * f0 - h1 * f1));
        }
        return g * this.K.rate;
    }
    linkers(i) {
        const res = [];
        const q = this.qOf[i];
        const r = this.rOf[i];
        const lim = this.K.link + 1;
        for (const s of this.linkSrc) {
            if (hexd(q, r, this.qOf[s], this.rOf[s]) > lim)
                continue;
            if (this.link(i, s))
                res.push(s);
        }
        return res;
    }
    penalized(i) {
        return (this.penal.get(i) ?? 0) > this.t;
    }
    inZone(i) {
        if (this.myPull[i] > 0)
            return true;
        return this.hearth >= 0 && hexd(this.qOf[i], this.rOf[i], this.qOf[this.hearth], this.rOf[this.hearth]) <= this.K.link;
    }
    lam() {
        const left = this.tend - this.t - 100;
        const tf = Math.max(0, Math.min(1, left / 900));
        const e = this.energy;
        const ef = e < 120 ? 1 : e < 250 ? 0.5 : 0.1;
        return 0.12 * tf * ef;
    }
    /* ---------------------------------------------------------------- */
    /* per-tick: orders and budget                                       */
    /* ---------------------------------------------------------------- */
    isActive(u) {
        const k = u.task;
        if (k !== null && (k.path > 0 || k.site !== null || k.feed !== null || k.jam !== null || k.ram !== null || k.goal !== null)) {
            return true;
        }
        if (u.cls === TK) {
            const info = this.known.get(idxOf(u.q, u.r));
            if (info && info.owner !== this.me && !info.start)
                return true;
        }
        return false;
    }
    setBudget(obs) {
        this.active.clear();
        let act = 0;
        for (const u of obs.mine.units) {
            if (this.isActive(u)) {
                act++;
                this.active.add(u.id);
            }
        }
        this.avail = obs.pulse.chan - this.K.hands * act;
        this.needKeep = this.t - this.lastAcceptT >= 4;
        if (this.needKeep)
            this.avail -= this.K.chan;
        this.cap = Math.floor(obs.pulse.chanAt / this.K.chan) + 4;
        this.out = [];
    }
    issue(o, cost, hands) {
        if (this.out.length >= this.cap - 1)
            return false;
        if (this.avail < cost + hands)
            return false;
        if (cost === 0 && this.avail < this.K.chan)
            return false;
        this.avail -= cost + hands;
        this.out.push(o);
        return true;
    }
    orderable(u) {
        return !(u.task !== null && u.task.path > 0 && u.wait > 0);
    }
    idle(u) {
        const k = u.task;
        return k === null || (k.path === 0 && k.site === null && k.feed === null && k.jam === null && k.ram === null && k.goal === null);
    }
    extra(u) {
        return this.active.has(u.id) ? 0 : this.K.hands;
    }
    cmdMove(u, to, home) {
        const o = { kind: 'move', unit: u.id, q: this.qOf[to], r: this.rOf[to], goal: null, home };
        if (!this.issue(o, this.ucost(idxOf(u.q, u.r)), this.extra(u)))
            return false;
        this.active.add(u.id);
        return true;
    }
    cmdNeedle(u, to) {
        const o = { kind: 'needle', unit: u.id, q: this.qOf[to], r: this.rOf[to] };
        if (!this.issue(o, this.ucost(idxOf(u.q, u.r)), this.extra(u)))
            return false;
        this.active.add(u.id);
        return true;
    }
    cmdFeed(u, to) {
        const o = { kind: 'feed', unit: u.id, q: this.qOf[to], r: this.rOf[to] };
        if (!this.issue(o, this.ucost(idxOf(u.q, u.r)), this.extra(u)))
            return false;
        this.active.add(u.id);
        return true;
    }
    cmdRam(u, target) {
        const o = { kind: 'ram', unit: u.id, target };
        if (!this.issue(o, this.ucost(idxOf(u.q, u.r)), this.extra(u)))
            return false;
        this.active.add(u.id);
        return true;
    }
    cmdJam(u, to, hold) {
        const o = { kind: 'jam', unit: u.id, target: { q: this.qOf[to], r: this.rOf[to] }, hold };
        return this.issue(o, 0, 0);
    }
    keepaliveFront(orders) {
        if (this.t - this.lastAcceptT < 4)
            return;
        const h = this.hearth >= 0 ? this.hearth : this.seats.length ? this.seats[0] : idxOf(0, 0);
        orders.unshift({ kind: 'watch', q: this.qOf[h], r: this.rOf[h], keep: 0 });
    }
    sanitize(orders) {
        const res = [];
        for (const o of orders) {
            let good = true;
            switch (o.kind) {
                case 'yard':
                    good = o.cls === TK || o.cls === KL;
                    break;
                case 'move':
                case 'feed':
                case 'needle':
                    good = Number.isInteger(o.q) && Number.isInteger(o.r) && inRange(o.q, o.r) && o.unit.length >= 3 && o.unit.length <= 12;
                    break;
                case 'ram':
                    good = o.unit.length >= 3 && o.unit.length <= 12 && o.target.length >= 3 && o.target.length <= 12;
                    break;
                case 'jam':
                    good = o.unit.length >= 3 && o.unit.length <= 12 && (o.target === null || (Number.isInteger(o.target.q) && Number.isInteger(o.target.r)));
                    break;
                case 'halt':
                    good = o.unit.length >= 3 && o.unit.length <= 12;
                    break;
                case 'watch':
                    good = Number.isInteger(o.q) && Number.isInteger(o.r) && Number.isInteger(o.keep) && o.keep >= 0;
                    break;
                case 'bid':
                    good = Number.isInteger(o.lot) && o.lot >= 0 && Number.isInteger(o.amount) && o.amount >= 0;
                    break;
                default:
                    break;
            }
            if (good)
                res.push(o);
        }
        return res;
    }
    denied(o, code) {
        switch (o.kind) {
            case 'yard': {
                const k = this.pending.map((p) => p.cls).lastIndexOf(o.cls);
                if (k >= 0)
                    this.pending.splice(k, 1);
                break;
            }
            case 'move':
            case 'needle':
            case 'feed': {
                if (code === 11 || code === 12 || code === 13 || code === 21) {
                    if (inRange(o.q, o.r))
                        this.penal.set(idxOf(o.q, o.r), this.t + 45);
                    this.jobs.delete(o.unit);
                }
                break;
            }
            case 'ram': {
                if (code === 16 || code === 17) {
                    this.jobs.delete(o.unit);
                    this.ramBan.set(o.target, this.t + 12);
                }
                break;
            }
            case 'jam': {
                if (code === 18)
                    this.jobs.delete(o.unit);
                break;
            }
            case 'bid': {
                const st = this.bids.get(o.lot);
                if (st)
                    st.ok = false;
                break;
            }
            default:
                break;
        }
    }
    /* ---------------------------------------------------------------- */
    /* the plan of a tick                                                */
    /* ---------------------------------------------------------------- */
    guard(fn) {
        try {
            fn();
        }
        catch {
            this.faults++;
        }
    }
    plan(obs) {
        this.lastObs = obs;
        this.ingest(obs);
        this.setBudget(obs);
        this.reserve = 0;
        this.guard(() => this.buildMaps(obs));
        this.guard(() => this.applyPending());
        this.guard(() => this.planBids(obs));
        this.guard(() => this.planYard(obs));
        this.guard(() => this.planKlinoks(obs));
        this.guard(() => this.planTkachs(obs));
        if (this.needKeep) {
            const h = this.hearth >= 0 ? this.hearth : idxOf(0, 0);
            this.out.unshift({ kind: 'watch', q: this.qOf[h], r: this.rOf[h], keep: 0 });
        }
        return this.out;
    }
    /* ---------------------------------------------------------------- */
    /* bids                                                              */
    /* ---------------------------------------------------------------- */
    lotBid(lot) {
        const H = this.tend - lot.at;
        if (H <= 40)
            return 0;
        const cs = [];
        for (const h of lot.cells) {
            if (!inRange(h.q, h.r))
                continue;
            const i = idxOf(h.q, h.r);
            const info = this.known.get(i);
            if (!info || info.owner !== null)
                continue;
            cs.push(i);
        }
        if (cs.length === 0)
            return 0;
        const linked = cs.map((i) => this.linkers(i).length > 0);
        for (let a = 0; a < cs.length; a++) {
            if (linked[a])
                continue;
            for (let b = 0; b < cs.length; b++) {
                if (a !== b && linked[b] && this.link(cs[a], cs[b])) {
                    linked[a] = true;
                    break;
                }
            }
        }
        let val = 0;
        let n = 0;
        for (let k = 0; k < cs.length; k++) {
            if (!linked[k])
                continue;
            val += this.gainCore(cs[k], this.wN, 1, 0, 3) * H * 0.9;
            n++;
        }
        if (n === 0)
            return 0;
        let amt = Math.round(4 * val + 10 * n);
        amt = Math.max(61, Math.min(amt, 150));
        if (amt % 5 === 0)
            amt += 1;
        return amt;
    }
    planBids(obs) {
        const m = this.man;
        if (!m)
            return;
        let reserve = 0;
        for (let j = 0; j < m.lots.length; j++) {
            const lot = m.lots[j];
            const left = lot.at - this.t;
            if (left < 1 || left > 4)
                continue;
            const want = this.lotBid(lot);
            if (want < 60)
                continue;
            const have = Math.floor(obs.pulse.energy);
            if (have < 62)
                continue;
            reserve = Math.max(reserve, Math.min(want, have));
            if (left === 2 || left === 1) {
                const amount = Math.min(want, have - 1);
                if (amount < 60)
                    continue;
                const st = this.bids.get(j);
                if (left === 2 || !st || !st.ok || st.amount > have) {
                    const o = { kind: 'bid', lot: j, amount };
                    if (this.issue(o, this.hcost(), 0))
                        this.bids.set(j, { amount, ok: false });
                }
            }
        }
        this.reserve = reserve;
    }
    /* ---------------------------------------------------------------- */
    /* yard                                                              */
    /* ---------------------------------------------------------------- */
    planYard(obs) {
        const K = this.K;
        let nT = 0;
        let nK = 0;
        for (const u of obs.mine.units) {
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
        const weight = nT * 2 + nK;
        let want = null;
        if (nT === 0 && nK === 0)
            want = TK;
        else if (nT >= 1 && nK === 0 && this.t <= 150 && weight + 1 <= K.squad && this.cacheWanted())
            want = KL;
        else if (nT < this.knobs.tkach && weight + 2 <= K.squad)
            want = TK;
        else if (nK < this.knobs.klinok && weight + 1 <= K.squad)
            want = KL;
        if (!want)
            return;
        const cost = want === TK ? K.costT : K.costK;
        if (obs.pulse.energy - this.reserve < cost)
            return;
        const o = { kind: 'yard', cls: want };
        if (this.issue(o, this.hcost(), 0))
            this.pending.push({ cls: want, t: this.t });
    }
    /* ---------------------------------------------------------------- */
    /* caches                                                            */
    /* ---------------------------------------------------------------- */
    chooseCache(from, startT, maxD) {
        if (from < 0 || this.finds.size === 0)
            return -1;
        const D = this.dist(from, 1);
        let best = -1;
        let bd = INF;
        for (const [i, kind] of this.finds) {
            if (kind !== 'cache')
                continue;
            const d = D[i];
            if (d >= INF || d > maxD)
                continue;
            const mine = startT + d;
            let rv = INF;
            for (const R of this.rivalDistK)
                rv = Math.min(rv, 5 + R[i]);
            if (mine > rv + 12)
                continue;
            if (d < bd) {
                bd = d;
                best = i;
            }
        }
        return best;
    }
    /* is there a cache worth a Klinok from the yard right now */
    cacheWanted() {
        if (this.hearth < 0)
            return false;
        if (this.cachePlan >= 0 && this.finds.has(this.cachePlan))
            return true;
        const c = this.chooseCache(this.hearth, this.t + this.K.build / 2 + 4, 26);
        if (c >= 0)
            this.cachePlan = c;
        return c >= 0;
    }
    /* ---------------------------------------------------------------- */
    /* Klinoks: cache runner, guards, raider                             */
    /* ---------------------------------------------------------------- */
    nearestMine(q, r) {
        let nd = 99;
        for (const [i] of this.myN) {
            const d = hexd(q, r, this.qOf[i], this.rOf[i]);
            if (d < nd)
                nd = d;
        }
        if (this.hearth >= 0) {
            const d = hexd(q, r, this.qOf[this.hearth], this.rOf[this.hearth]);
            if (d < nd)
                nd = d;
        }
        return nd;
    }
    findThreats(obs) {
        const th = [];
        const myTk = obs.mine.units.filter((u) => u.cls === TK);
        for (const f of obs.foe) {
            if (f.p === this.me || f.p === 'K')
                continue;
            const nd = this.nearestMine(f.q, f.r);
            let prio = 0;
            if (f.cls === TK) {
                if (nd <= 3)
                    prio = 100 - nd * 5;
                else if (this.knobs.hunt && nd <= 8)
                    prio = 40 - nd;
            }
            else {
                if (nd <= 1)
                    prio = 70;
                else {
                    for (const u of myTk) {
                        if (hexd(u.q, u.r, f.q, f.r) <= 3) {
                            prio = 60;
                            break;
                        }
                    }
                }
            }
            if (prio > 0)
                th.push({ id: f.id, q: f.q, r: f.r, cls: f.cls, prio });
        }
        th.sort((a, b) => b.prio - a.prio || (a.id < b.id ? -1 : 1));
        return th;
    }
    stationFor(slotNo) {
        const rivals = this.rivals;
        let target = this.hearth;
        if (rivals.length > 0)
            target = rivals[slotNo % rivals.length];
        if (target < 0)
            return this.hearth;
        const tq = this.qOf[target];
        const tr = this.rOf[target];
        let best = -1;
        let bd = INF;
        const hq = this.hearth >= 0 ? this.qOf[this.hearth] : 0;
        const hr = this.hearth >= 0 ? this.rOf[this.hearth] : 0;
        for (const [i, n] of this.myN) {
            if (n.dark || n.weight < 0.99)
                continue;
            const q = this.qOf[i];
            const r = this.rOf[i];
            if (this.inLine(i))
                continue;
            /* not so far from home that the response is slow everywhere */
            if (hexd(q, r, hq, hr) > 11)
                continue;
            const d = hexd(q, r, tq, tr);
            if (d < bd) {
                bd = d;
                best = i;
            }
        }
        return best >= 0 ? best : this.hearth;
    }
    planKlinoks(obs) {
        const ks = this.units.filter((u) => u.cls === KL).sort(byId);
        if (ks.length === 0)
            return;
        const threats = this.findThreats(obs);
        const visible = new Map();
        for (const f of obs.foe)
            visible.set(f.id, f);
        const taken = new Set();
        /* validate jobs */
        for (const u of ks) {
            const j = this.jobs.get(u.id);
            if (!j)
                continue;
            if (j.kind === 'cache') {
                if (!this.finds.has(j.cell) || this.t - j.since > 90)
                    this.jobs.delete(u.id);
            }
            else if (j.kind === 'ram') {
                if (visible.has(j.target) && this.t - j.since < 60)
                    taken.add(j.target);
                else {
                    this.jobs.delete(u.id);
                    if (u.task !== null && u.task.ram !== null) {
                        const o = { kind: 'halt', unit: u.id };
                        this.issue(o, 0, 0);
                    }
                }
            }
            else if (j.kind === 'jam') {
                const info = this.known.get(j.cell);
                if (!info || info.owner === null || info.owner === this.me || info.owner === 'K' || info.start || this.t - j.since > 90) {
                    this.jobs.delete(u.id);
                }
            }
        }
        /* the first Klinok of the opening runs for the cache */
        if (this.t <= 120) {
            for (const u of ks) {
                if (this.jobs.has(u.id))
                    continue;
                let target = -1;
                if (this.cachePlan >= 0 && this.finds.has(this.cachePlan))
                    target = this.cachePlan;
                else if (this.cachePlan >= 0 || this.t > 30)
                    target = this.chooseCache(idxOf(u.q, u.r), this.t, 22);
                if (target >= 0 && this.orderable(u)) {
                    if (this.cmdMove(u, target, false)) {
                        this.jobs.set(u.id, { kind: 'cache', cell: target, target: '', since: this.t, hold: 0, cmdAt: this.t, aggr: false });
                    }
                }
                break;
            }
        }
        else {
            /* later caches are only taken in passing */
        }
        /* keep the runner on its way */
        for (const u of ks) {
            const j = this.jobs.get(u.id);
            if (j && j.kind === 'cache' && this.idle(u) && this.orderable(u) && this.t - j.cmdAt >= 2) {
                if (this.cmdMove(u, j.cell, false))
                    j.cmdAt = this.t;
            }
        }
        /* guards: threats first */
        const free = ks.filter((u) => {
            const j = this.jobs.get(u.id);
            return !j || j.kind === 'station';
        });
        for (const th of threats) {
            if (taken.has(th.id))
                continue;
            if ((this.ramBan.get(th.id) ?? 0) > this.t)
                continue;
            let best = null;
            let bd = th.cls === TK ? 16 : 10;
            for (const u of free) {
                if (!this.orderable(u))
                    continue;
                const j = this.jobs.get(u.id);
                if (j && j.kind === 'ram')
                    continue;
                const D = this.distFor(u);
                const d = D[idxOf(th.q, th.r)];
                if (d < bd) {
                    bd = d;
                    best = u;
                }
            }
            if (best) {
                if (this.cmdRam(best, th.id)) {
                    this.jobs.set(best.id, { kind: 'ram', cell: -1, target: th.id, since: this.t, hold: 0, cmdAt: this.t, aggr: false });
                    taken.add(th.id);
                }
            }
        }
        /* raider: the spare Klinok jams a frontier needle of an enemy */
        const spare = ks.filter((u) => {
            const j = this.jobs.get(u.id);
            return !j || j.kind === 'station' || j.kind === 'jam';
        });
        if (this.knobs.raid && spare.length >= 2 && this.t >= 180 && this.t <= this.dawnAt + 120 && threats.length === 0) {
            const raider = spare[spare.length - 1];
            this.runRaider(raider);
        }
        else {
            for (const u of spare) {
                const j = this.jobs.get(u.id);
                if (j && j.kind === 'jam')
                    this.jobs.delete(u.id);
            }
        }
        /* the rest stand guard */
        let no = 0;
        for (const u of ks) {
            const j = this.jobs.get(u.id);
            if (j && j.kind !== 'station') {
                no++;
                continue;
            }
            if (!this.orderable(u) || !this.idle(u) && this.t - (this.stations.get(u.id)?.t ?? -99) < 25) {
                no++;
                continue;
            }
            const st = this.stations.get(u.id);
            let cell = st ? st.cell : -1;
            if (cell < 0 || this.t - (st ? st.t : 0) >= 25) {
                cell = this.stationFor(no);
                this.stations.set(u.id, { cell, t: this.t });
            }
            no++;
            if (cell < 0)
                continue;
            const here = idxOf(u.q, u.r);
            if (here !== cell && (this.idle(u) || this.t - (st ? st.t : 0) === 0)) {
                if (hexd(u.q, u.r, this.qOf[cell], this.rOf[cell]) >= 1 && this.idle(u)) {
                    if (this.cmdMove(u, cell, this.inZone(cell))) {
                        this.jobs.set(u.id, { kind: 'station', cell, target: '', since: this.t, hold: 0, cmdAt: this.t, aggr: false });
                    }
                }
            }
            else if (!this.jobs.has(u.id)) {
                this.jobs.set(u.id, { kind: 'station', cell, target: '', since: this.t, hold: 0, cmdAt: this.t, aggr: false });
            }
        }
    }
    /* number of enemy needles cut off from their roots when i goes dark */
    cutSize(i) {
        const info = this.known.get(i);
        if (!info || info.owner === null)
            return 0;
        const owner = info.owner;
        const nodes = [];
        const roots = [];
        for (const [j, n] of this.known) {
            if (n.owner !== owner || n.dark)
                continue;
            nodes.push(j);
            if (n.start)
                roots.push(j);
        }
        if (roots.length === 0 || nodes.length > 60)
            return 0;
        const reach = (skip) => {
            const seen = new Set();
            const stack = [];
            for (const r of roots) {
                if (r !== skip) {
                    seen.add(r);
                    stack.push(r);
                }
            }
            while (stack.length) {
                const a = stack.pop();
                for (const b of nodes) {
                    if (b === skip || seen.has(b))
                        continue;
                    if (hexd(this.qOf[a], this.rOf[a], this.qOf[b], this.rOf[b]) > this.K.link + 1)
                        continue;
                    if (this.link(a, b)) {
                        seen.add(b);
                        stack.push(b);
                    }
                }
            }
            return seen.size;
        };
        const full = reach(-1);
        const part = reach(i);
        return Math.max(0, full - part - 1);
    }
    pickRaid(u) {
        const D = this.distFor(u);
        let best = -1;
        let bv = 0;
        for (const [i, info] of this.known) {
            if (info.owner === null || info.owner === this.me || info.owner === 'K' || info.start)
                continue;
            if (this.t - info.seen > 60 || info.dark)
                continue;
            if (this.nearestMine(info.q, info.r) > 8)
                continue;
            const eta = D[i];
            if (eta >= 40)
                continue;
            const loot = this.gainCore(i, this.wN, 1, 1, 3) * 30;
            const cut = this.cutSize(i) * 0.012 * 40 * 0.5;
            const v = loot + cut;
            if (v < 4)
                continue;
            const sc = v / (eta + 12);
            if (sc > bv) {
                bv = sc;
                best = i;
            }
        }
        return best;
    }
    runRaider(u) {
        let j = this.jobs.get(u.id);
        if (j && j.kind === 'jam') {
            const info = this.known.get(j.cell);
            if (!info || info.owner === null || info.owner === this.me || info.owner === 'K' || info.start) {
                this.jobs.delete(u.id);
                j = undefined;
            }
        }
        if (!j || j.kind !== 'jam') {
            if (this.t < this.raidAt || !this.orderable(u))
                return;
            this.raidAt = this.t + 10;
            if (!this.lastObs || this.lastObs.pulse.chanAt < 190)
                return;
            const target = this.pickRaid(u);
            if (target < 0)
                return;
            j = { kind: 'jam', cell: target, target: '', since: this.t, hold: 0, cmdAt: -9, aggr: true };
            this.jobs.set(u.id, j);
        }
        const tq = this.qOf[j.cell];
        const tr = this.rOf[j.cell];
        const dd = hexd(u.q, u.r, tq, tr);
        if (dd <= 1) {
            const jamming = u.task !== null && u.task.jam !== null;
            if (!jamming && this.t - j.cmdAt >= 2) {
                if (this.cmdJam(u, j.cell, true))
                    j.cmdAt = this.t;
            }
        }
        else if (this.orderable(u) && this.idle(u) && this.t - j.cmdAt >= 2) {
            if (this.cmdMove(u, j.cell, false)) {
                j.cmdAt = this.t;
                this.cmdJam(u, j.cell, false);
            }
        }
    }
    /* ---------------------------------------------------------------- */
    /* Tkachs                                                            */
    /* ---------------------------------------------------------------- */
    contractBonus() {
        const res = new Map();
        const ord = this.lastObs ? this.lastObs.pub.order : null;
        if (!ord)
            return res;
        const t = this.t;
        if (t > ord.to - this.K.hold - 4)
            return res;
        const cells = ord.cells.map((h) => idxOf(h.q, h.r));
        const need = [];
        for (const c of cells) {
            const mine = this.myN.has(c);
            if (mine)
                continue;
            const info = this.known.get(c);
            if (!info || info.owner !== null || this.inLine(c) || this.penalized(c))
                return res;
            need.push(c);
        }
        if (need.length === 0)
            return res;
        /* chain: every needed cell has to join the lit network */
        const S = new Set(this.linkSrc);
        for (const c of cells)
            if (this.myN.has(c))
                S.add(c);
        let grew = true;
        const joined = new Set();
        while (grew) {
            grew = false;
            for (const c of need) {
                if (joined.has(c))
                    continue;
                for (const s of S) {
                    if (hexd(this.qOf[c], this.rOf[c], this.qOf[s], this.rOf[s]) <= this.K.link + 1 && this.link(c, s)) {
                        joined.add(c);
                        S.add(c);
                        grew = true;
                        break;
                    }
                }
            }
        }
        if (joined.size < need.length)
            return res;
        /* can the Tkachs make it before the contract ends */
        const tks = this.units.filter((u) => u.cls === TK).sort(byId);
        if (tks.length === 0)
            return res;
        const free = tks.map(() => t);
        const etas = tks.map((u) => this.distFor(u));
        const order = need.slice().sort((a, b) => {
            let ea = INF;
            let eb = INF;
            for (const D of etas) {
                ea = Math.min(ea, D[a]);
                eb = Math.min(eb, D[b]);
            }
            return ea - eb;
        });
        let done = t;
        for (const c of order) {
            let bk = -1;
            let bf = INF;
            for (let k = 0; k < tks.length; k++) {
                const e = etas[k][c];
                if (e >= INF)
                    continue;
                const f = free[k] + e + this.K.heatN;
                if (f < bf) {
                    bf = f;
                    bk = k;
                }
            }
            if (bk < 0)
                return res;
            free[bk] = bf;
            if (bf > done)
                done = bf;
        }
        if (done + this.K.hold > ord.to - 1)
            return res;
        /* rivals nearer to the cells are a risk */
        let p = 0.7;
        for (const c of need) {
            let rv = INF;
            for (const h of this.rivals) {
                rv = Math.min(rv, t + this.K.stepT * hexd(this.qOf[h], this.rOf[h], this.qOf[c], this.rOf[c]) + this.K.heatN);
            }
            if (rv < done)
                p = 0.35;
        }
        const each = (this.K.orderBonus * p) / need.length;
        for (const c of need)
            res.set(c, each);
        return res;
    }
    lastObs = null;
    stageCell(i) {
        let best = -1;
        let bd = INF;
        const hq = this.hearth >= 0 ? this.qOf[this.hearth] : 0;
        const hr = this.hearth >= 0 ? this.rOf[this.hearth] : 0;
        for (let d = 0; d < 6; d++) {
            const j = this.nbr[i * 6 + d];
            if (j < 0 || !this.pass[j] || this.known.has(j))
                continue;
            if (this.inLine(j))
                continue;
            const dd = hexd(this.qOf[j], this.rOf[j], hq, hr);
            if (dd < bd) {
                bd = dd;
                best = j;
            }
        }
        return best;
    }
    danger(i) {
        let f = 1;
        const q = this.qOf[i];
        const r = this.rOf[i];
        for (const s of this.foeSeen.values()) {
            const d = hexd(s.q, s.r, q, r);
            if (s.cls === KL && d <= 4)
                f *= 0.55;
            else if (s.cls === TK && d <= 2)
                f *= 0.85;
        }
        return f;
    }
    meshFactor(nlink) {
        if (nlink >= 2)
            return this.crownOn ? 1.14 : 1.05;
        return 1;
    }
    rivalNear(i) {
        if (this.hearth < 0 || this.rivals.length === 0)
            return 1;
        const q = this.qOf[i];
        const r = this.rOf[i];
        const dm = hexd(q, r, this.qOf[this.hearth], this.rOf[this.hearth]);
        let dr = INF;
        for (const h of this.rivals)
            dr = Math.min(dr, hexd(q, r, this.qOf[h], this.rOf[h]));
        const info = this.known.get(i);
        const fresh = info !== undefined && this.t - info.seen <= 30 && info.seen > 0;
        if (!fresh && this.t > 70 && dr + 3 < dm)
            return 0.5;
        return 1;
    }
    genCands(obs) {
        const out = [];
        const t = this.t;
        const bonusMap = this.contractBonus();
        const H0 = Math.max(0, this.tend - t - 60);
        const eB = this.lit < 8 ? 1 : 0;
        const unlinked = [];
        /* ruins */
        for (const i of this.ruinList) {
            const info = this.known.get(i);
            if (!info || info.owner !== null || this.penalized(i))
                continue;
            if (this.inLine(i))
                continue;
            const lk = this.linkers(i);
            const g = this.gainCore(i, this.wN, 1, 0, 3);
            if (lk.length === 0) {
                unlinked.push({ i, v: g * H0 });
                continue;
            }
            const c = {
                idx: i,
                kind: 'ruin',
                gain: g * this.meshFactor(lk.length),
                bonus: (bonusMap.get(i) ?? 0) + eB * 0,
                work: this.K.heatN,
                costE: 0,
                hold: 0,
                mult: 1,
                en: 0,
                nlink: lk.length,
                safe: this.rivalNear(i),
            };
            out.push(c);
        }
        /* build sites around the lit network */
        const mark = new Uint8Array(NCELL);
        const sites = [];
        for (const s of this.linkSrc) {
            const q0 = this.qOf[s];
            const r0 = this.rOf[s];
            for (let dq = -6; dq <= 6; dq++) {
                const lo = Math.max(-6, -dq - 6);
                const hi = Math.min(6, -dq + 6);
                for (let dr = lo; dr <= hi; dr++) {
                    const q = q0 + dq;
                    const r = r0 + dr;
                    if (!inRange(q, r))
                        continue;
                    const i = idxOf(q, r);
                    if (!this.valid[i] || mark[i])
                        continue;
                    mark[i] = 1;
                    sites.push(i);
                }
            }
        }
        const darkOwn = [];
        for (const n of obs.mine.needles)
            if (n.weight === 0)
                darkOwn.push(idxOf(n.q, n.r));
        const hearths = this.seats;
        for (const i of sites) {
            if (!this.pass[i] || !this.bld[i] || this.deadCells.has(i) || this.known.has(i) || this.penalized(i))
                continue;
            if (this.inLine(i))
                continue;
            const q = this.qOf[i];
            const r = this.rOf[i];
            let nearHearth = false;
            for (const h of hearths) {
                if (hexd(q, r, this.qOf[h], this.rOf[h]) <= 2) {
                    nearHearth = true;
                    break;
                }
            }
            if (nearHearth)
                continue;
            const lk = this.linkers(i);
            if (lk.length === 0)
                continue;
            let close = false;
            for (const s of lk) {
                if (hexd(q, r, this.qOf[s], this.rOf[s]) < 2) {
                    close = true;
                    break;
                }
            }
            if (close)
                continue;
            const g = this.gainCore(i, this.wN, 1, 0, 3);
            if (g < 0.0015)
                continue;
            let bonus = 0;
            let ucount = 0;
            for (const u of unlinked) {
                if (ucount >= 2)
                    break;
                if (hexd(q, r, this.qOf[u.i], this.rOf[u.i]) <= this.K.link + 1 && this.link(i, u.i)) {
                    bonus += 0.35 * u.v;
                    ucount++;
                }
            }
            for (const d of darkOwn) {
                if (hexd(q, r, this.qOf[d], this.rOf[d]) <= this.K.link + 1 && this.link(i, d)) {
                    bonus += this.gainCore(d, this.wN, this.ringMult(d), 0, 3) * H0 * 0.6;
                }
            }
            out.push({
                idx: i,
                kind: 'build',
                gain: g * this.meshFactor(lk.length),
                bonus,
                work: this.K.build,
                costE: this.K.costN,
                hold: 0,
                mult: 1,
                en: 0,
                nlink: lk.length,
                safe: 1,
            });
        }
        /* enemy needles on the edge of our network, dark ones first */
        if (this.knobs.attack) {
            for (const [i, info] of this.known) {
                if (info.owner === null || info.owner === this.me || info.owner === 'K' || info.start)
                    continue;
                if (this.penalized(i) || this.inLine(i))
                    continue;
                if (t - info.seen > 40 || t - info.first < this.K.grace + 4)
                    continue;
                if (!info.dark && this.nearestMine(info.q, info.r) > 5)
                    continue;
                const lk = this.linkers(i);
                if (lk.length === 0)
                    continue;
                let guarded = false;
                for (const s of this.foeSeen.values()) {
                    if (t - s.t <= 6 && hexd(s.q, s.r, info.q, info.r) <= 4) {
                        guarded = true;
                        break;
                    }
                }
                if (guarded)
                    continue;
                const em = this.ringMult(i);
                const g = this.gainCore(i, this.wN, em, 1, 3);
                out.push({
                    idx: i,
                    kind: 'enemy',
                    gain: g * this.meshFactor(lk.length) * (info.dark ? 1 : 0.7),
                    bonus: 0,
                    work: info.dark ? this.K.heatD : this.K.heatE,
                    costE: 0,
                    hold: 0,
                    mult: em,
                    en: 1,
                    nlink: lk.length,
                    safe: 1,
                });
            }
        }
        /* the Keeper's ring: after dawn, staged just before */
        if (t >= this.dawnAt - 45) {
            for (const [i, info] of this.known) {
                if (info.owner !== 'K' || !info.ring || this.penalized(i))
                    continue;
                const lk = this.linkers(i);
                if (lk.length === 0)
                    continue;
                const inside = hexd(this.qOf[this.citadel], this.rOf[this.citadel], info.q, info.r) <= this.cherta;
                if (!this.dawnOn && inside && this.stageCell(i) < 0)
                    continue;
                const g = this.gainCore(i, this.wN, this.K.dawnRing, 0, 3);
                out.push({
                    idx: i,
                    kind: 'ring',
                    gain: g * this.meshFactor(lk.length),
                    bonus: 0,
                    work: this.K.heatN,
                    costE: 0,
                    hold: this.dawnOn ? 0 : this.dawnAt,
                    mult: this.K.dawnRing,
                    en: 0,
                    nlink: lk.length,
                    safe: 1,
                });
            }
        }
        return out;
    }
    candValue(c, eta) {
        const ready = Math.max(this.t + eta, c.hold);
        const H = this.tend - ready - c.work;
        if (H <= 0)
            return -1;
        let v = c.gain * H * 0.9 * c.safe * this.danger(c.idx) + c.bonus - c.costE * this.lam();
        if (this.lit < 8 && c.kind !== 'enemy')
            v += 0.0125 * Math.min(H, 400);
        return v;
    }
    buildJobs() {
        let n = 0;
        for (const j of this.jobs.values())
            if (j.kind === 'build')
                n++;
        return n;
    }
    canAffordBuild(eta) {
        const regen = 0.25 * Math.min(8, this.lit);
        let nT = this.pending.filter((p) => p.cls === TK).length;
        for (const u of this.units)
            if (u.cls === TK)
                nT++;
        const saving = nT < 2 ? this.K.costT : 0;
        const e = this.energy - this.reserve - saving - this.K.costN * this.buildJobs();
        return e + regen * eta >= this.K.costN;
    }
    jobValid(u, j) {
        const t = this.t;
        if (j.kind === 'heat') {
            const info = this.known.get(j.cell);
            if (!info || info.owner === this.me || this.penalized(j.cell))
                return false;
            if (info.owner !== null && !j.aggr && info.owner !== 'K')
                return false;
            if (info.owner === 'K' && !this.dawnOn && j.hold === 0)
                return false;
            if (t - j.since > 160)
                return false;
            if (u.stuck && t - j.cmdAt > 12)
                return false;
            return true;
        }
        if (j.kind === 'build') {
            if (this.myN.has(j.cell) || this.known.has(j.cell) && this.known.get(j.cell).owner !== null)
                return false;
            if (this.penalized(j.cell) || t - j.since > 90)
                return false;
            return true;
        }
        if (j.kind === 'feed') {
            const n = this.myN.get(j.cell);
            return !!n && !n.dark && n.weight >= 0.99;
        }
        return true;
    }
    maintain(u, j) {
        const t = this.t;
        const here = idxOf(u.q, u.r);
        if (t - j.cmdAt < 2)
            return;
        if (j.kind === 'heat') {
            let dest = j.cell;
            if (j.hold > t) {
                const s = this.stageCell(j.cell);
                if (s >= 0)
                    dest = s;
            }
            if (here === dest)
                return;
            if (j.hold > t && dest === j.cell)
                return;
            if (this.orderable(u) && this.idle(u)) {
                if (this.cmdMove(u, dest, false))
                    j.cmdAt = t;
            }
        }
        else if (j.kind === 'build') {
            const building = u.task !== null && u.task.site !== null;
            if (!building && this.orderable(u)) {
                if (this.cmdNeedle(u, j.cell))
                    j.cmdAt = t;
            }
        }
        else if (j.kind === 'feed') {
            const feeding = u.task !== null && u.task.feed !== null;
            if (!feeding && this.orderable(u)) {
                if (this.cmdFeed(u, j.cell))
                    j.cmdAt = t;
            }
        }
    }
    planTkachs(obs) {
        this.lastObs = obs;
        const tks = this.units.filter((u) => u.cls === TK).sort(byId);
        if (tks.length === 0)
            return;
        const t = this.t;
        const assigned = new Set();
        const feedTaken = new Set();
        let cands = null;
        let feeds = null;
        /* stale leash: bring a stranded Tkach home */
        for (const u of tks) {
            if (u.away >= 30 && this.orderable(u)) {
                let bd = INF;
                let bi = -1;
                const D = this.distFor(u);
                for (const s of this.linkSrc) {
                    const d = D[s];
                    if (d < bd) {
                        bd = d;
                        bi = s;
                    }
                }
                if (bi >= 0 && bd > 0) {
                    this.jobs.delete(u.id);
                    this.cmdMove(u, bi, true);
                    continue;
                }
            }
        }
        for (const u of tks) {
            const j = this.jobs.get(u.id);
            if (j) {
                if (j.kind === 'feed')
                    feedTaken.add(j.cell);
                else if (j.kind === 'heat' || j.kind === 'build')
                    assigned.add(j.cell);
            }
        }
        for (const u of tks) {
            let j = this.jobs.get(u.id) ?? null;
            if (j && !this.jobValid(u, j)) {
                this.jobs.delete(u.id);
                if (j.kind === 'heat' || j.kind === 'build')
                    assigned.delete(j.cell);
                if (j.kind === 'feed')
                    feedTaken.delete(j.cell);
                j = null;
            }
            let reconsider = false;
            if (j && j.kind === 'feed' && t - j.since >= 20 && this.orderable(u))
                reconsider = true;
            if (j && !reconsider) {
                this.maintain(u, j);
                continue;
            }
            if (!this.orderable(u))
                continue;
            if (!this.idle(u) && !reconsider)
                continue;
            if (!cands)
                cands = this.genCands(obs);
            const D = this.distFor(u);
            const opp = reconsider && j ? this.feedGainOf(j.cell) : 0;
            let best = null;
            let bs = 0;
            let be = 0;
            for (const c of cands) {
                if (assigned.has(c.idx))
                    continue;
                const eta = D[c.idx];
                if (eta >= INF)
                    continue;
                if (c.kind === 'build' && !this.canAffordBuild(eta))
                    continue;
                let v = this.candValue(c, eta);
                v -= opp * (eta + c.work);
                if (v < 1.0)
                    continue;
                const sc = v / (eta + c.work + 6);
                if (sc > bs) {
                    bs = sc;
                    best = c;
                    be = eta;
                }
            }
            if (best) {
                const jb = {
                    kind: best.kind === 'build' ? 'build' : 'heat',
                    cell: best.idx,
                    target: '',
                    since: t,
                    hold: best.hold,
                    cmdAt: t,
                    aggr: best.kind === 'enemy',
                };
                let okc = false;
                if (jb.kind === 'build')
                    okc = this.cmdNeedle(u, best.idx);
                else {
                    let dest = best.idx;
                    if (best.hold > t) {
                        const s = this.stageCell(best.idx);
                        dest = s >= 0 ? s : best.idx;
                    }
                    if (hexd(u.q, u.r, this.qOf[dest], this.rOf[dest]) === 0)
                        okc = true;
                    else
                        okc = this.cmdMove(u, dest, false);
                }
                if (okc) {
                    if (j && j.kind === 'feed')
                        feedTaken.delete(j.cell);
                    this.jobs.set(u.id, jb);
                    assigned.add(best.idx);
                    /* the future needle counts for the next picks */
                    const mult = best.kind === 'ring' ? this.K.dawnRing : 1;
                    this.stamp(this.myPull, best.idx, mult, false);
                    this.linkSrc.push(best.idx);
                    for (const c2 of cands) {
                        if (c2 === best)
                            continue;
                        if (hexd(this.qOf[c2.idx], this.rOf[c2.idx], this.qOf[best.idx], this.rOf[best.idx]) <= 7) {
                            c2.gain = this.gainCore(c2.idx, this.wN, c2.mult, c2.en, 3) * this.meshFactor(c2.nlink) * (c2.kind === 'enemy' ? 0.8 : 1);
                        }
                    }
                    void be;
                    continue;
                }
            }
            if (reconsider && j) {
                j.since = t;
                continue;
            }
            /* nothing worth building: feed the needle where one more ring adds most */
            if (this.knobs.hunt || true) {
                if (!feeds)
                    feeds = this.feedList(obs);
                if (obs.pulse.chanAt >= 190 && this.avail >= 96) {
                    let fb = null;
                    let fs = 0;
                    for (const f of feeds) {
                        if (feedTaken.has(f.i))
                            continue;
                        const eta = D[f.i];
                        if (eta >= 80)
                            continue;
                        const v = f.g * (this.tend - t - eta) * 0.9;
                        if (v < 3)
                            continue;
                        if (v > fs) {
                            fs = v;
                            fb = f;
                        }
                    }
                    if (fb) {
                        if (this.cmdFeed(u, fb.i)) {
                            this.jobs.set(u.id, { kind: 'feed', cell: fb.i, target: '', since: t, hold: 0, cmdAt: t, aggr: false });
                            feedTaken.add(fb.i);
                        }
                    }
                }
            }
        }
    }
    feedGainOf(i) {
        const n = this.myN.get(i);
        if (!n)
            return 0;
        return this.gainCore(i, this.wD, n.weight * this.ringMult(i), 0, 4);
    }
    feedList(obs) {
        const res = [];
        for (const n of obs.mine.needles) {
            if (n.dark || n.weight < 0.99 || n.fed)
                continue;
            const i = idxOf(n.q, n.r);
            if (this.penalized(i))
                continue;
            const g = this.gainCore(i, this.wD, n.weight * this.ringMult(i), 0, 4);
            if (g > 0)
                res.push({ i, g });
        }
        return res;
    }
}
export function createStrategy(preset) {
    return new Zoria(preset && PRESETS[preset] ? preset : 'mesh');
}
