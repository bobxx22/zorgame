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
   нічого не тече.

   ===== покажчик надбудов: що, навіщо, як, чи в бою =====
   Токен задає ZARIA_TACTICS (розбір - parseTactics у strategy.ts), бій без
   змінної - DEFAULT_TACTICS. Цифри - --eval лабораторії, 60 свіжих долин,
   змішаний пул, парна різниця частки за пакет до тодішнього бою.

   Усередині голови (hookHead):
     nofeed:T  БІЙ (1200). Голова ставить ткача на підкормку раніше за ціль і
               тримає назавжди - мінус ткач росту. Маска w.fed на час
               рішення: botTryFeed не знаходить, кого живити. +1.05 ± 0.19.
     k0:T      вимкнено. Без клинків у верфі до T: ручка klinok = 0. +0.28 ± 0.17.
     cherta    вимкнено (перевіряє сервер). До зорі голки за чертою зникають
               із віри на час рішення: Ключник таранить ткачів, що їх гріють,
               а захоплень там майже немає. +0.18 ± 0.12.
     gap, catch, bopen, rfloor  вимкнено, не міряно. Числа вбудованих голів
               (guardGap, catchFloor, buildOpen, raidFloor) у своєму дзеркалі.

   Після голови (ramOrder, AfterHead):
     ram:R     БІЙ (6). Клинок таранить чужого ткача на голці, що не його
               (гріє - таран чистий, правила 11.7). +0.17 ± 0.09.
     hunt:R    вимкнено (перевіряє сервер). Таран v2: ширше коло мисливців,
               без розмінів (пауза захоплення, транзит, не встигне). +0.17 ± 0.11.
     stay:K    вимкнено. Не відкликати ткача за K тактів до захоплення. ≈ 0.
     nohook    БІЙ. Гачок знахідки (правила 16.8) веде ткача до схрону і назад
               у точку, де він звернув, навіть коли той уже стоїть на голці
               цілі. Коли знахідка вже нічого не дасть (взята або згорить під
               стелею), move на ту саму клітину обрізає зворотний слід: ткач
               лишається гріти. Схрон, що ще платить, гачок довозить. ±0.03 -
               копійка без ризику: менше зайвих кроків, заряд не губиться.
     cache:N   вимкнено. Схрон дасть повні 150 - по нього йде найближчий вільний
               юнит до N клітин (клинок без справи чи ткач без задачі). +0.02 ±
               0.04, але ~0.1 відмови на пакет - поки не в бою.
     yardcap   вимкнено. Не замовляти юнит понад вагу рою (для голови-наказу).
               −0.02 ± 0.02. */

import { orderCap, orderCost } from '@zoria/protocol';
import type { ActorName, ClsName, Hex, Manifest, NeedleSpec, Observe, Order, SlotName, Verdict } from '@zoria/protocol';
import { channelLeft } from './strategy.js';
import type { PulseWorld, Source, Tactics } from './strategy.js';

/* те, що надбудовам потрібно від рушія дзеркала */
interface HeadEngine {
  botOrders: (p: string, w: unknown) => void;
  BOT_STYLE: Record<string, Record<string, unknown>>;
  SIM: { t: number };
  NEEDLES?: readonly { key: string; q: number; r: number }[];
  CHERTA_R?: number;
  SIM_CFG?: Record<string, unknown>;
}
interface HeadWorld {
  lit: Record<string, Record<string, unknown> | undefined>;
  fed: Record<string, string>;
  own: Record<string, string | undefined>;
  dawn?: number | boolean;
  keep?: { mercy?: Record<string, unknown> };
  bel?: Record<string, { at: Record<string, unknown> } | undefined>;
}

/* надбудови голови: k0, nofeed, cherta і числа вбудованих голів. Немає рушія
   (підміна в тестах без дзеркала) або він не той - у журнал і без них */
export function hookHead(engine: unknown, slot: SlotName, tactics: Tactics, log: (line: string) => void): void {
  const { noFeed, k0, cherta } = tactics;
  const knobs = Object.entries(tactics.engine);
  if (noFeed === null && k0 === null && !cherta && !knobs.length) return;
  const E = engine as HeadEngine | null;
  if (!E || typeof E.botOrders !== 'function' || !E.BOT_STYLE?.[slot] || !E.SIM) {
    log('надбудови голови (nofeed, k0, cherta, числа голови) без рушія дзеркала не діють');
    return;
  }
  /* числа вбудованих голів - лише в своєму дзеркалі: MirrorBot.init уже
     переписав SIM_CFG з маніфесту, і більше його не чіпає */
  if (knobs.length && E.SIM_CFG) for (const [key, value] of knobs) E.SIM_CFG[key] = value;
  if (noFeed === null && k0 === null && !cherta) return;
  const style = E.BOT_STYLE[slot];
  const klinok = typeof style['klinok'] === 'number' ? style['klinok'] : 0;
  /* голки за чертою (центр - цитадель у 0,0): лише їх і ховає cherta */
  const inside = cherta ? (E.NEEDLES ?? []).filter((n) => hexDist(n, { q: 0, r: 0 }) <= (E.CHERTA_R ?? 6)).map((n) => n.key) : [];
  const decide = E.botOrders;
  E.botOrders = (p, w) => {
    const t = E.SIM.t;
    if (k0 !== null) style['klinok'] = t < k0 ? 0 : klinok;
    const world = w as HeadWorld;
    /* botTryFeed пропускає голку з w.fed; маска - лише на час рішення,
       бухгалтерія світу до неї вже порахована в sync дзеркала */
    const fed: string[] = [];
    if (noFeed !== null && t < noFeed) {
      const lit = world.lit?.[p] ?? {};
      for (const k of Object.keys(lit)) {
        if (lit[k] && !world.fed[k]) {
          world.fed[k] = p;
          fed.push(k);
        }
      }
    }
    /* до зорі й без милості голки за чертою зникають із віри: botPick
       пропускає невідому голку, і голова не шле туди ні ткача, ні клинка */
    const hidden: [string, unknown][] = [];
    const at = world.bel?.[p]?.at;
    if (at && inside.length && !world.dawn && !world.keep?.mercy?.[p]) {
      for (const k of inside) {
        if (at[k] !== undefined && world.own?.[k] !== p) {
          hidden.push([k, at[k]]);
          delete at[k];
        }
      }
    }
    try {
      return decide.call(E, p, w);
    } finally {
      for (const k of fed) delete world.fed[k];
      for (const [k, v] of hidden) at![k] = v;
    }
  };
}

const cell = (h: Hex): string => h.q + ',' + h.r;
export const hexDist = (a: Hex, b: Hex): number => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/* хто володіє кожною голкою, наскільки ми знаємо: з маніфесту (руїни, кільце,
   стартові) і з кадрів - свої повністю, чужі - коли їх видно */
export class NeedleOwners {
  private readonly owner = new Map<string, ActorName | null>();
  private readonly ring = new Set<string>();

  constructor(needles: readonly NeedleSpec[]) {
    for (const n of needles) {
      this.owner.set(cell(n), n.start ?? (n.ring ? 'K' : null));
      if (n.ring) this.ring.add(cell(n));
    }
  }

  ringAt(h: Hex): boolean {
    return this.ring.has(cell(h));
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
export function ramOrder(
  obs: Observe,
  orders: readonly Order[],
  slot: SlotName,
  owners: NeedleOwners,
  R: number,
  world: PulseWorld,
  refused: (unit: string, target: string) => boolean = () => false,
): Order | null {
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
      if (d > R || refused(u.id, f.id)) continue;
      if (!best || rank < best.rank || (rank === best.rank && d < best.d)) best = { unit: u.id, at: u, target: f.id, rank, d };
    }
  }
  if (!best) return null;
  const ram: Order = { kind: 'ram', unit: best.unit, target: best.target };
  if (orders.length + 1 > orderCap(world.cfg, obs.pulse.chanAt)) return null;
  const cost = orderCost(world.cfg, 'ram', best.at, obs.t, world.storms);
  return channelLeft(obs, orders, world) >= cost ? ram : null;
}

/* запис кадру: команда, її джерело і місце в ньому (strategy.ts, Entry) */
export interface Tagged {
  order: Order;
  from: Source;
  at: number;
}


/* Надбудови після голови, що пам'ятають кадри: stay, cherta (зняти того, хто
   вже йде за черту), hunt (таран v2), yardcap і пам'ять відмов тарану.
   Свій стан - на одну партію: PulseStrategy будує новий у кожному init. */
export class AfterHead {
  readonly owners: NeedleOwners;
  private readonly cfg: Record<string, number>;
  private readonly citadel: Hex;
  private readonly cherta: number;
  private readonly start = new Set<string>();
  /* свій ткач: скільки тактів із руками стоїть на одній клітині */
  private readonly dwell = new Map<string, { cell: string; ticks: number }>();
  /* чужий юнит: з якого такту стоїть на клітині */
  private readonly foeAt = new Map<string, { cell: string; since: number }>();
  /* своя голка: такт, коли вона стала нашою (пауза capGrace після захоплення) */
  private readonly ours = new Map<string, number>();
  private known = false;
  /* прийняті воротарем замовлення верфі: корпуси в черзі (droneBuild тактів) */
  private readonly yards: { t: number; cls: ClsName }[] = [];
  /* відмовлені тарани «мисливець>ціль» - до такту */
  private readonly refusedUntil = new Map<string, number>();
  /* погоні hunt: мисливець -> ціль */
  private readonly hunts = new Map<string, string>();
  /* схрони і спалахи долини (маніфест) і вже взяті (подія find видна всім) */
  private readonly finds: { q: number; r: number; kind: string }[];
  private readonly taken = new Set<string>();
  /* схрон -> юнит, якого надбудова cache по нього послала */
  private readonly seekers = new Map<string, string>();
  private t = 0;

  constructor(
    private readonly tactics: Tactics,
    man: Manifest,
    private readonly slot: SlotName,
    private readonly world: PulseWorld,
    /* чи дотягнеться нитка з клітини до своєї горящої голки чи вогнища (рушій дзеркала) */
    private readonly links: (at: Hex, obs: Observe) => boolean,
  ) {
    this.owners = new NeedleOwners(man.needles);
    this.cfg = man.cfg;
    this.citadel = man.citadel;
    this.cherta = man.cherta;
    for (const n of man.needles) if (n.start) this.start.add(cell(n));
    this.finds = man.finds.filter((f) => f.kind === 'cache' || f.kind === 'flare');
  }

  private num(key: string, fallback: number): number {
    const v = this.cfg[key];
    return typeof v === 'number' ? v : fallback;
  }

  refused = (unit: string, target: string): boolean => (this.refusedUntil.get(unit + '>' + target) ?? -1) >= this.t;

  /* кадр спостереження: власники, стояння своїх і чужих, нові свої голки */
  see(obs: Observe): void {
    this.t = obs.t;
    this.owners.see(obs, this.slot);
    for (const e of obs.events) if (e.type === 'find') this.taken.add(cell(e));
    for (const n of obs.mine.needles) {
      const k = cell(n);
      if (!this.ours.has(k)) this.ours.set(k, this.known ? obs.t : -1e9);
    }
    const mineNow = new Set(obs.mine.needles.map(cell));
    for (const k of [...this.ours.keys()]) if (!mineNow.has(k)) this.ours.delete(k);
    this.known = true;
    const alive = new Set<string>();
    for (const u of obs.mine.units) {
      alive.add(u.id);
      if (u.cls !== 'ткач') continue;
      const k = cell(u);
      const d = this.dwell.get(u.id);
      const hands = u.mute ? 0 : 1;
      this.dwell.set(u.id, d && d.cell === k ? { cell: k, ticks: d.ticks + hands } : { cell: k, ticks: hands });
    }
    for (const id of [...this.dwell.keys()]) if (!alive.has(id)) this.dwell.delete(id);
    const seen = new Set<string>();
    for (const f of obs.foe) {
      seen.add(f.id);
      const k = cell(f);
      const was = this.foeAt.get(f.id);
      if (!was || was.cell !== k) this.foeAt.set(f.id, { cell: k, since: obs.t });
    }
    for (const id of [...this.foeAt.keys()]) if (!seen.has(id)) this.foeAt.delete(id);
    for (const [id] of this.hunts) if (!alive.has(id)) this.hunts.delete(id);
  }

  private underLine(h: Hex, obs: Observe): boolean {
    return !obs.pub.dawn && !obs.pulse.mercy && hexDist(h, this.citadel) <= this.cherta;
  }

  /* скільки тактів гріти голку під юнитом: руїна 8, темна чужа 16, горяча 24;
     кільце Ключника до зорі - як чужа, після - як руїна */
  private heatPrice(at: Hex, owner: ActorName | null, obs: Observe): number {
    if (owner === null || (owner === 'K' && obs.pub.dawn)) return this.num('heatNeedle', 8);
    const dark = obs.own.find((e) => e.q === at.q && e.r === at.r)?.dark ?? false;
    return dark ? this.num('heatDark', 16) : this.num('heatEnemy', 24);
  }

  /* stay: ткач гріє чужу чи нічию голку, до кінця ≤ K тактів, і повідець витримає */
  staysToFinish(u: Observe['mine']['units'][number], obs: Observe, K: number): boolean {
    if (u.cls !== 'ткач') return false;
    const owner = this.owners.at(u);
    if (owner === undefined || owner === this.slot || this.start.has(cell(u))) return false;
    if (this.underLine(u, obs)) return false;
    const stood = this.dwell.get(u.id);
    if (!stood || stood.cell !== cell(u)) return false;
    const left = this.heatPrice(u, owner, obs) - stood.ticks;
    /* далеко до кінця або «прогрес» не росте (пауза чужого захоплення) */
    if (left > K || left < -2) return false;
    const back = this.links(u, obs) ? 0 : 3 * this.num('stepTkach', 2);
    return u.away + Math.max(0, left) + back + 4 <= this.num('autonomy', 40);
  }

  /* усе після голови: вхід - записи голови (чи заповнювача), вихід - кадр без пульсу */
  apply(obs: Observe, entries: readonly Tagged[]): Tagged[] {
    let out = [...entries];
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    const commanded = (id: string) => out.some((e) => 'unit' in e.order && e.order.unit === id);

    if (this.tactics.stay !== null) {
      const K = this.tactics.stay;
      out = out.filter((e) => {
        if (e.from !== 'head' || e.order.kind !== 'move' || !e.order.home) return true;
        const u = units.get(e.order.unit);
        return !(u && this.staysToFinish(u, obs, K));
      });
    }

    if (this.tactics.noHook) {
      /* Ткач стоїть на клітині своєї цілі, а шлях ще не порожній - це лише
         слід гачка знахідки (правила 16.8): гачок веде юнит до знахідки, вертає
         туди, де він звернув, і лише тоді доводить старий шлях до цілі. move
         на ту саму клітину дає порожній шлях і ту саму ціль: юнит стоїть і
         гріє (simHeat дивиться на клітину, не на задачу), а на порожньому
         шляху гачок не чіпляється. Обрізаємо лише той слід, де знахідка вже
         нічого не дасть (hookWorth): тоді ткач не втрачає ні тактів, ні
         заряду. Ціна - звичайна команда (32 байти) */
      for (const u of obs.mine.units) {
        const task = u.task;
        const goal = task?.goal;
        if (u.cls !== 'ткач' || !task || !goal || goal.q !== u.q || goal.r !== u.r || task.path <= 0) continue;
        if (task.home || task.ram || u.wait > 0 || u.stuck || commanded(u.id) || this.owners.at(u) === undefined) continue;
        if (this.hookWorth(u, obs)) continue;
        const orders = out.map((e) => e.order);
        if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) break;
        if (channelLeft(obs, orders, this.world) < orderCost(this.world.cfg, 'move', u, obs.t, this.world.storms)) break;
        out.push({ order: { kind: 'move', unit: u.id, q: u.q, r: u.r, goal: { q: u.q, r: u.r }, home: false }, from: 'tactic', at: 0 });
      }
    }

    if (this.tactics.cache !== null) out = this.seekCache(obs, out, this.tactics.cache);

    const extra: Order[] = [];
    if (this.tactics.cherta && !obs.pub.dawn && !obs.pulse.mercy) {
      /* хто вже йде за черту за старим планом - зупинити; клинок, що глушить
         кільце зсередини черти, - без цілі (провокація, правила 21.6) */
      for (const u of obs.mine.units) {
        const goal = u.task?.goal;
        if (u.cls === 'ткач' && goal && this.underLine(goal, obs) && !commanded(u.id)) extra.push({ kind: 'halt', unit: u.id });
      }
      out = out.map((e) => {
        const o = e.order;
        if (o.kind !== 'jam' || !o.target || this.owners.at(o.target) !== 'K') return e;
        const u = units.get(o.unit);
        return u && this.underLine(u, obs) ? { ...e, order: { ...o, target: null } } : e;
      });
    }

    if (this.tactics.hunt !== null) {
      for (const [hunter, target] of [...this.hunts]) {
        const u = units.get(hunter);
        if (!u || u.task?.ram !== target) {
          this.hunts.delete(hunter);
          continue;
        }
        const f = obs.foe.find((x) => x.id === target);
        if (f && !this.worthy(f, obs) && !commanded(hunter)) {
          extra.push({ kind: 'halt', unit: hunter });
          this.hunts.delete(hunter);
        }
      }
    }

    /* зняття - безкоштовні, але воротар приймає їх лише з 32 байтами каналу (13.4) */
    for (const o of extra) {
      const orders = out.map((e) => e.order);
      if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) break;
      if (channelLeft(obs, orders, this.world) < this.world.cfg.chanOrder) break;
      out.push({ order: o, from: 'tactic', at: 0 });
    }

    if (this.tactics.hunt !== null) {
      const hit = this.hunt(obs, out, this.tactics.hunt);
      if (hit) {
        if (hit.replaces !== null) out.splice(hit.replaces, 1);
        out.push({ order: hit.order, from: 'tactic', at: 0 });
        if (hit.order.kind === 'ram') this.hunts.set(hit.order.unit, hit.order.target);
      }
    }

    if (this.tactics.yardCap) out = this.capYard(obs, out);
    return out;
  }

  /* скільки заряду дасть схрон зараз: понад стелю згоряє (правила 16.3) */
  private cacheGain(obs: Observe): number {
    return Math.max(0, Math.min(this.num('cacheEnergy', 150), this.num('energyCap', 360) - obs.pulse.energy));
  }

  /* чи є біля юнита (у межах гачка, findHook) невзята знахідка, заради якої
     варто дати гачку дійти: спалах - завжди (безкоштовний скан, гачок - кілька
     тактів), схрон - коли від нього лишиться ≥ 50 заряду. Нічого такого - слід
     гачка порожній: або знахідку вже взято, або вона згорить під стелею */
  private hookWorth(u: Hex, obs: Observe): boolean {
    const reach = this.num('findHook', 2);
    return this.finds.some(
      (f) => !this.taken.has(cell(f)) && hexDist(u, f) <= reach && (f.kind === 'flare' || this.cacheGain(obs) >= 50),
    );
  }

  /* cache:N - схрон дасть повні 150, тож по нього варто сходити: найближчий
     за часом вільний юнит до N клітин (клинок крокує вдвічі швидше за
     ткача). Вільний - у зоні (away 0), без тарану, дороги додому й облоги;
     клинку голова дала нічого або лише «порожній» jam (його місце займе
     move), ткач без задачі і без команди голови. Ткача, що гріє чи йде до
     цілі, не знімаємо. По одному юниту на схрон; гачок і сама дорога
     підберуть його кроком (16.2), після чого голова дасть юниту нову справу */
  private seekCache(obs: Observe, entries: readonly Tagged[], N: number): Tagged[] {
    if (this.cacheGain(obs) < this.num('cacheEnergy', 150)) return [...entries];
    const units = new Map(obs.mine.units.map((u) => [u.id, u]));
    let out = [...entries];
    for (const f of this.finds) {
      const key = cell(f);
      if (f.kind !== 'cache' || this.taken.has(key)) continue;
      const sent = this.seekers.get(key);
      const seeker = sent ? units.get(sent) : undefined;
      if (seeker && seeker.task && seeker.task.path > 0 && !seeker.task.goal) continue;
      this.seekers.delete(key);
      let best: { unit: string; at: Hex; time: number; replaces: number | null } | null = null;
      for (const u of obs.mine.units) {
        if (u.stuck || u.wait > 0 || u.away > 0) continue;
        if (u.task && (u.task.ram || u.task.home)) continue;
        const mine = out.flatMap((e, i) => ('unit' in e.order && e.order.unit === u.id ? [i] : []));
        let replaces: number | null = null;
        if (u.cls === 'клинок') {
          if (u.task && u.task.jam && u.task.path === 0) continue;
          if (mine.length) {
            const only = out[mine[0]!]!.order;
            if (mine.length !== 1 || only.kind !== 'jam' || only.target !== null || only.hold) continue;
            replaces = mine[0]!;
          }
        } else if (u.task !== null || mine.length) continue;
        const d = hexDist(u, f);
        if (d > N) continue;
        const time = d * (u.cls === 'клинок' ? this.num('stepKlinok', 1) : this.num('stepTkach', 2));
        if (!best || time < best.time) best = { unit: u.id, at: u, time, replaces };
      }
      if (!best) continue;
      const rest = out.filter((_, i) => i !== best!.replaces);
      const orders = rest.map((e) => e.order);
      if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) continue;
      if (channelLeft(obs, orders, this.world) < orderCost(this.world.cfg, 'move', best.at, obs.t, this.world.storms)) continue;
      out = [...rest, { order: { kind: 'move', unit: best.unit, q: f.q, r: f.r, goal: null, home: false }, from: 'tactic', at: 0 }];
      this.seekers.set(key, best.unit);
    }
    return out;
  }

  /* здобич таки варта тарану: стоїть на голці, що не її, не в нашій паузі,
     не на стартовій і не на голці партнера своєї угоди */
  private worthy(f: Observe['foe'][number], obs: Observe): boolean {
    const owner = this.owners.at(f);
    if (owner === undefined || owner === f.p || this.start.has(cell(f))) return false;
    if (owner === 'K' && !obs.pub.dawn) return false;
    if (owner === this.slot && this.t - (this.ours.get(cell(f)) ?? -1e9) < this.num('capGrace', 60)) return false;
    if (owner !== null && obs.pub.pact.active.some((l) => (l.a === f.p && l.b === owner) || (l.b === f.p && l.a === owner))) return false;
    return true;
  }

  /* Таран v2. Мисливець - клинок у зоні (away 0), без тарану й дороги додому,
     якому голова нічого не дала або дала лише «порожній» jam (без цілі й
     hold: він нічого не змінює, і його місце займе таран). Тримач облоги -
     лише на здобич на нашій голці до 3 кроків. Здобич стоїть на клітині ≥ 3
     тактів і варта тарану (worthy), клинок встигає до кінця прогріву.
     Ранги: наша голка (кільце після зорі - вище), руїна чи кільце, голка третього. */
  private hunt(obs: Observe, entries: readonly Tagged[], R: number): { order: Order; replaces: number | null } | null {
    const link = obs.pub.pact.active.find((l) => l.a === this.slot || l.b === this.slot);
    const friend = link ? (link.a === this.slot ? link.b : link.a) : null;
    const chased = new Set(obs.mine.units.flatMap((u) => (u.task?.ram ? [u.task.ram] : [])));
    const stepK = this.num('stepKlinok', 1);
    const prey: { f: Observe['foe'][number]; rank: number; left: number; ours: boolean }[] = [];
    for (const f of obs.foe) {
      if (f.cls !== 'ткач' || f.p === 'K' || f.p === friend || chased.has(f.id) || !this.worthy(f, obs)) continue;
      const stood = this.foeAt.get(f.id);
      const owner = this.owners.at(f) ?? null;
      /* на нашій голці в паузі захоплення гріти не можна: прогрів почався не раніше її кінця */
      const graceEnd = owner === this.slot ? (this.ours.get(cell(f)) ?? -1e9) + this.num('capGrace', 60) : -1e9;
      const since = stood && stood.cell === cell(f) ? obs.t - Math.max(stood.since, graceEnd) : 0;
      if (since < 3) continue;
      const ring = owner === this.slot && this.owners.ringAt(f);
      const rank = owner === this.slot ? (ring ? -1 : 0) : owner === null || owner === 'K' ? 1 : 2;
      prey.push({ f, rank, left: this.heatPrice(f, owner, obs) - since, ours: owner === this.slot });
    }
    if (!prey.length) return null;
    const byUnit = new Map<string, number[]>();
    entries.forEach((e, i) => {
      if ('unit' in e.order) byUnit.set(e.order.unit, [...(byUnit.get(e.order.unit) ?? []), i]);
    });
    let best: { unit: string; at: Hex; target: string; rank: number; d: number; replaces: number | null } | null = null;
    for (const u of obs.mine.units) {
      if (u.cls !== 'клинок' || u.stuck || u.wait > 0 || u.away > 0) continue;
      if (u.task && (u.task.ram || u.task.home)) continue;
      const mine = byUnit.get(u.id) ?? [];
      let replaces: number | null = null;
      if (mine.length) {
        const only = entries[mine[0]!]!.order;
        if (mine.length !== 1 || only.kind !== 'jam' || only.target !== null || only.hold) continue;
        replaces = mine[0]!;
      }
      const holder = !!(u.task && u.task.jam && u.task.path === 0);
      for (const p of prey) {
        const d = hexDist(u, p.f);
        if (d > R || (holder && (!p.ours || d > 3)) || this.refused(u.id, p.f.id)) continue;
        if ((d - 1) * stepK + 2 >= p.left) continue;
        if (!best || p.rank < best.rank || (p.rank === best.rank && d < best.d)) best = { unit: u.id, at: u, target: p.f.id, rank: p.rank, d, replaces };
      }
    }
    if (!best) return null;
    const orders = entries.filter((_, i) => i !== best!.replaces).map((e) => e.order);
    if (orders.length + 1 > orderCap(this.world.cfg, obs.pulse.chanAt)) return null;
    const cost = orderCost(this.world.cfg, 'ram', best.at, obs.t, this.world.storms);
    if (channelLeft(obs, orders, this.world) < cost) return null;
    return { order: { kind: 'ram', unit: best.unit, target: best.target }, replaces: best.replaces };
  }

  /* yardcap: юнит на полі й корпуси в черзі верфі (прийняті за droneBuild
     тактів) плюс новий - не важче squadWeight; інакше відмова «вага рою» */
  private capYard(obs: Observe, entries: readonly Tagged[]): Tagged[] {
    const weight = (cls: ClsName) => (cls === 'ткач' ? this.num('weightTkach', 2) : this.num('weightKlinok', 1));
    const build = this.num('droneBuild', 4);
    while (this.yards.length && this.yards[0]!.t < obs.t - build) this.yards.shift();
    let load = obs.mine.units.reduce((s, u) => s + weight(u.cls), 0) + this.yards.reduce((s, y) => s + weight(y.cls), 0);
    const cap = this.num('squadWeight', 8);
    return entries.filter((e) => {
      if (e.order.kind !== 'yard') return true;
      const w = weight(e.order.cls);
      if (load + w > cap) return false;
      load += w;
      return true;
    });
  }

  /* вердикти кадру: прийняті замовлення верфі - у чергу, відмови тарану - у пам'ять на 15 тактів */
  verdicts(sent: readonly Tagged[], list: readonly Verdict[]): void {
    for (const [i, ok] of list) {
      const e = sent[i];
      if (!e) continue;
      if (ok && e.order.kind === 'yard') this.yards.push({ t: this.t, cls: e.order.cls });
      if (!ok && e.from === 'tactic' && e.order.kind === 'ram') {
        this.refusedUntil.set(e.order.unit + '>' + e.order.target, this.t + 15);
        this.hunts.delete(e.order.unit);
      }
    }
  }
}
