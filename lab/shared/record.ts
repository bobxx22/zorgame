/* lab :: record
   Формат запису партії лабораторії - спільний для сервера (пише) і панелі
   (читає). Кадр на кожен такт: правда світу з рушія, команди й відмови всіх
   місць, події, а для нашого місця - що бот бачив і коли стріляв пульс. */

export type Slot = 'A' | 'B' | 'C';
export type Actor = Slot | 'K';
export const SLOTS: readonly Slot[] = ['A', 'B', 'C'];

export interface Hex {
  q: number;
  r: number;
}

/* хто сидить на місці: наш бот (пресет), дзеркало архетипу SDK або наказ-зразок */
export type SeatKind = 'ours' | 'archetype' | 'nakaz' | 'our-nakaz';

export interface SeatSpec {
  kind: SeatKind;
  /* пресет нашої голови, ім'я архетипу або зразка наказу */
  name: string;
}

export interface MatchStatic {
  radius: number;
  /* імена типів місцевості за індексом */
  types: string[];
  /* кожна сота долини: q, r, тип, рівень */
  cells: [number, number, number, number][];
  needles: { k: string; q: number; r: number; start: Slot | null; ring: boolean }[];
  /* вогнища місць A, B, C */
  seats: Record<Slot, Hex>;
  citadel: Hex;
  cherta: number;
  finds: { kind: string; q: number; r: number }[];
  lots: { at: number; cells: Hex[] }[];
  storms: { x0: number; y0: number; vx: number; vy: number; r: number }[];
  dawn: number;
  linkRange: number;
}

/* рахунок, хвилини, заряд, голок, горить, юнитів, канал, бюджет каналу, вуха, бюджет вух */
export type PlayerRow = [number, number, number, number, number, number, number, number, number, number];
export const P = { score: 0, minutes: 1, energy: 2, needles: 3, lit: 4, units: 5, chan: 6, chanAt: 7, ear: 8, earAt: 9 } as const;

/* ключ, власник, вага горіння (0 - темна), прапорці: 1 - глушіння, 2 - корона, 4 - підживлення, 8 - жевріє */
export type NeedleRow = [string, Actor, number, number];
export const NF = { jam: 1, crown: 2, fed: 4, ember: 8 } as const;

/* завдання юнита */
export const TASKS = ['', 'move', 'needle', 'feed', 'jam', 'ram', 'home'] as const;
export type TaskName = (typeof TASKS)[number];
/* id, власник, клас (0 ткач, 1 клинок), q, r, завдання, ціль q, ціль r, прапорці: 1 - без рук, 2 - на повідку */
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
  /* нагрів: ключ голки, хто гріє, прогрес у тактах */
  heat: [string, Actor, number][];
  /* події такту з журналу рушія, як є */
  ev: Record<string, unknown>[];
  /* кадри команд місць цього такту (декодовані) */
  ord: Partial<Record<Slot, unknown[]>>;
  /* відмови: [позиція в кадрі, код] */
  den: Partial<Record<Slot, [number, number][]>>;
  eye: Partial<Record<Slot, Eye>>;
  order: Contract | null;
  dawn: boolean;
  /* наше місце: що бот бачив у кадрі спостереження і який пульс подав */
  seen?: { foe: [string, string, number, number][]; noisy: [number, number][] };
  pulse?: unknown;
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
  /* такти, коли слот вів наказ (мовчання бота 6 тактів і довше, правила 23.2) */
  nakazTicks: number;
  nakazEpisodes: { from: number; to: number }[];
}

export interface MatchMeta {
  index: number;
  seed: number;
  ticks: number;
  engine: string;
  /* хто на якому місці: учасник 0, 1, 2 пакета */
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
  /* учасники 1, 2, 3 пакета */
  lineup: [SeatSpec, SeatSpec, SeatSpec];
  /* 3 - повний пакет з пересадкою, 1 - одна партія */
  matches: 1 | 3;
}

export interface RunMeta {
  id: string;
  createdAt: string;
  request: RunRequest;
  status: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
  progress: { match: number; t: number };
  /* доля кожного учасника за пакет */
  shares?: [number, number, number];
  matches?: { index: number; places: Record<Slot, number>; scores: Record<Slot, number> }[];
  ms?: number;
}

export interface LabOptions {
  presets: string[];
  archetypes: string[];
  nakaz: string[];
  engine: string;
  cpus: number;
}
