/* bot :: strategy
   Стратегія бота: голова-дзеркало з характером (ZARIA_PRESET - ім'я
   каталогу styles.ts або рядок «основа+ручка=число,...», типово полудень) і
   пульс, що тримає слот за ботом.

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
     - jam без цілі клинку в справі, який не глушить і не таранить, -
       теж безкоштовний; наміру глушити в нього й так немає;
     - повтор фокуса, який воротар уже прийняв, - 32 байти каналу. Він стоїть
       першим, тож watch голови в тому самому кадрі, якщо його приймуть,
       перекриває його.
   Пульс подається, лише якщо на нього вистачає каналу разом із командами
   голови і кадр не впирається в стелю: відмова - теж відхилена команда. */

import { readFileSync } from 'node:fs';
import { createEngine } from '@zoria/engine';
import { BeliefTrace, MirrorBot } from '@zoria/sdk';
import { createNakazSparring, NAKAZ_SAMPLES } from '@zoria/sdk/nakaz';
import type { BeliefFrame, WireBot } from '@zoria/sdk';
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
import { parseStyle, STYLES } from './styles.js';
import { AfterHead, hookHead, ramOrder } from './tactics.js';

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
  // halt and jam are free, but the gatekeeper accepts them only while 32 bytes are left (rules 13.4)
  if (idle && left >= world.cfg.chanOrder) return { kind: 'halt', unit: idle.id };
  /* клинок у справі, що не глушить і не таранить: jam без цілі лише скидає
     намір глушити, а його й так немає - світ не змінюється (zaria-sim-order.js, subJam) */
  const klinok = obs.mine.units.find((u) => u.cls === 'клинок' && u.task !== null && u.task.jam === null && u.task.ram === null && u.wait === 0 && !busy.has(u.id));
  if (klinok && left >= world.cfg.chanOrder) return { kind: 'jam', unit: klinok.id, target: null, hold: false };
  if (!focus) return null;
  return left >= orderCost(world.cfg, 'watch', focus, obs.t, world.storms) ? focus : null;
}

/* Надбудови над головою. Типово - DEFAULT_TACTICS. Заповнювач спрацьовує
   рідко (близько такту за партію): на 60 свіжих долинах бот без надбудов
   проти fill:наш:6 - -0.10 ± 0.15 частки за пакет, у межах похибки. Його
   лишено, бо шкоди немає, а в довгий простій він дає ткача. Задаються
   рядком ZARIA_TACTICS через кому; none - без надбудов, порожньо - типові:
     fill:<наказ>[:N]  - простій голови заповнює наказ: зразок SDK (черепаха,
                         експансія, економка, хвилини, замовлення, тиск) або
                         наш (bot/nakaz.yaml). Наказ іде всередині бота
                         кожен такт і знає світ; його команди йдуть у кадр,
                         коли голова мовчить понад N тактів (типово 0). Слот
                         лишається за ботом: це не епізод наказу вузла;
     nopact            - не пропонувати і не приймати угод: податок угоди -
                         десята частка доходу кожного такту (правила 19.5);
     nofeed:T          - голова не ставить ткачів на підкормку до такту T
                         (1200 - ніколи): підкормка в її черзі рішень стоїть
                         раніше за ціль і забирає ткача росту назавжди;
     k0:T              - без клинків у верфі до такту T, далі - klinok стилю;
     ram:R             - чистий таран: вільний клинок до R кроків таранить
                         чужого ткача на голці, що не його (греє - таран чистий,
                         правила 11.7);
     hunt:R            - таран v2: охотник і клинок із «порожнім» jam голови,
                         лише в зоні; здобич стоїть на голці ≥ 3 тактів, не в
                         паузі нашого захоплення, клинок встигає; погоню, що
                         втратила сенс, знято;
     cherta            - до зорі голова не бачить голок за чертою (Ключник
                         таранить, захоплень майже немає);
     stay:K            - не відкликати додому ткача, якому до захоплення ≤ K
                         тактів і повідець витримає;
     yardcap           - не замовляти юнит понад вагу рою (відмова «вага рою»);
     nohook            - ткач уже на голці своєї цілі, а сервер веде його ще
                         слідом гачка знахідки (правила 16.8) - move на ту саму
                         клітину обрізає зайвий круг, прогрів не переривається.
                         Лише коли знахідка на гачку нічого не дасть: уже взята
                         або від схрону під стелею заряду лишиться < 50;
     surplus:E:B       - динамічний стиль: поки заряд ≥ E, ручка build = B
                         (заряд на стелі 360 згоряє - нехай іде на щогли й лоти);
     cache:N           - схрон дасть повні 150 (заряд + 150 ≤ стеля): по нього
                         йде найближчий вільний юнит до N клітин - клинок без
                         справи чи ткач без задачі; ткача, що гріє, не знімаємо;
     gap:N, catch:x,   - числа «вбудованих голів» з маніфесту (правила, A.1)
     bopen:x, rfloor:x   у власному дзеркалі: guardGap, catchFloor, buildOpen,
                         raidFloor. Законів світу вони не міняють, лише голову.
   Механіка - tactics.ts. */
export const FILL_CHARTERS = [...Object.keys(NAKAZ_SAMPLES), 'наш'] as const;

export interface Tactics {
  fill: { charter: string; after: number } | null;
  noPact: boolean;
  noFeed: number | null;
  k0: number | null;
  ram: number | null;
  hunt: number | null;
  cherta: boolean;
  stay: number | null;
  yardCap: boolean;
  noHook: boolean;
  cache: number | null;
  surplus: { at: number; build: number } | null;
  /* ключ SIM_CFG -> значення в дзеркалі голови */
  engine: Readonly<Record<string, number>>;
}

/* токен -> ключ SIM_CFG і межі; gap - ціле */
export const ENGINE_KNOBS: Readonly<Record<string, { key: string; min: number; max: number; int: boolean }>> = {
  gap: { key: 'guardGap', min: 1, max: 600, int: true },
  catch: { key: 'catchFloor', min: 0, max: 1, int: false },
  bopen: { key: 'buildOpen', min: 0, max: 5, int: false },
  rfloor: { key: 'raidFloor', min: 0, max: 2, int: false },
};

export const NO_TACTICS: Tactics = { fill: null, noPact: false, noFeed: null, k0: null, ram: null, hunt: null, cherta: false, stay: null, yardCap: false, noHook: false, cache: null, surplus: null, engine: {} };

/* здача: ZARIA_TACTICS організатори не задають, тож бій іде з цим рядком.
   Порожня змінна (стек часто так задає) - теж цей рядок; без надбудов - none.
   nofeed:1200 - з пошуку 01.10 разом зі стилем полудень (DEFAULT_PRESET);
   nohook - лише скорочує шлях після гачка знахідки; cherta і hunt:6 (таран v2
   замість ram:6) - проти сильного пулу +0.30 ± 0.15 і +0.27 ± 0.13 на двох
   наборах по 90 свіжих долин (02.10) */
export const DEFAULT_TACTICS = 'fill:наш:6,nofeed:1200,nohook,cherta,hunt:6';

/* рядок надбудов; невідоме - у журнал і пропустити */
export function parseTactics(spec: string | readonly string[] | undefined, log: (line: string) => void = () => undefined): Tactics {
  const items = (typeof spec === 'string' ? spec.split(',') : (spec ?? [])).map((x) => x.trim()).filter(Boolean);
  const out: Tactics = { ...NO_TACTICS };
  /* такт або радіус: ціле в межах, інакше - у журнал */
  const int = (item: string, v: string | undefined, max: number): number | null => {
    const n = Number(v);
    if (v !== undefined && /^\d{1,4}$/.test(v) && n >= 1 && n <= max) return n;
    log('надбудова «' + item + '»: N - ціле 1-' + max + ', пропускаю');
    return null;
  };
  for (const item of items) {
    const [name, charter, after, ...rest] = item.split(':');
    if (rest.length) log('надбудови «' + item + '» немає, пропускаю');
    else if (name === 'none' && charter === undefined) continue;
    else if (name === 'nopact' && charter === undefined) out.noPact = true;
    else if (name === 'nofeed' && after === undefined) out.noFeed = int(item, charter, 1200) ?? out.noFeed;
    else if (name === 'k0' && after === undefined) out.k0 = int(item, charter, 1200) ?? out.k0;
    else if (name === 'ram' && after === undefined) out.ram = int(item, charter, 12) ?? out.ram;
    else if (name === 'hunt' && after === undefined) out.hunt = int(item, charter, 12) ?? out.hunt;
    else if (name === 'stay' && after === undefined) out.stay = int(item, charter, 24) ?? out.stay;
    else if (name === 'cherta' && charter === undefined) out.cherta = true;
    else if (name === 'yardcap' && charter === undefined) out.yardCap = true;
    else if (name === 'nohook' && charter === undefined) out.noHook = true;
    else if (name === 'cache' && after === undefined) out.cache = int(item, charter, 12) ?? out.cache;
    else if (name === 'surplus' && charter !== undefined && after !== undefined) {
      const at = Number(charter);
      const build = Number(after);
      const ok = /^\d{1,3}$/.test(charter) && at >= 0 && at <= 360 && /^\d+(\.\d+)?$/.test(after) && build <= 3;
      if (ok) out.surplus = { at, build };
      else log('надбудова «' + item + '»: E - ціле 0-360, B - 0-3, пропускаю');
    }
    else if (name && Object.hasOwn(ENGINE_KNOBS, name) && after === undefined) {
      const k = ENGINE_KNOBS[name]!;
      const n = Number(charter);
      const ok = charter !== undefined && (k.int ? /^\d{1,4}$/ : /^\d+(\.\d+)?$/).test(charter) && n >= k.min && n <= k.max;
      if (ok) out.engine = { ...out.engine, [k.key]: n };
      else log('надбудова «' + item + '»: N - ' + (k.int ? 'ціле ' : '') + k.min + '-' + k.max + ', пропускаю');
    }
    else if (name === 'fill' && charter && (FILL_CHARTERS as readonly string[]).includes(charter)) {
      const n = after === undefined ? 0 : Number(after);
      if (Number.isInteger(n) && n >= 0 && n <= 1200) out.fill = { charter, after: n };
      else log('надбудова «' + item + '»: N - ціле 0-1200, пропускаю');
    } else log('надбудови «' + item + '» немає, пропускаю');
  }
  return out;
}

/* текст наказу-заповнювача */
export function charterText(name: string): string {
  if (name === 'наш') return readFileSync(new URL('../nakaz.yaml', import.meta.url), 'utf8');
  const text = (NAKAZ_SAMPLES as Readonly<Record<string, string>>)[name];
  if (!text) throw new Error('no such charter: ' + name);
  return text;
}

/* голова, яку обгортає пульс: дзеркало архетипу або підміна в тестах */
export type Head = Pick<MirrorBot, 'init' | 'tick' | 'feedback' | 'mirror'>;

/* звідки команда кадру: пульс, голова, наказ-заповнювач чи надбудова, і її місце у своєму джерелі */
export type Source = 'pulse' | 'head' | 'fill' | 'tactic';
interface Entry {
  order: Order;
  from: Source;
  at: number;
}

export interface StrategyOpts {
  tactics?: Tactics;
  /* наказ-заповнювач; без нього fill не діє */
  filler?: WireBot | null;
}

export class PulseStrategy implements Strategy {
  private readonly head: Head;
  private readonly log: (line: string) => void;
  private readonly tactics: Tactics;
  private readonly filler: WireBot | null;
  private slot: SlotName | null = null;
  private trace: BeliefTrace | null = null;
  private world: PulseWorld | null = null;
  /* тактів поспіль без прийнятої команди */
  private quiet = 0;
  /* тактів поспіль, коли голова мовчала */
  private headIdle = 0;
  /* фокус, прийнятий воротарем; до першого watch - вогнище */
  private focus: Watch | null = null;
  /* команди кадру цього такту в порядку кадру: за ними вердикти йдуть до свого джерела */
  private sent: Entry[] = [];
  /* діагностика для лабораторії (lab/): пульс і джерела команд останнього кадру */
  lastPulse: Order | null = null;
  lastSources: Source[] = [];
  private headFaults = 0;
  /* надбудови після голови з пам'яттю кадрів (tactics.ts); null - жодної */
  private after: AfterHead | null = null;
  /* попередження «nofeed не діє» - раз за партію */
  private feedWarned = false;

  constructor(head: Head, log: (line: string) => void = () => undefined, opts: StrategyOpts = {}) {
    this.head = head;
    this.log = log;
    this.tactics = opts.tactics ?? NO_TACTICS;
    this.filler = this.tactics.fill ? (opts.filler ?? null) : null;
  }

  init(manifest: Uint8Array, slot: SlotName): void {
    this.head.init(manifest, slot);
    this.filler?.init(manifest, slot);
    this.slot = slot;
    this.trace = new BeliefTrace(slot);
    const m = decodeManifest(manifest);
    const hearth = m?.seats[m.perm.indexOf(slot)];
    this.world = m && hearth ? { cfg: m.cfg as unknown as ChannelCfg, storms: m.storms, hearth } : null;
    this.focus = hearth ? { kind: 'watch', q: hearth.q, r: hearth.r, keep: 0 } : null;
    this.quiet = 0;
    this.headIdle = 0;
    this.feedWarned = false;
    const t = this.tactics;
    const needAfter = t.ram !== null || t.hunt !== null || t.stay !== null || t.cherta || t.yardCap || t.noHook || t.cache !== null;
    this.after = needAfter && m && this.world ? new AfterHead(t, m, slot, this.world, (at, obs) => this.links(at, obs)) : null;
    hookHead(this.head.mirror(), slot, this.tactics, this.log);
  }

  tick(observe: Uint8Array): Uint8Array {
    let reply: Uint8Array | null = null;
    let headOrders: Order[] = [];
    try {
      reply = this.head.tick(observe);
      const decoded = decodeOrders(reply);
      // a reply that does not decode is garbage for the node too: the pulse speaks instead
      if (decoded === null) reply = null;
      headOrders = decoded ?? [];
    } catch (e) {
      this.fail('tick', e);
    }
    // the filler follows every tick, so that it knows the world when its turn comes
    let fillOrders: Order[] = [];
    if (this.filler) {
      try {
        fillOrders = decodeOrders(this.filler.tick(observe)) ?? [];
      } catch (e) {
        this.fail('fill', e);
      }
    }

    let entries: Entry[] = headOrders
      .map((order, at): Entry => ({ order, from: 'head', at }))
      .filter((e) => !(this.tactics.noPact && e.order.kind === 'pact' && e.order.op !== 'break'));
    this.headIdle = headOrders.length === 0 ? this.headIdle + 1 : 0;
    const fill = this.tactics.fill;
    if (fill && entries.length === 0 && this.headIdle > fill.after) {
      entries = fillOrders.map((order, at): Entry => ({ order, from: 'fill', at }));
    }

    const quiet = this.quiet;
    this.quiet += 1;
    const obs = (quiet >= PULSE_AFTER || this.after || this.tactics.noFeed !== null) && this.world ? decodeObserve(observe) : null;
    /* nofeed діє, а ткач однаково на підкормці (її поставив наказ вузла чи
       маска не спрацювала) - раз за партію в журнал: інакше втрату не видно */
    const nf = this.tactics.noFeed;
    if (obs && nf !== null && obs.t < nf && !this.feedWarned && obs.mine.units.some((u) => u.task?.feed)) {
      this.feedWarned = true;
      this.log('nofeed: ткач на підкормці на такті ' + obs.t + ' - перевірте маску (новий рушій?)');
    }
    if (obs && this.after && this.slot && this.world) {
      this.after.see(obs);
      entries = this.after.apply(obs, entries);
      if (this.tactics.ram !== null) {
        const ram = ramOrder(obs, entries.map((e) => e.order), this.slot, this.after.owners, this.tactics.ram, this.world, this.after.refused);
        if (ram) entries = [...entries, { order: ram, from: 'tactic', at: 0 }];
      }
    }
    const orders = entries.map((e) => e.order);
    const pulse = obs && quiet >= PULSE_AFTER && this.world ? pulseOrder(obs, orders, this.focus, this.world) : null;
    this.lastPulse = pulse;
    this.sent = pulse ? [{ order: pulse, from: 'pulse', at: 0 }, ...entries] : entries;
    this.lastSources = this.sent.map((e) => e.from);

    // untouched head reply goes out byte for byte
    if (!pulse && reply && entries.length === headOrders.length && entries.every((e) => e.from === 'head')) return reply;
    return encodeOrders(this.sent.map((e) => e.order));
  }

  feedback(verdicts: Uint8Array): void {
    const list = decodeVerdicts(verdicts);
    if (list?.some(([, ok]) => ok)) this.quiet = 0;
    if (list) this.after?.verdicts(this.sent, list);
    const head: Verdict[] = [];
    const filler: Verdict[] = [];
    for (const [i, ok, code] of list ?? []) {
      const entry = this.sent[i];
      if (!entry) continue;
      if (ok && entry.order.kind === 'watch') this.focus = entry.order;
      if (entry.from === 'head') head.push([entry.at, ok, code]);
      else if (entry.from === 'fill') filler.push([entry.at, ok, code]);
    }
    try {
      // the head gets back only the verdicts on its own commands, at their own positions
      this.head.feedback(list ? encodeVerdicts(head) : verdicts);
    } catch (e) {
      this.fail('feedback', e);
    }
    if (this.filler && filler.length > 0) {
      try {
        this.filler.feedback?.(encodeVerdicts(filler));
      } catch (e) {
        this.fail('fill feedback', e);
      }
    }
  }

  /* чи дотягнеться нитка з клітини до своєї горящої голки чи вогнища: питаємо
     рушій дзеркала (гори, пагорби - правила 7.2); голова-наказ - ні (обережно) */
  private links(at: Hex, obs: Observe): boolean {
    const E = this.head.mirror() as { linkOk?: (aq: number, ar: number, bq: number, br: number) => boolean } | null;
    if (!E || typeof E.linkOk !== 'function' || !this.world) return false;
    const to = [this.world.hearth, ...obs.mine.needles.filter((n) => !n.dark)];
    return to.some((n) => E.linkOk!(at.q, at.r, n.q, n.r));
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

/* імена каталогу стилів: за ними службова ручка зміни пресета вирішує, є
   такий пресет чи ні */
export function presets(): string[] {
  return Object.keys(STYLES);
}

/* полудень - переможець пошуку 01.10 (styles.ts), шукали разом із надбудовами
   nofeed:1200 і ram:6. Із ними до світанку з fill:наш:6, що грав у бою до
   того: +1.55 ± 0.21 частки за пакет на 60 свіжих долинах проти змішаного
   пулу (наш бот, рівний, облягач, опортуніст, рейдер, бот під наказом),
   кращий проти кожного з них. Після зсуву світу 05.10 - перемірити */
export const DEFAULT_PRESET = 'полудень';

/* Голова-наказ: «nakaz:<зразок SDK або наш>» - замість дзеркала думає наказ
   усередині бота (як заповнювач, але весь час). Пульс і надбудови після голови
   діють як завжди, тож слот лишається за ботом: голий наказ на місці мовчить у
   такти без справ, і вузол віддає слот наказу (правила 23.2) */
export const NAKAZ_HEADS = FILL_CHARTERS.map((name) => 'nakaz:' + name);
export function nakazHeadOf(preset: string): string | null {
  return NAKAZ_HEADS.includes(preset) ? preset.slice('nakaz:'.length) : null;
}

/* пресет - стиль каталогу, рядок «основа+ручка=число» або голова-наказ */
export function isPreset(preset: string): boolean {
  return parseStyle(preset) !== null || nakazHeadOf(preset) !== null;
}

/* невідоме ім'я (одруківка, кодова сторінка cmd) не валить бота до присяги:
   грає типовий стиль */
export function presetOrDefault(preset: string | undefined, log: (line: string) => void = () => undefined): string {
  if (!preset) return DEFAULT_PRESET;
  if (isPreset(preset)) return preset;
  log('пресета «' + preset + '» немає, граю ' + DEFAULT_PRESET);
  return DEFAULT_PRESET;
}

/* наказ у ролі голови: віри-дзеркала в нього немає, щоденник віри порожній */
function nakazHead(text: string): Head {
  const bot = createNakazSparring(text);
  return {
    init: (manifest, slot) => bot.init(manifest, slot),
    tick: (observe) => bot.tick(observe),
    feedback: (verdicts) => bot.feedback?.(verdicts),
    mirror: () => null,
  };
}

export function createStrategy(
  preset = process.env['ZARIA_PRESET'],
  log: (line: string) => void = () => undefined,
  tactics: Tactics = parseTactics(process.env['ZARIA_TACTICS'] || DEFAULT_TACTICS, log),
): PulseStrategy {
  const chosen = presetOrDefault(preset, log);
  const nakaz = nakazHeadOf(chosen);
  const head: Head = nakaz ? nakazHead(charterText(nakaz)) : new MirrorBot(createEngine, { ...(parseStyle(chosen) ?? STYLES[DEFAULT_PRESET]!) });
  let filler: WireBot | null = null;
  if (tactics.fill) {
    try {
      filler = createNakazSparring(charterText(tactics.fill.charter));
    } catch (e) {
      log('наказ-заповнювач «' + tactics.fill.charter + '» не прочитався, граю без нього: ' + errText(e));
    }
  }
  return new PulseStrategy(head, log, { tactics, filler });
}
