/* bot :: strategy
   ТУТ ВАША СТРАТЕГІЯ - єдиний файл шаблону, який мусить стати вашим.

   Заглушка - дзеркальна голова архетипу SDK: вона грає, але своїх правил у
   неї немає; списуйте з неї контракт, а не тактику. Контракт - WireBot
   (маніфест, кадр спостереження -> кадр команд, вердикти) плюс кадр
   щоденника віри. Архетип заглушки - ZARIA_PRESET (рівний, шир, обхідник,
   проривник, облягач).

   Свою голову починають із BlankBot з @zoria/sdk:

     class MyBot extends BlankBot {
       protected override think(obs: Observe): Order[] { ... }
     }

   і повертають її з createStrategy(); belief() без дзеркала збирає
   BeliefFrame сам або віддає null. Мережі тут немає і бути не повинно:
   провід, повернення і піни живуть у main.ts і connectBot. */

import { createEngine } from '@zoria/engine';
import { ARCHETYPES, BeliefTrace, sampleBot } from '@zoria/sdk';
import type { BeliefFrame, MirrorBot, WireBot } from '@zoria/sdk';
import { decodeManifest, decodeObserve, decodeOrders, decodeVerdicts, encodeOrders, encodeVerdicts } from '@zoria/protocol';
import type { Observe, Order, SlotName } from '@zoria/protocol';

export interface Strategy extends WireBot {
  /* кадр щоденника віри такту; null - кадру немає */
  belief(obs: Observe | null): BeliefFrame | null;
}

/* Наказ бере слот із сьомого такту мовчання (правила 23.2), а голова дзеркала
   мовчить, коли їй нема чого скомандувати. Після стількох тактів поспіль без
   прийнятої команди бот сам додає «пульс» - команду, яка нічого не змінює у
   світі (P2-04). Запас у два такти - на випадок відмови самого пульсу. */
export const PULSE_AFTER = 4;

type Watch = Extract<Order, { kind: 'watch' }>;

/* найдешевша команда, що нічого не змінює: halt юниту без завдання
   безкоштовний (приймається, якщо в каналі лишилося 32 байти), повтор
   поточного фокуса коштує 32 байти й фокус не зсуває */
export function pulseOrder(obs: Observe | null, focus: Watch | null): Order | null {
  const idle = obs?.mine.units.find((unit) => unit.task === null && unit.wait === 0);
  return idle ? { kind: 'halt', unit: idle.id } : focus;
}

class MirrorStrategy implements Strategy {
  private head: MirrorBot;
  private trace: BeliefTrace | null = null;
  /* тактів поспіль без прийнятої команди */
  private quiet = 0;
  /* фокус, як його лишила голова; до першого watch - вогнище */
  private focus: Watch | null = null;
  /* скільки команд такту дала голова: вердикт пульсу їй не належить */
  private headOrders = 0;

  constructor(preset: string) {
    this.head = sampleBot(createEngine, preset);
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.head.init(manifest, slot);
    this.trace = new BeliefTrace(slot);
    const m = decodeManifest(manifest);
    const seat = m ? m.seats[m.perm.indexOf(slot)] : undefined;
    this.focus = seat ? { kind: 'watch', q: seat.q, r: seat.r, keep: 0 } : null;
    this.quiet = 0;
  }

  tick(observe: Uint8Array): Uint8Array {
    const reply = this.head.tick(observe);
    const orders = decodeOrders(reply);
    this.headOrders = orders?.length ?? 0;
    for (const order of orders ?? []) if (order.kind === 'watch') this.focus = order;
    const quiet = this.quiet;
    this.quiet += 1;
    if (orders === null || quiet < PULSE_AFTER) return reply;
    const pulse = pulseOrder(decodeObserve(observe), this.focus);
    return pulse ? encodeOrders([...orders, pulse]) : reply;
  }

  feedback(verdicts: Uint8Array): void {
    const list = decodeVerdicts(verdicts);
    if (list?.some(([, ok]) => ok)) this.quiet = 0;
    // the head gets back only the verdicts on its own commands
    const own = list?.filter(([i]) => i < this.headOrders);
    this.head.feedback(own && own.length !== list?.length ? encodeVerdicts(own) : verdicts);
  }

  /* віра дзеркала: світ дзеркальної голови і є те, у що вона вірить */
  belief(obs: Observe | null): BeliefFrame | null {
    const E = this.head.mirror();
    return this.trace && E ? this.trace.frame(E, obs) : null;
  }
}

/* імена архетипів заглушки: за ними службова ручка зміни пресета вирішує,
   є такий пресет чи ні. Своя голова повертає тут свої імена */
export function presets(): string[] {
  return Object.keys(ARCHETYPES);
}

export function createStrategy(preset = process.env['ZARIA_PRESET'] || 'рівний'): Strategy {
  return new MirrorStrategy(preset);
}
