/* lab :: human
   A thread that plays one match with a human in a seat (play mode). The engine
   asks every seat for its frame synchronously, in the middle of a tick, so the
   human's seat is a WireBot that, on a decision tick, sends the turn to the main
   thread and sleeps on shared memory (Atomics.wait) until the panel answers.
   Between decisions the seat is silent or played by the advisor.

   The advisor is any lab bot in the same seat's shadow: it is initialized with
   the same manifest and slot, sees every observe frame of the seat and answers
   as if it played; its orders become advice with an explanation (advise.ts).
   It gets the verdicts only of the orders the seat really sent.

   The finished match is saved as an ordinary run (runs/<id>, match 1). */

import { mkdirSync, writeFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import { decodeManifest, decodeObserve, decodeOrders, decodeVerdicts, encodeOrders, encodeVerdicts } from '@zoria/protocol';
import type { ChannelCfg, Hex, Manifest, Observe, Order, SlotName, Verdict as WireVerdict } from '@zoria/protocol';
import type { WireBot } from '@zoria/sdk';
import { pulseOrder } from '../../bot/dist/strategy.js';
import type { PulseWorld } from '../../bot/dist/strategy.js';
import type { Advice, Bilingual, PlayAction, PlayRequest, PlayTurn, Verdict } from '../shared/play.ts';
import type { Frame, MatchStatic, RunMeta, SeatLine, SeatResult, SeatSpec, Slot } from '../shared/record.ts';
import { explain } from './advise.ts';
import { makeBot, recordMatch, staticOf } from './recorder.ts';
import { matchFile, newRunId, runDir, saveMeta } from './runs.ts';

export interface HumanJob {
  request: PlayRequest;
  /* [0] - 1 when an action is waiting, [1] - its length in bytes; the action's JSON from byte 8 */
  shared: SharedArrayBuffer;
}

export type HumanMessage =
  | { type: 'ready'; slot: Slot; static: MatchStatic; cfg: Record<string, number> }
  | { type: 'turn'; turn: PlayTurn }
  | { type: 'progress'; t: number }
  | { type: 'done'; result: SeatResult[]; runId: string }
  | { type: 'failed'; error: string };

const job = workerData as HumanJob;
const send = (message: HumanMessage): void => {
  parentPort?.postMessage(message);
};

const ctrl = new Int32Array(job.shared, 0, 2);
const data = new Uint8Array(job.shared, 8);
/* flag values: 0 - nothing, 1 - an action is waiting, 2 - the game is closed */
const CLOSED = 2;

class Closed extends Error {}

/* the game was closed from the panel: the thread unwinds by itself (terminating a thread
   asleep in Atomics.wait brings the whole process down) */
function checkClosed(): void {
  if (Atomics.load(ctrl, 0) === CLOSED) throw new Closed('closed');
}

/* the panel's answer: wait for the flag, read the JSON, reset the flag */
function awaitAction(): PlayAction {
  while (Atomics.load(ctrl, 0) === 0) Atomics.wait(ctrl, 0, 0);
  checkClosed();
  const length = Atomics.load(ctrl, 1);
  const json = new TextDecoder().decode(data.slice(0, length));
  Atomics.store(ctrl, 0, 0);
  return JSON.parse(json) as PlayAction;
}

const b = (en: string, uk: string): Bilingual => ({ en, uk });
const key = (o: Order): string => JSON.stringify(o);

class HumanSeat implements WireBot {
  private man: Manifest | null = null;
  private slot: SlotName = 'A';
  private world: PulseWorld | null = null;
  private hearth: Hex = { q: 0, r: 0 };
  private focus: Extract<Order, { kind: 'watch' }> | null = null;
  /* ticks left in the current run, and how they are played */
  private left = 0;
  private autopilot = false;
  private stopEarly = true;
  /* ticks in a row without an accepted order: the keep-alive comes from the third (as our bot's pulse) */
  private quiet = 0;
  private sent: Order[] = [];
  private advice: Order[] = [];
  private verdicts: Verdict[] = [];
  private note: Bilingual | null = null;
  lastFrame: Frame | null = null;
  private readonly advisor: WireBot | null;

  constructor(advisor: WireBot | null) {
    this.advisor = advisor;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.man = decodeManifest(manifest);
    this.slot = slot;
    const m = this.man;
    if (m) {
      this.hearth = m.seats[m.perm.indexOf(slot)] ?? this.hearth;
      this.world = { cfg: m.cfg as unknown as ChannelCfg, storms: m.storms, hearth: this.hearth };
      this.focus = { kind: 'watch', q: this.hearth.q, r: this.hearth.r, keep: 0 };
      send({ type: 'ready', slot: slot as Slot, static: staticOf(manifest), cfg: m.cfg });
    }
    try {
      this.advisor?.init(manifest, slot);
    } catch (e) {
      this.note = b('The advisor failed to start: ' + String(e), 'Порадник не запустився: ' + String(e));
    }
  }

  tick(bytes: Uint8Array): Uint8Array {
    checkClosed();
    const obs = decodeObserve(bytes);
    let advice: Order[] = [];
    let sources: string[] = [];
    if (this.advisor) {
      try {
        advice = decodeOrders(this.advisor.tick(bytes)) ?? [];
        const strategy = (this.advisor as { strategy?: { lastSources?: string[] } }).strategy;
        sources = strategy?.lastSources ? [...strategy.lastSources] : [];
      } catch (e) {
        this.note = b('The advisor failed on this tick: ' + String(e), 'Порадник упав на цьому такті: ' + String(e));
      }
    }
    this.advice = advice;
    if (!obs) return new Uint8Array(0);

    let orders: Order[];
    /* the advisor's frame as is already carries its own keep-alive */
    let advisorFrame = false;
    const reason = this.left > 0 && this.stopEarly ? this.stopReason(obs) : null;
    if (this.left > 0 && !reason) {
      this.left--;
      orders = this.autopilot ? advice : [];
      advisorFrame = this.autopilot && sources.includes('pulse');
    } else {
      this.left = 0;
      if (reason) this.note = reason;
      send({ type: 'turn', turn: this.turn(obs, advice, sources) });
      this.note = null;
      const action = awaitAction();
      orders = action.orders;
      this.left = Math.max(0, Math.floor(action.run) - 1);
      this.autopilot = action.autopilot;
      this.stopEarly = action.stop;
    }
    /* the seat stays ours: after two silent ticks a free order that changes nothing goes first (P2-04) */
    if (this.quiet >= 2 && this.world && !advisorFrame) {
      const pulse = pulseOrder(obs, orders, this.focus, this.world);
      if (pulse) orders = [pulse, ...orders];
    }
    try {
      const frame = encodeOrders(orders);
      this.sent = orders;
      return frame;
    } catch (e) {
      this.note = b('The frame could not be encoded and was not sent: ' + String(e), 'Кадр не закодувався і не пішов: ' + String(e));
      this.sent = [];
      return new Uint8Array(0);
    }
  }

  feedback(bytes: Uint8Array): void {
    const list = decodeVerdicts(bytes) ?? [];
    this.quiet = list.some(([, ok]) => ok) ? 0 : this.quiet + 1;
    this.verdicts = list.flatMap(([i, ok, code]) => {
      const order = this.sent[i];
      if (!order) return [];
      if (ok && order.kind === 'watch') this.focus = order;
      return [{ order, ok, code }];
    });
    /* the advisor learns the fate only of its own orders that were really sent, under its own numbers */
    if (this.advisor?.feedback) {
      const free = new Map<string, number[]>();
      this.advice.forEach((o, j) => free.set(key(o), [...(free.get(key(o)) ?? []), j]));
      const mapped: WireVerdict[] = [];
      for (const [i, ok, code] of list) {
        const order = this.sent[i];
        const slots = order ? free.get(key(order)) : undefined;
        const j = slots?.shift();
        if (j !== undefined) mapped.push([j, ok, code]);
      }
      try {
        this.advisor.feedback(encodeVerdicts(mapped));
      } catch {
        /* an advisor that cannot take its verdicts keeps advising without them */
      }
    }
  }

  private stopReason(obs: Observe): Bilingual | null {
    const me = this.slot;
    for (const e of obs.events) {
      if (e.type === 'lost' && e.p === me) return b(`Stopped: we lost a ${e.cls === 'клинок' ? 'Klinok' : 'Tkach'} at (${e.q}, ${e.r}).`, `Зупинка: ми втратили ${e.cls === 'клинок' ? 'клинка' : 'ткача'} на (${e.q}, ${e.r}).`);
      if (e.type === 'cap' && e.from === me) return b(`Stopped: ${e.p} captured our needle (${e.q}, ${e.r}).`, `Зупинка: ${e.p} захопив нашу голку (${e.q}, ${e.r}).`);
      if (e.type === 'build' && e.p === me) return b(`Stopped: a new ${e.cls === 'клинок' ? 'Klinok' : 'Tkach'} left our yard - it waits for orders.`, `Зупинка: з нашого двору вийшов ${e.cls === 'клинок' ? 'клинок' : 'ткач'} - чекає наказів.`);
      if (e.type === 'dawn') return b('Stopped: dawn - the Keeper\'s ring is open.', 'Зупинка: зоря - кільце Ключника відкрите.');
    }
    if (this.verdicts.some((v) => !v.ok)) return b('Stopped: the gatekeeper rejected an order.', 'Зупинка: воротар відхилив команду.');
    return null;
  }

  private turn(obs: Observe, advice: Order[], sources: string[]): PlayTurn {
    const m = this.man!;
    const ctx = { slot: this.slot, obs, man: m, hearth: this.hearth };
    const list: Advice[] = advice.map((order, i) => {
      const src = sources[i] ?? '';
      return { order, src, why: explain(order, { ...ctx, src }) };
    });
    const cfg = m.cfg;
    const weight = obs.mine.units.reduce((s, u) => s + (u.cls === 'ткач' ? (cfg['weightTkach'] ?? 2) : (cfg['weightKlinok'] ?? 1)), 0);
    return {
      t: obs.t,
      frame: this.lastFrame,
      sight: {
        pulse: obs.pulse,
        units: obs.mine.units,
        needles: obs.mine.needles,
        jams: obs.mine.jams,
        pact: obs.mine.pact,
        ledger: obs.mine.ledger,
        order: obs.mine.order,
        own: obs.own,
        foe: obs.foe,
        pub: obs.pub,
        events: obs.events,
      },
      advice: list,
      verdicts: this.verdicts,
      weight,
      note: this.note,
    };
  }
}

try {
  const { request } = job;
  const advisor = request.advisor ? makeBot(request.advisor) : null;
  const seat = new HumanSeat(advisor);
  const human: SeatSpec = { kind: 'human', name: 'human' };
  const lineup: [SeatSpec, SeatSpec, SeatSpec] = [human, request.opponents[0], request.opponents[1]];
  const record = recordMatch(request.seat, request.seed, request.ticks, lineup, (t) => send({ type: 'progress', t }), {
    bots: { 0: seat },
    onFrame: (frame) => {
      seat.lastFrame = frame;
    },
  });

  /* saved as an ordinary single-match run: the viewer and the runs list read it as is */
  const runId = newRunId();
  mkdirSync(runDir(runId), { recursive: true });
  writeFileSync(matchFile(runId, 0), gzipSync(JSON.stringify(record)));
  const places = {} as Record<Slot, number>;
  const scores = {} as Record<Slot, number>;
  const seats: SeatLine[] = [];
  const shares: [number, number, number] = [0, 0, 0];
  for (const row of record.result) {
    places[row.slot] = row.place;
    scores[row.slot] = row.score;
    const participant = (record.meta.seating[row.slot] ?? 0) as 0 | 1 | 2;
    shares[participant] += row.share;
    const bd = row.breakdown;
    seats.push({
      participant,
      slot: row.slot,
      place: row.place,
      share: row.share,
      score: row.score,
      network: bd['network'] ?? 0,
      orders: bd['orders'] ?? 0,
      stolen: bd['stolen'] ?? 0,
      tax: bd['pactTax'] ?? 0,
      lit: row.lit,
      denials: row.denials,
      pulses: row.pulses,
      fills: row.fills,
      nakazTicks: row.nakazTicks,
    });
  }
  const meta: RunMeta = {
    id: runId,
    createdAt: new Date().toISOString(),
    request: { seed: request.seed, ticks: request.ticks, lineup, matches: 1 },
    status: 'done',
    progress: { match: 1, t: 0 },
    shares,
    matches: [{ index: 0, places, scores, seats }],
  };
  saveMeta(meta);
  send({ type: 'done', result: record.result, runId });
} catch (e) {
  if (!(e instanceof Closed)) send({ type: 'failed', error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
}
