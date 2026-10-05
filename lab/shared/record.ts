/* lab :: record
   The lab's match record format - shared by the server (writes) and the panel
   (reads). A frame per tick: the world's truth from the engine, orders and
   rejections of all seats, events, and for our seat - what the bot saw and when the pulse fired. */

export type Slot = 'A' | 'B' | 'C';
export type Actor = Slot | 'K';
export const SLOTS: readonly Slot[] = ['A', 'B', 'C'];

export interface Hex {
  q: number;
  r: number;
}

/* who sits in a seat: our bot (preset), an SDK archetype mirror, a sample nakaz, an external bot (lab/ext) or a mixed one (one's economy, another's Klinoks: "e=a3,k=ours") */
export type SeatKind = 'ours' | 'archetype' | 'nakaz' | 'our-nakaz' | 'ext' | 'mix';

export interface SeatSpec {
  kind: SeatKind;
  /* our head's preset, an archetype name or a nakaz sample name */
  name: string;
  /* our bot's tactics (bot/src/strategy.ts): fill:<nakaz>[:N], nopact, none;
     unset - the defaults, as in battle (DEFAULT_TACTICS) */
  tactics?: string[];
}

export function seatText(seat: SeatSpec): string {
  if (seat.kind === 'ours') {
    const tactics = seat.tactics === undefined ? ['default tactics'] : seat.tactics.join(',') === 'none' ? ['no tactics'] : seat.tactics;
    return ['ours · ' + seat.name, ...tactics].join(' · ');
  }
  if (seat.kind === 'archetype') return 'archetype · ' + seat.name;
  if (seat.kind === 'ext') return 'external · ' + seat.name;
  if (seat.kind === 'mix') return 'mixed · ' + seat.name;
  if (seat.kind === 'our-nakaz') return 'our nakaz';
  return 'nakaz · ' + seat.name;
}

export interface MatchStatic {
  radius: number;
  /* terrain type names by index */
  types: string[];
  /* every valley cell: q, r, type, level */
  cells: [number, number, number, number][];
  needles: { k: string; q: number; r: number; start: Slot | null; ring: boolean }[];
  /* hearths of seats A, B, C */
  seats: Record<Slot, Hex>;
  citadel: Hex;
  cherta: number;
  finds: { kind: string; q: number; r: number }[];
  lots: { at: number; cells: Hex[] }[];
  storms: { x0: number; y0: number; vx: number; vy: number; r: number }[];
  dawn: number;
  linkRange: number;
}

/* score, minutes, charge, needles, lit, units, channel, channel budget, ears, ears budget */
export type PlayerRow = [number, number, number, number, number, number, number, number, number, number];
export const P = { score: 0, minutes: 1, energy: 2, needles: 3, lit: 4, units: 5, chan: 6, chanAt: 7, ear: 8, earAt: 9 } as const;

/* key, owner, burn weight (0 - dark), flags: 1 - jamming, 2 - crown, 4 - feeding, 8 - smouldering */
export type NeedleRow = [string, Actor, number, number];
export const NF = { jam: 1, crown: 2, fed: 4, ember: 8 } as const;

/* a unit's task */
export const TASKS = ['', 'move', 'needle', 'feed', 'jam', 'ram', 'home'] as const;
export type TaskName = (typeof TASKS)[number];
/* id, owner, class (0 Tkach, 1 Klinok), q, r, task, target q, target r, flags: 1 - no hands, 2 - on the leash */
export type UnitRow = [string, Actor, 0 | 1, number, number, number, number | null, number | null, number];

export interface Eye {
  watch: Hex | null;
  scan: (Hex & { rad: number }) | null;
}

export interface Contract {
  cells: string[];
  from: number;
  to: number;
  progress: Partial<Record<Slot, { ticks: number; reason: string | null }>>;
}

export interface Frame {
  t: number;
  p: Record<Actor, PlayerRow>;
  n: NeedleRow[];
  u: UnitRow[];
  /* heating: needle key, who heats, progress in ticks */
  heat: [string, Actor, number][];
  /* the tick's events from the engine journal, as is */
  ev: Record<string, unknown>[];
  /* the seats' order frames of this tick (decoded) */
  ord: Partial<Record<Slot, unknown[]>>;
  /* rejections: [position in the frame, code] */
  den: Partial<Record<Slot, [number, number][]>>;
  eye: Partial<Record<Slot, Eye>>;
  order: Contract | null;
  dawn: boolean;
  /* our seat: what the bot saw in the observe frame and which pulse it sent */
  seen?: { foe: [string, string, number, number][]; noisy: [number, number][] };
  pulse?: unknown;
  /* where each order of our seat's frame came from: pulse, head, fill */
  src?: string[];
}

export interface SeatResult {
  slot: Slot;
  score: number;
  place: number;
  share: number;
  breakdown: Record<string, number>;
  lit: number;
  energy: number;
  needles: number;
  denials: number;
  orders: number;
  pulses: number;
  /* ticks when our seat's frame had filler nakaz orders */
  fills: number;
  /* ticks when the nakaz ran the slot (the bot silent for 6 ticks or longer, rules 23.2) */
  nakazTicks: number;
  nakazEpisodes: { from: number; to: number }[];
}

export interface MatchMeta {
  index: number;
  seed: number;
  ticks: number;
  engine: string;
  /* who is in which seat: participant 0, 1, 2 of the pack */
  seating: Record<Slot, number>;
  labels: Record<Slot, string>;
  ours: Slot | null;
}

export interface MatchRecord {
  v: 1;
  meta: MatchMeta;
  static: MatchStatic;
  frames: Frame[];
  result: SeatResult[];
}

export interface RunRequest {
  seed: number;
  ticks: number;
  /* participants 1, 2, 3 of the pack */
  lineup: [SeatSpec, SeatSpec, SeatSpec];
  /* 3 - a full pack with seat rotation, 1 - a single match */
  matches: 1 | 3;
}

/* a participant's result in one match - for tournaments without reading records */
export interface SeatLine {
  participant: number;
  slot: Slot;
  place: number;
  share: number;
  score: number;
  network: number;
  orders: number;
  stolen: number;
  tax: number;
  lit: number;
  denials: number;
  pulses: number;
  fills: number;
  nakazTicks: number;
}

export interface RunMeta {
  id: string;
  createdAt: string;
  request: RunRequest;
  status: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
  progress: { match: number; t: number };
  /* each participant's share per pack */
  shares?: [number, number, number];
  matches?: { index: number; places: Record<Slot, number>; scores: Record<Slot, number>; seats?: SeatLine[] }[];
  ms?: number;
  /* the run is part of a tournament: variant and valley number */
  tournament?: { id: string; variant: number; seed: number };
}

export interface LabOptions {
  presets: string[];
  archetypes: string[];
  nakaz: string[];
  /* external bots (lab/ext) */
  ext: string[];
  /* nakazes that can fill the head's idle time */
  charters: string[];
  /* our bot's battle configuration: default style and tactics */
  defaultPreset: string;
  defaultTactics: string[];
  engine: string;
  cpus: number;
}

export interface TournamentRequest {
  name: string;
  /* variants in participant 1's seat: our bot with tactics or anyone else as a reference */
  variants: SeatSpec[];
  /* opponents: pairs from this pool in turn, every variant - on the same pairs and valleys */
  opponents: SeatSpec[];
  seedFrom: number;
  seeds: number;
  ticks: number;
}

export interface Tournament {
  id: string;
  createdAt: string;
  request: TournamentRequest;
  /* opponent pairs by valley number */
  pairs: [SeatSpec, SeatSpec][];
  /* run ids: [variant][valley] */
  runs: string[][];
}

export interface VariantStats {
  variant: number;
  label: string;
  done: number;
  total: number;
  mean: number;
  se: number;
  min: number;
  max: number;
  /* difference vs variant 1 on the same valleys */
  delta: { mean: number; se: number; n: number } | null;
  places: [number, number, number];
  score: number;
  network: number;
  orders: number;
  stolen: number;
  tax: number;
  lit: number;
  denials: number;
  pulses: number;
  fills: number;
  nakazTicks: number;
  opponentScore: number;
}

export interface TournamentView {
  tournament: Tournament;
  stats: VariantStats[];
  /* the variant's share on each valley: [valley][variant], null - not played yet */
  grid: (number | null)[][];
  status: { queued: number; running: number; done: number; failed: number };
}
