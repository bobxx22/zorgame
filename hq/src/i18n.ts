/* hq :: i18n
   The show speaks the language the host names (HQ contract, 2.4): Ukrainian by
   default, English on request. Anchor values are not translated - they are the
   contract's own words. */

export type Lang = 'uk' | 'en'

type Dict = Readonly<Record<string, string>>

const UK: Dict = {
  brand: 'штаб',
  oPack: 'запис',
  oMatch: 'партія',
  oTick: 'такт',
  oMode: 'шар',
  oFocus: 'фокус',
  oCell: 'клітина',
  oUnit: 'машина',
  oOrder: 'команда',
  oPreset: 'пресет',
  oPromote: 'підняти в бій',
  play: 'грати',
  pause: 'пауза',
  follow: 'до ефіру',
  openFiles: 'відкрити запис',
  mTruth: 'правда',
  mBelief: 'віра',
  mBoth: 'обидва',
  live: 'ефір',
  lag: 'відставання',
  hNow: 'Де стоїть показ',
  hField: 'Правда і віра',
  hChan: 'Канал',
  hAb: 'Порівняння пресетів',
  match: 'партія',
  tick: 'такт',
  mode: 'шар',
  focus: 'фокус',
  score: 'рахунок фокуса',
  needles: 'голок горить',
  shares: 'частки',
  cell: 'клітина',
  ownerTruth: 'голка за правдою',
  ownerBelief: 'голка за вірою',
  ghost: 'де бачив машину',
  ghostAge: "вік пам'яті, тактів",
  diff: 'розбіжностей голок',
  dark: 'мовчазних голок',
  bytes: 'байтів у кадрі',
  orders: 'команд подано',
  denied: 'відхилено',
  denyWord: 'причина відмови',
  denyTop: 'пік відмов, такт',
  abWinner: 'більше хвилин мережі',
  abDiff: 'різниця рахунку',
  abTop: 'стаття розбіжності',
  abItem: 'стаття',
  abDelta: 'різниця',
  total: 'рахунок',
  network: 'мережа',
  ordersItem: 'замовлення',
  stolen: 'здобич',
  pactTax: 'податок',
  promote: 'відповідь бота',
  stripHint: 'Смуга каналу: байти кадру наказів фокуса, відмови воротаря і рахунок за тактами. Клацніть, щоб перейти на такт.',
  keeper: 'Доглядач',
  ruin: 'руїна',
  diverged: 'віра розійшлася з правдою',
  liveName: 'ефір',
  noHost: 'Господаря показу немає: відкрийте файли запису - pack.json, журнали партій і щоденники.',
  noPackFile: 'Серед вибраних файлів немає pack.json.',
  badPack: 'Зведення пакета не прочитано.',
  matchProblem: 'Партію не показано: ',
  diarySkipped: 'Рядків щоденника не прочитано: ',
  promoteWait: 'чекаємо відповіді бота…',
}

const EN: Dict = {
  brand: 'HQ',
  oPack: 'record',
  oMatch: 'match',
  oTick: 'tick',
  oMode: 'layer',
  oFocus: 'focus',
  oCell: 'cell',
  oUnit: 'unit',
  oOrder: 'command',
  oPreset: 'preset',
  oPromote: 'promote to battle',
  play: 'play',
  pause: 'pause',
  follow: 'to live',
  openFiles: 'open a record',
  mTruth: 'truth',
  mBelief: 'belief',
  mBoth: 'both',
  live: 'broadcast',
  lag: 'lag',
  hNow: 'Where the show stands',
  hField: 'Truth and belief',
  hChan: 'Channel',
  hAb: 'Preset comparison',
  match: 'match',
  tick: 'tick',
  mode: 'layer',
  focus: 'focus',
  score: 'focus score',
  needles: 'needles lit',
  shares: 'shares',
  cell: 'cell',
  ownerTruth: 'needle by truth',
  ownerBelief: 'needle by belief',
  ghost: 'unit last seen at',
  ghostAge: 'memory age, ticks',
  diff: 'diverging needles',
  dark: 'dark needles',
  bytes: 'bytes in the frame',
  orders: 'commands submitted',
  denied: 'denied',
  denyWord: 'denial reason',
  denyTop: 'peak of denials, tick',
  abWinner: 'more network minutes',
  abDiff: 'score difference',
  abTop: 'divergence item',
  abItem: 'item',
  abDelta: 'difference',
  total: 'score',
  network: 'network',
  ordersItem: 'orders',
  stolen: 'loot',
  pactTax: 'tax',
  promote: "the bot's answer",
  stripHint: "The channel strip: bytes of the focus's orders frame, the gatekeeper's denials and the score by tick. Click to jump to a tick.",
  keeper: 'Keeper',
  ruin: 'ruin',
  diverged: 'the belief diverged from the truth',
  liveName: 'broadcast',
  noHost: 'There is no show host: open the files of a record - pack.json, the match journals and the diaries.',
  noPackFile: 'There is no pack.json among the chosen files.',
  badPack: 'The pack summary did not parse.',
  matchProblem: 'The match is not shown: ',
  diarySkipped: 'Diary lines not read: ',
  promoteWait: 'waiting for the bot…',
}

const DICTS: Readonly<Record<Lang, Dict>> = { uk: UK, en: EN }

let current: Lang = 'uk'

export function setLang(lang: Lang, root: ParentNode & { documentElement?: HTMLElement }): void {
  current = lang
  for (const el of root.querySelectorAll<HTMLElement>('[data-t]')) {
    const text = DICTS[lang][el.dataset.t ?? '']
    if (text !== undefined) el.textContent = text
  }
  if (root.documentElement) root.documentElement.lang = lang
}

/** A string of the current language; the key itself when the dictionary has none. */
export function tr(key: string): string {
  return DICTS[current][key] ?? UK[key] ?? key
}
