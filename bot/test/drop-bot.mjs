// Test helper, not a test: runs the bot behind a TCP proxy that breaks the wire once,
// DROP_AFTER_MS after the start, and refuses new connections for DROP_OUTAGE_MS.
// The local pack starts it as the bot command: --bot "node test/drop-bot.mjs".
import { spawn } from 'node:child_process';
import net from 'node:net';

const after = Number(process.env['DROP_AFTER_MS'] ?? 1000);
const outage = Number(process.env['DROP_OUTAGE_MS'] ?? 1500);
const target = new URL(process.env['ZARIA_URL'] ?? '');
const live = new Set();
let refuseUntil = 0;

const proxy = net.createServer((client) => {
  if (Date.now() < refuseUntil) {
    client.destroy();
    return;
  }
  const upstream = net.connect(Number(target.port), target.hostname);
  const pair = { client, upstream };
  live.add(pair);
  const end = () => {
    client.destroy();
    upstream.destroy();
    live.delete(pair);
  };
  client.on('error', end);
  upstream.on('error', end);
  client.on('close', end);
  upstream.on('close', end);
  client.pipe(upstream);
  upstream.pipe(client);
});

proxy.listen(0, '127.0.0.1', () => {
  const url = new URL(target);
  url.port = String(proxy.address().port);
  const bot = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, ZARIA_URL: url.toString() }, stdio: 'inherit' });
  const timer = setTimeout(() => {
    refuseUntil = Date.now() + outage;
    for (const { client, upstream } of live) {
      client.destroy();
      upstream.destroy();
    }
    live.clear();
  }, after);
  bot.on('exit', (code) => {
    clearTimeout(timer);
    proxy.close();
    process.exit(code ?? 1);
  });
});
