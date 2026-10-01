/* bot :: tactics
   Надбудови, що діють не поруч із головою, а всередині неї чи після неї.

   Голова - botOrders рушія на дзеркальному світі (MirrorBot.decide кличе
   E.botOrders через властивість об'єкта рушія). Тож надбудова може:
     - підмінити ручку стилю на живому E.BOT_STYLE[slot] - голова читає її
       щотакту (k0: без клинків у верфі до такту T);
     - обгорнути E.botOrders і на час рішення змінити те, що голова бачить
       (nofeed: усі свої горящі голки «вже підживлюються», і botTryFeed не
       знаходить, кого підживити);
     - дописати команду після голови (ram: чистий таран).
   Рушій дзеркала - свій у кожній партії (MirrorBot.init), тож між партіями
   нічого не тече. */

import { orderCap, orderCost } from '@zoria/protocol';
import type { ActorName, Hex, NeedleSpec, Observe, Order, SlotName } from '@zoria/protocol';
import { channelLeft } from './strategy.js';
import type { PulseWorld, Tactics } from './strategy.js';

/* те, що надбудовам потрібно від рушія дзеркала */
interface HeadEngine {
  botOrders: (p: string, w: unknown) => void;
  BOT_STYLE: Record<string, Record<string, unknown>>;
  SIM: { t: number };
}
interface FeedWorld {
  lit: Record<string, Record<string, unknown> | undefined>;
  fed: Record<string, string>;
}

/* надбудови голови: k0 і nofeed. Немає рушія (підміна в тестах без дзеркала)
   або він не той - у журнал і без них */
export function hookHead(engine: unknown, slot: SlotName, tactics: Tactics, log: (line: string) => void): void {
  const { noFeed, k0 } = tactics;
  if (noFeed === null && k0 === null) return;
  const E = engine as HeadEngine | null;
  if (!E || typeof E.botOrders !== 'function' || !E.BOT_STYLE?.[slot] || !E.SIM) {
    log('надбудови голови (nofeed, k0) без рушія дзеркала не діють');
    return;
  }
  const style = E.BOT_STYLE[slot];
  const klinok = typeof style['klinok'] === 'number' ? style['klinok'] : 0;
  const decide = E.botOrders;
  E.botOrders = (p, w) => {
    const t = E.SIM.t;
    if (k0 !== null) style['klinok'] = t < k0 ? 0 : klinok;
    if (noFeed === null || t >= noFeed) return decide.call(E, p, w);
    /* botTryFeed пропускає голку з w.fed; маска - лише на час рішення,
       бухгалтерія світу до неї вже порахована в sync дзеркала */
    const world = w as FeedWorld;
    const lit = world.lit?.[p] ?? {};
    const added: string[] = [];
    for (const k of Object.keys(lit)) {
      if (lit[k] && !world.fed[k]) {
        world.fed[k] = p;
        added.push(k);
      }
    }
    try {
      return decide.call(E, p, w);
    } finally {
      for (const k of added) delete world.fed[k];
    }
  };
}

const cell = (h: Hex): string => h.q + ',' + h.r;
export const hexDist = (a: Hex, b: Hex): number => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/* хто володіє кожною голкою, наскільки ми знаємо: з маніфесту (руїни, кільце,
   стартові) і з кадрів - свої повністю, чужі - коли їх видно */
export class NeedleOwners {
  private readonly owner = new Map<string, ActorName | null>();

  constructor(needles: readonly NeedleSpec[]) {
    for (const n of needles) this.owner.set(cell(n), n.start ?? (n.ring ? 'K' : null));
  }

  see(obs: Observe, slot: SlotName): void {
    for (const e of obs.own) this.owner.set(cell(e), e.owner);
    for (const n of obs.mine.needles) this.owner.set(cell(n), slot);
  }

  /* undefined - на клітині голки немає */
  at(h: Hex): ActorName | null | undefined {
    return this.owner.get(cell(h));
  }
}

/* Чистий таран: чужий ткач стоїть на голці, що не його, - він її гріє або
   будує, і таран по ньому чистий (правила 11.7). Голова таких не ловить: її
   захист розрахований на розмін 1:1 (одна перезарядка на рій, поріг ціни
   гостя, лише горящі голки). Здобич - лише видима точно в цьому такті (11.6),
   не Ключник і не партнер угоди; спершу ткачі на наших голках, потім на
   руїнах і кільці, потім на голках третього. Мисливець - клинок без справи
   тарану чи дороги додому, не тримач облоги, якому голова в кадрі нічого не
   дала, до R кроків. Не більше одного нового тарану за такт; канал і стелю
   кадру перевірено, як для пульсу. */
export function ramOrder(obs: Observe, orders: readonly Order[], slot: SlotName, owners: NeedleOwners, R: number, world: PulseWorld): Order | null {
  const link = obs.pub.pact.active.find((l) => l.a === slot || l.b === slot);
  const friend = link ? (link.a === slot ? link.b : link.a) : null;
  const commanded = new Set(orders.flatMap((o) => ('unit' in o ? [o.unit] : [])));
  const chased = new Set(obs.mine.units.flatMap((u) => (u.task?.ram ? [u.task.ram] : [])));
  const rank = (owner: ActorName | null): number => (owner === slot ? 0 : owner === null || owner === 'K' ? 1 : 2);
  const prey = obs.foe.flatMap((f) => {
    if (f.cls !== 'ткач' || f.p === 'K' || f.p === friend || chased.has(f.id)) return [];
    const owner = owners.at(f);
    return owner === undefined || owner === f.p ? [] : [{ f, rank: rank(owner) }];
  });
  if (!prey.length) return null;
  let best: { unit: string; at: Hex; target: string; rank: number; d: number } | null = null;
  for (const u of obs.mine.units) {
    if (u.cls !== 'клинок' || u.stuck || u.wait > 0 || commanded.has(u.id)) continue;
    if (u.task && (u.task.ram || u.task.home || (u.task.jam && u.task.path === 0))) continue;
    for (const { f, rank } of prey) {
      const d = hexDist(u, f);
      if (d > R) continue;
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { unit: u.id, at: u, target: f.id, rank, d };
    }
  }
  if (!best) return null;
  const ram: Order = { kind: 'ram', unit: best.unit, target: best.target };
  if (orders.length + 1 > orderCap(world.cfg, obs.pulse.chanAt)) return null;
  const cost = orderCost(world.cfg, 'ram', best.at, obs.t, world.storms);
  return channelLeft(obs, orders, world) >= cost ? ram : null;
}
