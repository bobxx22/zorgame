import { BlankBot } from '@zoria/sdk';
import type { BeliefFrame, WireBot } from '@zoria/sdk';
import type { Observe, Order, Hex, SlotName, MineUnit } from '@zoria/protocol';

export interface Strategy extends WireBot {
  belief(obs: Observe | null): BeliefFrame | null;
}

export function presets(): string[] {
  return ['custom'];
}

export function createStrategy(preset?: string): Strategy {
  return new CustomStrategy();
}

function dist(a: Hex, b: Hex): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}

function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

class CustomStrategy extends BlankBot implements Strategy {
  private unpassable = new Set<string>();
  private deadCells = new Set<string>();
  private allKnownNeedles = new Map<string, Hex>();
  private hearth!: Hex;
  private pendingYard: { tick: number, weight: number, cls: string }[] = [];
  
  override init(manifestBytes: Uint8Array, slot: SlotName): void {
    super.init(manifestBytes, slot);
    if (!this.manifest) return;
    
    const idx = slot === 'A' ? 0 : slot === 'B' ? 1 : 2;
    this.hearth = this.manifest.seats[idx];

    for (const cell of this.manifest.terrain.cells) {
      if (cell[2] === 6 || cell[2] === 7) { 
        this.unpassable.add(`${cell[0]},${cell[1]}`);
      }
    }

    for (const f of this.manifest.finds) {
      if (f.kind === 'dead') {
        this.deadCells.add(`${f.q},${f.r}`);
      }
    }

    for (const n of this.manifest.needles) {
      this.allKnownNeedles.set(hexKey(n), { q: n.q, r: n.r });
    }
  }

  belief(obs: Observe | null): BeliefFrame | null {
    if (!obs) return null;
    const own: Record<string, string | null> = {};
    const dark: Record<string, boolean> = {};
    for (const o of obs.own) {
      const k = hexKey(o);
      own[k] = o.owner;
      if (o.dark) dark[k] = true;
    }
    return {
      t: obs.t,
      pulse: {
        energy: obs.pulse.energy,
        chan: obs.pulse.chan,
        ear: obs.pulse.ear,
        minutes: obs.pulse.minutes,
        needles: obs.pulse.needles
      },
      own,
      dark,
      foe: obs.foe.map(f => [f.id, f.p, f.q, f.r]),
      noisy: obs.noisy.length,
      units: obs.mine.units.map(u => [u.id, u.q, u.r, u.task?.path || 0]),
      pact: null,
      cries: obs.pub.cries.map(c => [c[0], c[1]])
    };
  }

  protected override think(obs: Observe): Order[] {
    const orders: Order[] = [];
    try {
      if (!this.manifest) return [];
      
      const maxCmds = Math.floor(obs.pulse.chanAt / 32) + 4;
      let cmds = 0;
      const addOrder = (o: Order) => {
        if (cmds < maxCmds) {
          orders.push(o);
          cmds++;
        }
      };

      for (const o of obs.own) {
        const k = hexKey(o);
        if (!this.allKnownNeedles.has(k)) {
          this.allKnownNeedles.set(k, { q: o.q, r: o.r });
        }
      }

      this.pendingYard = this.pendingYard.filter(p => obs.t < p.tick + 4);
      let currentWeight = obs.mine.units.reduce((sum, u) => sum + (u.cls === 'ткач' ? 2 : 1), 0);
      currentWeight += this.pendingYard.reduce((sum, p) => sum + p.weight, 0);
      const tkachCount = obs.mine.units.filter(u => u.cls === 'ткач').length + this.pendingYard.filter(p => p.cls === 'ткач').length;

      if (currentWeight <= 6) {
        if (tkachCount < 3 && obs.pulse.energy >= 90) {
          addOrder({ kind: 'yard', cls: 'ткач' });
          this.pendingYard.push({ tick: obs.t, weight: 2, cls: 'ткач' });
          obs.pulse.energy -= 90;
        } else if (tkachCount >= 3 && obs.pulse.energy >= 50 && currentWeight <= 7) {
          addOrder({ kind: 'yard', cls: 'клинок' });
          this.pendingYard.push({ tick: obs.t, weight: 1, cls: 'клинок' });
          obs.pulse.energy -= 50;
        }
      }

      for (let i = 0; i < this.manifest.lots.length; i++) {
        const lot = this.manifest.lots[i];
        if (lot && obs.t === lot.at - 1 && obs.pulse.energy >= 150) {
          addOrder({ kind: 'bid', lot: i, amount: 65 });
          obs.pulse.energy -= 65;
        }
      }

      const claimedTargets = new Set<string>();
      const myNeedles = new Set(obs.mine.needles.map(n => hexKey(n)));

      for (const u of obs.mine.units) {
        if (u.wait > 0 || (u.task && (u.task.path > 0 || u.task.site || u.task.feed))) continue;

        if (u.cls === 'ткач') {
          const onKey = hexKey(u);
          if (this.allKnownNeedles.has(onKey) && !myNeedles.has(onKey)) {
            const isRing = dist(u, {q: 0, r: 0}) <= 6;
            if (!isRing || obs.t >= 980) continue; 
          }

          const target = this.getBestTkachTarget(u, obs, claimedTargets, myNeedles);
          if (target) {
            if (target.type === 'feed') {
              addOrder({ kind: 'feed', unit: u.id, q: target.hex.q, r: target.hex.r });
            } else if (target.type === 'build') {
              addOrder({ kind: 'needle', unit: u.id, q: target.hex.q, r: target.hex.r });
            } else {
              addOrder({ kind: 'move', unit: u.id, q: target.hex.q, r: target.hex.r, goal: null, home: false });
            }
            claimedTargets.add(hexKey(target.hex));
          }
        } else if (u.cls === 'клинок') {
          const target = this.getBestKlinokTarget(u, obs, claimedTargets, myNeedles);
          if (target) {
            if (target.type === 'ram') {
              addOrder({ kind: 'ram', unit: u.id, target: target.enemyId! });
            } else if (target.type === 'jam') {
              addOrder({ kind: 'jam', unit: u.id, target: target.hex, hold: true });
            } else {
              addOrder({ kind: 'move', unit: u.id, q: target.hex.q, r: target.hex.r, goal: null, home: false });
            }
            claimedTargets.add(target.enemyId || hexKey(target.hex));
          }
        }
      }
    } catch (e) {
      // Return safely parsed valid frames if something unexpected occurs
    }
    return orders;
  }

  private getBestTkachTarget(u: MineUnit, obs: Observe, claimed: Set<string>, myNeedles: Set<string>): { type: 'move'|'build'|'feed', hex: Hex } | null {
    if (obs.pub.order && obs.pub.order.cells) {
      for (const cell of obs.pub.order.cells) {
        if (!myNeedles.has(hexKey(cell)) && !claimed.has(hexKey(cell))) {
          return { type: 'move', hex: cell };
        }
      }
    }

    let bestCapture: Hex | null = null;
    let bestCapDist = Infinity;
    
    for (const [k, hex] of this.allKnownNeedles.entries()) {
      if (myNeedles.has(k) || claimed.has(k)) continue;
      if (dist(hex, {q: 0, r: 0}) <= 6 && obs.t < 980) continue;
      
      let isStart = false;
      for (const s of this.manifest!.seats) {
        if (dist(hex, s) <= 1) isStart = true;
      }
      if (isStart) continue;

      const d = dist(u, hex);
      if (d < bestCapDist) {
        bestCapDist = d;
        bestCapture = hex;
      } else if (d === bestCapDist && bestCapture) {
         if (hex.q < bestCapture.q) bestCapture = hex;
      }
    }
    if (bestCapture) return { type: 'move', hex: bestCapture };

    let bestBuild: Hex | null = null;
    let bestBuildDist = Infinity;

    for (let q = -19; q <= 19; q++) {
      for (let r = -19; r <= 19; r++) {
        const hex = { q, r };
        if (dist(hex, {q: 0, r: 0}) > 19) continue;
        const k = hexKey(hex);
        
        if (this.unpassable.has(k) || this.deadCells.has(k) || this.allKnownNeedles.has(k) || claimed.has(k)) continue;
        if (dist(hex, this.hearth) <= 2) continue; 
        if (dist(hex, {q: 0, r: 0}) <= 6 && obs.t < 980) continue; 

        let minNetDist = Infinity;
        for (const n of obs.mine.needles) {
          const d = dist(hex, n);
          if (d < minNetDist) minNetDist = d;
        }

        if (minNetDist === 4 || minNetDist === 5) {
          const dToUnit = dist(u, hex);
          if (dToUnit < bestBuildDist) {
            bestBuildDist = dToUnit;
            bestBuild = hex;
          } else if (dToUnit === bestBuildDist && bestBuild) {
             if (hex.q < bestBuild.q) bestBuild = hex;
          }
        }
      }
    }
    if (bestBuild) return { type: 'build', hex: bestBuild };

    const uKey = hexKey(u);
    if (myNeedles.has(uKey)) {
      return { type: 'feed', hex: u };
    }

    return null;
  }

  private getBestKlinokTarget(u: MineUnit, obs: Observe, claimed: Set<string>, myNeedles: Set<string>): { type: 'jam'|'ram'|'move', hex: Hex, enemyId?: string } | null {
    for (const foe of obs.foe) {
      if (myNeedles.has(hexKey(foe)) && !claimed.has(foe.id)) {
        return { type: 'ram', hex: foe, enemyId: foe.id };
      }
    }

    let bestJam: Hex | null = null;
    let bestJamDist = Infinity;
    
    for (const [k, hex] of this.allKnownNeedles.entries()) {
      if (myNeedles.has(k) || claimed.has(k)) continue;
      if (dist(hex, {q: 0, r: 0}) <= 6 && obs.t < 980) continue;
      
      let isStart = false;
      for (const s of this.manifest!.seats) {
        if (dist(hex, s) <= 1) isStart = true;
      }
      if (isStart) continue;

      let alreadyJammed = false;
      for (const j of obs.mine.jams) {
        if (j.q === hex.q && j.r === hex.r) alreadyJammed = true;
      }
      if (alreadyJammed) continue;

      const d = dist(u, hex);
      if (d < bestJamDist) {
        bestJamDist = d;
        bestJam = hex;
      }
    }
    if (bestJam) return { type: 'jam', hex: bestJam };

    const target = obs.t >= 980 ? { q: 0, r: 0 } : { q: Math.round(this.hearth.q / 2), r: Math.round(this.hearth.r / 2) };
    return { type: 'move', hex: target };
  }
}
