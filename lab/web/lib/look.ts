/* Panel colours and labels: seats, terrain, events, gatekeeper rejections.
   Labels are in both languages (lib/i18n.ts). */

import type { Actor } from '../../shared/record.ts';
import { tr, txt } from './i18n.ts';
import type { Text } from './i18n.ts';

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

const T = (en: string, uk: string): Text => ({ en, uk });

const TERRAIN: Record<string, Text> = {
  bare: T('wasteland', 'пустка'),
  meadow: T('meadow', 'луг'),
  wood: T('forest', 'ліс'),
  sand: T('sand', 'пісок'),
  marsh: T('marsh', 'болото'),
  hill: T('hill', 'пагорб'),
  water: T('water', 'вода'),
  mount: T('mountain', 'гора'),
};
export const terrainName = (name: string): string => (TERRAIN[name] ? txt(TERRAIN[name]) : name);

const FIND: Record<string, Text> = {
  cache: T('cache (+150 charge)', 'схованка (+150 заряду)'),
  flare: T('flare (free scan)', 'спалах (безкоштовний скан)'),
  still: T('still backwater', 'тиха заводь'),
  dead: T('dead cell', 'мертва сота'),
  echo: T('echo nest', 'гніздо відлуння'),
};
export const findName = (kind: string): string => (FIND[kind] ? txt(FIND[kind]) : kind);

export const FIND_GLYPH: Record<string, string> = { cache: '⚡', flare: '✦', still: '◌', dead: '✕', echo: '≈' };

/* gatekeeper rejection codes (protocol 6.6) */
const DENY: readonly Text[] = [
  T('accepted', 'прийнято'),
  T('garbage', 'сміття'),
  T('cap', 'стеля'),
  T('machine', 'машина'),
  T('turn', 'поворот'),
  T('tariff', 'тариф'),
  T('channel', 'канал'),
  T('ears', 'вуха'),
  T('yard', 'верф'),
  T('charge', 'заряд'),
  T('swarm weight', 'вага рою'),
  T('ground', 'земля'),
  T('no path', 'немає шляху'),
  T('not own needle', 'не своя голка'),
  T('flare', 'спалах'),
  T('view', 'погляд'),
  T('ram', 'таран'),
  T('target', 'ціль'),
  T('jamming', 'глушіння'),
  T('pact', 'угода'),
  T('cry', 'клич'),
  T('refusal', 'відмова'),
  T('bidding', 'торги'),
];
export const denyWord = (code: number): string => (DENY[code] ? txt(DENY[code]) : String(code));

const CRIES: readonly Text[] = [
  T('going for the ring', 'йду в кільце'),
  T('holding my own', 'тримаю своє'),
  T('looking for a pact', 'шукаю угоди'),
  T('looking for peace', 'шукаю миру'),
  T('going for the leader', 'йду на лідера'),
  T('going for the weaker', 'йду на слабшого'),
  T('waiting out the storm', 'пережидаю бурю'),
  T('good game', 'добра гра'),
];
export const CRY_COUNT = CRIES.length;
export const cryText = (n: number): string => (CRIES[n] ? txt(CRIES[n]) : String(n));

const EVENT: Record<string, Text> = {
  build: T('left the yard', 'вихід із двору'),
  raise: T('new needle', 'нова голка'),
  cap: T('capture', 'захоплення'),
  lost: T('loss', 'втрата'),
  jam: T('jamming', 'глушіння'),
  ram: T('ram', 'таран'),
  cut: T('thread cut', 'розрив нитки'),
  find: T('find', 'знахідка'),
  lot: T('lot', 'лот'),
  order: T('contract', 'контракт'),
  orderDone: T('contract done', 'контракт виконано'),
  pact: T('pact', 'угода'),
  pactBreak: T('pact broken', 'розрив угоди'),
  pactGone: T('pact ended', 'угода скінчилась'),
  cry: T('cry', 'клич'),
  dawn: T('dawn', 'зоря'),
  mercy: T('mercy', 'милість'),
  out: T('out', 'вибув'),
  scan: T('scan', 'скан'),
  deny: T('rejection', 'відмова'),
  note: T('note', 'нотатка'),
};
export const eventName = (type: string): string => (EVENT[type] ? txt(EVENT[type]) : type);

/* a unit class from the engine (ткач, клинок) or a record (0, 1) in the panel's language */
export const clsName = (cls: string | number): string =>
  cls === 'клинок' || cls === 1 ? tr('Klinok', 'клинок') : cls === 'ткач' || cls === 0 ? tr('Tkach', 'ткач') : String(cls);

const cell = (e: Record<string, unknown>): string => (typeof e['q'] === 'number' ? ` (${String(e['q'])}, ${String(e['r'])})` : '');

/* an engine journal event as one line */
export function eventText(e: Record<string, unknown>): string {
  const type = String(e['type']);
  const name = eventName(type);
  const p = e['p'] ? String(e['p']) : '';
  const unit = (v: unknown) => (v ? clsName(String(v)) : tr('a unit', 'юнит'));
  switch (type) {
    case 'cap':
      return `${p} ${tr('captured a needle', 'захопив голку')}${cell(e)}${e['from'] ? tr(' from ', ' у ') + String(e['from']) : ''}${e['ring'] ? tr(' · ring', ' · кільце') : ''}`;
    case 'raise':
      return `${p} ${tr('raised a needle', 'звів голку')}${cell(e)}`;
    case 'lost':
      return `${p} ${tr('lost', 'втратив')} ${unit(e['cls'])}${e['why'] ? ' (' + String(e['why']) + ')' : ''}${cell(e)}`;
    case 'jam':
      return `${p} ${tr('jams a needle', 'глушить голку')}${cell(e)}${e['own'] ? tr(' of player ', ' гравця ') + String(e['own']) : ''}`;
    case 'ram':
      return `${p} ${tr('rams', 'таранить')}${cell(e)}${e['tgt'] ? tr(' unit ', ' юнит ') + String(e['tgt']) : ''}`;
    case 'build':
      return `${p}: ${unit(e['cls'])} ${tr('left the yard', 'вийшов із двору')}`;
    case 'lot':
      return `${tr('lot', 'лот')} ${String(e['lot'])}: ${e['p'] ? tr('bought by ', 'купив ') + String(e['p']) : tr('not sold', 'не продано')}`;
    case 'order':
      return `${tr('contract opened', 'контракт відкрито')}${cell(e)}, ${tr('until tick', 'до такту')} ${String(e['to'])}`;
    case 'find':
      return `${p} ${tr('picked up', 'підібрав')}: ${findName(String(e['find']))}${cell(e)}`;
    case 'cry':
      return `${p}: «${cryText(Number(e['n']))}»`;
    case 'deny':
      return `${p}: ${tr('rejection', 'відмова')} «${String(e['why'] ?? '')}»${cell(e)}`;
    case 'pact':
      return `${tr('pact', 'угода')} ${String(e['a'] ?? p)}-${String(e['b'] ?? '')}`;
    case 'scan':
      return `${p} ${tr('scans', 'сканує')}${cell(e)}`;
    default:
      return `${name}${p ? ' · ' + p : ''}${cell(e)}`;
  }
}

/* an order as one line */
export function orderText(o: Record<string, unknown>): string {
  const at = typeof o['q'] === 'number' ? ` → (${String(o['q'])}, ${String(o['r'])})` : '';
  switch (o['kind']) {
    case 'yard':
      return `${tr('yard', 'двір')}: ${clsName(String(o['cls']))}`;
    case 'move':
      return `${String(o['unit'])} ${tr('goes', 'іде')}${at}${o['home'] ? tr(' home', ' додому') : ''}`;
    case 'needle':
      return `${String(o['unit'])} ${tr('builds', 'будує')}${at}`;
    case 'feed':
      return `${String(o['unit'])} ${tr('feeds', 'живить')}${at}`;
    case 'jam': {
      const target = o['target'] as { q: number; r: number } | null;
      return `${String(o['unit'])} ${tr('jams', 'глушить')} ${target ? `(${target.q}, ${target.r})` : '—'}${o['hold'] ? tr(' holding', ' стоячи') : ''}`;
    }
    case 'ram':
      return `${String(o['unit'])} ${tr('rams', 'таранить')} ${String(o['target'])}`;
    case 'halt':
      return `${String(o['unit'])} ${tr('halt', 'стоп')}`;
    case 'scan':
      return `${tr('scan', 'скан')}${at} r${String(o['rad'])}`;
    case 'watch':
      return `${tr('focus', 'фокус')}${at}`;
    case 'bid':
      return `${tr('bid on lot', 'ставка на лот')} ${String(o['lot'])}: ${String(o['amount'])}`;
    case 'pact': {
      const ops: Record<string, Text> = { offer: T('offer', 'пропозиція'), accept: T('accept', 'згода'), break: T('break', 'розрив') };
      const op = ops[String(o['op'])];
      return `${tr('pact', 'угода')} ${op ? txt(op) : String(o['op'])} → ${String(o['to'])}`;
    }
    case 'cry':
      return `${tr('cry', 'клич')} «${cryText(Number(o['phrase']))}»`;
    default:
      return JSON.stringify(o);
  }
}

export const fmt = (n: number, digits = 1): string => (Number.isFinite(n) ? n.toFixed(digits) : '—');
