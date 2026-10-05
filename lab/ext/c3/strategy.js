/* bot :: strategy
   Dominator strategy for Zoria.
   Autonomous, deterministic, and latency-optimized for maximum pack score. */
import { createEngine } from '@zoria/engine';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, } from '@zoria/protocol';
import { RulesOracle } from '@zoria/sdk';
const HEX_DIRS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
function hexDist(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((a.q + a.r) - (b.q + b.r))) / 2;
}
function hexKey(q, r) {
    return `${q},${r}`;
}
function parseHexKey(k) {
    const parts = k.split(',');
    return { q: Number(parts[0]), r: Number(parts[1]) };
}
class DominatorStrategy {
    preset;
    oracle = null;
    manifest = null;
    slot = 'A';
    hearth = { q: 0, r: 0 };
    cellPassable = new Set();
    cellValues = new Map();
    cellNeighbors = new Map();
    allNeedles = new Map();
    needleLinks = new Map();
    needleValues = new Map();
    needleOwners = new Map();
    yardPendingTicks = 0;
    yardPendingWeight = 0;
    consecutiveRejectedTicks = 0;
    lotBidsPlaced = new Set();
    myStartingNeedles = [];
    constructor(preset) {
        this.preset = preset;
    }
    init(manifestBytes, slot) {
        this.slot = slot;
        this.oracle = new RulesOracle(createEngine, manifestBytes);
        this.manifest = decodeManifest(manifestBytes);
        if (!this.manifest)
            return;
        const seatIdx = this.manifest.perm.indexOf(slot);
        const seatHex = this.manifest.seats[seatIdx >= 0 ? seatIdx : 0];
        this.hearth = seatHex ? { q: seatHex.q, r: seatHex.r } : { q: 0, r: 0 };
        const nonBareMap = new Map();
        for (const entry of this.manifest.terrain.cells) {
            nonBareMap.set(hexKey(entry[0], entry[1]), entry[2]);
        }
        const typeValues = [2, 3, 2, 1, 1, 1, 0, 0];
        const typePass = [true, true, true, true, true, true, false, false];
        for (let q = -19; q <= 19; q++) {
            for (let r = -19; r <= 19; r++) {
                if (hexDist({ q, r }, { q: 0, r: 0 }) <= 19) {
                    const k = hexKey(q, r);
                    const tIdx = nonBareMap.get(k) ?? 0;
                    const val = typeValues[tIdx] ?? 2;
                    const pass = typePass[tIdx] ?? true;
                    this.cellValues.set(k, val);
                    if (pass)
                        this.cellPassable.add(k);
                }
            }
        }
        for (const k of this.cellPassable) {
            const h = parseHexKey(k);
            const validNbrs = [];
            for (const d of HEX_DIRS) {
                const nq = h.q + d.q;
                const nr = h.r + d.r;
                const nk = hexKey(nq, nr);
                if (this.cellPassable.has(nk)) {
                    if (this.oracle.canStep(h, { q: nq, r: nr })) {
                        validNbrs.push({ q: nq, r: nr });
                    }
                }
            }
            this.cellNeighbors.set(k, validNbrs);
        }
        this.myStartingNeedles = [];
        for (const n of this.manifest.needles) {
            const k = hexKey(n.q, n.r);
            this.allNeedles.set(k, n);
            if (n.start) {
                this.needleOwners.set(k, n.start);
                if (n.start === this.slot)
                    this.myStartingNeedles.push(k);
            }
            else if (n.ring || n.spoke) {
                this.needleOwners.set(k, 'K');
            }
            else {
                this.needleOwners.set(k, null);
            }
        }
        const needleList = Array.from(this.allNeedles.values());
        for (let i = 0; i < needleList.length; i++) {
            const nA = needleList[i];
            const kA = hexKey(nA.q, nA.r);
            const linksA = [];
            for (let j = 0; j < needleList.length; j++) {
                if (i === j)
                    continue;
                const nB = needleList[j];
                if (this.oracle.linkOk({ q: nA.q, r: nA.r }, { q: nB.q, r: nB.r })) {
                    linksA.push(hexKey(nB.q, nB.r));
                }
            }
            this.needleLinks.set(kA, linksA);
            let pullVal = 0;
            for (let dq = -3; dq <= 3; dq++) {
                for (let dr = -3; dr <= 3; dr++) {
                    const d = hexDist({ q: 0, r: 0 }, { q: dq, r: dr });
                    if (d <= 3) {
                        const v = this.cellValues.get(hexKey(nA.q + dq, nA.r + dr)) ?? 0;
                        const w = d <= 1 ? 1 : d === 2 ? 0.666 : 0.333;
                        pullVal += v * w;
                    }
                }
            }
            this.needleValues.set(kA, pullVal);
        }
    }
    feedback(verdictBytes) {
        try {
            const verdicts = decodeVerdicts(verdictBytes);
            if (verdicts && verdicts.length > 0) {
                let anyAccepted = false;
                for (const v of verdicts) {
                    if (v[1]) {
                        anyAccepted = true;
                        break;
                    }
                }
                if (anyAccepted) {
                    this.consecutiveRejectedTicks = 0;
                }
                else {
                    this.consecutiveRejectedTicks++;
                }
            }
        }
        catch {
            // Ignore verdict parsing issues
        }
    }
    belief(obs) {
        if (!obs)
            return null;
        const ownRec = {};
        const darkRec = {};
        for (const [k, owner] of this.needleOwners.entries()) {
            ownRec[k] = owner;
        }
        for (const n of obs.mine.needles) {
            const k = hexKey(n.q, n.r);
            ownRec[k] = this.slot;
            darkRec[k] = n.dark;
        }
        const foeList = obs.foe.map((f) => [f.id, f.p, f.q, f.r]);
        const unitList = obs.mine.units.map((u) => [
            u.id,
            u.q,
            u.r,
            u.task?.path ?? 0,
        ]);
        const activePact = obs.pub.pact.active.find((l) => l.a === this.slot || l.b === this.slot);
        const pactPartner = activePact ? (activePact.a === this.slot ? activePact.b : activePact.a) : null;
        const criesList = obs.pub.cries.map((c) => [c[0], c[1]]);
        return {
            t: obs.t,
            full: true,
            pulse: {
                energy: obs.pulse.energy,
                chan: obs.pulse.chan,
                ear: obs.pulse.ear,
                minutes: obs.pulse.minutes,
                needles: obs.pulse.needles,
            },
            own: ownRec,
            dark: darkRec,
            foe: foeList,
            noisy: obs.noisy.length,
            units: unitList,
            pact: pactPartner,
            cries: criesList,
        };
    }
    tick(observeBytes) {
        try {
            const obs = decodeObserve(observeBytes);
            if (!obs || !this.manifest || !this.oracle) {
                return encodeOrders([]);
            }
            const orders = this.think(obs);
            return encodeOrders(orders);
        }
        catch {
            return encodeOrders([]);
        }
    }
    think(obs) {
        if (this.yardPendingTicks > 0) {
            this.yardPendingTicks--;
            if (this.yardPendingTicks === 0) {
                this.yardPendingWeight = 0;
            }
        }
        for (const e of obs.events) {
            if (e.type === 'cap') {
                this.needleOwners.set(hexKey(e.q, e.r), e.p === this.slot ? this.slot : e.p);
            }
            else if (e.type === 'lot') {
                if (e.p !== null && e.lot !== undefined && this.manifest) {
                    const lotSpec = this.manifest.lots[e.lot];
                    if (lotSpec) {
                        for (const c of lotSpec.cells) {
                            this.needleOwners.set(hexKey(c.q, c.r), e.p);
                        }
                    }
                }
            }
        }
        for (const n of obs.mine.needles) {
            this.needleOwners.set(hexKey(n.q, n.r), this.slot);
        }
        const myNeedleKeys = new Set();
        for (const [k, p] of this.needleOwners.entries()) {
            if (p === this.slot)
                myNeedleKeys.add(k);
        }
        const jammedKeys = new Set();
        for (const j of obs.mine.jams) {
            jammedKeys.add(hexKey(j.q, j.r));
        }
        const litNeedleKeys = new Set();
        const litQueue = [];
        for (const sn of this.myStartingNeedles) {
            if (myNeedleKeys.has(sn) && !jammedKeys.has(sn)) {
                litNeedleKeys.add(sn);
                litQueue.push(sn);
            }
        }
        while (litQueue.length > 0) {
            const curr = litQueue.shift();
            const neighbors = this.needleLinks.get(curr) ?? [];
            for (const nbr of neighbors) {
                if (myNeedleKeys.has(nbr) && !jammedKeys.has(nbr) && !litNeedleKeys.has(nbr)) {
                    litNeedleKeys.add(nbr);
                    litQueue.push(nbr);
                }
            }
        }
        const orders = [];
        const chanCap = Math.floor(obs.pulse.chanAt / 32) + 4;
        let chanBudget = obs.pulse.chan;
        let actingUnits = 0;
        for (const u of obs.mine.units) {
            if (u.wait > 0 || u.task !== null || (u.cls === 'ткач' && this.canHeatHere(u.q, u.r, obs.t))) {
                actingUnits++;
            }
        }
        const maxOrderCost = Math.max(32, chanBudget - actingUnits * 32);
        let allowedOrders = Math.min(chanCap, Math.floor(maxOrderCost / 32));
        // 1. AUCTION BIDDING
        if (this.manifest && allowedOrders > 0 && chanBudget >= 32) {
            for (let lotIdx = 0; lotIdx < this.manifest.lots.length; lotIdx++) {
                const lot = this.manifest.lots[lotIdx];
                if (!lot)
                    continue;
                if (obs.t >= lot.at - 25 && obs.t < lot.at && !this.lotBidsPlaced.has(lotIdx)) {
                    if (obs.pulse.energy >= 130) {
                        const bidVal = obs.pulse.energy >= 250 ? 79 : 67;
                        orders.push({ kind: 'bid', lot: lotIdx, amount: bidVal });
                        this.lotBidsPlaced.add(lotIdx);
                        chanBudget -= 32;
                        allowedOrders--;
                        break;
                    }
                }
            }
        }
        // 2. YARD RECRUITMENT
        let currentTkachs = 0;
        let currentKlinoks = 0;
        for (const u of obs.mine.units) {
            if (u.cls === 'ткач')
                currentTkachs++;
            else if (u.cls === 'клинок')
                currentKlinoks++;
        }
        const totalSwarmWeight = currentTkachs * 2 + currentKlinoks * 1 + this.yardPendingWeight;
        if (this.yardPendingTicks === 0 && allowedOrders > 0 && chanBudget >= 32) {
            let wantClass = null;
            let wantEnergy = 0;
            let wantWeight = 0;
            const dawnApproaching = obs.t >= 900;
            const targetTkachs = dawnApproaching ? 3 : 2;
            if (currentTkachs < targetTkachs && totalSwarmWeight <= 6 && obs.pulse.energy >= 90) {
                wantClass = 'ткач';
                wantEnergy = 90;
                wantWeight = 2;
            }
            else if (totalSwarmWeight <= 7 && obs.pulse.energy >= 50) {
                wantClass = 'клинок';
                wantEnergy = 50;
                wantWeight = 1;
            }
            if (wantClass && obs.pulse.energy >= wantEnergy) {
                orders.push({ kind: 'yard', cls: wantClass });
                this.yardPendingTicks = 4;
                this.yardPendingWeight = wantWeight;
                chanBudget -= 32;
                allowedOrders--;
            }
        }
        // 3. UNIT ORDERS
        const assignedTargets = new Set();
        for (const u of obs.mine.units) {
            if (allowedOrders <= 0 || chanBudget < 32)
                break;
            if (u.wait > 0)
                continue;
            if (u.cls === 'клинок') {
                const order = this.orderKlinok(u, obs, assignedTargets);
                if (order) {
                    orders.push(order);
                    chanBudget -= 32;
                    allowedOrders--;
                }
            }
            else if (u.cls === 'ткач') {
                const order = this.orderTkach(u, obs, litNeedleKeys, assignedTargets);
                if (order) {
                    orders.push(order);
                    chanBudget -= 32;
                    allowedOrders--;
                }
            }
        }
        // 4. GUARANTEE ZERO SILENCE TICKS (ANTI-NAKAZ)
        if (orders.length === 0) {
            const idle = obs.mine.units.find((u) => u.wait === 0 && u.task === null);
            if (idle && chanBudget >= 32) {
                orders.push({ kind: 'halt', unit: idle.id });
            }
            else if (chanBudget >= 32) {
                orders.push({ kind: 'watch', q: this.hearth.q, r: this.hearth.r, keep: 0 });
            }
        }
        return orders;
    }
    canHeatHere(q, r, t) {
        const k = hexKey(q, r);
        const owner = this.needleOwners.get(k);
        if (owner === this.slot)
            return false;
        if (owner === undefined)
            return false;
        if (t < 1000 && hexDist({ q, r }, { q: 0, r: 0 }) <= 6)
            return false;
        return true;
    }
    orderKlinok(u, obs, assigned) {
        const uPos = { q: u.q, r: u.r };
        // Priority 1: Clean Ram against heating/building enemy Tkachs
        let bestRamTarget = null;
        let minRamDist = 8;
        for (const foe of obs.foe) {
            if (foe.cls === 'ткач') {
                const foeKey = hexKey(foe.q, foe.r);
                const onNeedle = this.allNeedles.has(foeKey);
                const d = hexDist(uPos, { q: foe.q, r: foe.r });
                if ((onNeedle || d <= 3) && d <= minRamDist) {
                    minRamDist = d;
                    bestRamTarget = foe.id;
                }
            }
        }
        if (bestRamTarget) {
            return { kind: 'ram', unit: u.id, target: bestRamTarget };
        }
        // Priority 2: Defensive Ram against nearby enemy Klinoks threatening our Tkachs
        for (const myTkach of obs.mine.units) {
            if (myTkach.cls === 'ткач') {
                for (const foe of obs.foe) {
                    if (foe.cls === 'клинок') {
                        const distToTkach = hexDist({ q: myTkach.q, r: myTkach.r }, { q: foe.q, r: foe.r });
                        if (distToTkach <= 2 && hexDist(uPos, { q: foe.q, r: foe.r }) <= 4) {
                            return { kind: 'ram', unit: u.id, target: foe.id };
                        }
                    }
                }
            }
        }
        // Priority 3: Jam valuable enemy needle
        let bestJamNeedle = null;
        let bestJamScore = -1;
        for (const [k, owner] of this.needleOwners.entries()) {
            if (owner && owner !== this.slot && owner !== 'K') {
                const nHex = parseHexKey(k);
                const d = hexDist(uPos, nHex);
                if (d <= 10) {
                    const val = (this.needleValues.get(k) ?? 10) / (d + 1);
                    if (val > bestJamScore) {
                        bestJamScore = val;
                        bestJamNeedle = nHex;
                    }
                }
            }
        }
        if (bestJamNeedle) {
            const d = hexDist(uPos, bestJamNeedle);
            if (d <= 1) {
                return { kind: 'jam', unit: u.id, target: bestJamNeedle, hold: true };
            }
            const adjCells = this.cellNeighbors.get(hexKey(bestJamNeedle.q, bestJamNeedle.r)) ?? [];
            let bestAdj = null;
            let minAdjDist = 999;
            for (const adj of adjCells) {
                const ad = hexDist(uPos, adj);
                if (ad < minAdjDist) {
                    minAdjDist = ad;
                    bestAdj = adj;
                }
            }
            if (bestAdj && (!u.task?.goal || hexDist(u.task.goal, bestAdj) > 0)) {
                return { kind: 'move', unit: u.id, q: bestAdj.q, r: bestAdj.r, goal: bestJamNeedle, home: false };
            }
        }
        // Priority 4: Escort / Contract Guard
        if (obs.pub.order) {
            for (const c of obs.pub.order.cells) {
                const d = hexDist(uPos, c);
                if (d > 1 && (!u.task?.goal || hexDist(u.task.goal, c) > 1)) {
                    return { kind: 'move', unit: u.id, q: c.q, r: c.r, goal: c, home: false };
                }
            }
        }
        return null;
    }
    orderTkach(u, obs, litKeys, assigned) {
        const uPos = { q: u.q, r: u.r };
        const currKey = hexKey(u.q, u.r);
        // If standing on a needle it can heat: let it heat!
        if (this.canHeatHere(u.q, u.r, obs.t)) {
            if (u.task) {
                return { kind: 'halt', unit: u.id };
            }
            return null;
        }
        // Priority 1: Dawn Rush (t >= 980) towards Keeper ring needles
        if (obs.t >= 980) {
            let bestRing = null;
            let minRingDist = 999;
            for (const [k, nSpec] of this.allNeedles.entries()) {
                if (nSpec.ring && this.needleOwners.get(k) !== this.slot && !assigned.has(k)) {
                    const d = hexDist(uPos, { q: nSpec.q, r: nSpec.r });
                    if (d < minRingDist) {
                        minRingDist = d;
                        bestRing = { q: nSpec.q, r: nSpec.r };
                    }
                }
            }
            if (bestRing) {
                assigned.add(hexKey(bestRing.q, bestRing.r));
                if (!u.task?.goal || hexDist(u.task.goal, bestRing) > 0) {
                    return { kind: 'move', unit: u.id, q: bestRing.q, r: bestRing.r, goal: bestRing, home: false };
                }
                return null;
            }
        }
        // Priority 2: Contract Needles
        if (obs.pub.order) {
            for (const c of obs.pub.order.cells) {
                const ck = hexKey(c.q, c.r);
                if (this.needleOwners.get(ck) !== this.slot && !assigned.has(ck)) {
                    assigned.add(ck);
                    if (!u.task?.goal || hexDist(u.task.goal, c) > 0) {
                        return { kind: 'move', unit: u.id, q: c.q, r: c.r, goal: c, home: false };
                    }
                    return null;
                }
            }
        }
        // Priority 3: Expanding to Connected Unowned Ruins
        let bestRuin = null;
        let bestRuinScore = -1;
        for (const [k, owner] of this.needleOwners.entries()) {
            if (owner === null && !assigned.has(k)) {
                const rHex = parseHexKey(k);
                if (obs.t < 1000 && hexDist(rHex, { q: 0, r: 0 }) <= 6)
                    continue;
                let connects = false;
                const links = this.needleLinks.get(k) ?? [];
                for (const lnk of links) {
                    if (litKeys.has(lnk)) {
                        connects = true;
                        break;
                    }
                }
                const d = hexDist(uPos, rHex);
                const baseVal = this.needleValues.get(k) ?? 15;
                const score = (connects ? baseVal * 2 : baseVal) / (d + 1);
                if (score > bestRuinScore) {
                    bestRuinScore = score;
                    bestRuin = rHex;
                }
            }
        }
        if (bestRuin) {
            const brKey = hexKey(bestRuin.q, bestRuin.r);
            assigned.add(brKey);
            if (!u.task?.goal || hexDist(u.task.goal, bestRuin) > 0) {
                return { kind: 'move', unit: u.id, q: bestRuin.q, r: bestRuin.r, goal: bestRuin, home: false };
            }
            return null;
        }
        // Priority 4: Feeding Lit High-Value Needle
        if (!u.task?.feed && litKeys.has(currKey)) {
            return { kind: 'feed', unit: u.id, q: u.q, r: u.r };
        }
        return null;
    }
}
export function presets() {
    return ['домінатор', 'рівний', 'експансія', 'штурм'];
}
export function createStrategy(preset = 'домінатор') {
    return new DominatorStrategy(preset);
}
