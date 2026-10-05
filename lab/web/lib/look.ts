/* Panel colours and labels: seats, terrain, events, gatekeeper rejections. */

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
  bare: 'wasteland',
  meadow: 'meadow',
  wood: 'forest',
  sand: 'sand',
  marsh: 'marsh',
  hill: 'hill',
  water: 'water',
  mount: 'mountain',
};

export const FIND_NAME: Record<string, string> = {
  cache: 'cache (+150 charge)',
  flare: 'flare (free scan)',
  still: 'still backwater',
  dead: 'dead cell',
  echo: 'echo nest',
};

export const FIND_GLYPH: Record<string, string> = { cache: '⚡', flare: '✦', still: '◌', dead: '✕', echo: '≈' };

/* gatekeeper rejection codes (protocol 6.6) */
export const DENY = [
  'accepted',
  'garbage',
  'cap',
  'machine',
  'turn',
  'tariff',
  'channel',
  'ears',
  'yard',
  'charge',
  'swarm weight',
  'ground',
  'no path',
  'not own needle',
  'flare',
  'view',
  'ram',
  'target',
  'jamming',
  'pact',
  'cry',
  'refusal',
  'bidding',
] as const;

export const CRIES = [
  'going for the ring',
  'holding my own',
  'looking for a pact',
  'looking for peace',
  'going for the leader',
  'going for the weaker',
  'waiting out the storm',
  'good game',
];

export const EVENT_NAME: Record<string, string> = {
  build: 'left the yard',
  raise: 'new needle',
  cap: 'capture',
  lost: 'loss',
  jam: 'jamming',
  ram: 'ram',
  cut: 'thread cut',
  find: 'find',
  lot: 'lot',
  order: 'contract',
  orderDone: 'contract done',
  pact: 'pact',
  pactBreak: 'pact broken',
  pactGone: 'pact ended',
  cry: 'cry',
  dawn: 'dawn',
  mercy: 'mercy',
  out: 'out',
  scan: 'scan',
  deny: 'rejection',
  note: 'note',
};

const cell = (e: Record<string, unknown>): string => (typeof e['q'] === 'number' ? ` (${String(e['q'])}, ${String(e['r'])})` : '');

/* an engine journal event as one line */
export function eventText(e: Record<string, unknown>): string {
  const type = String(e['type']);
  const name = EVENT_NAME[type] ?? type;
  const p = e['p'] ? String(e['p']) : '';
  switch (type) {
    case 'cap':
      return `${p} captured a needle${cell(e)}${e['from'] ? ' from ' + String(e['from']) : ''}${e['ring'] ? ' · ring' : ''}`;
    case 'raise':
      return `${p} raised a needle${cell(e)}`;
    case 'lost':
      return `${p} lost ${String(e['cls'] ?? 'a unit')}${e['why'] ? ' (' + String(e['why']) + ')' : ''}${cell(e)}`;
    case 'jam':
      return `${p} jams a needle${cell(e)}${e['own'] ? ' of player ' + String(e['own']) : ''}`;
    case 'ram':
      return `${p} rams${cell(e)}${e['tgt'] ? ' unit ' + String(e['tgt']) : ''}`;
    case 'build':
      return `${p}: ${String(e['cls'] ?? 'a unit')} left the yard`;
    case 'lot':
      return `lot ${String(e['lot'])}: ${e['p'] ? 'bought by ' + String(e['p']) : 'not sold'}`;
    case 'order':
      return `contract opened${cell(e)}, until tick ${String(e['to'])}`;
    case 'find':
      return `${p} picked up: ${FIND_NAME[String(e['find'])] ?? String(e['find'])}${cell(e)}`;
    case 'cry':
      return `${p}: "${CRIES[Number(e['n'])] ?? String(e['n'])}"`;
    case 'deny':
      return `${p}: rejection "${String(e['why'] ?? '')}"${cell(e)}`;
    case 'pact':
      return `pact ${String(e['a'] ?? p)}-${String(e['b'] ?? '')}`;
    case 'scan':
      return `${p} scans${cell(e)}`;
    default:
      return `${name}${p ? ' · ' + p : ''}${cell(e)}`;
  }
}

/* an order as one line */
export function orderText(o: Record<string, unknown>): string {
  const at = typeof o['q'] === 'number' ? ` → (${String(o['q'])}, ${String(o['r'])})` : '';
  switch (o['kind']) {
    case 'yard':
      return `yard: ${String(o['cls'])}`;
    case 'move':
      return `${String(o['unit'])} goes${at}${o['home'] ? ' home' : ''}`;
    case 'needle':
      return `${String(o['unit'])} builds${at}`;
    case 'feed':
      return `${String(o['unit'])} feeds${at}`;
    case 'jam': {
      const target = o['target'] as { q: number; r: number } | null;
      return `${String(o['unit'])} jams ${target ? `(${target.q}, ${target.r})` : '—'}${o['hold'] ? ' holding' : ''}`;
    }
    case 'ram':
      return `${String(o['unit'])} rams ${String(o['target'])}`;
    case 'halt':
      return `${String(o['unit'])} halt`;
    case 'scan':
      return `scan${at} r${String(o['rad'])}`;
    case 'watch':
      return `focus${at}`;
    case 'bid':
      return `bid on lot ${String(o['lot'])}: ${String(o['amount'])}`;
    case 'pact':
      return `pact ${({ offer: 'offer', accept: 'accept', break: 'break' } as Record<string, string>)[String(o['op'])] ?? String(o['op'])} → ${String(o['to'])}`;
    case 'cry':
      return `cry "${CRIES[Number(o['phrase'])] ?? String(o['phrase'])}"`;
    default:
      return JSON.stringify(o);
  }
}

export const fmt = (n: number, digits = 1): string => (Number.isFinite(n) ? n.toFixed(digits) : '—');
