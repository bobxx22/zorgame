import { BlankBot } from '@zoria/sdk';
import type { Observe, Order, Hex, SlotName, ObsEvent } from '@zoria/protocol';
import type { BeliefFrame, WireBot } from '@zoria/sdk';

export interface Strategy extends WireBot {
  belief(obs: Observe | null): BeliefFrame | null;
}

export function presets(): string[] {
  return ['dominator'];
}

export function createStrategy(_preset?: string): Strategy {
  return new ZoriaDominator();
}

function hexDist(aq: number, ar: number, bq: number, br: number): number {
  return (Math.abs(aq - bq) + Math.abs(aq + ar - bq - br) + Math.abs(ar - br)) / 2;
}

class ZoriaDominator extends BlankBot implements Strategy {
  private knownNeedles = new Map<string, { q: number, r: number, owner: string | null, ring: boolean, start: boolean }>();
  private pendingWeight = 0;

  belief(_obs: Observe | null): BeliefFrame | null {
    return null; 
  }

  override init(manifestBytes: Uint8Array, slot: SlotName): void {
    super.init(manifestBytes, slot);
    for (const n of this.manifest!.needles) {
      const owner = n.start ? n.start : (n.ring ? 'K' : null);
      this.knownNeedles.set(`${n.q},${n.r}`, { q: n.q, r: n.r, owner, ring: n.ring, start: n.start !== null });
    }
  }

  protected override think(obs: Observe): Order[] {
    const orders: Order[] = [];
    const t = obs.t;
    const energy = obs.pulse.energy;
    const isDawn = t >= this.manifest!.dawn.at;

    // 1. Update memory
    for (const ev of obs.events) {
      if (ev.type === 'cap') {
        const n = this.knownNeedles.get(`${ev.q},${ev.r}`);
        if (n) n.owner = ev.p;
      } else if (ev.type === 'raise') {
        this.knownNeedles.set(`${ev.q},${ev.r}`, { q: ev.q, r: ev.r, owner: ev.p, ring: false, start: false });
      } else if (ev.type === 'build' && ev.p === this.slot) {
        this.pendingWeight -= (ev.cls === 'ткач' ? 2 : 1);
        if (this.pendingWeight < 0) this.pendingWeight = 0;
      }
    }

    for (const o of obs.own) {
      const n = this.knownNeedles.get(`${o.q},${o.r}`);
      if (n) n.owner = o.owner;
    }

    // 2. Yard Management (Max weight 8: 3 Tkachs = 6, 2 Klinoks = 2)
    let swarmWeight = this.pendingWeight;
    let tkachCount = 0;
    let klinokCount = 0;
    for (const u of obs.mine.units) {
      swarmWeight += u.cls === 'ткач' ? 2 : 1;
      if (u.cls === 'ткач') tkachCount++;
      if (u.cls === 'клинок') klinokCount++;
    }

    let orderedYard = false;
    if (energy >= 90 && swarmWeight <= 6 && tkachCount < 3) {
      orders.push({ kind: 'yard', cls: 'ткач' });
      this.pendingWeight += 2;
      orderedYard = true;
    } else if (energy >= 50 && swarmWeight <= 7 && klinokCount < 2 && !orderedYard && tkachCount >= 1) {
      orders.push({ kind: 'yard', cls: 'клинок' });
      this.pendingWeight += 1;
    }

    // 3. Auctions
    for (let i = 0; i < this.manifest!.lots.length; i++) {
      const lot = this.manifest!.lots[i];
      if (lot && t === lot.at - 1 && energy >= 60) {
        orders.push({ kind: 'bid', lot: i, amount: Math.max(60, Math.floor(energy / 2)) });
      }
    }

    // 4. Unit Directives
    const contractCells = obs.pub.order ? obs.pub.order.cells : [];
    const targetedNeedles = new Set<string>();

    for (const u of obs.mine.units) {
      if (u.wait > 0) continue; // Waiting for obstacle or mid-step, avoid 'поворот' denials

      if (u.cls === 'ткач') {
        let bestTarget: Hex | null = null;
        let bestScore = -999999;

        for (const [key, n] of this.knownNeedles.entries()) {
          if (n.owner === this.slot || n.start) continue; 
          if (targetedNeedles.has(key)) continue; 
          if (n.owner === 'K' && !isDawn && !obs.pulse.mercy && hexDist(n.q, n.r, 0, 0) <= 6) continue;

          let connects = false;
          for (const myN of obs.mine.needles) {
            if (myN.weight > 0 && hexDist(myN.q, myN.r, n.q, n.r) <= 5) {
              connects = true;
              break;
            }
          }
          if (!connects) continue;

          let score = -hexDist(u.q, u.r, n.q, n.r);
          if (n.owner === null) score += 100;
          else if (n.owner === 'K' && isDawn) score += 200;
          else score += 10;

          if (contractCells.some(c => c.q === n.q && c.r === n.r)) {
            score += 500;
          }

          if (score > bestScore) {
            bestScore = score;
            bestTarget = n;
          }
        }

        if (bestTarget) {
          targetedNeedles.add(`${bestTarget.q},${bestTarget.r}`);
          if (u.q === bestTarget.q && u.r === bestTarget.r) {
            // Already there
          } else if (!u.task || !u.task.goal || u.task.goal.q !== bestTarget.q || u.task.goal.r !== bestTarget.r) {
            orders.push({ kind: 'move', unit: u.id, q: bestTarget.q, r: bestTarget.r, home: false, goal: bestTarget });
          }
        }

      } else if (u.cls === 'клинок') {
        let bestRamTarget: string | null = null;
        let bestRamScore = -999;

        for (const foe of obs.foe) {
          if (foe.cls === 'ткач') {
            let score = 100 - hexDist(u.q, u.r, foe.q, foe.r);
            if (score > bestRamScore) {
              bestRamScore = score;
              bestRamTarget = foe.id;
            }
          }
        }

        if (bestRamTarget) {
          if (!u.task || u.task.ram !== bestRamTarget) {
            orders.push({ kind: 'ram', unit: u.id, target: bestRamTarget });
          }
        } else {
          let bestJamTarget: Hex | null = null;
          let bestJamScore = -999;
          for (const [key, n] of this.knownNeedles.entries()) {
            if (n.owner === this.slot || n.owner === null || n.owner === 'K' || n.start) continue;
            let score = -hexDist(u.q, u.r, n.q, n.r);
            if (score > bestJamScore) {
              bestJamScore = score;
              bestJamTarget = n;
            }
          }
          if (bestJamTarget) {
            if (!u.task || !u.task.jam || u.task.jam.q !== bestJamTarget.q || u.task.jam.r !== bestJamTarget.r) {
              orders.push({ kind: 'jam', unit: u.id, target: bestJamTarget, hold: false });
            }
          }
        }
      }
    }

    // Keep under channel cap
    const cap = Math.floor(obs.pulse.chanAt / 32) + 4;
    return orders.slice(0, cap);
  }
}
