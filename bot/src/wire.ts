/* bot :: wire
   everything main.ts does around the strategy, in a form that can be checked
   without a node: connection options, belief diary, WireBot for connectBot,
   head snapshot and preset change for the service port, think summary.
   main.ts only reads the environment and connects these parts. */

import { closeSync, openSync, writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { beliefLine } from '@zoria/sdk';
import type { BotRun, ConnectOpts, WireBot } from '@zoria/sdk';
import { decodeObserve, peekObserveTick } from '@zoria/protocol';
import { errText } from './errors.js';
import { Refusal } from './status.js';
import type { Head, HeadStats } from './status.js';
import type { Strategy } from './strategy.js';

/* Reconnect after a drop (protocol 8). By default the SDK makes 4 attempts
   with a pause of up to 150 ms - that's ~0.3 s, and a network drop of a second
   or two ends the match, though the reconnect seal lives 180 s. 12 attempts
   with a pause cap of 1 s keep a ~8-10 s window; the first attempt is still
   immediate, so a planned rotation and the provocateur's drop cost nothing.
   The node's limit is 8 hellos per 10 s per seal; network failures never reach
   the node and don't spend it. The oath waits for an answer no less than the
   lobby's init-ms (protocol 3.3, 10 s). */
export const WIRE_OPTS = { resumeTries: 12, resumeJitterMs: 1000, connectTimeoutMs: 10_000 } as const satisfies Partial<ConnectOpts>;

/* service port number from the environment; not a number 1-65535 - no port
   (listen on such a number throws synchronously, before the oath) */
export function statusPortOf(value: string | undefined, log: (line: string) => void = () => undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  log('STATUS_PORT "' + value + '" is not a port 1-65535: there will be no service port');
  return 0;
}

/* p50, p99 and max think time per match, ms */
export function thinkSummary(values: readonly number[]): { p50: string; p99: string; max: string } {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number): string =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!.toFixed(1) : '0';
  return { p50: q(50), p99: q(99), max: q(100) };
}

/* Belief diary: one descriptor per match, writes are synchronous - a process
   that crashed doesn't take the last ticks with it. A file failure breaks
   neither the oath nor the tick's answer: each failure goes to the log with
   the tick, the next line is a full frame (the diary is written as diffs),
   after BELIEF_FAULTS failures in a row the diary is turned off. */
export const BELIEF_FAULTS = 3;

export class BeliefDiary {
  private fd: number | null = null;
  private faults = 0;
  frames = 0;
  at = 0;

  constructor(
    private readonly path: string,
    private readonly log: (line: string) => void,
  ) {}

  get open(): boolean {
    return this.fd !== null;
  }

  start(): void {
    this.close();
    if (!this.path) return;
    try {
      this.fd = openSync(this.path, 'w');
      this.faults = 0;
    } catch (e) {
      this.log('belief diary did not open, playing without it: ' + errText(e));
    }
  }

  write(strategy: Strategy, observe: Uint8Array): void {
    if (this.fd === null) return;
    try {
      const frame = strategy.belief(decodeObserve(observe));
      if (!frame) return;
      writeSync(this.fd, beliefLine(frame));
      this.frames++;
      this.at = Date.now();
      this.faults = 0;
    } catch (e) {
      this.faults++;
      this.log('belief diary, tick ' + String(peekObserveTick(observe)) + ': ' + errText(e));
      // the diary is written in deltas: after a lost line the next one must be full
      strategy.resetBelief();
      if (this.faults < BELIEF_FAULTS) return;
      this.log('belief diary turned off after ' + this.faults + ' failures in a row');
      this.close();
    }
  }

  close(): void {
    if (this.fd === null) return;
    const fd = this.fd;
    this.fd = null;
    try {
      closeSync(fd);
    } catch (e) {
      this.log('belief diary did not close: ' + errText(e));
    }
  }
}

export interface ShellOpts {
  preset: string;
  engine: string;
  freeze: boolean;
  beliefFile: string;
  presets: () => string[];
  createStrategy: (preset: string) => Strategy;
  log: (line: string) => void;
}

const IDLE: HeadStats = { ticks: 0, orders: 0, nacks: 0, bytesIn: 0, bytesOut: 0, resyncMs: 0, resumes: 0, faults: 0, deferred: 0, lastTickAt: 0 };

/* the head's state in the process: strategy, match phase, wire and diary */
export class BotShell {
  preset: string;
  strategy: Strategy;
  phase: 'lobby' | 'live' | 'done' = 'lobby';
  why = '';
  tick = 0;
  frames = 0;
  run: BotRun | null = null;
  readonly diary: BeliefDiary;
  readonly think: number[] = [];
  private readonly born = Date.now();

  constructor(private readonly o: ShellOpts) {
    this.preset = o.preset;
    this.strategy = o.createStrategy(o.preset);
    this.diary = new BeliefDiary(o.beliefFile, o.log);
  }

  /* WireBot for connectBot. The diary is written after the answer: the SDK
     sends it right after tick, and the microtask runs after that and before
     the next frame - disk latency doesn't fall into the tick deadline */
  wireBot(): WireBot {
    return {
      init: (manifest, slot) => {
        this.strategy.init(manifest, slot);
        this.diary.start();
      },
      tick: (observe) => {
        const t0 = performance.now();
        const strategy = this.strategy;
        const out = strategy.tick(observe);
        this.think.push(performance.now() - t0);
        queueMicrotask(() => {
          this.diary.write(strategy, observe);
        });
        return out;
      },
      feedback: (verdicts) => {
        this.strategy.feedback?.(verdicts);
      },
    };
  }

  /* connectBot options: wire and reconnects */
  connectOpts(url: string, token: string, agent: string): ConnectOpts {
    return {
      url,
      token,
      agent,
      bot: this.wireBot(),
      engine: this.o.engine,
      ...WIRE_OPTS,
      onTick: (t, n) => {
        if (t !== null) this.tick = t;
        this.frames = n;
      },
    };
  }

  /* snapshot and preset change for the service port (status.ts) */
  head(): Head {
    return {
      state: () => ({
        state: this.phase,
        slot: this.run ? this.run.slot : null,
        preset: this.preset,
        presets: this.o.presets(),
        freeze: this.o.freeze,
        tick: this.tick,
        frames: this.frames,
        ticks: this.run ? this.run.ack.ticks : 0,
        why: this.why,
        engine: this.run ? this.run.ack.engine : this.o.engine,
        uptimeMs: Date.now() - this.born,
        stats: this.run ? { ...this.run.stats } : { ...IDLE },
        belief: { frames: this.diary.frames, ageMs: this.diary.at ? Date.now() - this.diary.at : 0 },
      }),
      /* a strategy change - between matches and only before the freeze: a
         preset change mid-battle would be a change of player */
      promote: (value) => {
        if (typeof value !== 'string' || !this.o.presets().includes(value)) throw new Refusal(400, 'preset');
        if (this.phase === 'live') throw new Refusal(409, 'live');
        if (this.o.freeze) throw new Refusal(409, 'freeze');
        // the new head is built first: a throw leaves the old preset and the old head together
        const next = this.o.createStrategy(value);
        this.strategy = next;
        this.preset = value;
        return this.preset;
      },
    };
  }

  /* the end-of-match line for the log */
  summary(): string {
    const s = thinkSummary(this.think);
    const stats = this.run?.stats;
    return (
      'match over (' +
      this.why +
      '): answers ' +
      String(stats?.ticks ?? 0) +
      ', throws ' +
      String(stats?.faults ?? 0) +
      ', reconnects ' +
      String(stats?.resumes ?? 0) +
      '; think, ms: p50 ' +
      s.p50 +
      ', p99 ' +
      s.p99 +
      ', max ' +
      s.max
    );
  }
}
