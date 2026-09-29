/* Кольори й підписи панелі: місця, місцевість, події, відмови воротаря. */

import type { Actor } from '../../shared/record.ts';

export const ACTOR_COLOR: Record<Actor, string> = {
  A: '#4db8ff',
  B: '#ff6b6b',
  C: '#6fd28a',
  K: '#b39ddb',
};

export const TERRAIN_COLOR: Record<string, string> = {
  bare: '#3a362f',
  meadow: '#3d5634',
  wood: '#2c452d',
  sand: '#6a5f42',
  marsh: '#33504d',
  hill: '#5b4a39',
  water: '#1d3a57',
  mount: '#565b63',
};

export const TERRAIN_NAME: Record<string, string> = {
  bare: 'пустка',
  meadow: 'луг',
  wood: 'ліс',
  sand: 'пісок',
  marsh: 'болото',
  hill: 'пагорб',
  water: 'вода',
  mount: 'гора',
};

export const FIND_NAME: Record<string, string> = {
  cache: 'схованка (+150 заряду)',
  flare: 'спалах (безкоштовний скан)',
  still: 'тиха заводь',
  dead: 'мертва сота',
  echo: 'гніздо відлуння',
};

export const FIND_GLYPH: Record<string, string> = { cache: '⚡', flare: '✦', still: '◌', dead: '✕', echo: '≈' };

/* коди відмов воротаря (протокол 6.6) */
export const DENY = [
  'прийнято',
  'сміття',
  'стеля',
  'машина',
  'поворот',
  'тариф',
  'канал',
  'вуха',
  'верф',
  'заряд',
  'вага рою',
  'земля',
  'немає шляху',
  'не своя голка',
  'спалах',
  'погляд',
  'таран',
  'ціль',
  'глушіння',
  'угода',
  'клич',
  'відмова',
  'торги',
] as const;

export const CRIES = [
  'йду в кільце',
  'тримаю своє',
  'шукаю угоди',
  'шукаю миру',
  'йду на лідера',
  'йду на слабшого',
  'пережидаю бурю',
  'добра гра',
];

export const EVENT_NAME: Record<string, string> = {
  build: 'вихід із двору',
  raise: 'нова голка',
  cap: 'захоплення',
  lost: 'втрата',
  jam: 'глушіння',
  ram: 'таран',
  cut: 'розрив нитки',
  find: 'знахідка',
  lot: 'лот',
  order: 'контракт',
  orderDone: 'контракт виконано',
  pact: 'угода',
  pactBreak: 'розрив угоди',
  pactGone: 'угода скінчилась',
  cry: 'клич',
  dawn: 'зоря',
  mercy: 'милість',
  out: 'вибув',
  scan: 'скан',
  deny: 'відмова',
  note: 'нотатка',
};

const cell = (e: Record<string, unknown>): string => (typeof e['q'] === 'number' ? ` (${String(e['q'])}, ${String(e['r'])})` : '');

/* подія журналу рушія одним рядком */
export function eventText(e: Record<string, unknown>): string {
  const type = String(e['type']);
  const name = EVENT_NAME[type] ?? type;
  const p = e['p'] ? String(e['p']) : '';
  switch (type) {
    case 'cap':
      return `${p} захопив голку${cell(e)}${e['from'] ? ' у ' + String(e['from']) : ''}${e['ring'] ? ' · кільце' : ''}`;
    case 'raise':
      return `${p} звів голку${cell(e)}`;
    case 'lost':
      return `${p} втратив ${String(e['cls'] ?? 'юнит')}${e['why'] ? ' (' + String(e['why']) + ')' : ''}${cell(e)}`;
    case 'jam':
      return `${p} глушить голку${cell(e)}${e['own'] ? ' гравця ' + String(e['own']) : ''}`;
    case 'ram':
      return `${p} таранить${cell(e)}${e['tgt'] ? ' юнит ' + String(e['tgt']) : ''}`;
    case 'build':
      return `${p}: ${String(e['cls'] ?? 'юнит')} вийшов із двору`;
    case 'lot':
      return `лот ${String(e['lot'])}: ${e['p'] ? 'купив ' + String(e['p']) : 'не продано'}`;
    case 'order':
      return `контракт відкрито${cell(e)}, до такту ${String(e['to'])}`;
    case 'find':
      return `${p} підібрав: ${FIND_NAME[String(e['find'])] ?? String(e['find'])}${cell(e)}`;
    case 'cry':
      return `${p}: «${CRIES[Number(e['n'])] ?? String(e['n'])}»`;
    case 'deny':
      return `${p}: відмова «${String(e['why'] ?? '')}»${cell(e)}`;
    case 'pact':
      return `угода ${String(e['a'] ?? p)}-${String(e['b'] ?? '')}`;
    case 'scan':
      return `${p} сканує${cell(e)}`;
    default:
      return `${name}${p ? ' · ' + p : ''}${cell(e)}`;
  }
}

/* команда одним рядком */
export function orderText(o: Record<string, unknown>): string {
  const at = typeof o['q'] === 'number' ? ` → (${String(o['q'])}, ${String(o['r'])})` : '';
  switch (o['kind']) {
    case 'yard':
      return `двір: ${String(o['cls'])}`;
    case 'move':
      return `${String(o['unit'])} іде${at}${o['home'] ? ' додому' : ''}`;
    case 'needle':
      return `${String(o['unit'])} будує${at}`;
    case 'feed':
      return `${String(o['unit'])} живить${at}`;
    case 'jam': {
      const target = o['target'] as { q: number; r: number } | null;
      return `${String(o['unit'])} глушить ${target ? `(${target.q}, ${target.r})` : '—'}${o['hold'] ? ' стоячи' : ''}`;
    }
    case 'ram':
      return `${String(o['unit'])} таранить ${String(o['target'])}`;
    case 'halt':
      return `${String(o['unit'])} стоп`;
    case 'scan':
      return `скан${at} r${String(o['rad'])}`;
    case 'watch':
      return `фокус${at}`;
    case 'bid':
      return `ставка на лот ${String(o['lot'])}: ${String(o['amount'])}`;
    case 'pact':
      return `угода ${['пропозиція', 'згода', 'розрив'][Number(o['op'])] ?? String(o['op'])} → ${String(o['to'])}`;
    case 'cry':
      return `клич «${CRIES[Number(o['phrase'])] ?? String(o['phrase'])}»`;
    default:
      return JSON.stringify(o);
  }
}

export const fmt = (n: number, digits = 1): string => (Number.isFinite(n) ? n.toFixed(digits) : '—');
