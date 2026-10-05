/* bot :: strategy
   Dominant competitive strategy for Zoria:
   - High-yield meadow network expansion with instant thread linking
   - Clean ram sniper Klinoks targeting enemy builders and heaters
   - Tactical jamming for territory disruption and loot pull
   - Aggressive contract fulfillment (+30 bonus minutes)
   - Pre-dawn positioning and instant Dawn ring capture (2.0x pull)
   - Non-colliding prime auction bids
   - Active anti-silence heartbeat guaranteeing the Nakaz never takes control
*/
import { createEngine } from '@zoria/engine';
import { decodeManifest, decodeObserve, decodeVerdicts, encodeOrders, orderCap, } from '@zoria/protocol';
import { RulesOracle } from '@zoria/sdk';
const COV_RINGS = [1, 1, 0.666667, 0.333333];
function hexDist(aq, ar, bq, br) {
    return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - (bq + br))) / 2;
}
function hexKey(q, r) {
    return `${q},${r}`;
}
class FastRng {
    state;
    constructor(seed = 133742) {
        this.state = seed >>> 0;
    }
    next() {
        this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
        return this.state / 0x100000000;
    }
}
export class DominantStrategy {
    presetName;
    rng = new FastRng(987654321);
    manifest = null;
    mySlot = 'A';
    hearth = { q: 6, r: -12 };
    oracle = null;
    needles = new Map();
    needleNeighbors = new Map();
    bidsPlaced = new Set();
    yardQueue = [];
    consecutiveSilentTicks = 0;
    lastScannedTick = -100;
    constructor(presetName = 'домінант') {
        this.presetName = presetName;
    }
    init(manifestBytes, slot) {
        const decoded = decodeManifest(manifestBytes);
        if (!decoded)
            return;
        this.manifest = decoded;
        this.mySlot = slot;
        this.oracle = new RulesOracle(createEngine, manifestBytes);
        const seatIdx = slot === 'A' ? 0 : slot === 'B' ? 1 : 2;
        const seat = this.manifest.seats[seatIdx];
        this.hearth = seat ? { q: seat.q, r: seat.r } : { q: 0, r: 0 };
        this.needles.clear();
        this.needleNeighbors.clear();
        this.bidsPlaced.clear();
        this.yardQueue.length = 0;
        this.consecutiveSilentTicks = 0;
        this.lastScannedTick = -100;
        for (const spec of this.manifest.needles) {
            const k = hexKey(spec.q, spec.r);
            const isStart = spec.start !== null;
            const initialOwner = spec.start ?? (spec.ring ? 'K' : null);
            const isMyStart = spec.start === this.mySlot;
            let staticVal = 0;
            for (let dq = -3; dq <= 3; dq++) {
                for (let dr = -3; dr <= 3; dr++) {
                    const d = hexDist(0, 0, dq, dr);
                    if (d <= 3) {
                        const pull = COV_RINGS[d] ?? 0;
                        const tq = spec.q + dq;
                        const tr = spec.r + dr;
                        if (hexDist(0, 0, tq, tr) <= 19) {
                            staticVal += pull * 2;
                        }
                    }
                }
            }
            this.needles.set(k, {
                q: spec.q,
                r: spec.r,
                key: k,
                owner: initialOwner,
                dark: false,
                lit: isMyStart,
                isStarting: isStart,
                isRing: spec.ring,
                staticVal,
                capGraceUntil: 0,
            });
        }
        const needleList = Array.from(this.needles.values());
        for (let i = 0; i < needleList.length; i++) {
            const a = needleList[i];
            if (!a)
                continue;
            const neighbors = [];
            for (let j = 0; j < needleList.length; j++) {
                if (i === j)
                    continue;
                const b = needleList[j];
                if (!b)
                    continue;
                if (this.oracle.linkOk({ q: a.q, r: a.r }, { q: b.q, r: b.r })) {
                    neighbors.push(b.key);
                }
            }
            this.needleNeighbors.set(a.key, neighbors);
        }
    }
    feedback(verdictBytes) {
        try {
            const verdicts = decodeVerdicts(verdictBytes);
            if (!verdicts || verdicts.length === 0)
                return;
            let hasAccepted = false;
            for (const v of verdicts) {
                if (v[1] === true) {
                    hasAccepted = true;
                    break;
                }
            }
            if (hasAccepted) {
                this.consecutiveSilentTicks = 0;
            }
            else {
                this.consecutiveSilentTicks++;
            }
        }
        catch {
            // ignore
        }
    }
    tick(observeBytes) {
        try {
            const obs = decodeObserve(observeBytes);
            if (!obs || !this.manifest || !this.oracle) {
                return encodeOrders([]);
            }
            this.updateWorldState(obs);
            const orders = this.planOrders(obs);
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
        const ownMap = {};
        const darkMap = {};
        for (const [key, n] of this.needles.entries()) {
            ownMap[key] = n.owner;
            darkMap[key] = n.dark;
        }
        const foeList = obs.foe.map((f) => [
            f.id,
            f.p,
            f.q,
            f.r,
        ]);
        const unitList = obs.mine.units.map((u) => [
            u.id,
            u.q,
            u.r,
            u.task?.path ?? 0,
        ]);
        const activePact = obs.pub.pact.active.find((p) => p.a === this.mySlot || p.b === this.mySlot);
        const pactPartner = activePact
            ? activePact.a === this.mySlot
                ? activePact.b
                : activePact.a
            : null;
        const criesList = obs.pub.cries.map(([s, n]) => [s, n]);
        const pulse = {
            energy: obs.pulse.energy,
            chan: obs.pulse.chan,
            ear: obs.pulse.ear,
            minutes: obs.pulse.minutes,
            needles: obs.pulse.needles,
        };
        return {
            t: obs.t,
            full: true,
            pulse,
            own: ownMap,
            dark: darkMap,
            foe: foeList,
            noisy: obs.noisy.length,
            units: unitList,
            pact: pactPartner,
            cries: criesList,
        };
    }
    updateWorldState(obs) {
        for (let i = this.yardQueue.length - 1; i >= 0; i--) {
            const q = this.yardQueue[i];
            if (q && q.readyTick <= obs.t) {
                this.yardQueue.splice(i, 1);
            }
        }
        for (const mn of obs.mine.needles) {
            const k = hexKey(mn.q, mn.r);
            const existing = this.needles.get(k);
            if (existing) {
                existing.owner = this.mySlot;
                existing.dark = mn.dark;
                existing.lit = !mn.dark;
            }
            else {
                this.registerDynamicNeedle(mn.q, mn.r, this.mySlot, mn.dark);
            }
        }
        for (const own of obs.own) {
            const k = hexKey(own.q, own.r);
            const existing = this.needles.get(k);
            if (existing) {
                existing.owner = own.owner;
                existing.dark = own.dark;
                existing.lit = own.owner === this.mySlot && !own.dark;
            }
            else if (own.owner !== null) {
                this.registerDynamicNeedle(own.q, own.r, own.owner, own.dark);
            }
        }
        for (const ev of obs.events) {
            if (ev.type === 'cap') {
                const k = hexKey(ev.q, ev.r);
                const existing = this.needles.get(k);
                if (existing) {
                    existing.owner = ev.p;
                    existing.dark = false;
                    existing.lit = ev.p === this.mySlot;
                    existing.capGraceUntil = obs.t + 60;
                }
            }
            else if (ev.type === 'raise') {
                const k = hexKey(ev.q, ev.r);
                const existing = this.needles.get(k);
                if (existing) {
                    existing.owner = ev.p;
                    existing.dark = false;
                    existing.lit = ev.p === this.mySlot;
                    existing.capGraceUntil = obs.t + 60;
                }
                else {
                    this.registerDynamicNeedle(ev.q, ev.r, ev.p, false, obs.t + 60);
                }
            }
            else if (ev.type === 'dawn') {
                for (const n of this.needles.values()) {
                    if (n.isRing && n.owner === 'K') {
                        n.dark = true;
                        n.lit = false;
                    }
                }
            }
        }
        this.refreshLitNetwork();
    }
    registerDynamicNeedle(q, r, owner, dark, graceUntil = 0) {
        const k = hexKey(q, r);
        const nState = {
            q,
            r,
            key: k,
            owner,
            dark,
            lit: owner === this.mySlot && !dark,
            isStarting: false,
            isRing: false,
            staticVal: 20,
            capGraceUntil: graceUntil,
        };
        this.needles.set(k, nState);
        if (this.oracle) {
            const neighbors = [];
            for (const other of this.needles.values()) {
                if (other.key === k)
                    continue;
                if (this.oracle.linkOk({ q, r }, { q: other.q, r: other.r })) {
                    neighbors.push(other.key);
                    const otherN = this.needleNeighbors.get(other.key);
                    if (otherN && !otherN.includes(k)) {
                        otherN.push(k);
                    }
                }
            }
            this.needleNeighbors.set(k, neighbors);
        }
    }
    refreshLitNetwork() {
        for (const n of this.needles.values()) {
            if (n.owner === this.mySlot) {
                if (n.dark) {
                    n.lit = false;
                }
            }
            else {
                n.lit = false;
            }
        }
        const queue = [];
        const visited = new Set();
        for (const n of this.needles.values()) {
            if (n.owner === this.mySlot && n.isStarting && !n.dark) {
                n.lit = true;
                visited.add(n.key);
                queue.push(n.key);
            }
        }
        while (queue.length > 0) {
            const currKey = queue.shift();
            if (!currKey)
                break;
            const neighbors = this.needleNeighbors.get(currKey) ?? [];
            for (const nbrKey of neighbors) {
                if (visited.has(nbrKey))
                    continue;
                const nbr = this.needles.get(nbrKey);
                if (nbr && nbr.owner === this.mySlot && !nbr.dark) {
                    nbr.lit = true;
                    visited.add(nbrKey);
                    queue.push(nbrKey);
                }
            }
        }
    }
    isConnectedToLit(needleKey) {
        const neighbors = this.needleNeighbors.get(needleKey) ?? [];
        for (const nk of neighbors) {
            const n = this.needles.get(nk);
            if (n && n.owner === this.mySlot && n.lit) {
                return true;
            }
        }
        return false;
    }
    planOrders(obs) {
        const orders = [];
        const cfg = this.manifest?.cfg ?? {};
        const cap = Math.min(orderCap(cfg, obs.pulse.chanAt), Math.floor(obs.pulse.chan / 32));
        const activeUnits = obs.mine.units.filter((u) => u.task !== null || (u.cls === 'ткач' && this.isStandingOnHeatTarget(u, obs.t))).length;
        const reservedBytes = activeUnits * 32;
        const orderQuota = Math.max(1, Math.min(cap, Math.floor((obs.pulse.chan - reservedBytes) / 32) + 1));
        this.planAuctions(obs, orders);
        this.planYard(obs, orders);
        this.planScans(obs, orders);
        this.planKlinoks(obs, orders);
        this.planTkachs(obs, orders);
        if (orders.length === 0 && this.consecutiveSilentTicks >= 3) {
            if (obs.pulse.chan >= 32) {
                orders.push({ kind: 'watch', q: this.hearth.q, r: this.hearth.r, keep: 0 });
            }
        }
        while (orders.length > orderQuota) {
            orders.pop();
        }
        return orders;
    }
    isStandingOnHeatTarget(u, t) {
        const n = this.needles.get(hexKey(u.q, u.r));
        if (!n)
            return false;
        if (n.owner === this.mySlot || n.isStarting)
            return false;
        if (t < n.capGraceUntil)
            return false;
        return true;
    }
    planAuctions(obs, orders) {
        if (!this.manifest || obs.pulse.energy < 65 || obs.pulse.chan < 64)
            return;
        for (let i = 0; i < this.manifest.lots.length; i++) {
            if (this.bidsPlaced.has(i))
                continue;
            const lot = this.manifest.lots[i];
            if (!lot)
                continue;
            if (lot.at > obs.t && lot.at - obs.t <= 18) {
                let hasUnowned = false;
                for (const cell of lot.cells) {
                    const n = this.needles.get(hexKey(cell.q, cell.r));
                    if (n && n.owner === null) {
                        hasUnowned = true;
                        break;
                    }
                }
                if (hasUnowned) {
                    let bid = 67;
                    if (obs.pulse.energy >= 210) {
                        bid = 97;
                    }
                    else if (obs.pulse.energy >= 140) {
                        bid = 83;
                    }
                    else if (obs.pulse.energy >= 85) {
                        bid = 71;
                    }
                    if (bid <= obs.pulse.energy) {
                        orders.push({ kind: 'bid', lot: i, amount: bid });
                        this.bidsPlaced.add(i);
                        break;
                    }
                }
            }
        }
    }
    planYard(obs, orders) {
        if (obs.pulse.chan < 64)
            return;
        let fieldWeight = 0;
        let tkachCount = 0;
        let klinokCount = 0;
        for (const u of obs.mine.units) {
            if (u.cls === 'ткач') {
                fieldWeight += 2;
                tkachCount++;
            }
            else {
                fieldWeight += 1;
                klinokCount++;
            }
        }
        let queueWeight = 0;
        for (const q of this.yardQueue) {
            if (q.cls === 'ткач') {
                queueWeight += 2;
                tkachCount++;
            }
            else {
                queueWeight += 1;
                klinokCount++;
            }
        }
        const totalWeight = fieldWeight + queueWeight;
        if (totalWeight >= 8)
            return;
        if (tkachCount < 1 && obs.pulse.energy >= 90) {
            orders.push({ kind: 'yard', cls: 'ткач' });
            this.yardQueue.push({ cls: 'ткач', readyTick: obs.t + 4 });
            return;
        }
        if (totalWeight <= 6) {
            if (tkachCount < 2 && obs.pulse.energy >= 90) {
                orders.push({ kind: 'yard', cls: 'ткач' });
                this.yardQueue.push({ cls: 'ткач', readyTick: obs.t + 4 });
                return;
            }
            if (klinokCount < 1 && obs.pulse.energy >= 50) {
                orders.push({ kind: 'yard', cls: 'клинок' });
                this.yardQueue.push({ cls: 'клинок', readyTick: obs.t + 4 });
                return;
            }
            if (tkachCount < 3 && obs.pulse.energy >= 90) {
                orders.push({ kind: 'yard', cls: 'ткач' });
                this.yardQueue.push({ cls: 'ткач', readyTick: obs.t + 4 });
                return;
            }
            if (klinokCount < 2 && obs.pulse.energy >= 50) {
                orders.push({ kind: 'yard', cls: 'клинок' });
                this.yardQueue.push({ cls: 'клинок', readyTick: obs.t + 4 });
                return;
            }
        }
    }
    planScans(obs, orders) {
        if (obs.pulse.ear < 300)
            return;
        if (obs.t - this.lastScannedTick < 120)
            return;
        if (obs.pub.order && obs.pub.order.cells.length > 0) {
            const c = obs.pub.order.cells[0];
            if (c) {
                orders.push({ kind: 'scan', q: c.q, r: c.r, rad: 3 });
                this.lastScannedTick = obs.t;
                return;
            }
        }
        if (obs.t >= 970 && obs.t <= 995) {
            orders.push({ kind: 'scan', q: 0, r: 0, rad: 3 });
            this.lastScannedTick = obs.t;
        }
    }
    planKlinoks(obs, orders) {
        const klinoks = obs.mine.units.filter((u) => u.cls === 'клинок' && u.wait === 0);
        if (klinoks.length === 0)
            return;
        for (const k of klinoks) {
            if (k.away >= 28) {
                const safeNeedle = this.findNearestLitNeedle(k.q, k.r);
                orders.push({
                    kind: 'move',
                    unit: k.id,
                    q: safeNeedle.q,
                    r: safeNeedle.r,
                    goal: null,
                    home: true,
                });
                continue;
            }
            let cleanRamTarget = null;
            let minRamDist = 999;
            for (const foe of obs.foe) {
                const d = hexDist(k.q, k.r, foe.q, foe.r);
                if (foe.cls === 'ткач' && d <= 5) {
                    const onNeedle = this.needles.has(hexKey(foe.q, foe.r));
                    if (onNeedle && d < minRamDist) {
                        cleanRamTarget = foe.id;
                        minRamDist = d;
                    }
                }
            }
            if (cleanRamTarget) {
                orders.push({ kind: 'ram', unit: k.id, target: cleanRamTarget });
                continue;
            }
            let closeFoe = null;
            let minFoeDist = 999;
            for (const foe of obs.foe) {
                const d = hexDist(k.q, k.r, foe.q, foe.r);
                if (d <= 3 && d < minFoeDist) {
                    closeFoe = foe.id;
                    minFoeDist = d;
                }
            }
            if (closeFoe) {
                orders.push({ kind: 'ram', unit: k.id, target: closeFoe });
                continue;
            }
            let adjacentJamTarget = null;
            for (const n of this.needles.values()) {
                if (n.owner !== null && n.owner !== this.mySlot && !n.isStarting) {
                    if (hexDist(k.q, k.r, n.q, n.r) <= 1) {
                        adjacentJamTarget = n;
                        break;
                    }
                }
            }
            if (adjacentJamTarget) {
                orders.push({
                    kind: 'jam',
                    unit: k.id,
                    target: { q: adjacentJamTarget.q, r: adjacentJamTarget.r },
                    hold: true,
                });
                continue;
            }
            if (k.task === null || k.task.path === 0) {
                const raidNeedle = this.findBestJamTarget(k.q, k.r);
                if (raidNeedle) {
                    orders.push({
                        kind: 'move',
                        unit: k.id,
                        q: raidNeedle.q,
                        r: raidNeedle.r,
                        goal: null,
                        home: false,
                    });
                }
            }
        }
    }
    planTkachs(obs, orders) {
        const tkachs = obs.mine.units.filter((u) => u.cls === 'ткач' && u.wait === 0);
        if (tkachs.length === 0)
            return;
        for (const t of tkachs) {
            if (t.work > 0)
                continue;
            const currNeedle = this.needles.get(hexKey(t.q, t.r));
            if (currNeedle) {
                const isTarget = currNeedle.owner !== this.mySlot &&
                    !currNeedle.isStarting &&
                    obs.t >= currNeedle.capGraceUntil;
                if (isTarget) {
                    if (obs.t < 1000 && currNeedle.isRing && currNeedle.owner === 'K') {
                        // inside line before dawn - retreat to avoid Keeper ram
                    }
                    else {
                        // heating in progress, do not interrupt
                        continue;
                    }
                }
            }
            if (t.task !== null && t.task.path > 0) {
                continue;
            }
            if (obs.pub.order) {
                const contractNeedle = this.findUnownedContractNeedle(obs.pub.order.cells, obs.t);
                if (contractNeedle) {
                    orders.push({
                        kind: 'move',
                        unit: t.id,
                        q: contractNeedle.q,
                        r: contractNeedle.r,
                        goal: null,
                        home: false,
                    });
                    continue;
                }
            }
            if (obs.t >= 975 && obs.t < 1000) {
                const perimeterCell = this.findBestPerimeterCell(t.q, t.r);
                orders.push({
                    kind: 'move',
                    unit: t.id,
                    q: perimeterCell.q,
                    r: perimeterCell.r,
                    goal: null,
                    home: false,
                });
                continue;
            }
            if (obs.t >= 1000) {
                const ringNeedle = this.findBestRingNeedle(t.q, t.r, obs.t);
                if (ringNeedle) {
                    orders.push({
                        kind: 'move',
                        unit: t.id,
                        q: ringNeedle.q,
                        r: ringNeedle.r,
                        goal: null,
                        home: false,
                    });
                    continue;
                }
            }
            const expansionTarget = this.findBestExpansionRuin(t.q, t.r, obs.t);
            if (expansionTarget) {
                orders.push({
                    kind: 'move',
                    unit: t.id,
                    q: expansionTarget.q,
                    r: expansionTarget.r,
                    goal: null,
                    home: false,
                });
                continue;
            }
            const bestLit = this.findBestFeedNeedle();
            if (bestLit) {
                if (hexDist(t.q, t.r, bestLit.q, bestLit.r) === 0) {
                    orders.push({ kind: 'feed', unit: t.id, q: bestLit.q, r: bestLit.r });
                }
                else {
                    orders.push({
                        kind: 'move',
                        unit: t.id,
                        q: bestLit.q,
                        r: bestLit.r,
                        goal: null,
                        home: false,
                    });
                }
            }
        }
    }
    findNearestLitNeedle(q, r) {
        let bestDist = 999;
        let target = this.hearth;
        for (const n of this.needles.values()) {
            if (n.owner === this.mySlot && n.lit) {
                const d = hexDist(q, r, n.q, n.r);
                if (d < bestDist) {
                    bestDist = d;
                    target = { q: n.q, r: n.r };
                }
            }
        }
        return target;
    }
    findBestJamTarget(kq, kr) {
        let bestScore = -999;
        let bestNeedle = null;
        for (const n of this.needles.values()) {
            if (n.owner !== null && n.owner !== this.mySlot && !n.isStarting && !n.dark) {
                const d = hexDist(kq, kr, n.q, n.r);
                const score = n.staticVal - d * 2.5;
                if (score > bestScore) {
                    bestScore = score;
                    bestNeedle = n;
                }
            }
        }
        return bestNeedle;
    }
    findUnownedContractNeedle(cells, t) {
        for (const c of cells) {
            const n = this.needles.get(hexKey(c.q, c.r));
            if (n && n.owner !== this.mySlot && t >= n.capGraceUntil) {
                return n;
            }
        }
        return null;
    }
    findBestPerimeterCell(tq, tr) {
        const candidates = [
            { q: 7, r: -4 },
            { q: 4, r: 3 },
            { q: -3, r: 7 },
            { q: -7, r: 4 },
            { q: -4, r: -3 },
            { q: 3, r: -7 },
        ];
        let bestDist = 999;
        let chosen = candidates[0] ?? { q: 7, r: -4 };
        for (const c of candidates) {
            const d = hexDist(tq, tr, c.q, c.r);
            if (d < bestDist) {
                bestDist = d;
                chosen = c;
            }
        }
        return chosen;
    }
    findBestRingNeedle(tq, tr, t) {
        let bestDist = 999;
        let chosen = null;
        for (const n of this.needles.values()) {
            if (n.isRing && n.owner !== this.mySlot && t >= n.capGraceUntil) {
                const d = hexDist(tq, tr, n.q, n.r);
                if (d < bestDist) {
                    bestDist = d;
                    chosen = n;
                }
            }
        }
        return chosen;
    }
    findBestExpansionRuin(tq, tr, t) {
        let bestScore = -999;
        let chosen = null;
        for (const n of this.needles.values()) {
            if (n.isStarting)
                continue;
            if (n.owner === this.mySlot)
                continue;
            if (t < n.capGraceUntil)
                continue;
            if (t < 1000 && hexDist(0, 0, n.q, n.r) <= 6) {
                continue;
            }
            const d = hexDist(tq, tr, n.q, n.r);
            const isLinked = this.isConnectedToLit(n.key);
            const linkBonus = isLinked ? 35 : 0;
            const enemyBonus = n.owner !== null ? 10 : 0;
            const score = n.staticVal + linkBonus + enemyBonus - d * 2.2;
            if (score > bestScore) {
                bestScore = score;
                chosen = n;
            }
        }
        return chosen;
    }
    findBestFeedNeedle() {
        let bestVal = -1;
        let chosen = null;
        for (const n of this.needles.values()) {
            if (n.owner === this.mySlot && n.lit && !n.isStarting) {
                if (n.staticVal > bestVal) {
                    bestVal = n.staticVal;
                    chosen = n;
                }
            }
        }
        return chosen;
    }
}
export function presets() {
    return ['домінант', 'рівний', 'шир', 'обхідник', 'проривник', 'облягач'];
}
export function createStrategy(preset = process.env['ZARIA_PRESET'] || 'домінант') {
    return new DominantStrategy(preset);
}
