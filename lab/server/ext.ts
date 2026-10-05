/* lab :: ext
   External bots - lab opponents written from the same documents other
   participants have. Each one is built into ext/<name>/strategy.js
   (scripts/ext-build.mjs) by the kit template contract: createStrategy() gives
   a WireBot. Loaded once at process start (and in every search thread). */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { WireBot } from '@zoria/sdk';

interface ExtModule {
  createStrategy(preset?: string): WireBot;
}

const DIR = fileURLToPath(new URL('../ext/', import.meta.url));
const loaded = new Map<string, ExtModule>();
if (existsSync(DIR)) {
  for (const name of readdirSync(DIR).sort()) {
    const file = join(DIR, name, 'strategy.js');
    if (!existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)) as Partial<ExtModule>;
    if (typeof mod.createStrategy === 'function') loaded.set(name, mod as ExtModule);
  }
}

export const EXT_BOTS: readonly string[] = [...loaded.keys()];

/* "a3" or "a3@order=TTTKK+jam=0": after @ - the bot's preset, "+" instead of ";"
   (a semicolon in --start separates candidates) */
function split(name: string): { base: string; preset: string | undefined } {
  const at = name.indexOf('@');
  return at < 0 ? { base: name, preset: undefined } : { base: name.slice(0, at), preset: name.slice(at + 1).split('+').join(';') };
}

export function isExtBot(name: string): boolean {
  return loaded.has(split(name).base);
}

/* a new instance per match: memory is not carried between matches (rules 25.4) */
export function makeExtBot(name: string): WireBot {
  const { base, preset } = split(name);
  const mod = loaded.get(base);
  if (!mod) throw new Error('no external bot ' + base + ' in ext/');
  return mod.createStrategy(preset);
}
