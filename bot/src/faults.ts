/* bot :: faults
   Errors the bot survives on purpose - a head that fails on one tick keeps
   playing with a fallback - are counted and reported here, never silently
   dropped: the first one of each place goes to the log, then every 100th with
   its count. The log is set by whoever builds the strategy (combo.ts, the
   mirror head's pathOk in strategy.ts); without it they are only counted. */

import { errText } from './errors.js';

const counts = new Map<string, number>();
let report: (line: string) => void = () => undefined;

export function setFaultLog(log: (line: string) => void): void {
  report = log;
}

export function fault(where: string, e: unknown): void {
  const n = (counts.get(where) ?? 0) + 1;
  counts.set(where, n);
  if (n === 1 || n % 100 === 0) report('survived a fault in ' + where + (n > 1 ? ' (' + n + ' times)' : '') + ': ' + errText(e));
}

/* how many times each place failed: for tests and diagnostics */
export function faultCounts(): ReadonlyMap<string, number> {
  return counts;
}
