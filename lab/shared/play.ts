/* lab :: play
   Play mode: a human takes one seat of a match against bots, a bot of choice
   advises. Shared by the server (server/human.ts, the session in main.ts) and
   the panel (web/play). The match waits for the human on every decision tick;
   between decisions it can run on its own - silent or with the advisor at the
   wheel. */

import type { FoeEntry, MineJam, MineLedger, MineNeedle, MinePact, MineUnit, ObsEvent, Order, OrderProgress, OwnEntry, Pulse, PubLayer } from '@zoria/protocol';
import type { Frame, MatchStatic, SeatResult, SeatSpec, Slot } from './record.ts';

export type { Order };

/* the shared memory a decision travels in from the panel to the game thread */
export const SHARED_BYTES = 256 * 1024;

/* a text in both languages: explanations come from the server ready for either */
export interface Bilingual {
  en: string;
  uk: string;
}

export interface PlayRequest {
  seed: number;
  ticks: number;
  /* the human's seat: 0 - A, 1 - B, 2 - C */
  seat: 0 | 1 | 2;
  opponents: [SeatSpec, SeatSpec];
  /* who advises; null - nobody */
  advisor: SeatSpec | null;
}

/* one suggestion of the advisor: the order it would send and why */
export interface Advice {
  order: Order;
  why: Bilingual;
  /* where it came from inside our bot: head, tactic, fill, pulse; other bots - empty */
  src: string;
}

/* what the human's seat sees at the decision tick - the observe frame, without the noise */
export interface Sight {
  pulse: Pulse;
  units: MineUnit[];
  needles: MineNeedle[];
  jams: MineJam[];
  pact: MinePact;
  ledger: MineLedger;
  order: OrderProgress | null;
  own: OwnEntry[];
  foe: FoeEntry[];
  pub: PubLayer;
  events: ObsEvent[];
}

export interface Verdict {
  order: Order;
  ok: boolean;
  code: number;
}

export interface PlayTurn {
  /* the tick the orders will be played at */
  t: number;
  /* the world's truth before this tick (for the map; the panel can hide what the seat doesn't see) */
  frame: Frame | null;
  sight: Sight;
  advice: Advice[];
  /* verdicts of the human's last frame */
  verdicts: Verdict[];
  /* swarm weight of the units on the field (hulls in the yard queue are not in the frame) */
  weight: number;
  /* why the run stopped early, or what went wrong with the last frame; null - nothing */
  note: Bilingual | null;
}

/* what the human does at a decision tick */
export interface PlayAction {
  orders: Order[];
  /* ticks to play before the next decision, 1 - only this one */
  run: number;
  /* the advisor plays the extra ticks; otherwise the seat stays silent (units keep their tasks) */
  autopilot: boolean;
  /* stop the run early on our losses, captures of our needles, a new unit, dawn or a rejection */
  stop: boolean;
}

export type PlayStatus = 'starting' | 'waiting' | 'running' | 'done' | 'failed';

export interface PlayState {
  id: string;
  request: PlayRequest;
  status: PlayStatus;
  slot: Slot | null;
  labels: Record<Slot, string> | null;
  static: MatchStatic | null;
  cfg: Record<string, number> | null;
  turn: PlayTurn | null;
  /* during a run: the tick reached */
  progress: number;
  result: SeatResult[] | null;
  /* the saved record of a finished game: runs/<runId>, match 1 */
  runId: string | null;
  error: string | null;
}
