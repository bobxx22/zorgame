/* bot :: wire
   усе, що main.ts робить навколо стратегії, у формі, яку можна перевірити
   без вузла: параметри з'єднання, щоденник віри, WireBot для connectBot,
   знімок голови і зміна пресета для службового порту, підсумок думи.
   main.ts лише читає оточення і з'єднує ці частини. */

import { closeSync, openSync, writeSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { beliefLine } from '@zoria/sdk';
import type { BotRun, ConnectOpts, WireBot } from '@zoria/sdk';
import { decodeObserve, peekObserveTick } from '@zoria/protocol';
import { errText } from './errors.js';
import { Refusal } from './status.js';
import type { Head, HeadStats } from './status.js';
import type { Strategy } from './strategy.js';

/* Повернення після обриву (протокол 8). Типово SDK робить 4 спроби з паузою
   до 150 мс - це ~0,3 с, і обрив мережі на секунду-дві закінчує партію, хоча
   печатка повернення живе 180 с. 12 спроб зі стелею паузи 1 с тримають вікно
   ~8-10 с; перша спроба, як і раніше, миттєва, тож плановій ротації і
   обриву провокатора це нічого не коштує. Ліміт вузла - 8 hello за 10 с на
   печатку; мережеві відмови до вузла не доходять і його не витрачають.
   Присяга чекає відповіді не менше за лобі init-ms (протокол 3.3, 10 с). */
export const WIRE_OPTS = { resumeTries: 12, resumeJitterMs: 1000, connectTimeoutMs: 10_000 } as const satisfies Partial<ConnectOpts>;

/* номер службового порту з оточення; не число 1-65535 - без порту (listen
   на такому номері кидає синхронно, до присяги) */
export function statusPortOf(value: string | undefined, log: (line: string) => void = () => undefined): number {
  if (value === undefined || value.trim() === '') return 0;
  const port = Number(value);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  log('STATUS_PORT «' + value + '» не порт 1-65535: службового порту не буде');
  return 0;
}

/* p50, p99 і максимум думи за партію, мс */
export function thinkSummary(values: readonly number[]): { p50: string; p99: string; max: string } {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number): string =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]!.toFixed(1) : '0';
  return { p50: q(50), p99: q(99), max: q(100) };
}

/* Щоденник віри: один дескриптор на партію, запис синхронний - процес, що
   впав, не забирає останні такти. Збій файлу не зриває ні присягу, ні
   відповідь такту: кожен збій - у журнал із тактом, наступний рядок -
   повний кадр (щоденник пишеться різницями), після BELIEF_FAULTS збоїв
   поспіль щоденник вимикається. */
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
      this.log('щоденник віри не відкрився, граю без нього: ' + errText(e));
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
      this.log('щоденник віри, такт ' + String(peekObserveTick(observe)) + ': ' + errText(e));
      // the diary is written in deltas: after a lost line the next one must be full
      strategy.resetBelief();
      if (this.faults < BELIEF_FAULTS) return;
      this.log('щоденник віри вимкнено після ' + this.faults + ' збоїв поспіль');
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
      this.log('щоденник віри не закрився: ' + errText(e));
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

/* стан голови в процесі: стратегія, фаза партії, провід і щоденник */
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

  /* WireBot для connectBot. Щоденник пишеться після відповіді: SDK шле її
     одразу після tick, а мікрозадача виконується після цього і до
     наступного кадру - затримка диска не лягає в дедлайн такту */
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

  /* параметри connectBot: провід і повернення */
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

  /* знімок і зміна пресета для службового порту (status.ts) */
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
      /* зміна стратегії - між партіями і лише до заморожування: зміна
         пресета посеред бою була б зміною гравця */
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

  /* рядок про кінець партії для журналу */
  summary(): string {
    const s = thinkSummary(this.think);
    const stats = this.run?.stats;
    return (
      'партію закінчено (' +
      this.why +
      '): відповідей ' +
      String(stats?.ticks ?? 0) +
      ', кидків ' +
      String(stats?.faults ?? 0) +
      ', повернень ' +
      String(stats?.resumes ?? 0) +
      '; дума, мс: p50 ' +
      s.p50 +
      ', p99 ' +
      s.p99 +
      ', max ' +
      s.max
    );
  }
}
