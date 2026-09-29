/* bot :: strategy
   Стратегія бота: голова архетипу SDK (ZARIA_PRESET - рівний, шир,
   обхідник, проривник, облягач) і пульс, що тримає слот за ботом.

   Контракт - WireBot (маніфест, кадр спостереження -> кадр команд,
   вердикти) плюс кадр щоденника віри. Мережі тут немає і бути не повинно:
   провід, повернення і піни живуть у main.ts, wire.ts і connectBot.

   Пульс. Наказ бере слот із сьомого такту без прийнятої команди (правила
   23.2), а голова дзеркала мовчить, коли їй нема чого скомандувати, або
   отримує відмови. Після PULSE_AFTER таких тактів бот сам ставить першою в
   кадр команду, яка нічого не змінює у світі (P2-04):
     - halt юниту без завдання - безкоштовний (правила 13.4), але лише
       юниту, якому голова в цьому кадрі нічого не дала: кадр спостереження
       знято до команд (6.3), і воротар виконує їх по черзі (6.4), тож halt
       такому юниту скасував би щойно дану команду;
     - повтор фокуса, який воротар уже прийняв, - 32 байти каналу. Він стоїть
       першим, тож watch голови в тому самому кадрі, якщо його приймуть,
       перекриває його.
   Пульс подається, лише якщо на нього вистачає каналу разом із командами
   голови і кадр не впирається в стелю: відмова - теж відхилена команда. */

import { createEngine } from '@zoria/engine';
import { ARCHETYPES, BeliefTrace, sampleBot } from '@zoria/sdk';
import type { BeliefFrame, MirrorBot, WireBot } from '@zoria/sdk';
import {
  decodeManifest,
  decodeObserve,
  decodeOrders,
  decodeVerdicts,
  encodeOrders,
  encodeVerdicts,
  orderCap,
  orderCost,
} from '@zoria/protocol';
import type { ChannelCfg, Hex, Manifest, Observe, Order, SlotName, Verdict } from '@zoria/protocol';
import { errText } from './errors.js';

export interface Strategy extends WireBot {
  /* кадр щоденника віри такту; null - кадру немає */
  belief(obs: Observe | null): BeliefFrame | null;
  /* наступний кадр щоденника - повний: попередній рядок не записався */
  resetBelief(): void;
}

/* Пульс - із третього такту без прийнятої команди: до сьомого лишається
   чотири такти запасу на обрив і повернення (протокол 8.4). */
export const PULSE_AFTER = 2;
/* Падіння голови в журналі: перше і далі кожне FAIL_LOG_EVERY-те. */
export const FAIL_LOG_EVERY = 100;

type Watch = Extract<Order, { kind: 'watch' }>;

/* що потрібно пульсу про світ: тарифи, бурі, вогнище */
export interface PulseWorld {
  cfg: ChannelCfg;
  storms: Manifest['storms'];
  hearth: Hex;
}

/* де «стоїть» команда для тарифу: юнит - на своїй соті, фокус і скан -
   у цілі, решта (yard, bid, pact, cry) - на вогнищі (правила 15.3) */
export function costAt(order: Order, obs: Observe, hearth: Hex): Hex {
  if ('unit' in order) {
    const unit = obs.mine.units.find((u) => u.id === order.unit);
    return unit ? { q: unit.q, r: unit.r } : hearth;
  }
  if (order.kind === 'watch' || order.kind === 'scan') return { q: order.q, r: order.r };
  return hearth;
}

/* байти каналу, що лишаться після команд голови; скан платить вухами */
export function channelLeft(obs: Observe, orders: readonly Order[], world: PulseWorld): number {
  let left = obs.pulse.chan;
  for (const order of orders) {
    if (order.kind === 'scan') continue;
    left -= orderCost(world.cfg, order.kind, costAt(order, obs, world.hearth), obs.t, world.storms);
  }
  return left;
}

/* найдешевша команда, що нічого не змінює, або null, якщо такої немає */
export function pulseOrder(obs: Observe, orders: readonly Order[], focus: Watch | null, world: PulseWorld): Order | null {
  if (orders.length + 1 > orderCap(world.cfg, obs.pulse.chanAt)) return null;
  const left = channelLeft(obs, orders, world);
  const busy = new Set(orders.flatMap((order) => ('unit' in order ? [order.unit] : [])));
  const idle = obs.mine.units.find((unit) => unit.task === null && unit.wait === 0 && !busy.has(unit.id));
  // halt is free, but the gatekeeper accepts it only while 32 bytes are left (rules 13.4)
  if (idle && left >= world.cfg.chanOrder) return { kind: 'halt', unit: idle.id };
  if (!focus) return null;
  return left >= orderCost(world.cfg, 'watch', focus, obs.t, world.storms) ? focus : null;
}

/* вердикти кадру, де пульс стоїть першим, - як вердикти команд голови */
export function headVerdicts(list: readonly Verdict[], pulsed: boolean): Verdict[] {
  if (!pulsed) return [...list];
  return list.filter(([i]) => i > 0).map(([i, ok, code]) => [i - 1, ok, code]);
}

/* голова, яку обгортає пульс: дзеркало архетипу або підміна в тестах */
export type Head = Pick<MirrorBot, 'init' | 'tick' | 'feedback' | 'mirror'>;

export class PulseStrategy implements Strategy {
  private readonly head: Head;
  private readonly log: (line: string) => void;
  private slot: SlotName | null = null;
  private trace: BeliefTrace | null = null;
  private world: PulseWorld | null = null;
  /* тактів поспіль без прийнятої команди */
  private quiet = 0;
  /* фокус, прийнятий воротарем; до першого watch - вогнище */
  private focus: Watch | null = null;
  /* watch голови цього кадру та його місце в кадрі: фокусом стане, коли його приймуть */
  private asked: { at: number; order: Watch } | null = null;
  /* чи стоїть у кадрі цього такту пульс (першим) */
  private pulsed = false;
  private headFaults = 0;

  constructor(head: Head, log: (line: string) => void = () => undefined) {
    this.head = head;
    this.log = log;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.head.init(manifest, slot);
    this.slot = slot;
    this.trace = new BeliefTrace(slot);
    const m = decodeManifest(manifest);
    const hearth = m?.seats[m.perm.indexOf(slot)];
    this.world = m && hearth ? { cfg: m.cfg as unknown as ChannelCfg, storms: m.storms, hearth } : null;
    this.focus = hearth ? { kind: 'watch', q: hearth.q, r: hearth.r, keep: 0 } : null;
    this.quiet = 0;
  }

  tick(observe: Uint8Array): Uint8Array {
    let reply: Uint8Array | null = null;
    let orders: Order[] = [];
    try {
      reply = this.head.tick(observe);
      const decoded = decodeOrders(reply);
      // a reply that does not decode is garbage for the node too: the pulse speaks instead
      if (decoded === null) reply = null;
      orders = decoded ?? [];
    } catch (e) {
      this.fail('tick', e);
    }

    const quiet = this.quiet;
    this.quiet += 1;
    const obs = quiet >= PULSE_AFTER && this.world ? decodeObserve(observe) : null;
    const pulse = obs && this.world ? pulseOrder(obs, orders, this.focus, this.world) : null;
    this.pulsed = pulse !== null;

    const shift = this.pulsed ? 1 : 0;
    const index = orders.findIndex((order) => order.kind === 'watch');
    const watch = orders[index];
    this.asked = watch?.kind === 'watch' ? { at: index + shift, order: watch } : null;

    if (pulse) return encodeOrders([pulse, ...orders]);
    return reply ?? encodeOrders(orders);
  }

  feedback(verdicts: Uint8Array): void {
    const list = decodeVerdicts(verdicts);
    if (list?.some(([, ok]) => ok)) this.quiet = 0;
    const asked = this.asked;
    if (asked && list?.some(([i, ok]) => i === asked.at && ok)) this.focus = asked.order;
    try {
      // the head gets back only the verdicts on its own commands, at their own positions
      this.head.feedback(list && this.pulsed ? encodeVerdicts(headVerdicts(list, true)) : verdicts);
    } catch (e) {
      this.fail('feedback', e);
    }
  }

  /* віра дзеркала: світ дзеркальної голови і є те, у що вона вірить */
  belief(obs: Observe | null): BeliefFrame | null {
    const E = this.head.mirror();
    return this.trace && E ? this.trace.frame(E, obs) : null;
  }

  resetBelief(): void {
    if (this.slot) this.trace = new BeliefTrace(this.slot);
  }

  /* голова впала: такт іде далі без її команд; у журналі - перше падіння і
     кожне FAIL_LOG_EVERY-те, з лічильником */
  private fail(where: string, e: unknown): void {
    this.headFaults += 1;
    if (this.headFaults % FAIL_LOG_EVERY !== 1) return;
    this.log('голова впала (' + where + ', ' + this.headFaults + '-й раз): ' + errText(e) + '; пульс тримає слот');
  }
}

/* імена архетипів: за ними службова ручка зміни пресета вирішує, є такий
   пресет чи ні */
export function presets(): string[] {
  return Object.keys(ARCHETYPES);
}

export const DEFAULT_PRESET = 'рівний';

/* невідоме ім'я (одруківка, кодова сторінка cmd) не валить бота до присяги:
   грає типовий архетип */
export function presetOrDefault(preset: string | undefined, log: (line: string) => void = () => undefined): string {
  if (!preset) return DEFAULT_PRESET;
  if (presets().includes(preset)) return preset;
  log('пресета «' + preset + '» немає, граю ' + DEFAULT_PRESET);
  return DEFAULT_PRESET;
}

export function createStrategy(preset = process.env['ZARIA_PRESET'], log: (line: string) => void = () => undefined): Strategy {
  return new PulseStrategy(sampleBot(createEngine, presetOrDefault(preset, log)), log);
}
