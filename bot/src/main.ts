/* bot :: main
   провід бота: присяга, повтор першого входу, повернення після обриву,
   перевірка пінів, щоденник віри. Стратегія - у strategy.ts; мережі тут
   рівно стільки, щоб стратегія про неї не знала.

   Оточення виставляє вузол локального пакета (npm run play) або стек
   (zaria-kit init stack):
     ZARIA_URL     адреса вузла
     ZARIA_TOKEN   печатка місця
     ZARIA_ENGINE  хеш рушія, якого бот вимагає від вузла; порожньо - хеш
                   встановленого @zoria/engine. Чужий хеш - бот рве
                   провід сам: грати не в той світ гірше, ніж не грати
     ZARIA_BELIEF  файл щоденника віри (NDJSON); порожньо - не писати
     ZARIA_PRESET  стиль голови (styles.ts): ім'я каталогу або основа+ручка=число,...;
                   типово і для невідомого - полудень
     ZARIA_TACTICS надбудови над головою через кому (strategy.ts): fill:<наказ>[:N],
                   nopact, nofeed:T, k0:T, ram:R, hunt:R, cherta, stay:K, yardcap, nohook;
                   none - без надбудов;
                   не задано чи порожньо - fill:наш:6,nofeed:1200,nohook,cherta,hunt:6
     ZARIA_FREEZE  1 - здачу заморожено: зміна пресета відповідає відмовою
     ZARIA_AGENT   ім'я агента в присязі (zaria-bot)
     STATUS_PORT   внутрішній службовий порт (status.ts); порожньо - без нього
     STATUS_HOST   інтерфейс службового порту (0.0.0.0)

   Одна партія - одна присяга: пам'ять між партіями не переноситься
   (правила 25.4). Логіка навколо стратегії - у wire.ts (її перевіряють
   тести), тут лише оточення і з'єднання. Без службового порту процес виходить одразу після
   прощання вузла - так на нього і чекає локальний пакет. Зі службовим
   портом голова лишається жива і відповідає про кінець партії, доки стек
   не згасять: на цій відповіді стоїть /health службового контракту. */

import { ENGINE_HASH } from '@zoria/engine';
import { connectBot } from '@zoria/sdk';
import { errText } from './errors.js';
import { withJitter } from './jitter.js';
import { statusServer } from './status.js';
import { createStrategy, presetOrDefault, presets } from './strategy.js';
import { BotShell, statusPortOf } from './wire.js';

const log = (line: string): void => {
  process.stdout.write(line + '\n');
};

const env = process.env;
const url = env['ZARIA_URL'] ?? '';
const token = env['ZARIA_TOKEN'] ?? '';
const statusPort = statusPortOf(env['STATUS_PORT'], log);

const shell = new BotShell({
  preset: presetOrDefault(env['ZARIA_PRESET'], log),
  engine: env['ZARIA_ENGINE'] || ENGINE_HASH,
  freeze: env['ZARIA_FREEZE'] === '1',
  beliefFile: env['ZARIA_BELIEF'] ?? '',
  presets,
  createStrategy: (preset) => createStrategy(preset, log),
  log,
});

const server = statusPort ? statusServer(shell.head()) : null;
if (server) {
  /* зайнятий порт чи заборонений інтерфейс - без службового порту, але в грі */
  server.on('error', (e) => log('службовий порт ' + statusPort + ' не піднявся: ' + errText(e)));
  server.listen(statusPort, env['STATUS_HOST'] || '0.0.0.0', () => log('службовий порт ' + statusPort));
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    if (shell.run) shell.run.close();
    if (server) server.close();
    shell.diary.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
}

if (!url || !token) {
  /* адреси немає: у локальному пакеті це помилка запуску, а в стеку -
     простій. Службовий порт відповідає про простій чесним 503 */
  shell.why = 'потрібні ZARIA_URL і ZARIA_TOKEN: бота запускає вузол (npm run play) або стек';
  log(shell.why);
  if (!server) process.exit(2);
} else {
  /* перший вхід повторюється з повним джитером: вузол міг ще не відкрити
     лобі. Повернення в бою веде connectBot сам (WIRE_OPTS у wire.ts) */
  try {
    shell.run = await withJitter(
      { tries: 20, ceilMs: 2000, onRetry: (n, ms, e) => log('вхід ' + n + ' не вдався (' + errText(e) + '), повтор через ' + ms + ' мс') },
      () => connectBot(shell.connectOpts(url, token, env['ZARIA_AGENT'] || 'zaria-bot')),
    );
  } catch (e) {
    /* піни розійшлися, печатка не та, вузол не відкрив лобі: у партію не входимо */
    shell.phase = 'done';
    shell.why = 'у партію не ввійшов: ' + errText(e);
    log(shell.why);
    if (!server) process.exit(1);
  }

  const run = shell.run;
  if (run) {
    shell.phase = 'live';
    log('місце ' + run.slot + ', тактів ' + run.ack.ticks + ', рушій ' + run.ack.engine.slice(0, 12));
    shell.why = await run.done;
    shell.phase = 'done';
    shell.diary.close();
    log(shell.summary());
    if (!server) process.exit(0);
  }
}
