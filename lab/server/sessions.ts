/* lab :: sessions
   Play-mode sessions on the main thread: each one is a worker (human.ts) that
   holds a match and sleeps on shared memory while the human thinks. The panel
   long-polls: an action returns when the next decision tick (or the end) comes.
   At most MAX sessions live at once; a new one beyond that closes the oldest. */

import { Worker } from 'node:worker_threads';
import { SHARED_BYTES } from '../shared/play.ts';
import type { Order, PlayAction, PlayRequest, PlayState } from '../shared/play.ts';
import type { SeatSpec } from '../shared/record.ts';
import type { HumanJob, HumanMessage } from './human.ts';
import { newRunId, parseSeat } from './runs.ts';
import type { Known } from './runs.ts';

const MAX = 3;
/* how long one long poll waits for the next decision tick */
const POLL_MS = 120_000;

class Session {
  readonly state: PlayState;
  private readonly worker: Worker;
  private readonly ctrl: Int32Array;
  private readonly data: Uint8Array;
  private waiters: ((state: PlayState) => void)[] = [];

  constructor(id: string, request: PlayRequest) {
    this.state = { id, request, status: 'starting', slot: null, labels: null, static: null, cfg: null, turn: null, progress: 0, result: null, runId: null, error: null };
    const shared = new SharedArrayBuffer(8 + SHARED_BYTES);
    this.ctrl = new Int32Array(shared, 0, 2);
    this.data = new Uint8Array(shared, 8);
    const job: HumanJob = { request, shared };
    this.worker = new Worker(new URL('./human.ts', import.meta.url), { workerData: job });
    this.worker.on('message', (m: HumanMessage) => this.take(m));
    this.worker.on('error', (e) => this.fail(e.stack ?? e.message));
    this.worker.on('exit', () => {
      if (this.state.status !== 'done' && this.state.status !== 'failed') this.fail('the game thread exited');
    });
  }

  private take(m: HumanMessage): void {
    const s = this.state;
    if (m.type === 'ready') {
      s.slot = m.slot;
      s.static = m.static;
      s.cfg = m.cfg;
    } else if (m.type === 'turn') {
      s.status = 'waiting';
      s.turn = m.turn;
      s.progress = m.turn.t;
      this.wake();
    } else if (m.type === 'progress') {
      s.progress = m.t;
    } else if (m.type === 'done') {
      s.status = 'done';
      s.result = m.result;
      s.runId = m.runId;
      this.wake();
    } else {
      this.fail(m.error);
    }
  }

  private fail(error: string): void {
    this.state.status = 'failed';
    this.state.error = error;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w(this.state);
  }

  /* the next state change of interest: a decision tick, the end or a failure */
  next(): Promise<PlayState> {
    if (this.state.status === 'waiting' || this.state.status === 'done' || this.state.status === 'failed') return Promise.resolve(this.state);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(this.state);
      }, POLL_MS);
      const done = (state: PlayState) => {
        clearTimeout(timer);
        resolve(state);
      };
      this.waiters.push(done);
    });
  }

  act(action: PlayAction): Promise<PlayState> {
    if (this.state.status !== 'waiting') throw new Error('the game is not waiting for a move');
    const bytes = new TextEncoder().encode(JSON.stringify(action));
    if (bytes.length > SHARED_BYTES) throw new Error('the action is too large');
    this.data.set(bytes);
    Atomics.store(this.ctrl, 1, bytes.length);
    this.state.status = 'running';
    Atomics.store(this.ctrl, 0, 1);
    Atomics.notify(this.ctrl, 0);
    return this.next();
  }

  /* the flag 2 wakes the thread and it unwinds by itself; a forced stop only as a last resort,
     after it had time to leave Atomics.wait (terminating a sleeping thread crashes the process) */
  close(): void {
    Atomics.store(this.ctrl, 0, 2);
    Atomics.notify(this.ctrl, 0);
    this.state.status = 'failed';
    this.state.error = 'closed';
    this.wake();
    const timer = setTimeout(() => void this.worker.terminate(), 30_000);
    this.worker.once('exit', () => clearTimeout(timer));
  }
}

const sessions = new Map<string, Session>();

export function playStates(): PlayState[] {
  return [...sessions.values()].map((s) => ({ ...s.state, turn: null, static: null, cfg: null }));
}

export function playState(id: string): PlayState | null {
  return sessions.get(id)?.state ?? null;
}

export function closePlay(id: string): boolean {
  const s = sessions.get(id);
  if (!s) return false;
  s.close();
  sessions.delete(id);
  return true;
}

export async function startPlay(body: unknown, known: Known): Promise<PlayState> {
  const request = parsePlay(body, known);
  while (sessions.size >= MAX) closePlay(sessions.keys().next().value!);
  const id = newRunId();
  const session = new Session(id, request);
  sessions.set(id, session);
  return session.next();
}

export async function actPlay(id: string, body: unknown): Promise<PlayState> {
  const s = sessions.get(id);
  if (!s) throw new Error('no such game');
  return s.act(parseAction(body));
}

export async function waitPlay(id: string): Promise<PlayState> {
  const s = sessions.get(id);
  if (!s) throw new Error('no such game');
  return s.next();
}

/* ===== what the panel may send ===== */

function parsePlay(body: unknown, known: Known): PlayRequest {
  const b = body as Partial<PlayRequest> | null;
  if (!b || typeof b !== 'object') throw new Error('body');
  const seed = Number(b.seed);
  const ticks = Number(b.ticks);
  const seat = Number(b.seat);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 31) throw new Error('seed');
  if (!Number.isInteger(ticks) || ticks < 10 || ticks > 1200) throw new Error('ticks');
  if (seat !== 0 && seat !== 1 && seat !== 2) throw new Error('seat');
  if (!Array.isArray(b.opponents) || b.opponents.length !== 2) throw new Error('opponents');
  const opponents = b.opponents.map((o) => parseSeat(o, known)) as [SeatSpec, SeatSpec];
  const advisor = b.advisor ? parseSeat(b.advisor, known) : null;
  return { seed, ticks, seat, opponents, advisor };
}

const int = (v: unknown, min: number, max: number): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('order: number ' + String(v));
  return n;
};
const str = (v: unknown): string => {
  if (typeof v !== 'string' || !v || v.length > 32) throw new Error('order: unit');
  return v;
};
const hex = (v: unknown): { q: number; r: number } => {
  const h = v as { q?: unknown; r?: unknown } | null;
  return { q: int(h?.q, -64, 64), r: int(h?.r, -64, 64) };
};

/* only well-formed orders reach the codec; the gatekeeper judges the rest, as on the node */
export function parseOrder(v: unknown): Order {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') throw new Error('order');
  switch (o['kind']) {
    case 'yard':
      if (o['cls'] !== 'ткач' && o['cls'] !== 'клинок') throw new Error('order: class');
      return { kind: 'yard', cls: o['cls'] };
    case 'move':
      return { kind: 'move', unit: str(o['unit']), ...hex(o), goal: o['goal'] ? hex(o['goal']) : null, home: o['home'] === true };
    case 'ram':
      return { kind: 'ram', unit: str(o['unit']), target: str(o['target']) };
    case 'feed':
      return { kind: 'feed', unit: str(o['unit']), ...hex(o) };
    case 'needle':
      return { kind: 'needle', unit: str(o['unit']), ...hex(o) };
    case 'scan':
      return { kind: 'scan', ...hex(o), rad: int(o['rad'], 1, 6) };
    case 'watch':
      return { kind: 'watch', ...hex(o), keep: int(o['keep'], 0, 1200) };
    case 'jam':
      return { kind: 'jam', unit: str(o['unit']), target: o['target'] ? hex(o['target']) : null, hold: o['hold'] === true };
    case 'halt':
      return { kind: 'halt', unit: str(o['unit']) };
    case 'pact': {
      const op = o['op'];
      const to = o['to'];
      if (op !== 'offer' && op !== 'accept' && op !== 'break') throw new Error('order: pact');
      if (to !== 'A' && to !== 'B' && to !== 'C') throw new Error('order: pact');
      return { kind: 'pact', op, to };
    }
    case 'cry':
      return { kind: 'cry', phrase: int(o['phrase'], 0, 7) };
    case 'bid':
      return { kind: 'bid', lot: int(o['lot'], 0, 63), amount: int(o['amount'], 0, 100000) };
    default:
      throw new Error('order: kind ' + String(o['kind']));
  }
}

function parseAction(body: unknown): PlayAction {
  const b = body as Partial<PlayAction> | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.orders) || b.orders.length > 32) throw new Error('action');
  return {
    orders: b.orders.map(parseOrder),
    run: int(b.run ?? 1, 1, 1200),
    autopilot: b.autopilot === true,
    stop: b.stop !== false,
  };
}
