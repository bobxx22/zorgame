/* bot :: strategy
   Autonomous Master Strategy for Zoria (Зоря).
   Deterministic, zero-silence, high-score engine designed for
   rapid expansion, clean ramming, auction sniping, and contract capture. */
import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, orderCap, } from '@zoria/protocol';
const HEX_DIRS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
function hexDist(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
function hexKey(q, r) {
    return `${q},${r}`;
}
function parseHexKey(k) {
    const parts = k.split(',');
    return { q: Number(parts[0]), r: Number(parts[1]) };
}
class PRNG {
    s;
    constructor(seed = 20261002) {
        this.s = seed >>> 0;
    }
    next() {
        this.s = (this.s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}
class MasterStrategy {
    presetName;
    slot;
    manifest;
    oracle;
    hearth;
    rng = new PRNG();
    levels = new Map();
    terrain = new Map();
    cellValues = new Map();
    needles = new Map();
    needleAdjacency = new Map();
    needleOwners = new Map();
    needleDark = new Map();
    needleLit = new Set();
    graceUntil = new Map();
    tkachTarget = new Map();
    yardOrderedUntil = 0;
    consecutiveSilentTicks = 0;
    activePact = null;
    bidSubmitted = new Set();
    constructor(presetName) {
        this.presetName = presetName;
    }
    init(manifestBytes, slot) {
        const m = decodeManifest(manifestBytes);
        if (!m)
            throw new Error('Failed to decode manifest');
        this.manifest = m;
        this.slot = slot;
        this.oracle = new RulesOracle(createEngine, manifestBytes);
        const seatIdx = slot === 'A' ? 0 : slot === 'B' ? 1 : 2;
        const seatPos = this.manifest.seats[seatIdx];
        if (!seatPos)
            throw new Error('Seat position missing');
        this.hearth = seatPos;
        let cellIdx = 0;
        for (let r = -19; r <= 19; r++) {
            for (let q = -19; q <= 19; q++) {
                if (Math.abs(q) + Math.abs(r) + Math.abs(q + r) <= 38) {
                    const k = hexKey(q, r);
                    this.levels.set(k, this.manifest.levels[cellIdx] ?? 0);
                    cellIdx++;
                }
            }
        }
        const TERRAIN_VALUES = {
            0: 2, // bare
            1: 3, // meadow
            2: 2, // wood
            3: 1, // sand
            4: 1, // marsh
            5: 1, // hill
            6: 0, // water
            7: 0, // mountain
        };
        for (const [k] of this.levels) {
            this.terrain.set(k, 0);
            this.cellValues.set(k, TERRAIN_VALUES[0] ?? 2);
        }
        for (const [q, r, tIdx] of this.manifest.terrain.cells) {
            const k = hexKey(q, r);
            this.terrain.set(k, tIdx);
            this.cellValues.set(k, TERRAIN_VALUES[tIdx] ?? 1);
        }
        const needleList = [this.hearth];
        for (const n of this.manifest.needles) {
            const k = hexKey(n.q, n.r);
            this.needles.set(k, { q: n.q, r: n.r, ring: n.ring, start: n.start });
            needleList.push({ q: n.q, r: n.r });
            if (n.start !== null) {
                this.needleOwners.set(k, n.start);
            }
            else if (n.ring) {
                this.needleOwners.set(k, 'K');
            }
            else {
                this.needleOwners.set(k, null);
            }
        }
        for (const a of needleList) {
            const aKey = hexKey(a.q, a.r);
            let adj = this.needleAdjacency.get(aKey);
            if (!adj) {
                adj = new Set();
                this.needleAdjacency.set(aKey, adj);
            }
            for (const b of needleList) {
                if (a.q === b.q && a.r === b.r)
                    continue;
                const bKey = hexKey(b.q, b.r);
                if (this.oracle.linkOk(a, b)) {
                    adj.add(bKey);
                }
            }
        }
    }
    feedback(verdictBytes) {
        const verdicts = decodeVerdicts(verdictBytes);
        if (!verdicts)
            return;
        for (const [, ok] of verdicts) {
            if (ok) {
                this.consecutiveSilentTicks = 0;
                break;
            }
        }
    }
    tick(observeBytes) {
        try {
            const obs = decodeObserve(observeBytes);
            if (!obs)
                return encodeOrders([]);
            const orders = this.think(obs);
            if (orders.length > 0) {
                this.consecutiveSilentTicks = 0;
            }
            else {
                this.consecutiveSilentTicks++;
            }
            return encodeOrders(orders);
        }
        catch {
            return encodeOrders([]);
        }
    }
    belief(obs) {
        if (!obs)
            return null;
        const pulse = {
            energy: obs.pulse.energy,
            chan: obs.pulse.chan,
            ear: obs.pulse.ear,
            minutes: obs.pulse.minutes,
            needles: obs.pulse.needles,
        };
        const ownRecord = {};
        for (const [k, owner] of this.needleOwners) {
            ownRecord[k] = owner;
        }
        const darkRecord = {};
        for (const [k, d] of this.needleDark) {
            darkRecord[k] = d;
        }
        return {
            t: obs.t,
            full: obs.t % 200 === 0 ? true : undefined,
            pulse,
            own: ownRecord,
            dark: darkRecord,
            foe: obs.foe.map((f) => [f.id, f.p, f.q, f.r]),
            noisy: obs.noisy.length,
            units: obs.mine.units.map((u) => [u.id, u.q, u.r, u.task?.path ?? 0]),
            pact: this.activePact,
            cries: obs.pub.cries,
        };
    }
    think(obs) {
        this.updatePerceptions(obs);
        this.recomputeNetwork();
        const orders = [];
        const cfg = this.manifest.cfg;
        const maxOrders = orderCap(cfg, obs.pulse.chanAt);
        let channelLeft = obs.pulse.chan;
        const tryAddOrder = (ord, cost = 32) => {
            if (orders.length >= maxOrders)
                return false;
            if (channelLeft < cost)
                return false;
            orders.push(ord);
            channelLeft -= cost;
            return true;
        };
        this.handleAuction(obs, tryAddOrder);
        this.handleYardProduction(obs, tryAddOrder);
        this.handleCombatKlinoks(obs, tryAddOrder);
        this.handleExpansionTkachs(obs, tryAddOrder);
        if (orders.length === 0 && this.consecutiveSilentTicks >= 3 && channelLeft >= 32) {
            tryAddOrder({ kind: 'watch', q: this.hearth.q, r: this.hearth.r, keep: 0 });
        }
        return orders;
    }
    updatePerceptions(obs) {
        for (const n of obs.mine.needles) {
            const k = hexKey(n.q, n.r);
            this.needleOwners.set(k, this.slot);
            this.needleDark.set(k, n.dark);
        }
        for (const o of obs.own) {
            const k = hexKey(o.q, o.r);
            this.needleOwners.set(k, o.owner);
            this.needleDark.set(k, o.dark);
        }
        for (const ev of obs.events) {
            if (ev.type === 'cap') {
                const k = hexKey(ev.q, ev.r);
                this.needleOwners.set(k, ev.p);
                this.graceUntil.set(k, obs.t + 60);
            }
            else if (ev.type === 'raise') {
                const k = hexKey(ev.q, ev.r);
                this.needleOwners.set(k, ev.p);
                this.graceUntil.set(k, obs.t + 60);
                if (!this.needles.has(k)) {
                    this.needles.set(k, { q: ev.q, r: ev.r, ring: false, start: null });
                    this.addNeedleToGraph({ q: ev.q, r: ev.r });
                }
            }
            else if (ev.type === 'lot') {
                const lot = this.manifest.lots[ev.lot];
                if (lot && ev.p) {
                    for (const c of lot.cells) {
                        const k = hexKey(c.q, c.r);
                        this.needleOwners.set(k, ev.p);
                    }
                }
            }
        }
        if (obs.t >= 1000) {
            for (const [k, n] of this.needles) {
                if (n.ring && this.needleOwners.get(k) === 'K') {
                    this.needleDark.set(k, true);
                }
            }
        }
        const partner = obs.pub.pact.active.find((p) => p.a === this.slot || p.b === this.slot);
        this.activePact = partner ? (partner.a === this.slot ? partner.b : partner.a) : null;
    }
    addNeedleToGraph(pt) {
        const ptKey = hexKey(pt.q, pt.r);
        let adj = this.needleAdjacency.get(ptKey);
        if (!adj) {
            adj = new Set();
            this.needleAdjacency.set(ptKey, adj);
        }
        for (const [otherKey, other] of this.needles) {
            if (other.q === pt.q && other.r === pt.r)
                continue;
            if (this.oracle.linkOk(pt, { q: other.q, r: other.r })) {
                adj.add(otherKey);
                this.needleAdjacency.get(otherKey)?.add(ptKey);
            }
        }
        if (this.oracle.linkOk(pt, this.hearth)) {
            adj.add(hexKey(this.hearth.q, this.hearth.r));
            this.needleAdjacency.get(hexKey(this.hearth.q, this.hearth.r))?.add(ptKey);
        }
    }
    recomputeNetwork() {
        this.needleLit.clear();
        const hearthKey = hexKey(this.hearth.q, this.hearth.r);
        const queue = [hearthKey];
        const visited = new Set([hearthKey]);
        while (queue.length > 0) {
            const curr = queue.shift();
            const neighbors = this.needleAdjacency.get(curr);
            if (!neighbors)
                continue;
            for (const next of neighbors) {
                if (visited.has(next))
                    continue;
                const owner = this.needleOwners.get(next);
                const isDark = this.needleDark.get(next) ?? false;
                if (owner === this.slot && !isDark) {
                    visited.add(next);
                    this.needleLit.add(next);
                    queue.push(next);
                }
            }
        }
    }
    handleAuction(obs, tryAddOrder) {
        for (let i = 0; i < this.manifest.lots.length; i++) {
            if (this.bidSubmitted.has(i))
                continue;
            const lot = this.manifest.lots[i];
            if (!lot)
                continue;
            if (obs.t >= lot.at - 5 && obs.t < lot.at) {
                const hasUnowned = lot.cells.some((c) => this.needleOwners.get(hexKey(c.q, c.r)) !== this.slot);
                if (hasUnowned && obs.pulse.energy >= 110) {
                    if (tryAddOrder({ kind: 'bid', lot: i, amount: 62 })) {
                        this.bidSubmitted.add(i);
                    }
                }
            }
        }
    }
    handleYardProduction(obs, tryAddOrder) {
        if (obs.t < this.yardOrderedUntil)
            return;
        let tkachs = 0;
        let klinoks = 0;
        for (const u of obs.mine.units) {
            if (u.cls === 'ткач')
                tkachs++;
            else if (u.cls === 'клинок')
                klinoks++;
        }
        const currentWeight = tkachs * 2 + klinoks;
        if (currentWeight >= 8)
            return;
        if (obs.t === 1 && obs.pulse.energy >= 90) {
            if (tryAddOrder({ kind: 'yard', cls: 'ткач' })) {
                this.yardOrderedUntil = obs.t + 4;
                return;
            }
        }
        if (tkachs < 2 && obs.pulse.energy >= 90 && currentWeight <= 6) {
            if (tryAddOrder({ kind: 'yard', cls: 'ткач' })) {
                this.yardOrderedUntil = obs.t + 4;
                return;
            }
        }
        if (tkachs >= 2 && klinoks < 1 && obs.pulse.energy >= 50 && currentWeight <= 7) {
            if (tryAddOrder({ kind: 'yard', cls: 'клинок' })) {
                this.yardOrderedUntil = obs.t + 4;
                return;
            }
        }
        if (tkachs < 3 && obs.pulse.energy >= 90 && currentWeight <= 6) {
            if (tryAddOrder({ kind: 'yard', cls: 'ткач' })) {
                this.yardOrderedUntil = obs.t + 4;
                return;
            }
        }
        if (klinoks < 2 && obs.pulse.energy >= 50 && currentWeight <= 7) {
            if (tryAddOrder({ kind: 'yard', cls: 'клинок' })) {
                this.yardOrderedUntil = obs.t + 4;
                return;
            }
        }
    }
    handleCombatKlinoks(obs, tryAddOrder) {
        for (const u of obs.mine.units) {
            if (u.cls !== 'клинок')
                continue;
            if (u.wait > 0)
                continue;
            if (u.away >= 25) {
                tryAddOrder({ kind: 'move', unit: u.id, q: this.hearth.q, r: this.hearth.r, goal: null, home: true });
                continue;
            }
            let ramTarget = null;
            let minTkachDist = Infinity;
            for (const foe of obs.foe) {
                if (foe.p === this.activePact)
                    continue;
                if (foe.cls === 'ткач') {
                    const d = hexDist(u, foe);
                    if (d <= 5 && d < minTkachDist) {
                        minTkachDist = d;
                        ramTarget = foe.id;
                    }
                }
            }
            if (ramTarget) {
                tryAddOrder({ kind: 'ram', unit: u.id, target: ramTarget });
                continue;
            }
            let jamTarget = null;
            for (const [k, owner] of this.needleOwners) {
                if (!owner || owner === this.slot || owner === this.activePact || owner === 'K')
                    continue;
                const nPos = parseHexKey(k);
                if (hexDist(u, nPos) <= 1) {
                    jamTarget = nPos;
                    break;
                }
            }
            if (jamTarget && obs.pulse.chan >= 64) {
                tryAddOrder({ kind: 'jam', unit: u.id, target: jamTarget, hold: true }, 0);
                continue;
            }
            if (!u.task) {
                const orderBoard = obs.pub.order;
                let dest = this.hearth;
                if (orderBoard) {
                    dest = orderBoard.cells[0] ?? this.hearth;
                }
                else {
                    dest = {
                        q: Math.round((this.hearth.q + 0) / 2),
                        r: Math.round((this.hearth.r + 0) / 2),
                    };
                }
                tryAddOrder({ kind: 'move', unit: u.id, q: dest.q, r: dest.r, goal: null, home: false });
            }
        }
    }
    handleExpansionTkachs(obs, tryAddOrder) {
        const assignedKeys = new Set();
        for (const [, k] of this.tkachTarget) {
            assignedKeys.add(k);
        }
        for (const u of obs.mine.units) {
            if (u.cls !== 'ткач')
                continue;
            if (u.wait > 0)
                continue;
            const currKey = hexKey(u.q, u.r);
            const isNeedleCell = this.needles.has(currKey);
            const currOwner = this.needleOwners.get(currKey);
            if (isNeedleCell && currOwner !== this.slot) {
                const isShielded = this.manifest.needles.some((n) => n.q === u.q && n.r === u.r && n.start !== null);
                const inGrace = (this.graceUntil.get(currKey) ?? 0) > obs.t;
                const insideKeeperLine = hexDist(u, { q: 0, r: 0 }) <= 6;
                const keeperForbidden = obs.t < 1000 && !obs.pulse.mercy && insideKeeperLine;
                if (!isShielded && !inGrace && !keeperForbidden && currOwner !== this.activePact) {
                    this.tkachTarget.set(u.id, currKey);
                    continue;
                }
            }
            if (isNeedleCell && currOwner === this.slot) {
                this.tkachTarget.delete(u.id);
                assignedKeys.delete(currKey);
            }
            if (u.task && u.task.path > 0) {
                const targetKey = this.tkachTarget.get(u.id);
                if (targetKey) {
                    const tOwner = this.needleOwners.get(targetKey);
                    const inGrace = (this.graceUntil.get(targetKey) ?? 0) > obs.t;
                    if (tOwner === this.slot || inGrace) {
                        this.tkachTarget.delete(u.id);
                        assignedKeys.delete(targetKey);
                    }
                    else {
                        continue;
                    }
                }
                else {
                    continue;
                }
            }
            const best = this.findBestNeedleTarget(u, obs, assignedKeys);
            if (best) {
                if (tryAddOrder({ kind: 'move', unit: u.id, q: best.q, r: best.r, goal: null, home: false })) {
                    const bKey = hexKey(best.q, best.r);
                    this.tkachTarget.set(u.id, bKey);
                    assignedKeys.add(bKey);
                }
            }
            else if (isNeedleCell && currOwner === this.slot && this.needleLit.has(currKey)) {
                tryAddOrder({ kind: 'feed', unit: u.id, q: u.q, r: u.r });
            }
        }
    }
    findBestNeedleTarget(tkach, obs, assignedKeys) {
        let bestHex = null;
        let bestScore = -Infinity;
        const contractNeedles = new Set();
        if (obs.pub.order) {
            for (const c of obs.pub.order.cells) {
                contractNeedles.add(hexKey(c.q, c.r));
            }
        }
        for (const [k, n] of this.needles) {
            if (assignedKeys.has(k))
                continue;
            const owner = this.needleOwners.get(k);
            if (owner === this.slot)
                continue;
            if (owner === this.activePact)
                continue;
            if (n.start !== null)
                continue;
            if ((this.graceUntil.get(k) ?? 0) > obs.t)
                continue;
            const distCitadel = hexDist(n, { q: 0, r: 0 });
            if (obs.t < 1000 && !obs.pulse.mercy && distCitadel <= 6)
                continue;
            const d = hexDist(tkach, n);
            let score = 100 - d * 5;
            if (contractNeedles.has(k))
                score += 200;
            if (obs.t >= 1000 && n.ring)
                score += 150;
            if (owner === null)
                score += 40;
            if (this.needleDark.get(k))
                score += 30;
            const connectsLit = Array.from(this.needleAdjacency.get(k) ?? []).some((adjKey) => this.needleLit.has(adjKey) || adjKey === hexKey(this.hearth.q, this.hearth.r));
            if (connectsLit)
                score += 50;
            const localPull = this.cellValues.get(k) ?? 1;
            score += localPull * 5;
            if (score > bestScore) {
                bestScore = score;
                bestHex = { q: n.q, r: n.r };
            }
        }
        return bestHex;
    }
}
export function presets() {
    return ['магістр', 'рівний', 'шир', 'обхідник', 'проривник', 'облягач'];
}
export function createStrategy(preset = process.env['ZARIA_PRESET'] || 'магістр') {
    return new MasterStrategy(preset);
}
