/* bot :: jitter
   the first connection to the node: full jitter on top of exponential backoff
   (full jitter) - the same law connectBot uses for reconnects
   (04-protocol.md, section 8).

   The first attempt is immediate. Each next one waits uniformly in
   [0, min(ceil, base * 2^n)), base is a third of the ceiling. Uniformly from
   zero exactly: a constant plus a small spread doesn't break up the herd, it
   shifts it whole. Bots start together, and if the lobby isn't open yet they
   all rush it at once - exactly the case the law exists for. */

import { errText } from './errors.js';

export function backoffMs(attempt: number, ceilMs: number, rnd: () => number = Math.random): number {
  const base = Math.max(1, Math.round(ceilMs / 3));
  const cap = Math.min(ceilMs, base * Math.pow(2, attempt));
  return Math.floor(rnd() * cap);
}

/* only the network is worth retrying: the socket didn't come up or closed
   before the oath with a transport code (below 4000). Application codes
   4000-4999 are the node's verdict (foreign seal, slot taken), pins and the
   manifest - incompatibility; a retry doesn't cure them. Parsed by the text of
   connectBot's error (in English, as the SDK writes it): it carries no
   structured code, so the retry list is a whitelist, not a blacklist. Also
   here - an oath the node didn't answer within connectTimeoutMs (SDK: "wire
   closed before the manifest: timeout:5000"), and a close before the manifest
   with a transport code: the lobby lasts init-ms (protocol 3.3), and one failed
   attempt doesn't exhaust it. The tests (test/jitter.test.mjs) pin these texts:
   a new SDK that changes them will fail the tests, not silently in the lobby */
export function retryable(err: unknown): boolean {
  const msg = errText(err);
  if (msg.startsWith('wire did not come up')) return true;
  if (msg.startsWith('wire closed before the manifest: timeout:')) return true;
  const m = /^wire closed before the (?:oath, code |manifest: close:)(\d+)/.exec(msg);
  return m !== null && Number(m[1]) < 4000;
}

export interface RetryOpts {
  tries: number;
  ceilMs: number;
  rnd?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, waitMs: number, err: unknown) => void;
}

export async function withJitter<T>(o: RetryOpts, attempt: () => Promise<T>): Promise<T> {
  const sleep = o.sleep ?? ((ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms)));
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (e) {
      if (n + 1 >= o.tries || !retryable(e)) throw e;
      const wait = backoffMs(n, o.ceilMs, o.rnd);
      o.onRetry?.(n + 1, wait, e);
      await sleep(wait);
    }
  }
}
