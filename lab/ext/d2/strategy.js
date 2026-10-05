import { createEngine } from '@zoria/engine';
import { RulesOracle } from '@zoria/sdk';
import { encodeOrders, decodeObserve } from '@zoria/protocol';
export function presets() {
    return ['greedy_expansion'];
}
export function createStrategy(preset) {
    return new GreedyStrategy();
}
function hexDist(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
class GreedyStrategy {
    oracle;
    manifest;
    slot;
    ticksSinceCommand = 0;
    yardWait = 0;
    init(manifestBytes, slot) {
        this.slot = slot;
        this.oracle = new RulesOracle(createEngine, manifestBytes);
        this.manifest = this.oracle.manifest;
    }
    tick(observeBytes) {
        try {
            const obs = decodeObserve(observeBytes);
            if (!obs)
                return encodeOrders([]);
            return encodeOrders(this.think(obs));
        }
        catch (e) {
            return encodeOrders([]);
        }
    }
    feedback(verdictsBytes) {
        // Strategy derives world state intrinsically; feedback is ignored.
    }
    belief(obs) {
        // Skipping custom trace calculations to safely ensure <100ms response guarantees
        return null;
    }
    think(obs) {
        const orders = [];
        let channel = obs.pulse.chan;
        const cost = this.manifest.cfg['chanOrder'] ?? 32;
        const hearthIdx = ['A', 'B', 'C'].indexOf(this.slot);
        const hearth = this.manifest.seats[hearthIdx];
        const myTkachs = obs.mine.units.filter(u => u.cls === 'ткач');
        const myKlinoks = obs.mine.units.filter(u => u.cls === 'клинок');
        const weight = myTkachs.length * 2 + myKlinoks.length * 1;
        if (this.yardWait > 0)
            this.yardWait--;
        // 1. Swarm Replenishment: Maintain maximum Tkachs for expansion
        const needTkach = weight < 8 && this.yardWait <= 0;
        if (needTkach && obs.pulse.energy >= 90 && channel >= cost) {
            orders.push({ kind: 'yard', cls: 'ткач' });
            this.yardWait = 5;
            channel -= cost;
        }
        // 2. Bidding Logic: Dump energy into viable lots the tick before they reveal
        for (let i = 0; i < this.manifest.lots.length; i++) {
            const lot = this.manifest.lots[i];
            if (lot && obs.t === lot.at - 1) {
                let amount = Math.floor(obs.pulse.energy);
                if (needTkach)
                    amount -= 90; // Don't cripple swarm economy
                if (amount >= 60 && channel >= cost) {
                    orders.push({ kind: 'bid', lot: i, amount });
                    channel -= cost;
                }
            }
        }
        // 3. Identification of Valid Targets
        const myLitNeedles = obs.mine.needles.filter(n => n.weight > 0);
        const myLitHexes = [hearth, ...myLitNeedles.map(n => ({ q: n.q, r: n.r }))];
        const myNeedleKeys = new Set(obs.mine.needles.map(n => `${n.q},${n.r}`));
        const dawnTick = this.manifest.dawn?.at ?? 1000;
        let targets = this.manifest.needles.filter(n => !myNeedleKeys.has(`${n.q},${n.r}`));
        // Avoid provoking Keeper before dawn
        if (obs.t < dawnTick) {
            targets = targets.filter(n => hexDist(n, { q: 0, r: 0 }) > 6);
        }
        // Ensure targets physically reach our network to prevent dark isolation
        const reachableTargets = targets.filter(tgt => myLitHexes.some(lit => this.oracle.linkOk(lit, tgt)));
        // Flag contracts to grant them enormous targeting priority
        const contractCells = new Set();
        if (obs.pub.order) {
            for (const c of obs.pub.order.cells)
                contractCells.add(`${c.q},${c.r}`);
        }
        const assignedTargets = new Set();
        // Pass 1: Mark targets already being chased or heated
        for (const u of obs.mine.units) {
            if (u.cls !== 'ткач')
                continue;
            const onEnemyNeedle = targets.some(t => t.q === u.q && t.r === u.r);
            if (u.task?.goal) {
                assignedTargets.add(`${u.task.goal.q},${u.task.goal.r}`);
            }
            else if (onEnemyNeedle) {
                assignedTargets.add(`${u.q},${u.r}`);
            }
        }
        // Pass 2: Assign idle Tkachs
        for (const u of obs.mine.units) {
            if (u.cls !== 'ткач')
                continue;
            if (u.wait > 0)
                continue; // Waiting for cell clearance; don't trigger "поворот" (turn) denial
            const onEnemyNeedle = targets.some(t => t.q === u.q && t.r === u.r);
            let needsTask = false;
            if (!u.task?.goal) {
                if (!onEnemyNeedle)
                    needsTask = true;
            }
            else {
                // Did we finish capturing the goal needle mid-transit?
                const goalKey = `${u.task.goal.q},${u.task.goal.r}`;
                if (myNeedleKeys.has(goalKey)) {
                    needsTask = true;
                }
            }
            if (needsTask && channel >= cost) {
                let bestTarget = null;
                let bestScore = Infinity;
                for (const tgt of reachableTargets) {
                    const key = `${tgt.q},${tgt.r}`;
                    if (assignedTargets.has(key))
                        continue;
                    let d = hexDist(u, tgt);
                    if (contractCells.has(key))
                        d -= 1000; // Contract urgency 
                    if (d < bestScore) {
                        bestScore = d;
                        bestTarget = tgt;
                    }
                }
                if (bestTarget) {
                    orders.push({
                        kind: 'move',
                        unit: u.id,
                        q: bestTarget.q,
                        r: bestTarget.r,
                        goal: bestTarget,
                        home: false
                    });
                    assignedTargets.add(`${bestTarget.q},${bestTarget.r}`);
                    channel -= cost;
                }
            }
        }
        // 4. Nakaz Heartbeat
        if (orders.length > 0) {
            this.ticksSinceCommand = 0;
        }
        else {
            this.ticksSinceCommand++;
            if (this.ticksSinceCommand >= 5 && channel >= cost) {
                orders.push({ kind: 'watch', q: hearth.q, r: hearth.r, keep: 0 });
                this.ticksSinceCommand = 0;
            }
        }
        return orders;
    }
}
