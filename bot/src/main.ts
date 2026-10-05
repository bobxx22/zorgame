/* bot :: main
   the bot's wire: oath, retrying the first entry, reconnecting after a drop,
   pin check, belief diary. The strategy is in strategy.ts; there is exactly
   as much network here as needed for the strategy not to know about it.

   The environment is set by the local pack's node (npm run play) or by the
   stack (zaria-kit init stack):
     ZARIA_URL     node address
     ZARIA_TOKEN   seat seal
     ZARIA_ENGINE  engine hash the bot demands from the node; empty - the hash
                   of the installed @zoria/engine. A foreign hash - the bot
                   drops the wire itself: playing the wrong world is worse
                   than not playing
     ZARIA_BELIEF  belief diary file (NDJSON); empty - don't write
     ZARIA_PRESET  head style (styles.ts): a catalogue name or base+knob=number,...;
                   default and for an unknown one - полудень
     ZARIA_TACTICS tactics on top of the head, comma separated (strategy.ts):
                   fill:<nakaz>[:N], nopact, nofeed:T, k0:T, ram:R, hunt:R,
                   cherta, stay:K, yardcap, nohook; none - no tactics;
                   unset or empty - fill:own:6,nofeed:1200,nohook,cherta,hunt:12
     ZARIA_FREEZE  1 - the submission is frozen: a preset change answers with a refusal
     ZARIA_AGENT   agent name in the oath (zaria-bot)
     STATUS_PORT   internal service port (status.ts); empty - none
     STATUS_HOST   service port interface (0.0.0.0)

   One match - one oath: memory is not carried between matches (rules 25.4).
   The logic around the strategy is in wire.ts (tests check it), here only the
   environment and the connection. Without a service port the process exits
   right after the node says goodbye - that's what the local pack waits for.
   With a service port the head stays alive and reports the end of the match
   until the stack is shut down: the service contract's /health relies on that answer. */

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
  /* a busy port or a forbidden interface - no service port, but still in the game */
  server.on('error', (e) => log('service port ' + statusPort + ' did not start: ' + errText(e)));
  server.listen(statusPort, env['STATUS_HOST'] || '0.0.0.0', () => log('service port ' + statusPort));
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
  /* no address: in the local pack that's a launch error, and in the stack -
     idle time. The service port reports the idle time with an honest 503 */
  shell.why = 'ZARIA_URL and ZARIA_TOKEN are required: the bot is started by the node (npm run play) or the stack';
  log(shell.why);
  if (!server) process.exit(2);
} else {
  /* the first entry is retried with full jitter: the node may not have opened
     the lobby yet. Reconnects in battle are handled by connectBot itself (WIRE_OPTS in wire.ts) */
  try {
    shell.run = await withJitter(
      { tries: 20, ceilMs: 2000, onRetry: (n, ms, e) => log('entry ' + n + ' failed (' + errText(e) + '), retry in ' + ms + ' ms') },
      () => connectBot(shell.connectOpts(url, token, env['ZARIA_AGENT'] || 'zaria-bot')),
    );
  } catch (e) {
    /* pins differ, wrong seal, the node didn't open the lobby: we don't enter the match */
    shell.phase = 'done';
    shell.why = 'did not enter the match: ' + errText(e);
    log(shell.why);
    if (!server) process.exit(1);
  }

  const run = shell.run;
  if (run) {
    shell.phase = 'live';
    log('seat ' + run.slot + ', ticks ' + run.ack.ticks + ', engine ' + run.ack.engine.slice(0, 12));
    shell.why = await run.done;
    shell.phase = 'done';
    shell.diary.close();
    log(shell.summary());
    if (!server) process.exit(0);
  }
}
