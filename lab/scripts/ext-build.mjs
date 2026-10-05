// lab :: ext-build
// External bots as lab opponents. Each one is a single strategy.ts file by the kit
// template contract (createStrategy, presets); here it is copied to ext/<name>/strategy.ts
// and built next to it into strategy.js by the same tsc, with the lab's @zoria packages.
//
//   node scripts/ext-build.mjs <name>=<path to strategy.ts> [...]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSC = join(LAB, 'node_modules', 'typescript', 'bin', 'tsc');
const pairs = process.argv.slice(2);
if (!pairs.length) throw new Error('node scripts/ext-build.mjs <name>=<path to strategy.ts> ...');
for (const pair of pairs) {
  const [name, src] = pair.split('=');
  if (!name || !src || !/^[a-z0-9][a-z0-9.-]{0,48}$/.test(name)) throw new Error('pair ' + pair + ': <name>=<path>, name - a-z, 0-9, dot, hyphen');
  const dir = join(LAB, 'ext', name);
  mkdirSync(dir, { recursive: true });
  copyFileSync(resolve(src), join(dir, 'strategy.ts'));
  // the same strict options as in the kit template's tsconfig
  execFileSync(process.execPath, [TSC, '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--noImplicitOverride', '--skipLibCheck', '--types', 'node', '--rootDir', dir, '--outDir', dir, join(dir, 'strategy.ts')], { cwd: LAB, stdio: 'inherit' });
  console.log('built: ext/' + name + '/strategy.js');
}
