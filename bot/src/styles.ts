/* bot :: styles
   Характер голови: повний об'єкт ручок, яким MirrorBot підміняє BOT_STYLE
   свого місця в рушії. Алгоритм голови один; ручки - множники на чесну
   оцінку (хвилини за такт), тож стиль - це лише ваги, не інший код.

   Каталог: п'ять архетипів SDK як є, три стилі самого рушія (економіст,
   рейдер, опортуніст) і наші суміші. Будь-який стиль задається ще й рядком
   «основа+ручка=число,...» (рівний+raid=1.5,pact=1; облягач+mind=): так
   нічний пошук лабораторії (lab/server/search.ts) перебирає ваги, а
   переможця можна дописати в каталог під іменем. */

import { ARCHETYPES } from '@zoria/sdk';

export const KNOBS = ['dark', 'grow', 'steal', 'raid', 'order', 'klinok', 'build', 'guard', 'scout', 'deep', 'spare', 'pirate', 'siege', 'pact'] as const;
export type Knob = (typeof KNOBS)[number];
export type Mind = '' | 'різчик';
/* land - необов'язкова: без неї голова бере landContest світу (зараз 0), тож у
   стиль вона потрапляє лише заданою явно - новий світ 05.10 може змінити типове */
export type Style = { mind: Mind; land?: number } & Record<Knob, number>;
export const LAND_MAX = 2;

/* межі ручок, за рушієм (source/js/core/zaria-bot*.js):
     dark    чужа темрява за захопленою голкою проти своєї хвилини
     grow    нічия руїна - своя нова голка
     steal   чужа голка під захоплення
     raid    глушіння чужих голок
     order   контракти «Утримай лінію»
     klinok  частка клинків у рої (0-1)
     build   готовність тримати заряд на нову голку
     guard   ймовірність відповіді тараном на гостя (0-1, жереб)
     scout   вага чужої мережі в прицілі спалаху і скана
     deep    частка автономії на виліт углиб чужої мережі
     spare   ціна запасного шляху мережі (обхідник)
     pirate  клинок чергує біля чужого контракту
     siege   облога: жертва, пара вузлів, тримачі; на зорі - кільце
     pact    ймовірність угоди проти лідера (0-1, жереб)
     land    мірило руїни: приріст своєї частки і спірність соти (0-2) */
export const KNOB_MAX: Readonly<Record<Knob, number>> = {
  dark: 4,
  grow: 3,
  steal: 3,
  raid: 3,
  order: 3,
  klinok: 1,
  build: 3,
  guard: 1,
  scout: 2,
  deep: 1.5,
  spare: 2,
  pirate: 2,
  siege: 2,
  pact: 1,
};

/* повний стиль із часткового: відсутня ручка - нуль, як у SDK; land - лише задана */
export function fullStyle(way: Partial<Style>): Style {
  const st = { mind: way.mind ?? '' } as Style;
  for (const k of KNOBS) st[k] = way[k] ?? 0;
  if (way.land !== undefined) st.land = way.land;
  return st;
}

const sdk = (name: string): Style => fullStyle(ARCHETYPES[name] as Partial<Style>);
const mix = (base: Style, over: Partial<Style>): Style => fullStyle({ ...base, ...over });

const рівний = sdk('рівний');
const обхідник = sdk('обхідник');
const проривник = sdk('проривник');
const облягач = sdk('облягач');
const шир = sdk('шир');
/* стилі самого рушія (zaria-bot-style.js, BOT_STYLE A/B/C) */
const опортуніст = fullStyle({ grow: 1, steal: 1, dark: 1, raid: 0.9, order: 2.4, klinok: 0.4, build: 0.8, guard: 0.7, pact: 1 });

export const STYLES: Readonly<Record<string, Style>> = {
  /* архетипи SDK - ті самі об'єкти, що дає sampleBot */
  рівний,
  шир,
  обхідник,
  проривник,
  облягач,
  /* стилі рушія */
  економіст: fullStyle({ grow: 1.4, steal: 0.55, dark: 0.4, raid: 0.4, order: 0.8, klinok: 0.2, build: 1.2, guard: 1, pact: 0.5 }),
  рейдер: fullStyle({ grow: 0.75, steal: 1.3, dark: 1.6, raid: 1.7, order: 0.7, klinok: 0.6, build: 0.45, guard: 0.5, pact: 1 }),
  опортуніст,
  /* наші суміші: кожна міняє одну-дві риси відомого архетипу */
  союзник: mix(рівний, { pact: 1 }),
  підрядник: mix(рівний, { order: 2, pirate: 0.5 }),
  вартовий: mix(обхідник, { guard: 1, klinok: 0.6, spare: 1.5 }),
  будівник: mix(обхідник, { grow: 1.3, build: 1.6, klinok: 0.3 }),
  мисливець: mix(рівний, { dark: 2, steal: 1.4, raid: 1.4, klinok: 0.6, guard: 0.7 }),
  різчик: mix(рівний, { mind: 'різчик', raid: 1.4, scout: 1 }),
  глибокий: mix(проривник, { mind: 'різчик', deep: 0.6, scout: 1 }),
  пірат: mix(опортуніст, { pirate: 1, klinok: 0.5 }),
  зоряний: mix(обхідник, { siege: 1 }),
  широблог: mix(облягач, { grow: 1.2, build: 1, klinok: 0.45 }),
  тихий: mix(шир, { guard: 1, spare: 1, pact: 1 }),
  /* знайдений нічним пошуком 30.09 (покоління 3): зоряний із розумом різчика,
     більшим ростом, меншим будівництвом і частішим тараном. До широблога:
     +0.83 ± 0.15 частки за пакет на 60 свіжих долинах проти пар архетипів SDK
     і +1.06 ± 0.12 на 120 долинах проти змішаного пулу */
  світанок: mix(обхідник, { siege: 1, mind: 'різчик', grow: 1.4, build: 0.4, guard: 0.7, scout: 0.8 }),
  /* знайдений пошуком 01.10 разом із надбудовами nofeed:1200 і ram:6 (покоління 5):
     світанок із більшим ростом, контрактами, глушінням і розвідкою, ще меншим
     будівництвом, land 1. З цими надбудовами до світанку без них: +1.55 ± 0.21
     частки за пакет на 60 свіжих долинах проти змішаного пулу */
  полудень: mix(обхідник, {
    mind: 'різчик',
    grow: 2.25,
    raid: 1.35,
    order: 1.55,
    build: 0.25,
    guard: 0.6,
    scout: 1.35,
    spare: 0.6,
    siege: 1.2,
    pact: 0.7,
    land: 1,
  }),
};

/* рядок стилю: ім'я каталогу або «основа+ручка=число,...»; неправильне - null */
export function parseStyle(spec: string): Style | null {
  const [baseName, over, ...rest] = spec.split('+');
  if (rest.length || !baseName || !Object.hasOwn(STYLES, baseName)) return null;
  const st = fullStyle(STYLES[baseName]!);
  if (over === undefined) return st;
  if (!over) return null;
  for (const pair of over.split(',')) {
    const [k, v, ...tail] = pair.split('=');
    if (tail.length || k === undefined || v === undefined) return null;
    if (k === 'mind') {
      if (v !== '' && v !== 'різчик') return null;
      st.mind = v;
      continue;
    }
    if (!/^\d+(\.\d+)?$/.test(v)) return null;
    const n = Number(v);
    if (k === 'land') {
      if (n > LAND_MAX) return null;
      st.land = n;
      continue;
    }
    if (!(KNOBS as readonly string[]).includes(k) || n > KNOB_MAX[k as Knob]) return null;
    st[k as Knob] = n;
  }
  return st;
}

/* стиль рядком: основа і ручки, що від неї відрізняються; зворотне до parseStyle */
export function styleSpec(base: string, st: Style): string {
  const b = STYLES[base];
  if (!b) throw new Error('no such style: ' + base);
  const diff: string[] = [];
  if (st.mind !== b.mind) diff.push('mind=' + st.mind);
  for (const k of KNOBS) if (st[k] !== b[k]) diff.push(k + '=' + String(Math.round(st[k] * 100) / 100));
  if (st.land !== undefined && st.land !== b.land) diff.push('land=' + String(Math.round(st.land * 100) / 100));
  return diff.length ? base + '+' + diff.join(',') : base;
}
